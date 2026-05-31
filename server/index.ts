import express from 'express';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';

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
  app.use(express.static(join(import.meta.dirname || '.', '..', 'dist')));
}

// CORS for local dev
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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

// --- Helper: Call LLM (Anthropic with OpenAI fallback) ---
async function callLlm(systemPrompt: string, userMessage: string, maxTokens = 3000): Promise<string> {
  const anthropicKey = process.env.VITE_ANTHROPIC_API_KEY || '';
  const openaiKey = process.env.VITE_OPENAI_API_KEY || '';

  if (anthropicKey) {
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
      return data.content[0].text;
    }

    const errData = await response.json().catch(() => ({}));
    const errMsg = errData?.error?.message || `Anthropic ${response.status}`;

    if (!openaiKey) throw new Error(errMsg);
    console.warn('[LLM] Anthropic failed, falling back to OpenAI:', errMsg);
  }

  if (openaiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `OpenAI ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error('No API keys configured (VITE_ANTHROPIC_API_KEY or VITE_OPENAI_API_KEY).');
}

// --- Helper: Download YouTube audio ---
async function downloadYouTubeAudio(url: string): Promise<Buffer> {
  const id = randomUUID();
  const outputTemplate = join(tmpdir(), `yt-audio-${id}.%(ext)s`);

  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', [
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

// --- Helper: Transcribe with Groq ---
async function transcribeWithGroq(audioBuffer: Buffer): Promise<unknown> {
  const groqKey = process.env.VITE_GROQ_API_KEY;
  if (!groqKey) throw new Error('VITE_GROQ_API_KEY not configured.');

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `Groq API returned ${response.status}`);
  }

  return response.json();
}

// ============================================================
// ROUTES
// ============================================================

/** POST /api/transcribe — Download audio + transcribe via Groq */
app.post('/api/transcribe', async (req, res) => {
  const { url, platform } = req.body;
  if (!url) { res.status(400).json({ error: 'Missing url.' }); return; }

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

    console.log(`[Groq] Transcribing ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB...`);
    const result = await transcribeWithGroq(audioBuffer);
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

// Serve SPA in production — catch-all for client-side routing
if (process.env.NODE_ENV === 'production') {
  app.get('*', (_req, res) => {
    res.sendFile(join(import.meta.dirname || '.', '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🎙️  Server running on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});
