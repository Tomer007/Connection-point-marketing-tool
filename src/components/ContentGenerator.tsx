import { useState, useCallback } from 'react';
import { Sparkles, Loader2, Copy, ClipboardCheck, RotateCcw, RefreshCw, Link } from 'lucide-react';
import { copyToClipboard } from '../utils/helpers';
import { generateContentServer } from '../utils/api';
import { CONTENT_GENERATOR_PROMPT } from '../utils/prompts';
import { STORAGE_KEYS, CACHE_TTL_MS } from '../constants';
import Markdown from 'react-markdown';

type ContentFormat = 'reels' | 'instagram' | 'email';

const FORMAT_LABELS: Record<ContentFormat, string> = {
  reels: 'Reels / TikTok',
  instagram: 'Instagram / Facebook',
  email: 'Email / Newsletter',
};

const FORMAT_BUTTON_LABELS: Record<ContentFormat, string> = {
  reels: 'צור סקריפט רילס',
  instagram: 'צור פוסט',
  email: 'צור אימייל',
};

const CONTENT_TYPES: Record<ContentFormat, string> = {
  reels: 'reel script',
  instagram: 'post',
  email: 'email',
};

const TONE_PRESETS = [
  { value: 'warm-spiritual', label: 'חם ורוחני' },
  { value: 'bold-direct', label: 'ישיר ונועז' },
  { value: 'soft-inviting', label: 'רך ומזמין' },
  { value: 'playful-light', label: 'קליל ומשחקי' },
  { value: 'professional', label: 'מקצועי וסמכותי' },
  { value: 'storytelling', label: 'סיפורי ואישי' },
  { value: 'custom', label: 'מותאם אישית...' },
];

const TEMPLATES = [
  {
    label: 'קידום פרק פודקאסט',
    content: '',
    fields: [
      { key: 'transcript', label: 'תמלול הפרק', placeholder: 'הדביקו כאן את תמלול הפרק (או חלק ממנו)...', multiline: true },
    ],
    buildContent: (fields: Record<string, string>) =>
      `קידום פרק פודקאסט "זה כבר קרה"\n\nתמלול:\n${fields.transcript || ''}`,
  },
  {
    label: 'הזמנה לריטריט',
    content: '',
    fields: [
      { key: 'details', label: 'פרטי הריטריט', placeholder: 'כתבו בחופשיות: שם הריטריט, תאריך, מיקום, נושא/חוויה מרכזית, קהל יעד...', multiline: true },
    ],
    buildContent: (fields: Record<string, string>) =>
      `הזמנה לריטריט של נקודת חיבור\n\n${fields.details || ''}`,
  },
  {
    label: 'ציטוט השראה',
    content: '',
    fields: [
      { key: 'details', label: 'הציטוט והקשר', placeholder: 'כתבו בחופשיות: הציטוט עצמו, מי אמר (אופציונלי), מאיזה פרק, ובאיזה הקשר נאמר...', multiline: true },
    ],
    buildContent: (fields: Record<string, string>) =>
      `ציטוט השראה\n\n${fields.details || ''}`,
  },
  {
    label: 'שיתוף אישי',
    content: '',
    fields: [
      { key: 'details', label: 'השיתוף', placeholder: 'כתבו בחופשיות: מה קרה, מה הרגשתם, מה למדתם מזה...', multiline: true },
    ],
    buildContent: (fields: Record<string, string>) =>
      `שיתוף אישי של אנה ויעל\n\n${fields.details || ''}`,
  },
];

export function ContentGenerator() {
  const [content, setContent] = useState('');
  const [request, setRequest] = useState('');
  const [format, setFormat] = useState<ContentFormat>('reels');
  const [tonePreset, setTonePreset] = useState('warm-spiritual');
  const [customTone, setCustomTone] = useState('');
  const [result, setResult] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(0);
  const [templateFields, setTemplateFields] = useState<Record<string, string>>({});
  const [inputMode, setInputMode] = useState<'transcript' | 'url'>('transcript');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');

  const getSelectedTone = useCallback(() => {
    if (tonePreset === 'custom') return customTone || 'warm and spiritual';
    return TONE_PRESETS.find(t => t.value === tonePreset)?.label || 'warm and spiritual';
  }, [tonePreset, customTone]);

  const handleGenerate = useCallback(async () => {
    setError('');
    
    // Build content from template fields or free-form input
    let finalContent = content;
    if (selectedTemplate !== null) {
      const template = TEMPLATES[selectedTemplate];

      // If podcast template (index 0) with URL mode, transcribe first
      if (selectedTemplate === 0 && inputMode === 'url') {
        if (!youtubeUrl.trim()) {
          setError('אנא הזינו קישור YouTube.');
          return;
        }

        let transcript = transcribedText;
        if (!transcript.trim()) {
          setIsTranscribing(true);
          try {
            // Check cache
            const cacheKey = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_${youtubeUrl.trim()}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (parsed.transcript && Date.now() - parsed.timestamp <= CACHE_TTL_MS) {
                transcript = parsed.transcript;
              }
            }

            if (!transcript.trim()) {
              const serverUrl = import.meta.env.VITE_SERVER_URL || '';
              const response = await fetch(`${serverUrl}/api/transcribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: youtubeUrl.trim(), platform: 'YouTube' }),
              });

              if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData?.error || `שגיאה בתמלול (${response.status})`);
              }

              const data = await response.json();
              if (data.segments && Array.isArray(data.segments)) {
                transcript = data.segments
                  .map((seg: { start: number; text: string }) => {
                    const min = Math.floor(seg.start / 60);
                    const sec = Math.floor(seg.start % 60);
                    return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${seg.text}`;
                  })
                  .join('\n');
              } else if (data.text) {
                transcript = data.text;
              }

              // Cache
              try {
                localStorage.setItem(cacheKey, JSON.stringify({ transcript, timestamp: Date.now() }));
              } catch { /* quota */ }
            }

            setTranscribedText(transcript);
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'שגיאה בתמלול.');
            setIsTranscribing(false);
            return;
          } finally {
            setIsTranscribing(false);
          }
        }

        finalContent = `קידום פרק פודקאסט\n\nתמלול:\n${transcript}`;
      } else {
        // Check if user actually filled in data
        const hasInput = Object.values(templateFields).some(v => v.trim().length > 0);
        if (!hasInput) {
          setError('אנא הזינו תוכן לפני היצירה.');
          return;
        }
        finalContent = template.buildContent(templateFields);
      }
    }

    if (!finalContent.trim()) {
      setError('אנא מלאו את השדות הנדרשים.');
      return;
    }

    setIsGenerating(true);
    setResult('');

    try {
      const tone = getSelectedTone();
      const userMessage = `Target platform: ${FORMAT_LABELS[format]}
Content type: ${CONTENT_TYPES[format]}
Tone: ${tone}
Language: Hebrew

RAW INPUT:
${finalContent}

${request ? `Additional instructions: ${request}` : ''}`;

      const generatedText = await generateContentServer(CONTENT_GENERATOR_PROMPT, userMessage);
      setResult(generatedText);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'שגיאה ביצירת התוכן.';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [content, request, format, getSelectedTone, selectedTemplate, templateFields, inputMode, youtubeUrl, transcribedText]);

  const handleRegenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  const handleCopy = async () => {
    const success = await copyToClipboard(result);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReset = () => {
    setContent('');
    setRequest('');
    setResult('');
    setError('');
    setCustomTone('');
    setSelectedTemplate(null);
    setTemplateFields({});
    setYoutubeUrl('');
    setTranscribedText('');
    setInputMode('transcript');
  };

  const handleSelectTemplate = (index: number) => {
    if (selectedTemplate === index) {
      setSelectedTemplate(null);
      setTemplateFields({});
    } else {
      setSelectedTemplate(index);
      setTemplateFields({});
      setContent('');
    }
  };

  const updateTemplateField = (key: string, value: string) => {
    setTemplateFields(prev => ({ ...prev, [key]: value }));
  };

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" dir="ltr">
      {/* Left Panel — Output */}
      <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-4 min-h-[600px] order-2 lg:order-1" dir="rtl">
        {result ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-cp-ink font-serif">תוצאה — {FORMAT_LABELS[format]}</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={isGenerating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-cp-line hover:bg-cp-sand text-cp-ink-2 transition cursor-pointer disabled:opacity-40"
                  title="נסה שוב עם אותם נתונים"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>נסה שוב</span>
                </button>
                <button
                  onClick={handleCopy}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition cursor-pointer ${
                    copied ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10' : 'border-cp-line hover:bg-cp-sand text-cp-ink-2'
                  }`}
                >
                  {copied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'הועתק!' : 'העתק'}</span>
                </button>
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-cp-line hover:bg-cp-sand text-cp-ink-2 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>חדש</span>
                </button>
              </div>
            </div>
            <div className="bg-cp-bone border border-cp-line rounded-xl p-5 text-sm text-cp-ink leading-relaxed overflow-y-auto flex-1 prose prose-sm max-w-none prose-headings:text-cp-ink prose-headings:font-serif prose-p:text-cp-ink-2 prose-strong:text-cp-ink prose-li:text-cp-ink-2" dir="rtl">
              <Markdown>{result}</Markdown>
            </div>
          </>
        ) : isGenerating ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
            <div className="w-full max-w-sm space-y-3 animate-pulse">
              <div className="h-4 bg-cp-sand rounded w-3/4" />
              <div className="h-4 bg-cp-sand rounded w-full" />
              <div className="h-4 bg-cp-sand rounded w-5/6" />
              <div className="h-4 bg-cp-sand rounded w-2/3" />
              <div className="h-4 bg-cp-sand rounded w-full" />
              <div className="h-4 bg-cp-sand rounded w-4/5" />
            </div>
            <p className="text-xs text-cp-ink-3 mt-2">מייצר תוכן... ~10-15 שניות</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <Sparkles className="w-10 h-10 text-cp-line mb-3" />
            <p className="text-sm text-cp-ink-3 font-medium">התוכן שייווצר יופיע כאן</p>
            <p className="text-xs text-cp-ink-3/70 mt-1">הזינו תוכן ולחצו "צור תוכן"</p>
          </div>
        )}
      </div>

      {/* Right Panel — Input */}
      <form
        className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-5 order-1 lg:order-2"
        dir="rtl"
        onSubmit={(e) => { e.preventDefault(); if (!isGenerating) handleGenerate(); }}
      >
        <h3 className="text-xl font-bold text-cp-ink font-serif flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-cp-clay" />
          <span>יצירת תוכן שיווקי</span>
        </h3>

        {/* Templates */}
        <div>
          <label className="text-[10px] uppercase text-cp-ink-3 block mb-2 font-semibold tracking-wider">תבנית תוכן</label>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t, i) => (
              <button
                key={t.label}
                type="button"
                onClick={() => handleSelectTemplate(i)}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition cursor-pointer ${
                  selectedTemplate === i
                    ? 'border-cp-clay bg-cp-clay/10 text-cp-clay font-bold'
                    : 'border-cp-line hover:border-cp-clay/40 hover:bg-cp-sand text-cp-ink-2 hover:text-cp-clay'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Template Fields */}
        {selectedTemplate !== null && (
          <div className="flex flex-col gap-3 bg-cp-sand/30 border border-cp-line/50 rounded-xl p-4">
            <span className="text-[10px] uppercase text-cp-clay font-bold tracking-wider">{TEMPLATES[selectedTemplate].label}</span>
            
            {/* YouTube URL toggle — only for podcast template (index 0) */}
            {selectedTemplate === 0 && (
              <>
                <div className="flex p-1 bg-cp-sand rounded-lg border border-cp-line">
                  <button
                    type="button"
                    onClick={() => setInputMode('transcript')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer ${
                      inputMode === 'transcript'
                        ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                        : 'text-cp-ink-2 hover:text-cp-ink'
                    }`}
                  >
                    הדבק תמלול
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('url')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer flex items-center justify-center gap-1 ${
                      inputMode === 'url'
                        ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                        : 'text-cp-ink-2 hover:text-cp-ink'
                    }`}
                  >
                    <Link className="w-3.5 h-3.5" />
                    קישור YouTube
                  </button>
                </div>

                {inputMode === 'url' ? (
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] text-cp-ink-2 font-semibold">קישור לפרק</label>
                    <input
                      type="url"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition"
                      dir="ltr"
                    />
                    {transcribedText && (
                      <p className="text-[10px] text-cp-sage font-semibold">✓ תמלול מוכן — {transcribedText.split(/\s+/).length} מילים</p>
                    )}
                    {isTranscribing && (
                      <p className="text-[10px] text-cp-clay font-semibold flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> מתמלל...
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-cp-ink-2 font-semibold">תמלול הפרק</label>
                    <textarea
                      value={templateFields['transcript'] || ''}
                      onChange={(e) => updateTemplateField('transcript', e.target.value)}
                      placeholder="הדביקו כאן את תמלול הפרק (או חלק ממנו)..."
                      rows={8}
                      className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition resize-y min-h-[120px]"
                    />
                  </div>
                )}
              </>
            )}

            {/* Regular template fields for non-podcast templates */}
            {selectedTemplate !== 0 && TEMPLATES[selectedTemplate].fields.map(field => (
              <div key={field.key} className="flex flex-col gap-1">
                <label className="text-[10px] text-cp-ink-2 font-semibold">{field.label}</label>
                {(field as any).multiline ? (
                  <textarea
                    value={templateFields[field.key] || ''}
                    onChange={(e) => updateTemplateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    rows={8}
                    className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition resize-y min-h-[120px]"
                  />
                ) : (
                  <input
                    type="text"
                    value={templateFields[field.key] || ''}
                    onChange={(e) => updateTemplateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-1.5 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Format */}
        <div>
          <label className="text-[10px] uppercase text-cp-ink-3 block mb-2 font-semibold tracking-wider">פורמט יעד</label>
          <div className="flex p-1 bg-cp-sand rounded-lg border border-cp-line">
            {(['reels', 'instagram', 'email'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`flex-1 py-1.5 text-[10px] font-medium rounded transition cursor-pointer ${
                  format === f
                    ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                    : 'text-cp-ink-2 hover:text-cp-ink'
                }`}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Tone Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider">טון ואווירה</label>
          <div className="flex flex-wrap gap-1.5">
            {TONE_PRESETS.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTonePreset(t.value)}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition cursor-pointer ${
                  tonePreset === t.value
                    ? 'border-cp-clay bg-cp-clay/10 text-cp-clay font-bold'
                    : 'border-cp-line bg-cp-sand/40 text-cp-ink-2 hover:border-cp-clay/40 hover:text-cp-clay'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tonePreset === 'custom' && (
            <input type="text" value={customTone} onChange={(e) => setCustomTone(e.target.value)} placeholder="תארו את הטון הרצוי..." className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition mt-1" />
          )}
        </div>

        {/* Content Input — only when no template selected */}
        {selectedTemplate === null && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cg-content" className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider">תוכן / נושא (חופשי)</label>
            <textarea
              id="cg-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="הדביקו כאן את התוכן, הנושא, או הרעיון שברצונכם לעבד..."
              rows={6}
              className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition resize-y min-h-[120px]"
            />
            <div className="flex justify-between text-[10px] text-cp-ink-3">
              <span>{wordCount > 0 ? `${wordCount} מילים` : ''}</span>
              <span className={wordCount > 3000 ? 'text-cp-clay font-bold' : ''}>
                {wordCount > 3000 ? '⚠️ מומלץ עד 3000 מילים' : 'מומלץ: 100-3000 מילים'}
              </span>
            </div>
          </div>
        )}

        {/* Request Input */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cg-request" className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider">בקשה נוספת (אופציונלי)</label>
          <input
            id="cg-request"
            type="text"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder='למשל: "התמקדו בציטוט של עמרי", "הוסיפו סטטיסטיקה"'
            className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition"
          />
        </div>

        {/* Generate Button */}
        <button
          type="submit"
          disabled={isGenerating}
          className="w-full bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-3 px-4 rounded-full transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer shadow-md hover:shadow-lg active:scale-98"
        >
          {isGenerating ? (
            <><Loader2 className="w-5 h-5 animate-spin" /><span>מייצר תוכן...</span></>
          ) : (
            <><Sparkles className="w-5 h-5" /><span>{FORMAT_BUTTON_LABELS[format]}</span></>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-cp-rose/10 border border-cp-rose/25 p-3 rounded-xl flex flex-col gap-2" role="alert">
            <span className="text-sm text-cp-clay">{error}</span>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="self-start text-[11px] font-semibold text-cp-clay hover:text-cp-clay-deep underline cursor-pointer"
            >
              נסה שוב
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
