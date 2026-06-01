const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

/**
 * Retry wrapper with exponential backoff.
 * Retries on 5xx errors and network failures, not on 4xx client errors.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry client errors (4xx)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      // Server error (5xx) — retry
      if (attempt < retries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[API] Server error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < retries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[API] Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Call the backend LLM proxy endpoint.
 */
export async function callServerLlm(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 3000
): Promise<string> {
  const response = await fetchWithRetry(`${SERVER_URL}/api/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userMessage, maxTokens }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error || `שגיאה מהשרת: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}

/**
 * Call the backend content generation endpoint.
 */
export async function generateContentServer(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await fetchWithRetry(`${SERVER_URL}/api/generate-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userMessage }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error || `שגיאה מהשרת: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}
