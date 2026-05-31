const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

/**
 * Call the backend LLM proxy endpoint.
 */
export async function callServerLlm(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 3000
): Promise<string> {
  const response = await fetch(`${SERVER_URL}/api/llm`, {
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
  const response = await fetch(`${SERVER_URL}/api/generate-content`, {
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
