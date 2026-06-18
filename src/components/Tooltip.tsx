import { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  text: string;
  children?: ReactNode;
}

/** Simple hover tooltip with help icon */
export function Tooltip({ text, children }: TooltipProps) {
  return (
    <span className="tooltip-wrapper">
      {children || <HelpCircle className="w-3.5 h-3.5 text-cp-ink-3 hover:text-cp-clay transition cursor-help" />}
      <span className="tooltip-text">{text}</span>
    </span>
  );
}
