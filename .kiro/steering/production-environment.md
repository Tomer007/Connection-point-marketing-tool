# Production Environment — Connection Point Marketing Tool

## Hosting

- **Platform:** Render (Web Service)
- **Service ID:** `srv-d8e18gho3t8c73f115d0`
- **URL:** https://connection-point-marketing-tool.onrender.com
- **Dashboard:** https://dashboard.render.com/web/srv-d8e18gho3t8c73f115d0
- **Region:** Frankfurt
- **Plan:** Free
- **Runtime:** Node.js (v24.14.1)
- **Auto-deploy:** Yes (from `main` branch)
- **Repo:** https://github.com/Tomer007/Connection-point-marketing-tool

## Build & Start Commands

- **Build Command:** `npm run render-build`
  - Runs: `mkdir -p ./bin && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./bin/yt-dlp && chmod a+rx ./bin/yt-dlp && npm install && npm run build`
  - Downloads yt-dlp binary to `./bin/`
  - Installs npm dependencies
  - Runs Vite build to create `dist/` folder
- **Start Command:** `npm run start:prod`
  - Runs: `NODE_ENV=production tsx server/index.ts`
  - Serves static `dist/` folder + API on port 10000

## Environment Variables (must be set in Render dashboard)

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Set automatically |
| `AUTH_USERNAME` | `anna` | Login username |
| `AUTH_PASSWORD` | `yael` | Login password |
| `OPENAI_API_KEY` | (secret) | For Whisper transcription + GPT-4o |
| `ANTHROPIC_API_KEY` | (optional) | For Claude (primary LLM, falls back to OpenAI) |
| `VITE_SERVER_URL` | `` (empty) | Must be empty in production (same-origin) |

## Key Dependencies (runtime)

- **yt-dlp** — Downloaded as standalone binary to `./bin/yt-dlp` during build. Server resolves path via fallback list: `['yt-dlp', './bin/yt-dlp', '/opt/render/.local/bin/yt-dlp']`
- **ffmpeg** — NOT available on Render free tier Node runtime. Video cutting/processing features won't work in production unless Docker runtime is used.

## Common Issues

### 1. `spawn yt-dlp ENOENT`
- **Cause:** yt-dlp binary not installed during build
- **Fix:** Ensure build command is `npm run render-build` (not `: npm run start:prod` or anything else)
- **Verify:** Check build logs for `curl -L https://github.com/yt-dlp/yt-dlp/...`

### 2. `ENOENT: no such file or directory, stat '.../dist/index.html'`
- **Cause:** Vite build didn't run — `dist/` folder doesn't exist
- **Fix:** Ensure build command runs `npm run build` (via `render-build` script)
- **Verify:** Check build logs for `vite build` output and `✓ built in Xs`

### 3. Login fails with correct credentials
- **Cause:** `AUTH_USERNAME` and `AUTH_PASSWORD` env vars not set in Render dashboard
- **Fix:** Add them in https://dashboard.render.com/web/srv-d8e18gho3t8c73f115d0/environment
- **Fallback:** Without env vars, defaults to `admin` / `1234`

### 4. `injected env (0) from .env`
- **This is normal.** The `.env` file is in `.gitignore` and not deployed. All env vars must be set via Render dashboard. The `(0)` means dotenv found no local .env file (expected in production).

## File Paths on Render

- **Project root:** `/opt/render/project/src/`
- **Built frontend:** `/opt/render/project/src/dist/`
- **yt-dlp binary:** `/opt/render/project/src/bin/yt-dlp`
- **Server entry:** `/opt/render/project/src/server/index.ts`

## Port

- Render expects the service to listen on port `10000` (auto-detected)
- Server uses `process.env.PORT || 10000` in production
