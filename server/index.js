const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

const LOCAL_BIN = path.join(__dirname, '..', 'yt-dlp');
let ytdlpBin = 'yt-dlp';

function downloadYtDlp(dest) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https.get(url, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) { follow(res.headers.location); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} downloading yt-dlp`)); return; }
        const tmp = dest + '.tmp';
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          fs.renameSync(tmp, dest);
          fs.chmodSync(dest, 0o755);
          console.log('yt-dlp downloaded to', dest);
          resolve(dest);
        }));
        file.on('error', (e) => { fs.unlink(tmp, () => {}); reject(e); });
      }).on('error', reject);
    };
    follow('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux');
  });
}

async function resolveYtDlpBin() {
  if (process.platform === 'win32') {
    try {
      const { YOUTUBE_DL_PATH } = require('yt-dlp-exec/src/constants');
      if (fs.existsSync(YOUTUBE_DL_PATH)) return YOUTUBE_DL_PATH;
    } catch (_) {}
    return 'yt-dlp';
  }
  if (fs.existsSync(LOCAL_BIN)) return LOCAL_BIN;
  console.log('yt-dlp not found, downloading standalone Linux binary...');
  return downloadYtDlp(LOCAL_BIN);
}

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

// Helper: fetch video metadata via yt-dlp --dump-single-json
function fetchVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpBin, [
      url, ...YTDLP_BASE_ARGS,
      '--dump-single-json', '--no-warnings', '--skip-download', '--no-check-certificates',
    ]);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; process.stderr.write(d); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) reject(new Error(err.trim() || `yt-dlp exited with code ${code}`));
      else {
        try { resolve(JSON.parse(out)); }
        catch (e) { reject(new Error('Failed to parse yt-dlp output')); }
      }
    });
  });
}

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
    const cmd = ffmpeg(ytdlpProc.stdout)
      .audioBitrate(bitrate)
      .format('mp3')
      .output(tmpFile);
    cmd.on('error', reject);
    cmd.on('end', () => resolve(tmpFile));
    cmd.run();
    ytdlpProc.on('error', reject);
  });
}

app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const info = await fetchVideoInfo(url);

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
  const { url, format, quality, audioQuality, videoQuality } = req.query;
  if (!url || !format) return res.status(400).json({ error: 'URL and format are required' });

  try {
    const info = await fetchVideoInfo(url);

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

      // Flush headers immediately so Render's proxy doesn't timeout waiting for a response
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeTitle}.zip`);
      res.flushHeaders();

      const bitrateMap = { '320kbps': '320k', '192kbps': '192k', '128kbps': '128k' };
      const audioBitrate = bitrateMap[audioQuality] || '320k';
      const heightMatch = (videoQuality || 'best').match(/(\d+)/);
      const videoHeight = heightMatch ? heightMatch[1] : null;
      const videoFormatSelector = videoHeight
        ? `bestvideo[height<=${videoHeight}]+bestaudio/best[height<=${videoHeight}]/best`
        : 'bestvideo+bestaudio/best';

      console.log(`Maichart: audio=${audioBitrate}, video=${videoQuality || 'best'}`);

      try {
        await Promise.all([
          audioToMp3Tmp(url, audioBitrate, tmpMp3),
          downloadToTmp(url, [
            '-f', videoFormatSelector,
            '--no-playlist',
            '--merge-output-format', 'mp4',
            '--ffmpeg-location', path.dirname(ffmpegPath),
          ], tmpMp4),
        ]);
      } catch (err) {
        cleanup();
        res.end();
        return;
      }

      const zip = new AdmZip();
      zip.addLocalFile(tmpMp3, '', 'track.mp3');
      zip.addLocalFile(tmpMp4, '', 'pv.mp4');
      const zipBuf = zip.toBuffer();
      cleanup();
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
  resolveYtDlpBin().then(bin => {
    ytdlpBin = bin;
    console.log('yt-dlp binary:', ytdlpBin);
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  }).catch(err => {
    console.error('Failed to resolve yt-dlp binary:', err.message);
    process.exit(1);
  });
}

module.exports = app;
