# YouTube Downloader

A web application for downloading YouTube videos as MP3, MP4, or a Maichart bundle (track.mp3 + pv.mp4 in a .zip file).

---

## Tech Stack

**Frontend**
- React 19 (Vite)
- Deployed to GitHub Pages via GitHub Actions

**Backend**
- Node.js + Express
- yt-dlp — YouTube extraction
- ffmpeg-static + fluent-ffmpeg — audio/video conversion
- adm-zip — zip packaging for Maichart bundles
- Deployed to Render.com

---

## Local Development

### Prerequisites

- Node.js 18 or higher
- npm

### Setup

```bash
# Install all dependencies
npm install
npm install --prefix client

# Start both backend and frontend
npm run dev
```

- Frontend: http://localhost:5174
- Backend API: http://localhost:3001

---

## Deployment

This project uses a split deployment: the frontend is served as a static site on GitHub Pages and the backend runs as a Node.js web service on Render.

### Backend — Render.com

1. Push the repository to GitHub.
2. Go to [render.com](https://render.com) and create a new **Web Service**.
3. Connect your GitHub repository.
4. Render will detect `render.yaml` automatically and apply the following settings:
   - **Build command:** `npm install && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./node_modules/yt-dlp-exec/bin/yt-dlp && chmod +x ./node_modules/yt-dlp-exec/bin/yt-dlp`
   - **Start command:** `node server/index.js`
5. Add the required environment variables (see below).
6. Deploy. The service URL will look like `https://your-app.onrender.com`.

> Note: The free tier on Render spins down after 15 minutes of inactivity. The first request after a sleep period may take around 30 seconds.

### Frontend — GitHub Pages

1. Go to your GitHub repository settings.
2. Under **Pages**, set the source to **GitHub Actions**.
3. Under **Environments**, open the `github-pages` environment and add the following variables:
   - `VITE_API_URL` — the full URL to your Render backend API, e.g. `https://your-app.onrender.com/api`
   - `VITE_BASE_PATH` — the repository name with a leading slash, e.g. `/youtube_url_convert`
4. Push to the `main` branch. The workflow in `.github/workflows/deploy.yml` will build and deploy the frontend automatically.
5. The site will be available at `https://<your-username>.github.io/<repo-name>/`.

---

## Environment Variables

### Backend (set on Render)

| Variable | Required | Description |
|---|---|---|
| `YOUTUBE_COOKIES` | Yes | Netscape-format cookies exported from a browser while logged into YouTube. Required to bypass YouTube bot detection on server environments. |
| `NODE_ENV` | No | Set to `production` by `render.yaml` automatically. |

### Frontend (set as GitHub Actions variables in the `github-pages` environment)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Full URL of the backend API including `/api`, e.g. `https://your-app.onrender.com/api`. |
| `VITE_BASE_PATH` | Yes | Repository name with a leading slash, e.g. `/youtube_url_convert`. Used to set the Vite base path for GitHub Pages project sites. |

---

## How to Export YouTube Cookies

YouTube requires authentication cookies when yt-dlp runs on a server to confirm the request is not from a bot.

1. Install the **Get cookies.txt LOCALLY** extension in Chrome or Edge.
2. Log in to [youtube.com](https://youtube.com).
3. Click the extension and export cookies for `youtube.com` in **Netscape** format.
4. Copy the full contents of the exported file.
5. Paste it as the value of the `YOUTUBE_COOKIES` environment variable on Render.

Cookies expire after approximately 2 to 4 weeks. When the bot detection error reappears, repeat this process and update the variable on Render.

---

## Project Structure

```
.
├── api/
│   └── index.js          # Re-exports the Express app for Vercel (alternative deployment)
├── client/               # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   └── App.css
│   └── vite.config.js
├── server/
│   └── index.js          # Express API server
├── .github/
│   └── workflows/
│       └── deploy.yml    # GitHub Actions workflow for GitHub Pages deployment
├── render.yaml           # Render deployment configuration
├── vercel.json           # Vercel deployment configuration (alternative)
└── package.json
```
