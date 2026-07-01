import { useState, useCallback } from 'react';
import { Sparkles, Loader2, Copy, ClipboardCheck, RefreshCw, AlertCircle, Download } from 'lucide-react';
import { copyToClipboard, downloadBlob, wordCount as getWordCount } from '../utils/helpers';
import { callServerLlm } from '../utils/api';
import { Tooltip } from './Tooltip';
import { transcribeFromUrl, transcribeFromFile, getCachedTranscript, getUrlCacheKey, getFileCacheKey, getSavedTranscripts } from '../utils/transcription';
import { EPISODE_NAME_PROMPT } from '../utils/prompts/episodeNamePrompt';

type InputMode = 'youtube' | 'drive' | 'upload' | 'transcript';

interface EpisodeNameOption {
  name: string;
  description: string;
  hashtags: string[];
}

export function EpisodeNameGenerator() {
  const [inputMode, setInputMode] = useState<InputMode>('youtube');
  const [transcript, setTranscript] = useState('');
  const [url, setUrl] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [options, setOptions] = useState<EpisodeNameOption[]>([]);
  const [podcastDescription, setPodcastDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [cachedHint, setCachedHint] = useState('');

  /** Handle URL change — check cache immediately */
  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    const cacheKey = getUrlCacheKey(newUrl);
    const cached = getCachedTranscript(cacheKey);
    if (cached) {
      setTranscript(cached);
      setCachedHint('📋 נמצא תמלול שמור מהרצה קודמת — חוסך תמלול מחדש');
    } else {
      if (transcript && cachedHint) { setTranscript(''); }
      setCachedHint('');
    }
  };

  /** Handle file selection — check cache immediately */
  const handleFileChange = (file: File | null) => {
    setUploadedFile(file);
    if (file) {
      const cacheKey = getFileCacheKey(file);
      const cached = getCachedTranscript(cacheKey);
      if (cached) {
        setTranscript(cached);
        setCachedHint(`📋 נמצא תמלול שמור עבור "${file.name}" — חוסך תמלול מחדש`);
      } else {
        setTranscript('');
        setCachedHint('');
      }
    } else {
      setTranscript('');
      setCachedHint('');
    }
  };

  const handleGenerate = useCallback(async () => {
    setError('');
    let finalTranscript = transcript;

    // For URL modes (youtube / drive), transcribe if needed
    if ((inputMode === 'youtube' || inputMode === 'drive') && !finalTranscript.trim()) {
      if (!url.trim()) { setError('אנא הזינו קישור.'); return; }
      setIsTranscribing(true);
      try {
        const result = await transcribeFromUrl(url);
        finalTranscript = result.transcript;
        setTranscript(finalTranscript);
        if (result.fromCache) setCachedHint('📋 נמצא תמלול שמור מהרצה קודמת — חוסך תמלול מחדש');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'שגיאה בתמלול.');
        setIsTranscribing(false);
        return;
      } finally {
        setIsTranscribing(false);
      }
    }

    // For upload mode, transcribe file if needed
    if (inputMode === 'upload' && !finalTranscript.trim()) {
      if (!uploadedFile) { setError('אנא העלו קובץ שמע.'); return; }
      setIsTranscribing(true);
      try {
        const result = await transcribeFromFile(uploadedFile);
        finalTranscript = result.transcript;
        setTranscript(finalTranscript);
        if (result.fromCache) setCachedHint(`📋 נמצא תמלול שמור עבור "${uploadedFile.name}" — חוסך תמלול מחדש`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'שגיאה בתמלול הקובץ.');
        setIsTranscribing(false);
        return;
      } finally {
        setIsTranscribing(false);
      }
    }

    if (!finalTranscript.trim()) {
      setError('אנא הדביקו תמלול, הזינו קישור, או העלו קובץ.');
      return;
    }

    setIsGenerating(true);
    setOptions([]);
    setPodcastDescription('');

    try {
      const result = await callServerLlm(
        EPISODE_NAME_PROMPT,
        finalTranscript.substring(0, 12000),
        4000
      );

      // Parse JSON response — handle possible markdown code blocks
      let jsonStr = result.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr);
      if (!parsed.options || !Array.isArray(parsed.options) || parsed.options.length === 0) {
        throw new Error('התשובה מהמודל לא בפורמט תקין.');
      }

      // Validate and normalize
      const validOptions: EpisodeNameOption[] = parsed.options.slice(0, 5).map((opt: any) => ({
        name: String(opt.name || ''),
        description: String(opt.description || ''),
        hashtags: Array.isArray(opt.hashtags) ? opt.hashtags.map(String).slice(0, 7) : [],
      }));

      if (validOptions.length < 5) {
        throw new Error('המודל החזיר פחות מ-5 אפשרויות.');
      }

      setOptions(validOptions);
      if (parsed.podcastDescription) {
        setPodcastDescription(String(parsed.podcastDescription));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'שגיאה ביצירת שמות.';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [transcript, inputMode, url, uploadedFile]);

  const handleCopyOption = async (index: number) => {
    const opt = options[index];
    const text = `${opt.name}\n${opt.description}\n${opt.hashtags.join(' ')}`;
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const handleReset = () => {
    setOptions([]);
    setError('');
  };

  const handleDownloadHtml = () => {
    const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>שמות מוצעים לפרק — נקודת חיבור</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Heebo', 'Assistant', sans-serif; background: #F6EFE4; color: #2B2A26; padding: 40px 20px; direction: rtl; }
  .container { max-width: 700px; margin: 0 auto; }
  h1 { font-family: 'Frank Ruhl Libre', serif; font-size: 24px; color: #C2754B; margin-bottom: 8px; }
  .subtitle { font-size: 12px; color: #8C8678; margin-bottom: 32px; }
  .card { background: #FFFFFF; border: 1px solid #D9CFB9; border-radius: 16px; padding: 24px; margin-bottom: 20px; }
  .card h2 { font-family: 'Frank Ruhl Libre', serif; font-size: 20px; color: #2B2A26; margin-bottom: 6px; }
  .card .summary { font-size: 14px; color: #5A564E; line-height: 1.6; margin-bottom: 12px; }
  .card .pod-desc { background: #EADFC9; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .card .pod-desc-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #8C8678; font-weight: 700; margin-bottom: 6px; }
  .card .pod-desc p { font-size: 13px; color: #2B2A26; line-height: 1.7; white-space: pre-line; }
  .hashtags { display: flex; flex-wrap: wrap; gap: 6px; }
  .hashtag { font-size: 11px; background: #EADFC9; border: 1px solid #D9CFB9; border-radius: 20px; padding: 3px 10px; color: #5A564E; }
  .footer { text-align: center; margin-top: 32px; font-size: 11px; color: #8C8678; }
</style>
</head>
<body>
<div class="container">
  <h1>שמות מוצעים לפרק</h1>
  <p class="subtitle">נקודת חיבור · ${new Date().toLocaleDateString('he-IL')}</p>
  ${podcastDescription ? `
  <div class="card" style="border-color: #C2754B; border-width: 1.5px;">
    <div class="pod-desc-label">תיאור פרק</div>
    <p style="font-size: 14px; color: #2B2A26; line-height: 1.7; white-space: pre-line;">${podcastDescription}</p>
    <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #D9CFB9; font-size: 12px; line-height: 2; color: #5A564E;">
      לפרטים נוספים על תהליכים, ריטריטים וסדנאות: <a href="https://annayael.com/" style="color: #C2754B;">https://annayael.com/</a><br>
      מזמינות אתכם לעקוב אחרינו גם פה: <a href="https://www.instagram.com/nekudat.hibur?igsh=MWtjYWtuY2s5cjgybw%3D%3D" style="color: #C2754B;">https://www.instagram.com/nekudat.hibur</a><br>
      ומזמינות אתכם להצטרף לקבוצת עדכונים שקטה בוואטסאפ: <a href="https://chat.whatsapp.com/Dv196PI16IcCHprusiq21p?mode=gi_t" style="color: #C2754B;">https://chat.whatsapp.com/Dv196PI16IcCHprusiq21p</a>
    </div>
  </div>` : ''}
  ${options.map((opt, i) => `
  <div class="card">
    <h2>${i + 1}. ${opt.name}</h2>
    <p class="summary">${opt.description}</p>
    <div class="hashtags">${opt.hashtags.map(h => `<span class="hashtag">${h}</span>`).join('')}</div>
  </div>`).join('')}
  <p class="footer">אנה ויעל | נקודת חיבור · מרחבי ריפוי</p>
</div>
</body>
</html>`;

    downloadBlob(html, 'שמות-מוצעים-לפרק.html');
  };

  const wc = getWordCount(transcript);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" dir="ltr">
      {/* Left Panel — Output */}
      <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-4 min-h-[500px] order-2 lg:order-1" dir="rtl">
        {options.length > 0 ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-cp-ink font-serif">5 שמות מוצעים לפרק</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownloadHtml}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-cp-line hover:bg-cp-sand text-cp-ink-2 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>הורד HTML</span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-cp-line hover:bg-cp-sand text-cp-ink-2 transition cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>ייצר מחדש</span>
                </button>
              </div>
            </div>

            {/* Podcast Description — shown once at the top */}
            {podcastDescription && (
              <div className="bg-cp-clay/5 border border-cp-clay/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase text-cp-clay font-bold tracking-wider">תיאור פרק</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const success = await copyToClipboard(podcastDescription);
                      if (success) { setCopiedIndex(-1); setTimeout(() => setCopiedIndex(null), 2000); }
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border transition cursor-pointer ${
                      copiedIndex === -1
                        ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10'
                        : 'border-cp-line text-cp-ink-3 hover:text-cp-clay'
                    }`}
                  >
                    {copiedIndex === -1 ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedIndex === -1 ? 'הועתק!' : 'העתק'}</span>
                  </button>
                </div>
                <p className="text-sm text-cp-ink leading-relaxed whitespace-pre-line">{podcastDescription}</p>
                <div className="mt-3 pt-3 border-t border-cp-line/50 text-[11px] text-cp-ink-2 leading-loose space-y-0.5">
                  <p>לפרטים נוספים על תהליכים, ריטריטים וסדנאות: <a href="https://annayael.com/" className="text-cp-clay hover:underline" target="_blank" rel="noopener">annayael.com</a></p>
                  <p>מזמינות אתכם לעקוב אחרינו גם פה: <a href="https://www.instagram.com/nekudat.hibur?igsh=MWtjYWtuY2s5cjgybw%3D%3D" className="text-cp-clay hover:underline" target="_blank" rel="noopener">@nekudat.hibur</a></p>
                  <p>ומזמינות אתכם להצטרף לקבוצת עדכונים שקטה בוואטסאפ: <a href="https://chat.whatsapp.com/Dv196PI16IcCHprusiq21p?mode=gi_t" className="text-cp-clay hover:underline" target="_blank" rel="noopener">קבוצת WhatsApp</a></p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4 overflow-y-auto flex-1">
              {options.map((opt, idx) => (
                <div
                  key={idx}
                  className="bg-cp-bone border border-cp-line rounded-xl p-4 flex flex-col gap-2.5 transition hover:border-cp-clay/30 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-lg font-serif font-bold text-cp-ink leading-snug">{opt.name}</h4>
                    <button
                      type="button"
                      onClick={() => handleCopyOption(idx)}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition cursor-pointer ${
                        copiedIndex === idx
                          ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10'
                          : 'border-cp-line text-cp-ink-3 hover:text-cp-clay hover:border-cp-clay/40'
                      }`}
                    >
                      {copiedIndex === idx ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedIndex === idx ? 'הועתק!' : 'העתק'}</span>
                    </button>
                  </div>
                  <p className="text-sm text-cp-ink-2 leading-relaxed">{opt.description}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {opt.hashtags.map((tag, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-2.5 py-0.5 rounded-full bg-cp-sand border border-cp-line text-cp-ink-2 font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : isGenerating ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
            <div className="w-full max-w-sm space-y-4 animate-pulse">
              <div className="h-6 bg-cp-sand rounded w-1/2" />
              <div className="h-4 bg-cp-sand rounded w-full" />
              <div className="h-3 bg-cp-sand rounded w-3/4 mt-6" />
              <div className="h-6 bg-cp-sand rounded w-2/3" />
              <div className="h-4 bg-cp-sand rounded w-full" />
              <div className="h-3 bg-cp-sand rounded w-4/5 mt-6" />
              <div className="h-6 bg-cp-sand rounded w-1/2" />
              <div className="h-4 bg-cp-sand rounded w-5/6" />
            </div>
            <p className="text-xs text-cp-ink-3 mt-2">מייצר שמות לפרק... ~10-15 שניות</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <Sparkles className="w-10 h-10 text-cp-line mb-3" />
            <p className="text-sm text-cp-ink-3 font-medium">5 שמות מוצעים יופיעו כאן</p>
            <p className="text-xs text-cp-ink-3/70 mt-1">הדביקו תמלול ולחצו "צור שמות לפרק"</p>
          </div>
        )}
      </div>

      {/* Right Panel — Input */}
      <form
        className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-5 order-1 lg:order-2"
        dir="rtl"
        onSubmit={(e) => { e.preventDefault(); if (!isGenerating && !isTranscribing) handleGenerate(); }}
      >
        <h3 className="text-xl font-bold text-cp-ink font-serif flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-cp-clay" />
          <span>שם ותיאור לפרק</span>
        </h3>

        <p className="text-xs text-cp-ink-2 leading-relaxed">
          הזינו מקור שמע או תמלול והמערכת תייצר 5 שמות ויראליים לפרק, עם תיאור והאשטגים לכל אחד.
        </p>

        {/* Source Tabs — same pattern as Podcast 2 Reels */}
        <div>
          <label className="text-[10px] uppercase text-cp-ink-3 ml-1 block mb-2 font-semibold tracking-wider flex items-center gap-1.5">
            בחירת מקור
            <Tooltip text="בחרו מאיפה להעלות את האודיו: YouTube, Google Drive, קובץ מהמחשב, או הדביקו תמלול ישירות" />
          </label>
          <div className="flex p-1 bg-cp-sand rounded-lg border border-cp-line">
            {(['youtube', 'drive', 'upload', 'transcript'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => { if (inputMode !== tab) { setInputMode(tab); setUrl(''); setTranscript(''); setUploadedFile(null); setCachedHint(''); } }}
                className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer ${
                  inputMode === tab
                    ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                    : 'text-cp-ink-2 hover:text-cp-ink'
                }`}
              >
                {tab === 'youtube' ? 'YouTube' : tab === 'drive' ? 'Drive' : tab === 'upload' ? 'העלאת קובץ' : 'תמלול'}
              </button>
            ))}
          </div>
        </div>

        {/* YouTube Input */}
        {inputMode === 'youtube' && (
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider flex items-center gap-1.5">
              קישור YouTube
              <Tooltip text="הדביקו קישור YouTube. המערכת תתמלל אוטומטית ותייצר שמות. אם כבר תמללתם את אותו קישור — ישתמש במטמון." />
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ or https://youtu.be/..."
              className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition"
              dir="ltr"
            />
            {cachedHint && inputMode === 'youtube' && (
              <p className="text-[10px] text-cp-sage font-semibold">{cachedHint}</p>
            )}
            {transcript && !cachedHint && (
              <p className="text-[10px] text-cp-sage font-semibold">✓ תמלול מוכן — {transcript.split(/\s+/).length} מילים</p>
            )}
            {isTranscribing && (
              <p className="text-[10px] text-cp-clay font-semibold flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> מתמלל...
              </p>
            )}
          </div>
        )}

        {/* Google Drive Input */}
        {inputMode === 'drive' && (
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider flex items-center gap-1.5">
              קישור Google Drive
              <Tooltip text="הדביקו קישור Google Drive לקובץ שמע. וודאו שהקובץ משותף (Anyone with the link)." />
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="e.g., https://drive.google.com/file/d/1X2Y3Z... or share link"
              className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition"
              dir="ltr"
            />
            {cachedHint && inputMode === 'drive' && (
              <p className="text-[10px] text-cp-sage font-semibold">{cachedHint}</p>
            )}
            {transcript && !cachedHint && (
              <p className="text-[10px] text-cp-sage font-semibold">✓ תמלול מוכן — {transcript.split(/\s+/).length} מילים</p>
            )}
            {isTranscribing && (
              <p className="text-[10px] text-cp-clay font-semibold flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> מתמלל...
              </p>
            )}
          </div>
        )}

        {/* File Upload Input */}
        {inputMode === 'upload' && (
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider">העלאת קובץ שמע</label>
            <div
              className="border-2 border-dashed border-cp-line rounded-xl p-6 text-center hover:border-cp-clay/40 transition cursor-pointer bg-cp-bone"
              role="button"
              aria-label="לחצו להעלאת קובץ שמע"
              tabIndex={0}
              onClick={() => document.getElementById('eng-file-upload')?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('eng-file-upload')?.click(); } }}
            >
              <input
                id="eng-file-upload"
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
                className="hidden"
                onChange={(e) => { handleFileChange(e.target.files?.[0] || null); }}
              />
              {uploadedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm font-medium text-cp-ink">{uploadedFile.name}</span>
                  <span className="text-[10px] text-cp-ink-3">{(uploadedFile.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleFileChange(null); }}
                    className="text-[10px] text-cp-clay hover:text-cp-clay-deep transition cursor-pointer mt-1"
                  >
                    הסר קובץ
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-2xl">🎵</span>
                  <span className="text-xs text-cp-ink-2 font-medium">לחצו להעלאת קובץ שמע</span>
                  <span className="text-[10px] text-cp-ink-3">MP3, WAV, M4A, OGG, FLAC</span>
                </div>
              )}
            </div>

            {/* Saved Transcriptions Picker */}
            {(() => {
              const saved = getSavedTranscripts();
              if (saved.length === 0) return null;
              return (
                <div className="flex flex-col gap-1.5 mt-1">
                  <span className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider">או בחרו תמלול שמור</span>
                  <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto">
                    {saved.map((item) => (
                      <button
                        key={item.cacheKey}
                        type="button"
                        onClick={() => {
                          const cached = getCachedTranscript(item.cacheKey);
                          if (cached) {
                            setTranscript(cached);
                            setCachedHint(`📋 נטען תמלול שמור: "${item.label}"`);
                          }
                        }}
                        className="text-right text-[11px] px-3 py-2 rounded-lg border border-cp-line bg-cp-bone hover:border-cp-clay/40 hover:bg-cp-sand transition cursor-pointer flex items-center justify-between gap-2"
                      >
                        <span className="text-cp-ink truncate">{item.label}</span>
                        <span className="text-cp-ink-3 shrink-0">{item.wordCount} מילים</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {cachedHint && inputMode === 'upload' && (
              <p className="text-[10px] text-cp-sage font-semibold">{cachedHint}</p>
            )}
            {transcript && !cachedHint && (
              <p className="text-[10px] text-cp-sage font-semibold">✓ תמלול מוכן — {transcript.split(/\s+/).length} מילים</p>
            )}
            {isTranscribing && (
              <p className="text-[10px] text-cp-clay font-semibold flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> מתמלל קובץ...
              </p>
            )}
          </div>
        )}

        {/* Transcript Input */}
        {inputMode === 'transcript' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="eng-transcript" className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider flex items-center gap-1.5">
                תמלול הפרק
                <Tooltip text="הדביקו את התמלול מהטאב Podcast 2 Reels (כפתור 'העתק'), או מכל מקור אחר." />
              </label>
              {transcript && (
                <button type="button" onClick={() => setTranscript('')} className="text-[10px] text-cp-ink-3 hover:text-cp-clay transition cursor-pointer">נקה</button>
              )}
            </div>
            <textarea
              id="eng-transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="הדביקו כאן את תמלול הפרק המלא..."
              rows={12}
              className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 font-medium transition resize-y min-h-[200px]"
            />
            {/* Saved Transcriptions — quick load */}
            {!transcript && (() => {
              const saved = getSavedTranscripts();
              if (saved.length === 0) return null;
              return (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase text-cp-ink-3 font-semibold tracking-wider">או בחרו תמלול שמור</span>
                  <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                    {saved.map((item) => (
                      <button
                        key={item.cacheKey}
                        type="button"
                        onClick={() => {
                          const cached = getCachedTranscript(item.cacheKey);
                          if (cached) {
                            setTranscript(cached);
                            setCachedHint(`📋 נטען תמלול שמור: "${item.label}"`);
                          }
                        }}
                        className="text-right text-[11px] px-3 py-2 rounded-lg border border-cp-line bg-cp-bone hover:border-cp-clay/40 hover:bg-cp-sand transition cursor-pointer flex items-center justify-between gap-2"
                      >
                        <span className="text-cp-ink truncate">{item.label}</span>
                        <span className="text-cp-ink-3 shrink-0">{item.wordCount} מילים</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {cachedHint && inputMode === 'transcript' && (
              <p className="text-[10px] text-cp-sage font-semibold">{cachedHint}</p>
            )}
            <p className="text-[10px] text-cp-ink-3">{wc > 0 ? `${wc} מילים` : ''}</p>
          </div>
        )}

        {/* Generate Button */}
        <button
          type="submit"
          disabled={isGenerating || isTranscribing || (
            (inputMode === 'youtube' || inputMode === 'drive') && !url.trim() && !transcript.trim()
          ) || (
            inputMode === 'upload' && !uploadedFile && !transcript.trim()
          ) || (
            inputMode === 'transcript' && !transcript.trim()
          )}
          className="w-full bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-3 px-4 rounded-full transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer shadow-md hover:shadow-lg active:scale-98"
        >
          {isGenerating ? (
            <><Loader2 className="w-5 h-5 animate-spin" /><span>מייצר שמות...</span></>
          ) : isTranscribing ? (
            <><Loader2 className="w-5 h-5 animate-spin" /><span>מתמלל...</span></>
          ) : (
            <><Sparkles className="w-5 h-5" /><span>צור שמות לפרק</span></>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-cp-rose/10 border border-cp-rose/25 p-3 rounded-xl flex items-start gap-2" role="alert">
            <AlertCircle className="w-4 h-4 text-cp-clay mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
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
          </div>
        )}
      </form>
    </div>
  );
}
