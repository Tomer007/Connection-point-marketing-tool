/**
 * Convert an image URL/import to a base64 data URL.
 */
export async function imageToBase64(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return imageUrl;
  }
}

/**
 * Trigger a file download from in-memory content.
 */
export function downloadBlob(content: string, filename: string, mimeType = 'text/html;charset=utf-8;'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Get the metric badge color class based on score value.
 */
export function getMetricBadgeClass(score: number): string {
  if (score >= 8) return 'text-cp-sage-deep bg-cp-sage/15 border border-cp-sage/30';
  if (score >= 6) return 'text-cp-ochre bg-cp-ochre/15 border border-cp-ochre/30';
  return 'text-cp-clay bg-cp-clay/15 border border-cp-clay/30';
}

/**
 * Format a date in Hebrew locale.
 */
export function formatHebrewDate(): string {
  return new Date().toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
}

/**
 * Format Whisper segments into timestamped transcript lines.
 */
export function formatWhisperSegments(segments: { start: number; text: string }[]): string {
  return segments
    .map(seg => {
      const min = Math.floor(seg.start / 60);
      const sec = Math.floor(seg.start % 60);
      return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${seg.text}`;
    })
    .join('\n');
}

/**
 * Safely copy text to clipboard with fallback for non-HTTPS contexts.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern clipboard API first
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: textarea + execCommand
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch {
      console.warn('Clipboard write failed (both methods)');
      return false;
    }
  }
}


/**
 * Count words in a text string.
 */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
