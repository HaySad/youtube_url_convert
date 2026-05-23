import { useState } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL || '/api';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const FORMATS = [
  { id: 'mp3',      label: 'MP3',      desc: 'Audio only' },
  { id: 'mp4',      label: 'MP4',      desc: 'Video + Audio' },
  { id: 'maichart', label: 'Maichart', desc: 'track.mp3 + pv.mp4 (.zip)' },
];

const EXT = { mp3: 'mp3', mp4: 'mp4', maichart: 'zip' };
const STATE = { IDLE: 'idle', LOADING: 'loading', DONE: 'done' };

export default function App() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState('');
  const [maiAudio, setMaiAudio] = useState('320kbps');
  const [maiVideo, setMaiVideo] = useState('');
  const [fetching, setFetching] = useState(false);
  const [dlState, setDlState] = useState(STATE.IDLE);
  const [error, setError] = useState('');

  const fetchInfo = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setError('');
    setInfo(null);
    setDlState(STATE.IDLE);
    try {
      const res = await fetch(`${API}/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInfo(data);
      setQuality(data.formats.mp3[0]);
      setMaiVideo(data.formats.mp4[0] || '1080p');
    } catch (e) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  };

  const handleFormatChange = (f) => {
    setFormat(f);
    setDlState(STATE.IDLE);
    if (info) {
      if (f === 'mp3') setQuality(info.formats.mp3[0]);
      else if (f === 'mp4') setQuality(info.formats.mp4[0] || '1080p');
    }
  };

  const handleDownload = async () => {
    if (!info || !url || dlState === STATE.LOADING) return;
    setDlState(STATE.LOADING);
    setError('');

    try {
      const params = new URLSearchParams({ url, format, quality });
      if (format === 'maichart') {
        params.set('audioQuality', maiAudio);
        params.set('videoQuality', maiVideo);
      }

      const res = await fetch(`${API}/download?${params}`);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const blob = await res.blob();
      const ext = EXT[format];
      const filename = `${(info.title || 'video').replace(/[^\w\s-]/g, '').trim() || 'video'}.${ext}`;

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setDlState(STATE.DONE);
      setTimeout(() => setDlState(STATE.IDLE), 4000);
    } catch (e) {
      setError(e.message);
      setDlState(STATE.IDLE);
    }
  };

  const qualityOptions =
    format === 'mp3' ? (info?.formats.mp3 ?? []) :
    format === 'mp4' ? (info?.formats.mp4 ?? []) :
    [];

  const isLoading = dlState === STATE.LOADING;

  const btnClass = [
    'btn-download',
    format === 'maichart' ? 'maichart' : '',
    dlState === STATE.DONE ? 'done' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="app">
      <div className="card">
        <div className="header">
          <div className="logo-icon" />
          <h1>YouTube Downloader</h1>
          <p>Convert YouTube to MP3, MP4 or Maichart</p>
        </div>

        <div className="input-group">
          <input
            type="text"
            placeholder="Paste a YouTube URL here..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchInfo()}
            className="url-input"
          />
          <button onClick={fetchInfo} disabled={fetching || !url.trim()} className="btn-fetch">
            {fetching ? <span className="spinner" /> : 'Search'}
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}

        {info && (
          <div className="video-info">
            <img src={info.thumbnail} alt={info.title} className="thumbnail" />
            <div className="meta">
              <h2>{info.title}</h2>
              <span className="author">{info.author}</span>
              <span className="duration">{formatDuration(info.duration)}</span>
            </div>
          </div>
        )}

        {info && (
          <div className="options">
            <div className="format-tabs">
              {FORMATS.map(f => (
                <button
                  key={f.id}
                  className={`tab ${format === f.id ? 'active' : ''}`}
                  onClick={() => handleFormatChange(f.id)}
                  title={f.desc}
                  disabled={isLoading}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {format === 'maichart' && (
              <>
                <div className="maichart-info">
                  <div className="maichart-icon">ZIP</div>
                  <div>
                    <strong>track.mp3</strong> + <strong>pv.mp4</strong> packaged as a .zip file
                  </div>
                </div>

                <div className="quality-row">
                  <div className="quality-group">
                    <label>Audio quality</label>
                    <select
                      value={maiAudio}
                      onChange={e => setMaiAudio(e.target.value)}
                      className="select"
                      disabled={isLoading}
                    >
                      {(info.formats.mp3 ?? []).map(q => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  </div>

                  <div className="quality-group">
                    <label>Video quality</label>
                    <select
                      value={maiVideo}
                      onChange={e => setMaiVideo(e.target.value)}
                      className="select"
                      disabled={isLoading}
                    >
                      {(info.formats.mp4 ?? []).map(q => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {qualityOptions.length > 0 && format !== 'maichart' && (
              <div className="quality-group">
                <label>Quality</label>
                <select
                  value={quality}
                  onChange={e => setQuality(e.target.value)}
                  className="select"
                  disabled={isLoading}
                >
                  {qualityOptions.map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
            )}

            <button onClick={handleDownload} disabled={isLoading} className={btnClass}>
              {dlState === STATE.LOADING && (
                <>
                  <span className="spinner" />
                  {format === 'maichart'
                    ? 'Processing — downloading 2 files and zipping...'
                    : 'Preparing your file...'}
                </>
              )}
              {dlState === STATE.DONE && (
                <>
                  <span className="checkmark" />
                  File saved to Downloads
                </>
              )}
              {dlState === STATE.IDLE && (
                format === 'mp3' ? 'Download MP3' :
                format === 'mp4' ? 'Download MP4' :
                'Download Maichart (.zip)'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
