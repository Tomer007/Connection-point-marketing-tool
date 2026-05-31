import { useState } from 'react';
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { PipelineStep } from '../types';
import { copyToClipboard } from '../utils/helpers';

interface PipelineProgressProps {
  steps: PipelineStep[];
  consoleLogs: string[];
  isProcessing: boolean;
}

export function PipelineProgress({ steps, consoleLogs, isProcessing }: PipelineProgressProps) {
  const [consoleCopied, setConsoleCopied] = useState(false);
  const [consoleExpanded, setConsoleExpanded] = useState(false);

  const handleCopyConsole = async () => {
    const success = await copyToClipboard(consoleLogs.join('\n'));
    if (success) {
      setConsoleCopied(true);
      setTimeout(() => setConsoleCopied(false), 2000);
    }
  };

  const completedCount = steps.filter(s => s.state === 'done').length;

  return (
    <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm uppercase text-cp-ink-2 font-semibold tracking-wider">
          התקדמות ({completedCount}/{steps.length})
        </h3>
        <div className="flex items-center gap-3">
          {isProcessing && (
            <span className="text-[10px] text-cp-ink-3 bg-cp-sand px-2 py-0.5 rounded border border-cp-line">
              ~1-2 דקות
            </span>
          )}
          <span className="text-xs text-cp-ink-3 font-mono">
            {isProcessing ? 'מעבד...' : 'הושלם'}
          </span>
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-2.5" role="list" aria-label="Pipeline steps">
        {steps.map((step) => (
          <div
            key={step.id}
            role="listitem"
            aria-label={`${step.name}: ${step.state}`}
            className={`flex gap-3 p-3 rounded-xl border transition ${
              step.state === 'active'
                ? 'bg-cp-sand/45 border-cp-sage/35 shadow-inner'
                : step.state === 'done'
                ? 'bg-cp-sage/5 border-cp-line'
                : step.state === 'error'
                ? 'bg-cp-rose/5 border-cp-line'
                : 'bg-cp-bone/40 border-cp-line/50'
            }`}
          >
            <div className="mt-0.5">
              {step.state === 'active' && (
                <div className="w-5 h-5 rounded-full border-2 border-cp-line border-t-cp-sage animate-spin" aria-hidden="true" />
              )}
              {step.state === 'done' && <CheckCircle2 className="w-5 h-5 text-cp-sage" aria-hidden="true" />}
              {step.state === 'error' && <XCircle className="w-5 h-5 text-cp-clay" aria-hidden="true" />}
              {step.state === 'idle' && <div className="w-5 h-5 rounded-full border border-cp-line bg-cp-sand" aria-hidden="true" />}
            </div>

            <div className="flex-grow">
              <div className="flex justify-between items-center">
                <span className={`text-sm font-semibold ${step.state === 'active' ? 'text-cp-ink' : 'text-cp-ink-2'}`}>
                  {step.name}
                </span>
                <span className="text-[10px] font-bold text-cp-ink-3 tracking-wider uppercase">
                  {step.state === 'idle' ? 'בהמתנה' : step.state === 'active' ? 'מבצע...' : step.state === 'done' ? 'הושלם' : 'שגיאה'}
                </span>
              </div>
              {step.details && (
                <p className={`text-[11px] mt-1 ${step.state === 'error' ? 'text-cp-clay' : 'text-cp-ink-2'}`}>
                  {step.details}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Collapsible Console */}
      <div className="bg-cp-sand rounded-lg border border-cp-line overflow-hidden" dir="ltr">
        <button
          type="button"
          onClick={() => setConsoleExpanded(!consoleExpanded)}
          className="w-full px-4 py-2 flex justify-between items-center text-[11px] text-cp-ink-3 hover:text-cp-ink-2 transition cursor-pointer"
        >
          <span className="font-mono">פרטים טכניים ({consoleLogs.length})</span>
          {consoleExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {consoleExpanded && (
          <div className="px-4 pb-3 font-mono text-[11px] text-cp-ink-2 max-h-32 overflow-y-auto space-y-1 border-t border-cp-line/50 pt-2">
            <div className="flex justify-end mb-1">
              <button
                type="button"
                onClick={handleCopyConsole}
                className={`text-[10px] transition cursor-pointer px-1.5 py-0.5 rounded border ${
                  consoleCopied
                    ? 'text-cp-sage border-cp-sage/40 bg-cp-sage/10'
                    : 'text-cp-ink-3 hover:text-cp-clay border-cp-line/60 hover:border-cp-clay/40'
                }`}
                title="Copy console output"
                aria-label="Copy console output"
              >
                {consoleCopied ? '✓ copied' : 'copy'}
              </button>
            </div>
            {consoleLogs.map((log, i) => (
              <div key={i} className="leading-5 text-left">
                <span className="text-cp-clay/70 mr-2">&gt;&gt;</span>
                {log}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
