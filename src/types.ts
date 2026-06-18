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
  // Shot directions for content editor
  shotOpening?: string;
  shotClimax?: string;
  shotClosing?: string;
  // Publishing strategy
  publishOrder?: number;
  publishNote?: string;
  // Algorithm optimization
  algorithmLever?: string;
}

export interface PipelineResult {
  cuts: ViralCut[];
  sourceUrl: string;
  sourcePlatform: string;
  transcriptLength?: number;
  podcastName?: string;
  episodeName?: string;
}

export interface RecoveryData {
  transcript?: string;
  rawCuts?: ViralCut[];
  validatedCuts?: ViralCut[];
  podcastName?: string;
  episodeName?: string;
}

export interface CachedReport {
  html: string;
  result: PipelineResult;
  timestamp: number;
  platform: string;
  title: string;
  dateString: string;
  transcript?: string;
}

export interface StepIntermediateData {
  transcript?: string;
  rawCuts?: ViralCut[];
  validatedCuts?: ViralCut[];
  podcastName?: string;
  episodeName?: string;
}
