import { useState } from 'react';
import { ViralCut } from '../types';
import { getMetricBadgeClass, copyToClipboard } from '../utils/helpers';
import { Copy, ClipboardCheck } from 'lucide-react';

interface ViralCutCardProps {
  cut: ViralCut;
  index: number;
}

export function ViralCutCard({ cut, index }: ViralCutCardProps) {
  const isHighPotential = cut.viralPotential >= 75;
  const [quoteCopied, setQuoteCopied] = useState(false);

  const handleCopyQuote = async () => {
    const success = await copyToClipboard(cut.quote);
    if (success) {
      setQuoteCopied(true);
      setTimeout(() => setQuoteCopied(false), 2000);
    }
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
          <span className="text-[10px] uppercase text-cp-ochre font-bold block mb-2">🎬 הוראות שוט לאיש התוכן</span>
          <div className="space-y-1.5 text-xs text-cp-ink-2">
            {cut.shotOpening && <p><span className="font-bold text-cp-ink">📱 פתיחה:</span> {cut.shotOpening}</p>}
            {cut.shotClimax && <p><span className="font-bold text-cp-ink">⚡ שיא:</span> {cut.shotClimax}</p>}
            {cut.shotClosing && <p><span className="font-bold text-cp-ink">🎬 סיום:</span> {cut.shotClosing}</p>}
          </div>
        </div>
      )}

      {/* Ready Caption */}
      {cut.captionSuggestion && (
        <div className="mb-4 bg-cp-sage/5 border border-cp-sage/20 rounded-xl p-3.5">
          <span className="text-[10px] uppercase text-cp-sage-deep font-bold block mb-1">✍️ קפשן מוכן (העתק-הדבק)</span>
          <p className="text-xs text-cp-ink leading-relaxed font-medium">{cut.captionSuggestion}</p>
        </div>
      )}

      {/* Publishing Order */}
      {cut.publishOrder && (
        <div className="mb-4 flex items-center gap-2 text-xs text-cp-ink-2">
          <span className="bg-cp-clay/10 text-cp-clay font-bold px-2 py-0.5 rounded text-[10px]">📅 סדר פרסום: #{cut.publishOrder}</span>
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
    </div>
  );
}
