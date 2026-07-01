import { STORAGE_KEYS, CACHE_TTL_MS } from '../constants';
import { formatWhisperSegments } from './helpers';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

interface TranscribeResult {
  transcript: string;
  fromCache: boolean;
}

/**
 * Check localStorage cache for a transcript (shared across all tabs).
 */
export function getCachedTranscript(cacheKey: string): string | null {
  const cached = localStorage.getItem(cacheKey);
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached);
    if (parsed.transcript && Date.now() - parsed.timestamp <= CACHE_TTL_MS) {
      return parsed.transcript;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Store a transcript in localStorage cache.
 */
function cacheTranscript(cacheKey: string, transcript: string): void {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ transcript, timestamp: Date.now() }));
  } catch { /* quota exceeded — silently fail */ }
}

/**
 * Parse Whisper API response into timestamped transcript string.
 */
function parseWhisperResponse(data: { segments?: { start: number; text: string }[]; text?: string }): string {
  if (data.segments && Array.isArray(data.segments)) {
    return formatWhisperSegments(data.segments);
  }
  if (data.text) {
    return data.text;
  }
  return '';
}

/**
 * Transcribe from a URL (YouTube or Google Drive).
 * Uses shared localStorage cache (works across all tabs).
 */
export async function transcribeFromUrl(targetUrl: string): Promise<TranscribeResult> {
  const cacheKey = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_${targetUrl.trim()}`;

  // Check cache first
  const cached = getCachedTranscript(cacheKey);
  if (cached) {
    return { transcript: cached, fromCache: true };
  }

  const platform = targetUrl.includes('drive.google') ? 'Google Drive' : 'YouTube';

  const response = await fetch(`${SERVER_URL}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: targetUrl.trim(), platform }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error || `שגיאה בתמלול (${response.status})`);
  }

  const data = await response.json();
  const transcript = parseWhisperResponse(data);

  cacheTranscript(cacheKey, transcript);
  return { transcript, fromCache: false };
}

/**
 * Transcribe from an uploaded file.
 * Uses shared localStorage cache keyed by filename + size (works across all tabs).
 */
export async function transcribeFromFile(file: File): Promise<TranscribeResult> {
  const cacheKey = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}file_${file.name}_${file.size}`;

  // Check cache first
  const cached = getCachedTranscript(cacheKey);
  if (cached) {
    return { transcript: cached, fromCache: true };
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${SERVER_URL}/api/transcribe-file`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error || `שגיאה בתמלול הקובץ (${response.status})`);
  }

  const data = await response.json();
  let transcript = parseWhisperResponse(data);
  if (!transcript && data.text) {
    transcript = `[00:00] ${data.text}`;
  }

  cacheTranscript(cacheKey, transcript);
  return { transcript, fromCache: false };
}

/**
 * Get cache key for a URL.
 */
export function getUrlCacheKey(url: string): string {
  return `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_${url.trim()}`;
}

/**
 * Get cache key for a file.
 */
export function getFileCacheKey(file: File): string {
  return `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}file_${file.name}_${file.size}`;
}


/**
 * Get all cached transcripts from localStorage (from any tab/source).
 * Returns an array of { label, cacheKey, wordCount, timestamp }.
 */
export function getSavedTranscripts(): Array<{ label: string; cacheKey: string; wordCount: number; timestamp: number }> {
  const results: Array<{ label: string; cacheKey: string; wordCount: number; timestamp: number }> = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        if (!parsed.transcript || Date.now() - parsed.timestamp > CACHE_TTL_MS) continue;

        // Extract a human-readable label from the cache key
        let label = '';
        if (key.startsWith(`${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_`)) {
          const url = key.replace(`${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_`, '');
          // Shorten URL for display
          try {
            const u = new URL(url);
            label = u.hostname.replace('www.', '') + u.pathname.substring(0, 30);
          } catch {
            label = url.substring(0, 40);
          }
        } else if (key.startsWith(`${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}file_`)) {
          const parts = key.replace(`${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}file_`, '');
          // Format: filename_size
          const lastUnderscore = parts.lastIndexOf('_');
          label = lastUnderscore > 0 ? parts.substring(0, lastUnderscore) : parts;
        } else {
          continue;
        }

        const wc = parsed.transcript.split(/\s+/).filter(Boolean).length;
        results.push({ label, cacheKey: key, wordCount: wc, timestamp: parsed.timestamp });
      } catch { /* skip malformed entries */ }
    }
  } catch { /* localStorage access failed */ }

  // Sort by most recent first
  return results.sort((a, b) => b.timestamp - a.timestamp);
}
