import express from 'express';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

dotenv.config();

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;

// Trust proxy in production (Render uses reverse proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Request size limit
app.use(express.json({ limit: '1mb' }));

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(process.cwd(), 'dist')));
}

// CORS — restrict in production, allow in dev
app.use((_req, res, next) => {
  const origin = process.env.NODE_ENV === 'production'
    ? 'https://connection-point-marketing-tool.onrender.com'
    : '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Rate limiting (P1 #6)
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: 'Too many requests. Please wait a minute.' },
});
app.use('/api/', apiLimiter);

// --- Server-side authentication ---
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '1234';
const SESSION_TOKEN = process.env.SESSION_SECRET || 'cp-session-' + Date.now();

/** POST /api/login — server-side auth */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    res.json({ token: SESSION_TOKEN });
  } else {
    res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  }
});

// --- URL validation helper ---
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const allowedDomains = ['youtube.com', 'youtu.be', 'www.youtube.com', 'drive.google.com', 'docs.google.com'];
    return allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
  } catch { return false; }
}

// --- Time format validation helper ---
function validateTimeFormat(time: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(time);
}

// --- Helper: Call LLM (Anthropic with OpenAI fallback) ---
async function callLlm(systemPrompt: string, userMessage: string, maxTokens = 3000): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const openaiKey = process.env.OPENAI_API_KEY || '';

  if (anthropicKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        if (!text) {
          console.warn('[LLM] Anthropic returned empty content. stop_reason:', data.stop_reason);
          if (!openaiKey) throw new Error('Anthropic returned empty response (possible max_tokens truncation)');
          console.warn('[LLM] Falling back to OpenAI...');
        } else {
          console.log(`[LLM] Anthropic response: ${text.length} chars, stop_reason: ${data.stop_reason}`);
          return text;
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `Anthropic ${response.status}`;
        console.warn('[LLM] Anthropic failed:', errMsg);
        if (!openaiKey) throw new Error(errMsg);
        console.warn('[LLM] Falling back to OpenAI...');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown Anthropic error';
      console.warn('[LLM] Anthropic exception:', errMsg);
      if (!openaiKey) throw err;
      console.warn('[LLM] Falling back to OpenAI...');
    }
  }

  if (openaiKey) {
    const requestBody: Record<string, unknown> = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_completion_tokens: Math.max(maxTokens, 16000),
      temperature: 0.3,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `OpenAI ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log(`[LLM] OpenAI response: ${content.length} chars, finish_reason: ${finishReason}`);
    
    if (finishReason === 'length' && content.length < 100) {
      console.error('[LLM] OpenAI truncated response too short. First 500 chars:', content.substring(0, 500));
      throw new Error('OpenAI response was truncated (too short). The prompt may be too large.');
    }
    
    return content;
  }

  throw new Error('No API keys configured (ANTHROPIC_API_KEY or OPENAI_API_KEY).');
}

// --- Helper: Download YouTube audio ---
async function downloadYouTubeAudio(url: string): Promise<Buffer> {
  const id = randomUUID();
  const outputTemplate = join(tmpdir(), `yt-audio-${id}.%(ext)s`);

  // yt-dlp may be installed via pip in various locations
  const ytdlpPaths = ['yt-dlp', './bin/yt-dlp', '/opt/render/.local/bin/yt-dlp', '/usr/local/bin/yt-dlp'];
  let ytdlpBin = 'yt-dlp';
  
  for (const p of ytdlpPaths) {
    try {
      await execFileAsync(p, ['--version'], { timeout: 5000 });
      ytdlpBin = p;
      break;
    } catch { /* try next */ }
  }

  try {
    const { stdout, stderr } = await execFileAsync(ytdlpBin, [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--no-playlist',
      '--no-warnings',
      '--print', 'after_move:filepath',
      '-o', outputTemplate,
      url,
    ], { timeout: 180_000, maxBuffer: 1024 * 1024 });

    if (stderr) console.warn('[yt-dlp stderr]:', stderr);

    const finalPath = stdout.trim();
    if (!finalPath) throw new Error('yt-dlp did not return an output file path');

    console.log('[yt-dlp] Output file:', finalPath);
    const buffer = await readFile(finalPath);
    await unlink(finalPath).catch(() => {});
    return buffer;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[yt-dlp error]:', message);
    throw new Error(`YouTube download failed: ${message.substring(0, 200)}`);
  }
}

// --- Helper: Download Google Drive audio ---
async function downloadGoogleDriveAudio(url: string): Promise<Buffer> {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  const fileId = match ? match[1] : null;
  if (!fileId) throw new Error('Could not extract Google Drive file ID from URL.');

  const fetchUrl = process.env.VITE_GOOGLE_API_KEY
    ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${process.env.VITE_GOOGLE_API_KEY}`
    : `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;

  const response = await fetch(fetchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    redirect: 'follow',
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || contentType.includes('text/html')) {
    throw new Error('לא ניתן להוריד מגוגל דרייב. ודאו שהקובץ משותף כ-"Anyone with the link".');
  }

  return Buffer.from(await response.arrayBuffer());
}

// --- Helper: Transcribe with OpenAI Whisper ---
async function transcribeWithWhisper(audioBuffer: Buffer): Promise<unknown> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured for transcription.');

  // If file > 24MB, compress it with ffmpeg first
  let finalBuffer = audioBuffer;
  if (audioBuffer.length > 24 * 1024 * 1024) {
    console.log(`[Whisper] File is ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB — compressing with ffmpeg...`);
    finalBuffer = await compressAudio(audioBuffer);
    console.log(`[Whisper] Compressed to ${(finalBuffer.length / 1024 / 1024).toFixed(1)}MB`);
  }

  const formData = new FormData();
  formData.append('file', new Blob([finalBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `OpenAI Whisper API returned ${response.status}`);
  }

  return response.json();
}

// --- Helper: Compress audio with ffmpeg (64kbps mono MP3) ---
async function compressAudio(inputBuffer: Buffer): Promise<Buffer> {
  const inputPath = join(tmpdir(), `input-${randomUUID()}.mp3`);
  const outputPath = join(tmpdir(), `compressed-${randomUUID()}.mp3`);

  try {
    const { writeFile } = await import('fs/promises');
    await writeFile(inputPath, inputBuffer);

    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-ac', '1',           // mono
      '-ar', '16000',       // 16kHz sample rate (optimal for speech)
      '-b:a', '64k',        // 64kbps bitrate
      '-y',                 // overwrite
      outputPath,
    ], { timeout: 120_000 });

    const compressed = await readFile(outputPath);
    return compressed;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// File upload config (max 100MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ============================================================
// ROUTES
// ============================================================

/** POST /api/transcribe-file — Upload audio file + transcribe via OpenAI Whisper */
app.post('/api/transcribe-file', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'הקובץ גדול מדי. הגודל המקסימלי הוא 100MB.' });
        return;
      }
      res.status(400).json({ error: `שגיאה בהעלאת הקובץ: ${err.message}` });
      return;
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'לא התקבל קובץ. אנא העלו קובץ שמע.' });
    return;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    res.status(500).json({ error: 'מפתח OpenAI לא הוגדר בשרת. יש להגדיר OPENAI_API_KEY.' });
    return;
  }

  try {
    console.log(`[Upload] Received ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);
    const result = await transcribeWithWhisper(req.file.buffer);
    console.log(`[Upload] Transcription complete.`);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'שגיאה בתמלול הקובץ.';
    console.error('[transcribe-file error]:', message);
    res.status(502).json({ error: message });
  }
});

/** POST /api/transcribe — Download audio + transcribe via OpenAI Whisper */
app.post('/api/transcribe', async (req, res) => {
  const { url, platform } = req.body;
  if (!url) { res.status(400).json({ error: 'Missing url.' }); return; }
  if (!validateUrl(url)) { res.status(400).json({ error: 'קישור לא תקין. נתמכים: YouTube, Google Drive.' }); return; }

  try {
    let audioBuffer: Buffer;

    if (platform === 'YouTube') {
      console.log(`[YouTube] Downloading: ${url}`);
      audioBuffer = await downloadYouTubeAudio(url);
    } else if (platform === 'Google Drive') {
      console.log(`[Drive] Downloading: ${url}`);
      audioBuffer = await downloadGoogleDriveAudio(url);
    } else {
      const response = await fetch(url, { headers: { 'User-Agent': 'PodcastTool/1.0' }, redirect: 'follow' });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      audioBuffer = Buffer.from(await response.arrayBuffer());
    }

    console.log(`[Whisper] Transcribing ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB...`);
    const result = await transcribeWithWhisper(audioBuffer);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Transcription failed.';
    console.error('[transcribe error]:', message);
    res.status(502).json({ error: message });
  }
});

/** POST /api/llm — Generic LLM call (used by pipeline steps 2-4) */
app.post('/api/llm', async (req, res) => {
  const { systemPrompt, userMessage, maxTokens } = req.body;
  if (!systemPrompt || !userMessage) {
    res.status(400).json({ error: 'Missing systemPrompt or userMessage.' });
    return;
  }

  try {
    const result = await callLlm(systemPrompt, userMessage, maxTokens || 3000);
    res.json({ text: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'LLM call failed.';
    console.error('[llm error]:', message);
    res.status(502).json({ error: message });
  }
});

/** POST /api/generate-content — Content Generator endpoint */
app.post('/api/generate-content', async (req, res) => {
  const { systemPrompt, userMessage } = req.body;
  if (!systemPrompt || !userMessage) {
    res.status(400).json({ error: 'Missing systemPrompt or userMessage.' });
    return;
  }

  try {
    const result = await callLlm(systemPrompt, userMessage, 2000);
    res.json({ text: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Content generation failed.';
    console.error('[generate-content error]:', message);
    res.status(502).json({ error: message });
  }
});

/** POST /api/cut-clip — Download YouTube video segment and return as downloadable clip */
app.post('/api/cut-clip', async (req, res) => {
  const { url, startTime, endTime, title } = req.body;
  if (!url || !startTime || !endTime) {
    res.status(400).json({ error: 'Missing url, startTime, or endTime.' });
    return;
  }
  if (!validateUrl(url)) {
    res.status(400).json({ error: 'קישור לא תקין. נתמכים: YouTube, Google Drive.' });
    return;
  }
  if (!validateTimeFormat(startTime) || !validateTimeFormat(endTime)) {
    res.status(400).json({ error: 'פורמט זמן לא תקין. השתמשו ב-MM:SS.' });
    return;
  }

  const id = randomUUID();
  const outputPath = join(tmpdir(), `clip-${id}.mp4`);

  try {
    // Convert MM:SS to seconds
    const parseTime = (t: string): number => {
      const parts = t.split(':').map(Number);
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return 0;
    };

    const startSec = parseTime(startTime);
    const endSec = parseTime(endTime);
    const duration = endSec - startSec;

    if (duration <= 0 || duration > 120) {
      res.status(400).json({ error: 'משך הקליפ חייב להיות בין 1 ל-120 שניות.' });
      return;
    }

    console.log(`[Cut] Downloading & cutting ${url} [${startTime} → ${endTime}] (${duration}s)`);

    // Use yt-dlp to download the video segment
    const downloadPath = join(tmpdir(), `dl-${id}.mp4`);

    // Download with section cutting using yt-dlp
    const { stdout: dlStdout, stderr: dlStderr } = await execFileAsync('yt-dlp', [
      '--format', 'best[height<=1080][ext=mp4]/best[ext=mp4]/best',
      '--no-playlist',
      '--no-warnings',
      '--print', 'after_move:filepath',
      '--download-sections', `*${startTime}-${endTime}`,
      '--force-keyframes-at-cuts',
      '-o', downloadPath,
      url,
    ], { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });

    if (dlStderr) console.warn('[yt-dlp stderr]:', dlStderr);

    const downloadedFile = dlStdout.trim();
    if (!downloadedFile) throw new Error('yt-dlp did not return an output file path');

    console.log(`[Cut] Downloaded segment: ${downloadedFile}`);

    // Step 2: Re-encode to Instagram Reel format (9:16, 1080x1920)
    await execFileAsync('ffmpeg', [
      '-i', downloadedFile,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: 120_000 });

    // Clean up downloaded file
    await unlink(downloadedFile).catch(() => {});

    console.log(`[Cut] Clip ready: ${outputPath}`);

    // Send the clip file
    const clipBuffer = await readFile(outputPath);
    const safeFilename = `clip_${id.substring(0, 8)}.mp4`;
    const utf8Filename = `${(title || 'clip').replace(/[^\w\u0590-\u05FF\s-]/g, '').trim().replace(/\s+/g, '_')}.mp4`;

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(utf8Filename)}`);
    res.setHeader('Content-Length', clipBuffer.length.toString());
    res.send(clipBuffer);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Clip cutting failed.';
    console.error('[cut-clip error]:', message);
    res.status(502).json({ error: message });
  } finally {
    await unlink(outputPath).catch(() => {});
  }
});

// Serve SPA in production — catch-all for client-side routing
if (process.env.NODE_ENV === 'production') {
  app.get('*', (_req, res) => {
    res.sendFile(join(process.cwd(), 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🎙️  Server running on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});
