import { PipelineStep } from './types';

// localStorage keys
export const STORAGE_KEYS = {
  RECOVERY_PAYLOAD: 'vce_recovery_payload',
  REPORT_CACHE_PREFIX: 'vce_report_cache_',
  TRANSCRIPT_CACHE_PREFIX: 'vce_transcript_cache_',
} as const;

// Cache duration: 48 hours in milliseconds
export const CACHE_TTL_MS = 172_800_000;

// Default podcast name
export const DEFAULT_PODCAST_NAME = 'אנה ויעל | נקודת חיבור';

// Initial pipeline steps
export const INITIAL_STEPS: PipelineStep[] = [
  { id: 1, name: 'תמלול קובץ השמע', state: 'idle' },
  { id: 2, name: 'חילוץ קטעים בעלי פוטנציאל ויראלי', state: 'idle' },
  { id: 3, name: 'תיקוף קטעים מול מדדי ויראליות', state: 'idle' },
  { id: 4, name: 'דירוג ושקלול ציונים', state: 'idle' },
  { id: 5, name: 'הפקת דו"ח תוכן ניהולי מותאם', state: 'idle' },
];

// URL placeholders per platform
export const URL_PLACEHOLDERS: Record<string, string> = {
  youtube: 'e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ or https://youtu.be/...',
  drive: 'e.g., https://drive.google.com/file/d/1X2Y3Z... or share link',
  transcript: '',
};
