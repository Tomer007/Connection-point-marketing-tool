import { useState, useCallback } from 'react';
import { Sparkles, Loader2, Copy, ClipboardCheck, RotateCcw, RefreshCw, Link } from 'lucide-react';
import { copyToClipboard } from '../utils/helpers';
import { generateContentServer } from '../utils/api';
import { PODCAST_DESCRIPTION_PROMPT } from '../utils/prompts/podcastDescriptionPrompt';
import { STORAGE_KEYS, CACHE_TTL_MS } from '../constants';
import { Tooltip } from './Tooltip';

export function PodcastDescription() {
  const [inputMode, setInputMode] = useState<'transcript' | 'url'>('transcript');
  const [transcript, setTranscript] = useState('');
  const [url, setUrl] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [titleCopied, setTitleCopied] = useState(false);
  const [descCopied, setDescCopied] = useState(false);
  const [allCopied, setAllCopied] = useState(false);

  const handleGenerate = useCallback(async () => {
    setError('');
    let finalTranscript = transcript;

    // If URL mode and no transcript yet, transcribe first
    if (inputMode === 'url' && !finalTranscript.trim()) {
      if (!url.trim()) { setError('אנא הזינו קישור.'); return; }
      setIsTranscribing(true);

      try {
        // Check cache
        const cacheKey = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_${url.trim()}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.transcript && Date.now() - parsed.timestamp <= CACHE_TTL_MS) {
            finalTranscript = parsed.transcript;
            setTranscript(finalTranscript);
            setIsTranscribing(false);
          }
        }

        if (!finalTranscript.trim()) {
          const serverUrl = import.meta.env.VITE_SERVER_URL || '';
          const platform = url.includes('youtube') || url.includes('youtu.be') ? 'YouTube' :
            url.includes('drive.google') ? 'Google Drive' : 'YouTube';

          const response = await fetch(`${serverUrl}/api/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.trim(), platform }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error || `שגיאה בתמלול (${response.status})`);
          }

          const data = await response.json();
          if (data.segments && Array.isArray(data.segments)) {
            finalTranscript = data.segments
              .map((seg: { start: number; text: string }) => {
                const min = Math.floor(seg.start / 60);
                const sec = Math.floor(seg.start % 60);
                return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${seg.text}`;
              })
              .join('\n');
          } else if (data.text) {
            finalTranscript = data.text;
          }

          // Cache
          try {
            const cacheKey2 = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_${url.trim()}`;
            localStorage.setItem(cacheKey2, JSON.stringify({ transcript: finalTranscript, timestamp: Date.now() }));
          } catch { /* quota */ }

          setTranscript(finalTranscript);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'שגיאה בתמלול.');
        setIsTranscribing(false);
        return;
      } finally {
        setIsTranscribing(false);
      }
    }

    if (!finalTranscript.trim()) {
      setError('אנא הדביקו תמלול או הזינו קישור.');
      return;
    }

    setIsGenerating(true);
    setTitle('');
    setDescription('');

    try {
      const result = await generateContentServer(
        PODCAST_DESCRIPTION_PROMPT,
        finalTranscript.substring(0, 12000)
      );

      const titleMatch = result.match(/TITLE:\s*(.+?)(?:\n|$)/);
      const descMatch = result.match(/DESCRIPTION:\s*([\s\S]+)/);

      if (titleMatch) setTitle(titleMatch[1].trim());
      if (descMatch) setDescription(descMatch[1].trim());
      if (!titleMatch && !descMatch) setDescription(result.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'שגיאה ביצירת התיאור.');
    } finally {
      setIsGenerating(false);
    }
  }, [transcript, inputMode, url]);

  const handleCopyTitle = async () => {
    const success = await copyToClipboard(title);
    if (success) { setTitleCopied(true); setTimeout(() => setTitleCopied(false), 2000); }
  };

  const handleCopyDesc = async () => {
    const success = await copyToClipboard(description);
    if (success) { setDescCopied(true); setTimeout(() => setDescCopied(false), 2000); }
  };

  const handleCopyAll = async () => {
    const all = `${title}\n\n${description}`;
    const success = await copyToClipboard(all);
    if (success) { setAllCopied(true); setTimeout(() => setAllCopied(false), 2000); }
  };

  const handleReset = () => {
    setTranscript('');
    setTitle('');
    setDescription('');
    setError('');
  };

  const wordCount = transcript.split(/\s+/).filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" dir="ltr">
      {/* Left Panel — Output */}
      <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-4 min-h-[500px] order-2 lg:order-1" dir="rtl">
        {(title || description) ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-cp-ink font-serif">תיאור הפרק</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-cp-line hover:bg-cp-sand text-cp-ink-2 transition cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>נסה שוב</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyAll}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition cursor-pointer ${
                    allCopied ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10' : 'border-cp-line hover:bg-cp-sand text-cp-ink-2'
                  }`}
                >
                  {allCopied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{allCopied ? 'הועתק!' : 'העתק הכל'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-cp-line hover:bg-cp-sand text-cp-ink-2 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>חדש</span>
                </button>
              </div>
            </div>

            {/* Title */}
            {title && (
              <div className="bg-cp-clay/5 border border-cp-clay/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase text-cp-clay font-bold tracking-wider">כותרת הפרק</span>
                  <button
                    type="button"
                    onClick={handleCopyTitle}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border transition cursor-pointer ${
                      titleCopied ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10' : 'border-cp-line text-cp-ink-3 hover:text-cp-clay'
                    }`}
                  >
                    {titleCopied ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{titleCopied ? 'הועתק!' : 'העתק'}</span>
                  </button>
                </div>
                <p className="text-lg font-serif font-bold text-cp-ink">{title}</p>
              </div>
            )}

            {/* Description */}
            {description && (
              <div className="bg-cp-bone border border-cp-line rounded-xl p-4 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase text-cp-ink-3 font-bold tracking-wider">תיאור</span>
                  <button
                    type="button"
                    onClick={handleCopyDesc}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border transition cursor-pointer ${
                      descCopied ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10' : 'border-cp-line text-cp-ink-3 hover:text-cp-clay'
                    }`}
                  >
                    {descCopied ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{descCopied ? 'הועתק!' : 'העתק'}</span>
                  </button>
                </div>
                <div className="text-sm text-cp-ink leading-relaxed whitespace-pre-line">{description}</div>
              </div>
            )}
          </>
        ) : isGenerating ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
            <div className="w-full max-w-sm space-y-3 animate-pulse">
              <div className="h-6 bg-cp-sand rounded w-2/3" />
              <div className="h-4 bg-cp-sand rounded w-full mt-4" />
              <div className="h-4 bg-cp-sand rounded w-5/6" />
              <div className="h-4 bg-cp-sand rounded w-full" />
              <div className="h-4 bg-cp-sand rounded w-4/5" />
            </div>
            <p className="text-xs text-cp-ink-3 mt-2">מייצר כותרת ותיאור... ~10-15 שניות</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <Sparkles className="w-10 h-10 text-cp-line mb-3" />
            <p className="text-sm text-cp-ink-3 font-medium">הכותרת והתיאור יופיעו כאן</p>
            <p className="text-xs text-cp-ink-3/70 mt-1">הדביקו תמלול ולחצו "צור תיאור פרק"</p>
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
          <span>תיאור פרק פודקאסט</span>
        </h3>

        <p className="text-xs text-cp-ink-2 leading-relaxed">
          הדביקו תמלול או קישור YouTube והמערכת תייצר כותרת ותיאור בסגנון נקודת חיבור.
        </p>

        {/* Input Mode Tabs */}
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
            className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer ${
              inputMode === 'url'
                ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                : 'text-cp-ink-2 hover:text-cp-ink'
            }`}
          >
            קישור YouTube
          </button>
        </div>

        {/* URL Input */}
        {inputMode === 'url' && (
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider flex items-center gap-1.5">קישור לפרק <Tooltip text="הדביקו קישור YouTube או Google Drive לפרק. המערכת תתמלל אוטומטית ותייצר תיאור. אם כבר תמללתם את אותו קישור בעבר — ישתמש במטמון." /></label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition"
              dir="ltr"
            />
            {transcript && inputMode === 'url' && (
              <p className="text-[10px] text-cp-sage font-semibold">✓ תמלול מוכן — {transcript.split(/\s+/).length} מילים</p>
            )}
          </div>
        )}

        {/* Transcript Input */}
        {inputMode === 'transcript' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="pd-transcript" className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider flex items-center gap-1.5">תמלול הפרק <Tooltip text="הדביקו את התמלול מהטאב Podcast 2 Reels (כפתור 'העתק'), או מכל מקור אחר. ככל שהתמלול מלא יותר — התיאור יהיה מדויק יותר." /></label>
              {transcript && (
                <button type="button" onClick={() => setTranscript('')} className="text-[10px] text-cp-ink-3 hover:text-cp-clay transition cursor-pointer">נקה</button>
              )}
            </div>
            <textarea
              id="pd-transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="הדביקו כאן את תמלול הפרק המלא..."
              rows={12}
              className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 font-medium transition resize-y min-h-[200px]"
            />
            <p className="text-[10px] text-cp-ink-3">{wordCount > 0 ? `${wordCount} מילים` : ''}</p>
          </div>
        )}

        {/* Generate Button */}
        <button
          type="submit"
          disabled={isGenerating}
          className="w-full bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-3 px-4 rounded-full transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer shadow-md hover:shadow-lg active:scale-98"
        >
          {isGenerating ? (
            <><Loader2 className="w-5 h-5 animate-spin" /><span>מייצר תיאור...</span></>
          ) : (
            <><Sparkles className="w-5 h-5" /><span>צור תיאור פרק</span></>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-cp-rose/10 border border-cp-rose/25 p-3 rounded-xl" role="alert">
            <span className="text-sm text-cp-clay">{error}</span>
          </div>
        )}
      </form>
    </div>
  );
}
