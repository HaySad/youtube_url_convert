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

export default function App() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const fetchInfo = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setInfo(null);
    try {
      const res = await fetch(`${API}/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInfo(data);
      setQuality(data.formats.mp3[0]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFormatChange = (f) => {
    setFormat(f);
    if (info) {
      if (f === 'mp3') setQuality(info.formats.mp3[0]);
      else if (f === 'mp4') setQuality(info.formats.mp4[0] || '1080p');
      else setQuality('');
    }
  };

  const handleDownload = () => {
    if (!info || !url) return;
    setDownloading(true);
    setError('');
    const params = new URLSearchParams({ url, format, quality });
    const a = document.createElement('a');
    a.href = `${API}/download?${params}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloading(false), format === 'maichart' ? 10000 : 3000);
  };

  const qualityOptions =
    format === 'mp3' ? (info?.formats.mp3 ?? []) :
    format === 'mp4' ? (info?.formats.mp4 ?? []) :
    [];

  const downloadLabel =
    format === 'mp3' ? 'Download MP3' :
    format === 'mp4' ? 'Download MP4' :
    'Download Maichart (.zip)';

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
          <button onClick={fetchInfo} disabled={loading || !url.trim()} className="btn-fetch">
            {loading ? <span className="spinner" /> : 'Search'}
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
                >
                  {f.label}
                </button>
              ))}
            </div>

            {format === 'maichart' && (
              <div className="maichart-info">
                <div className="maichart-icon">ZIP</div>
                <div>
                  <strong>track.mp3</strong> — Audio at 320kbps<br />
                  <strong>pv.mp4</strong> — Best available video quality
                </div>
              </div>
            )}

            {qualityOptions.length > 0 && (
              <div className="quality-group">
                <label>Quality</label>
                <select value={quality} onChange={e => setQuality(e.target.value)} className="select">
                  {qualityOptions.map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              className={`btn-download ${format === 'maichart' ? 'maichart' : ''}`}
            >
              {downloading
                ? <><span className="spinner" /> Downloading{format === 'maichart' ? ' (this may take a moment...)' : ''}...</>
                : downloadLabel
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
