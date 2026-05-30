export type StepState = 'idle' | 'active' | 'done' | 'error';

export interface PipelineStep {
  id: number;
  name: string;
  state: StepState;
  details?: string;
}

export interface CutScores {
  authenticity: number;
  engagement: number;
  emotional_resonance: number;
  actionability: number;
  standalone_clarity?: number;
}

export interface ViralCut {
  id: number;
  startTime: string;
  endTime: string;
  title: string;
  quote: string;
  hook: string;
  whyViral: string;
  scores: CutScores;
  viralPotential: number;
  contentManagerNote?: string;
  openingLine?: string;
  targetEmotion?: string;
  bonusSignals?: string[];
  scoreBreakdown?: string;
  captionSuggestion?: string;
}

export interface PipelineResult {
  cuts: ViralCut[];
  sourceUrl: string;
  sourcePlatform: string;
  transcriptLength?: number;
  isSimulated?: boolean;
  podcastName?: string;
  episodeName?: string;
}
