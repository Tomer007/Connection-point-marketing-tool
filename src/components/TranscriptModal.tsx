import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Copy, ClipboardCheck } from 'lucide-react';
import { copyToClipboard } from '../utils/helpers';

interface TranscriptModalProps {
  transcript: string;
  onClose: () => void;
}

export function TranscriptModal({ transcript, onClose }: TranscriptModalProps) {
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    const success = await copyToClipboard(transcript);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Trap focus inside modal
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transcript-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-cp-line">
          <h3 id="transcript-modal-title" className="text-lg font-serif font-semibold text-cp-ink">תמלול הפרק</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-cp-line hover:bg-cp-sand transition cursor-pointer"
              title="העתק תמלול"
              aria-label="Copy transcript"
            >
              {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-cp-sage" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'הועתק!' : 'העתק'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-cp-sand transition cursor-pointer"
              title="סגור"
              aria-label="Close modal"
            >
              <X className="w-5 h-5 text-cp-ink-3" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-6">
          <pre className="whitespace-pre-wrap text-sm text-cp-ink leading-relaxed font-mono text-left" dir="ltr">
            {transcript}
          </pre>
        </div>
      </div>
    </div>
  );
}
