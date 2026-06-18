import { useState, memo } from 'react';
import { ViralCut } from '../types';
import { getMetricBadgeClass, copyToClipboard } from '../utils/helpers';
import { Copy, ClipboardCheck, Scissors, Loader2, FileText } from 'lucide-react';

interface ViralCutCardProps {
  cut: ViralCut;
  index: number;
  sourceUrl?: string;
  transcript?: string;
}

export const ViralCutCard = memo(function ViralCutCard({ cut, index, sourceUrl, transcript }: ViralCutCardProps) {
  const isHighPotential = cut.viralPotential >= 75;
  const [quoteCopied, setQuoteCopied] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [capcutCopied, setCapcutCopied] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [isCutting, setIsCutting] = useState(false);
  const [cutError, setCutError] = useState('');

  /** Generate Kiro Reel Spec JSON for MCP create_kiro_reel tool */
  const generateMcpSpec = () => {
    const safeTitle = cut.title.replace(/[^\w\u0590-\u05FF\s-]/g, '').trim().replace(/\s+/g, '_');
    const spec = {
      input_video_path: `~/Downloads/${safeTitle}.mp4`,
      subtitles_path: `~/Downloads/${safeTitle}.srt`,
      output_path: `~/Downloads/${safeTitle}_reel.mp4`,
      project: {
        title: cut.title,
        language: "he",
        format: "instagram_reel",
        duration_seconds: (() => {
          const parse = (t: string) => { const p = t.split(':').map(Number); return p.length === 2 ? p[0]*60+p[1] : p[0]*3600+p[1]*60+p[2]; };
          return parse(cut.endTime) - parse(cut.startTime);
        })(),
        aspect_ratio: "9:16"
      },
      content_source: {
        speaker: cut.shotClimax?.split(':')[0] || "האורח",
        type: "talking_head",
        context: cut.whyViral || cut.hook
      },
      viral_analysis: {
        virality_score: cut.viralPotential,
        emotional_depth: cut.scores.emotional_resonance,
        authenticity: cut.scores.authenticity,
        engagement: cut.scores.engagement,
        practical_value: cut.scores.actionability,
        hook_type: cut.targetEmotion || "vulnerability_confession"
      },
      hook_strategy: {
        first_3_seconds: cut.hook,
        reason: cut.whyViral
      },
      editing_directive: {
        style: "cinematic_real",
        start_frame: "close_up_face",
        pacing: "slow_intimate_start_then_rise",
        emotion_focus: cut.targetEmotion || "vulnerability_and_reflection"
      },
      timeline: [
        {
          segment: "0-5",
          type: "hook",
          audio: cut.shotOpening || cut.hook,
          visual_instruction: "close_up, stable, shallow_depth_of_field",
          caption_style: "bold_center",
          intent: "emotional_opening"
        },
        {
          segment: "5-25",
          type: "core_conflict",
          audio: cut.shotClimax || cut.quote,
          visual_instruction: "slight_zoom_in, tension_build",
          caption_style: "highlight_key_sentence",
          intent: "peak_emotion"
        },
        {
          segment: "25-30",
          type: "resolution",
          audio: cut.shotClosing || "נקודת חיבור | לינק בביו",
          visual_instruction: "soft_zoom_out, calm_end",
          caption_style: "fade_out",
          intent: "reflection"
        }
      ],
      caption_system: {
        cards: [
          { id: 1, type: "hook", text: cut.hook },
          { id: 2, type: "peak_quote", text: cut.quote },
          { id: 3, type: "cta", text: "נקודת חיבור | לינק בביו" }
        ],
        style: "minimal_high_contrast"
      },
      visual_direction: {
        lighting: "natural_soft",
        camera_motion: "static_with_micro_movement",
        framing: "tight_close_up",
        aesthetic: "documentary_authentic"
      },
      audio_direction: {
        music_style: "minimal_piano_ambient",
        voice_priority: "very_high",
        music_volume: 0.15
      },
      cta: {
        type: "engagement_question",
        text: cut.captionSuggestion?.match(/.*\?/)?.[0] || "מה את/ה מרגיש/ה?",
        placement: "end_screen"
      },
      output_requirements: {
        resolution: "1080x1920",
        codec: "h264",
        audio_codec: "aac",
        faststart: true
      }
    };
    return JSON.stringify(spec, null, 2);
  };

  const handleCopyQuote = async () => {
    const success = await copyToClipboard(cut.quote);
    if (success) {
      setQuoteCopied(true);
      setTimeout(() => setQuoteCopied(false), 2000);
    }
  };

  const handleCutClip = async () => {
    if (!sourceUrl || isCutting) return;
    setIsCutting(true);
    setCutError('');

    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || '';
      const response = await fetch(`${serverUrl}/api/cut-clip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: sourceUrl,
          startTime: cut.startTime,
          endTime: cut.endTime,
          title: cut.title,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || `שגיאה בחיתוך הקליפ (${response.status})`);
      }

      // Download the video file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${cut.title.replace(/[^\w\u0590-\u05FF\s-]/g, '').trim().replace(/\s+/g, '_')}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'שגיאה בחיתוך הקליפ.';
      setCutError(message);
    } finally {
      setIsCutting(false);
    }
  };

  /** Split text into short SRT-friendly lines (max ~5 words per line, 2 lines per entry) */
  const splitToSrtCards = (text: string, startSec: number, endSec: number): string[] => {
    const words = text.replace(/^[^:]+:\s*/, '').split(/\s+/); // Remove speaker prefix
    const entries: string[] = [];
    const WORDS_PER_CARD = 8;
    const totalCards = Math.ceil(words.length / WORDS_PER_CARD);
    const durationPerCard = (endSec - startSec) / totalCards;

    for (let i = 0; i < totalCards; i++) {
      const cardWords = words.slice(i * WORDS_PER_CARD, (i + 1) * WORDS_PER_CARD);
      const cardStart = startSec + i * durationPerCard;
      const cardEnd = startSec + (i + 1) * durationPerCard;

      // Split into 2 lines of ~4 words each
      const mid = Math.ceil(cardWords.length / 2);
      const line1 = cardWords.slice(0, mid).join(' ');
      const line2 = cardWords.slice(mid).join(' ');
      const cardText = line2 ? `${line1}\n${line2}` : line1;

      entries.push(`${secondsToSrtTime(cardStart)} --> ${secondsToSrtTime(cardEnd)}\n${cardText}\n`);
    }
    return entries;
  };

  const secondsToSrtTime = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  };

  /** Download a pure .srt file for CapCut import */
  const handleDownloadSrt = () => {
    const allCards: string[] = [];

    // Hook (0-5s) — short, keep as-is
    const hookText = cut.hook || cut.shotOpening || '';
    if (hookText) {
      allCards.push(...splitToSrtCards(hookText, 0, 5));
    }

    // Peak (5-25s) — long quote, split into multiple cards
    const peakText = cut.quote || cut.shotClimax || '';
    if (peakText) {
      allCards.push(...splitToSrtCards(peakText, 5, 25));
    }

    // CTA (25-30s)
    allCards.push(`${secondsToSrtTime(25)} --> ${secondsToSrtTime(30)}\nנקודת חיבור\nלינק בביו 👇\n`);

    // Number them
    const srtContent = allCards.map((card, i) => `${i + 1}\n${card}`).join('\n');

    const blob = new Blob([srtContent], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${cut.title.replace(/[^\w\u0590-\u05FF\s-]/g, '').trim().replace(/\s+/g, '_')}.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /** Download a .txt file with the clip's transcript + details */
  const handleDownloadTxt = () => {
    let clipTranscript = '';
    if (transcript) {
      const parseTimeToSeconds = (t: string): number => {
        const parts = t.split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
      };
      const clipStart = parseTimeToSeconds(cut.startTime);
      const clipEnd = parseTimeToSeconds(cut.endTime);

      const transcriptLines = transcript.split('\n');
      const relevantLines = transcriptLines.filter(line => {
        const match = line.match(/^\[(\d{1,2}:\d{2})\]/);
        if (!match) return false;
        const lineTime = parseTimeToSeconds(match[1]);
        return lineTime >= clipStart && lineTime <= clipEnd;
      });
      clipTranscript = relevantLines.join('\n');
    }

    const txtContent = [
      `כותרת: ${cut.title}`,
      `זמן: ${cut.startTime} – ${cut.endTime}`,
      '',
      '--- תמלול הקליפ ---',
      '',
      clipTranscript || cut.openingLine || cut.quote || '(לא נמצא תמלול לטווח הזמן הזה)',
      '',
      '--- פרטי הקליפ ---',
      `הוק: ${cut.hook}`,
      `ציטוט מרכזי: ${cut.quote}`,
      cut.shotOpening ? `פתיחה: ${cut.shotOpening}` : '',
      cut.shotClimax ? `שיא: ${cut.shotClimax}` : '',
      cut.shotClosing ? `סגירה: ${cut.shotClosing}` : '',
      cut.contentManagerNote ? `\nהנחיית הפקה: ${cut.contentManagerNote}` : '',
    ].filter(Boolean).join('\n');

    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${cut.title.replace(/[^\w\u0590-\u05FF\s-]/g, '').trim().replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 flex flex-col relative shadow-sm" dir="rtl">
      {/* Potential score badge — top-right for RTL */}
      <div className={`absolute top-4 right-5 border px-3 py-1 rounded-full text-xs font-bold leading-normal ${
        isHighPotential
          ? 'bg-cp-sage/10 text-cp-sage-deep border-cp-sage/30'
          : 'bg-cp-ochre/15 text-cp-ochre border-cp-ochre/30'
      }`}>
        {cut.viralPotential}/100
      </div>

      {/* Rank & Title */}
      <div className="flex items-start gap-3 mb-3 border-b border-cp-line pb-3 pr-1">
        <span className="text-3xl font-serif text-cp-clay font-bold select-none opacity-40 leading-none mt-0.5">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-bold text-cp-ink leading-tight text-base sm:text-lg pr-16">
            {cut.title}
          </h3>
          <p className="text-[11px] text-cp-clay font-mono mt-1" dir="ltr">
            {cut.startTime} — {cut.endTime}
          </p>
        </div>
      </div>

      {/* Cut Clip & SRT Buttons */}
      {sourceUrl && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCutClip}
            disabled={isCutting}
            className="inline-flex items-center gap-2 bg-cp-clay/10 hover:bg-cp-clay/20 border border-cp-clay/30 text-cp-clay font-semibold px-4 py-2 rounded-full transition text-xs cursor-pointer disabled:opacity-50"
          >
            {isCutting ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>חותך קליפ...</span></>
            ) : (
              <><Scissors className="w-3.5 h-3.5" /><span>חתוך והורד קליפ (Reel 9:16)</span></>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadSrt}
            className="inline-flex items-center gap-2 bg-cp-sage/10 hover:bg-cp-sage/20 border border-cp-sage/30 text-cp-sage-deep font-semibold px-4 py-2 rounded-full transition text-xs cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>כתוביות (.srt)</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadTxt}
            className="inline-flex items-center gap-2 bg-cp-sage/10 hover:bg-cp-sage/20 border border-cp-sage/30 text-cp-sage-deep font-semibold px-4 py-2 rounded-full transition text-xs cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>תמלול (.txt)</span>
          </button>
          {cutError && (
            <p className="text-[11px] text-cp-clay mt-2 w-full">{cutError}</p>
          )}
        </div>
      )}

      {/* Quote */}
      <div className="relative group mb-4">
        <blockquote className="text-base italic text-cp-ink-2 border-r-4 border-cp-clay pr-4 py-1.5 leading-relaxed font-serif">
          &ldquo;{cut.quote}&rdquo;
        </blockquote>
        <button
          onClick={handleCopyQuote}
          className={`absolute top-1 left-1 p-1.5 rounded-full border transition cursor-pointer opacity-0 group-hover:opacity-100 ${
            quoteCopied ? 'border-cp-sage/40 bg-cp-sage/10' : 'border-cp-line bg-cp-paper hover:bg-cp-sand'
          }`}
          title="העתק ציטוט"
          aria-label="Copy quote"
        >
          {quoteCopied ? <ClipboardCheck className="w-3.5 h-3.5 text-cp-sage" /> : <Copy className="w-3.5 h-3.5 text-cp-ink-3" />}
        </button>
      </div>

      {/* Hook Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="bg-cp-sand/30 p-3.5 rounded-xl border border-cp-line">
          <span className="text-[10px] uppercase text-cp-clay font-bold block">הוק פתיחה (3 שניות ראשונות)</span>
          <p className="text-xs text-cp-ink-2 leading-normal mt-1 font-medium">{cut.hook}</p>
        </div>
        <div className="bg-cp-sand/30 p-3.5 rounded-xl border border-cp-line">
          <span className="text-[10px] uppercase text-cp-clay font-bold block">למה זה יעבוד ויראלית</span>
          <p className="text-xs text-cp-ink-2 leading-normal mt-1">{cut.whyViral}</p>
        </div>
      </div>

      {/* Shot Directions */}
      {(cut.shotOpening || cut.shotClimax || cut.shotClosing) && (
        <div className="mb-4 bg-cp-ochre/5 border border-cp-ochre/20 border-r-4 border-r-cp-ochre rounded-xl p-3.5">
          <span className="text-[10px] uppercase text-cp-ochre font-bold block mb-2">הוראות שוט לאיש התוכן</span>
          <div className="space-y-1.5 text-xs text-cp-ink-2">
            {cut.shotOpening && <p><span className="font-bold text-cp-ink">פתיחה:</span> {cut.shotOpening}</p>}
            {cut.shotClimax && <p><span className="font-bold text-cp-ink">⚡ שיא:</span> {cut.shotClimax}</p>}
            {cut.shotClosing && <p><span className="font-bold text-cp-ink">סיום:</span> {cut.shotClosing}</p>}
          </div>
        </div>
      )}

      {/* Ready Caption */}
      {cut.captionSuggestion && (
        <div className="mb-4 bg-cp-sage/5 border border-cp-sage/20 rounded-xl p-3.5 relative group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase text-cp-sage-deep font-bold">קפשן מוכן (העתק-הדבק)</span>
            <button
              type="button"
              onClick={async () => {
                const success = await copyToClipboard(cut.captionSuggestion!);
                if (success) {
                  setCaptionCopied(true);
                  setTimeout(() => setCaptionCopied(false), 2000);
                }
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border transition cursor-pointer ${
                captionCopied
                  ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10'
                  : 'border-cp-line text-cp-ink-3 hover:text-cp-sage-deep hover:border-cp-sage/40'
              }`}
              title="העתק קפשן"
            >
              {captionCopied ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{captionCopied ? 'הועתק!' : 'העתק'}</span>
            </button>
          </div>
          <p className="text-xs text-cp-ink leading-relaxed font-medium">{cut.captionSuggestion}</p>
        </div>
      )}

      {/* Publishing Order */}
      {cut.publishOrder && (
        <div className="mb-4 flex items-center gap-2 text-xs text-cp-ink-2">
          <span className="bg-cp-clay/10 text-cp-clay font-bold px-2 py-0.5 rounded text-[10px]">סדר פרסום: #{cut.publishOrder}</span>
          {cut.publishNote && <span>{cut.publishNote}</span>}
        </div>
      )}

      {/* Score Matrix — larger font */}
      <div className="mb-4">
        <span className="text-[10px] uppercase tracking-wider text-cp-ink-3 mb-2 block font-semibold">מדדי ויראליות</span>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'אותנטיות', value: cut.scores.authenticity },
            { label: 'מעורבות', value: cut.scores.engagement },
            { label: 'רגש', value: cut.scores.emotional_resonance },
            { label: 'ישימות', value: cut.scores.actionability },
          ].map(({ label, value }) => (
            <div key={label} className="bg-cp-sand/20 border border-cp-line/60 p-2.5 rounded-lg text-center">
              <p className="text-[10px] text-cp-ink-3 font-medium">{label}</p>
              <p className={`text-sm font-bold mt-0.5 ${getMetricBadgeClass(value).split(' ')[0]}`}>{value}/10</p>
            </div>
          ))}
        </div>
      </div>

      {/* Content Manager Note */}
      {cut.contentManagerNote && (
        <div className="mt-auto bg-cp-sand/50 p-4 rounded-xl border border-cp-line">
          <p className="text-[10px] text-cp-clay font-semibold mb-1 uppercase">הנחיית הפקה</p>
          <p className="text-xs text-cp-ink-2 leading-relaxed">{cut.contentManagerNote}</p>
        </div>
      )}

      {/* CapCut Instructions — Copy All */}
      <div className="mt-4 bg-gradient-to-br from-cp-ochre/5 to-cp-clay/5 border border-cp-ochre/25 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase text-cp-ochre font-bold tracking-wider flex items-center gap-1.5">
            ✂️ הוראות CapCut — העתק הכל
          </span>
          <button
            type="button"
            onClick={async () => {
              const instructions = [
                `📋 הוראות עריכה לקליפ: "${cut.title}"`,
                `⏱️ חתוך מהמקור: ${cut.startTime} → ${cut.endTime}`,
                `📐 פורמט: 9:16 (Reel/TikTok)`,
                '',
                '🎬 פירוק שוטים:',
                cut.shotOpening ? `  0–5 שניות | פתיחה: ${cut.shotOpening}` : '',
                cut.shotClimax ? `  5–25 שניות | שיא: ${cut.shotClimax}` : '',
                cut.shotClosing ? `  25–30 שניות | סגירה: ${cut.shotClosing}` : '',
                '',
                '📝 כתוביות (3 כרטיסים):',
                `  כרטיס 1 (0:00–0:05): ${cut.hook}`,
                `  כרטיס 2 (0:05–0:25): "${cut.quote}"`,
                `  כרטיס 3 (0:25–0:30): נקודת חיבור | לינק בביו`,
                '',
                cut.contentManagerNote ? `🎨 הנחיית הפקה: ${cut.contentManagerNote}` : '',
                '',
                '📱 קפשן לפרסום:',
                cut.captionSuggestion || '',
              ].filter(Boolean).join('\n');

              const success = await copyToClipboard(instructions);
              if (success) {
                setCapcutCopied(true);
                setTimeout(() => setCapcutCopied(false), 2500);
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-full border transition cursor-pointer ${
              capcutCopied
                ? 'border-cp-sage/40 text-cp-sage bg-cp-sage/10'
                : 'border-cp-ochre/40 text-cp-ochre bg-cp-ochre/10 hover:bg-cp-ochre/20'
            }`}
          >
            {capcutCopied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{capcutCopied ? 'הועתק!' : 'העתק הוראות ל-CapCut'}</span>
          </button>
        </div>
        <div className="text-[11px] text-cp-ink-2 space-y-1 font-mono leading-relaxed" dir="rtl">
          <p>⏱️ <span className="font-semibold">{cut.startTime} → {cut.endTime}</span></p>
          {cut.shotOpening && <p>🎬 פתיחה: <span className="text-cp-ink">{cut.shotOpening}</span></p>}
          {cut.shotClimax && <p>⚡ שיא: <span className="text-cp-ink font-semibold">{cut.shotClimax}</span></p>}
          {cut.shotClosing && <p>🔚 סגירה: <span className="text-cp-ink">{cut.shotClosing}</span></p>}
        </div>
      </div>

      {/* MCP Kiro Reel Spec — Copy JSON */}
      <div className={`mt-3 rounded-xl p-4 transition-all duration-300 ${
        mcpCopied 
          ? 'bg-gradient-to-br from-green-50 to-emerald-50 border border-green-300/60 ring-2 ring-green-200' 
          : 'bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200/40'
      }`}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase text-purple-700 font-bold tracking-wider flex items-center gap-1.5">
            🤖 MCP Kiro Reel Spec
          </span>
          <button
            type="button"
            onClick={async () => {
              const spec = generateMcpSpec();
              // Try clipboard API first, fallback to textarea method
              let success = false;
              try {
                await navigator.clipboard.writeText(spec);
                success = true;
              } catch {
                // Fallback: create a textarea, select, copy
                const textarea = document.createElement('textarea');
                textarea.value = spec;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                success = document.execCommand('copy');
                document.body.removeChild(textarea);
              }
              if (success) {
                setMcpCopied(true);
                setTimeout(() => setMcpCopied(false), 3000);
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-full border transition-all duration-200 cursor-pointer ${
              mcpCopied
                ? 'border-green-400 text-green-700 bg-green-100 scale-105'
                : 'border-purple-300 text-purple-700 bg-purple-100/50 hover:bg-purple-100 hover:scale-105'
            }`}
          >
            {mcpCopied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{mcpCopied ? '✓ הועתק ללוח!' : 'העתק JSON ל-MCP'}</span>
          </button>
        </div>
        {mcpCopied && (
          <p className="text-[11px] text-green-700 font-semibold mt-2 animate-pulse">📋 ה-JSON הועתק — הדבק ב-Kiro Chat עם הפקודה create_kiro_reel</p>
        )}
        {!mcpCopied && (
          <p className="text-[10px] text-purple-600/70 mt-1">העתק והדבק ל-Kiro כ-input ל-create_kiro_reel. הקבצים יילקחו מ-Downloads.</p>
        )}
      </div>
    </div>
  );
});
