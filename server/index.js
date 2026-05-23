const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

const { YOUTUBE_DL_PATH } = require('yt-dlp-exec/src/constants');
const ytdlpBin = fs.existsSync(YOUTUBE_DL_PATH) ? YOUTUBE_DL_PATH : 'yt-dlp';

const YTDLP_BASE_ARGS = ['--js-runtimes', `node:${process.execPath}`];

// Write cookies from env var to a temp file so yt-dlp can authenticate with YouTube
const COOKIES_FILE = path.join(os.tmpdir(), 'yt_cookies.txt');
if (process.env.YOUTUBE_COOKIES) {
  fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES);
  YTDLP_BASE_ARGS.push('--cookies', COOKIES_FILE);
  console.log('YouTube cookies loaded.');
}

const app = express();
app.use(cors());
app.use(express.json());

// Helper: download to temp file via yt-dlp
function downloadToTmp(url, extraArgs, tmpFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpBin, [url, ...YTDLP_BASE_ARGS, ...extraArgs, '-o', tmpFile]);
    proc.stderr.on('data', d => process.stderr.write(d));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`yt-dlp exited with code ${code}`));
      else resolve(tmpFile);
    });
  });
}

// Helper: download audio via yt-dlp, convert to MP3 temp file via ffmpeg
function audioToMp3Tmp(url, bitrate, tmpFile) {
  return new Promise((resolve, reject) => {
    const ytdlpProc = spawn(ytdlpBin, [
      url, ...YTDLP_BASE_ARGS,
      '-f', 'bestaudio', '--no-playlist', '-o', '-',
    ]);
    ffmpeg(ytdlpProc.stdout)
      .audioBitrate(bitrate)
      .format('mp3')
      .on('error', err => reject(err))
      .on('end', () => resolve(tmpFile))
      .save(tmpFile);
    ytdlpProc.on('error', reject);
  });
}

app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true,
      noCheckCertificates: true,
      jsRuntimes: `node:${process.execPath}`,
    });

    const qualities = [
      ...new Set(
        (info.formats || [])
          .filter(f => f.vcodec !== 'none' && f.height)
          .map(f => `${f.height}p`)
      ),
    ].sort((a, b) => parseInt(b) - parseInt(a));

    res.json({
      title: info.title,
      author: info.uploader || info.channel || '',
      thumbnail: info.thumbnail,
      duration: info.duration || 0,
      formats: {
        mp4: qualities.length > 0 ? qualities : ['1080p', '720p', '480p', '360p'],
        mp3: ['320kbps', '192kbps', '128kbps'],
      },
    });
  } catch (err) {
    console.error('Info error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch video info' });
  }
});

app.get('/api/download', async (req, res) => {
  const { url, format, quality } = req.query;
  if (!url || !format) return res.status(400).json({ error: 'URL and format are required' });

  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true,
      jsRuntimes: `node:${process.execPath}`,
    });

    const title = (info.title || 'video').replace(/[^\w\s\-ก-๙]/g, '').trim() || 'video';
    const safeTitle = encodeURIComponent(title);

    if (format === 'mp3') {
      const bitrateMap = { '320kbps': '320k', '192kbps': '192k', '128kbps': '128k' };
      const bitrate = bitrateMap[quality] || '192k';

      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeTitle}.mp3`);
      res.setHeader('Content-Type', 'audio/mpeg');

      const ytdlpProc = spawn(ytdlpBin, [
        url, ...YTDLP_BASE_ARGS,
        '-f', 'bestaudio', '--no-playlist', '-o', '-',
      ]);
      ytdlpProc.on('error', err => {
        console.error('yt-dlp error:', err.message);
        if (!res.headersSent) res.status(500).end();
      });

      ffmpeg(ytdlpProc.stdout)
        .audioBitrate(bitrate)
        .format('mp3')
        .on('error', err => {
          console.error('FFmpeg error:', err.message);
          if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);

      req.on('close', () => ytdlpProc.kill());

    } else if (format === 'mp4') {
      const heightMatch = (quality || '1080').match(/(\d+)/);
      const height = heightMatch ? heightMatch[1] : '1080';
      const formatSelector = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
      const tmpFile = path.join(os.tmpdir(), `ytdl_${Date.now()}.mp4`);

      const ytdlpProc = spawn(ytdlpBin, [
        url, ...YTDLP_BASE_ARGS,
        '-f', formatSelector,
        '--no-playlist',
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', path.dirname(ffmpegPath),
        '-o', tmpFile,
      ]);

      ytdlpProc.on('error', err => {
        console.error('yt-dlp error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });
      ytdlpProc.stderr.on('data', d => process.stderr.write(d));

      ytdlpProc.on('close', code => {
        if (code !== 0) {
          fs.unlink(tmpFile, () => {});
          if (!res.headersSent) res.status(500).json({ error: `yt-dlp exited with code ${code}` });
          return;
        }
        const stat = fs.statSync(tmpFile);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeTitle}.mp4`);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', stat.size);
        const stream = fs.createReadStream(tmpFile);
        stream.pipe(res);
        stream.on('close', () => fs.unlink(tmpFile, () => {}));
      });

      req.on('close', () => {
        ytdlpProc.kill();
        fs.unlink(tmpFile, () => {});
      });

    } else if (format === 'maichart') {
      const ts = Date.now();
      const tmpMp3 = path.join(os.tmpdir(), `ytdl_track_${ts}.mp3`);
      const tmpMp4 = path.join(os.tmpdir(), `ytdl_pv_${ts}.mp4`);
      const cleanup = () => { fs.unlink(tmpMp3, () => {}); fs.unlink(tmpMp4, () => {}); };

      console.log('Maichart: downloading track.mp3 + pv.mp4 in parallel...');

      try {
        await Promise.all([
          audioToMp3Tmp(url, '320k', tmpMp3),
          downloadToTmp(url, [
            '-f', 'bestvideo+bestaudio/best',
            '--no-playlist',
            '--merge-output-format', 'mp4',
            '--ffmpeg-location', path.dirname(ffmpegPath),
          ], tmpMp4),
        ]);
      } catch (err) {
        cleanup();
        if (!res.headersSent) res.status(500).json({ error: err.message });
        return;
      }

      // Build zip in memory (adm-zip) then send
      const zip = new AdmZip();
      zip.addLocalFile(tmpMp3, '', 'track.mp3');
      zip.addLocalFile(tmpMp4, '', 'pv.mp4');
      const zipBuf = zip.toBuffer();
      cleanup();

      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeTitle}.zip`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', zipBuf.length);
      res.end(zipBuf);

    } else {
      res.status(400).json({ error: 'Invalid format' });
    }
  } catch (err) {
    console.error('Download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Download failed' });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = app;
