// ============================================================
// KIRO ADVANCED REEL SPEC — Input Format
// ============================================================

/** Top-level Kiro Reel Spec */
export interface KiroReelSpec {
  project: ProjectSpec;
  content_source: ContentSource;
  viral_analysis: ViralAnalysis;
  hook_strategy: HookStrategy;
  editing_directive: EditingDirective;
  timeline: TimelineSegment[];
  caption_system: CaptionSystem;
  visual_direction: VisualDirection;
  audio_direction: AudioDirection;
  cta: CtaSpec;
  output_requirements: OutputRequirements;
  /** Path to the source video file */
  input_video_path: string;
  /** Output path (auto-generated if omitted) */
  output_path?: string;
}

export interface ProjectSpec {
  title: string;
  language: string;
  format: string;
  duration_seconds: number;
  aspect_ratio: string;
}

export interface ContentSource {
  speaker: string;
  type: 'talking_head' | 'multi_speaker' | 'voiceover' | 'mixed';
  context: string;
}

export interface ViralAnalysis {
  virality_score: number;
  emotional_depth: number;
  authenticity: number;
  engagement: number;
  practical_value: number;
  hook_type: string;
}

export interface HookStrategy {
  first_3_seconds: string;
  reason: string;
}

export interface EditingDirective {
  style: string;
  start_frame: string;
  pacing: string;
  emotion_focus: string;
}

export interface TimelineSegment {
  segment: string;
  type: 'hook' | 'core_conflict' | 'resolution' | 'cta' | 'transition';
  audio: string;
  visual_instruction: string;
  caption_style: string;
  intent: string;
}

export interface CaptionSystem {
  cards: CaptionCard[];
  style: string;
}

export interface CaptionCard {
  id: number;
  type: 'hook' | 'peak_quote' | 'cta' | 'context';
  text: string;
}

export interface VisualDirection {
  lighting: string;
  camera_motion: string;
  framing: string;
  aesthetic: string;
}

export interface AudioDirection {
  music_style: string;
  voice_priority: string;
  music_volume: number;
  /** Path to background music file (optional) */
  music_path?: string;
}

export interface CtaSpec {
  type: string;
  text: string;
  placement: string;
}

export interface OutputRequirements {
  resolution: string;
  codec: string;
  audio_codec: string;
  faststart: boolean;
}

// ============================================================
// Simple create_reel input (backward compatible)
// ============================================================

export interface CreateReelInput {
  input_video_path: string;
  output_path?: string;
  aspect_ratio?: string;
  resolution?: string;
  start_time?: string;
  duration?: number;
  text_overlay?: TextOverlay;
  subtitles_path?: string;
  subtitle_style?: SubtitleStyle;
  background_music_path?: string;
  music_volume?: number;
  video_volume?: number;
  preset?: ReelPreset;
  language?: string;
}

export interface TextOverlay {
  text: string;
  position?: 'top' | 'center' | 'bottom';
  font_size?: number;
  color?: string;
  background?: string;
  font?: string;
  language?: string;
}

export interface SubtitleStyle {
  font_name?: string;
  font_size?: number;
  primary_color?: string;
  outline_color?: string;
  background_color?: string;
  bold?: boolean;
  outline?: number;
  shadow?: number;
  margin_v?: number;
  alignment?: number;
  encoding?: number;
}

export type ReelPreset = 'viral_reel_fast_cut' | 'talking_head_subtitles' | 'product_showcase' | 'custom';

// ============================================================
// Output types
// ============================================================

export interface CreateReelOutput {
  status: 'success' | 'error';
  output_video?: string;
  ffmpeg_command?: string;
  metadata?: {
    duration: number;
    resolution: string;
    format: string;
    title?: string;
    speaker?: string;
    virality_score?: number;
  };
  srt_file?: string;
  editing_notes?: string;
  error?: string;
}

export interface BatchReelInput {
  reels: (CreateReelInput | KiroReelSpec)[];
}

export interface BatchReelOutput {
  status: 'success' | 'partial' | 'error';
  results: CreateReelOutput[];
  total: number;
  succeeded: number;
  failed: number;
}
