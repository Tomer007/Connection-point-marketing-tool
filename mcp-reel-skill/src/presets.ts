import { CreateReelInput } from './types.js';

/**
 * Preset configurations for common reel types.
 * Applied as defaults that can be overridden by user input.
 */
export const PRESETS: Record<string, Partial<CreateReelInput>> = {
  viral_reel_fast_cut: {
    resolution: '1080x1920',
    duration: 15,
    text_overlay: {
      text: '',
      position: 'bottom',
      font_size: 56,
      color: 'white',
      background: 'black@0.7',
    },
    music_volume: 0.4,
    video_volume: 0.8,
  },

  talking_head_subtitles: {
    resolution: '1080x1920',
    duration: 30,
    text_overlay: {
      text: '',
      position: 'bottom',
      font_size: 42,
      color: 'white',
      background: 'black@0.5',
    },
    subtitle_style: {
      font_size: 12,
      primary_color: '&H00FF00FF',
      bold: true,
      outline: 1,
      shadow: 1,
      margin_v: 60,
      alignment: 2,
    },
    music_volume: 0.15,
    video_volume: 1.0,
  },

  product_showcase: {
    resolution: '1080x1920',
    duration: 20,
    text_overlay: {
      text: '',
      position: 'center',
      font_size: 64,
      color: 'white',
      background: 'black@0.4',
    },
    music_volume: 0.5,
    video_volume: 0.6,
  },
};

/** Apply preset defaults, then override with user input */
export function applyPreset(input: CreateReelInput): CreateReelInput {
  if (!input.preset || input.preset === 'custom') return input;

  const preset = PRESETS[input.preset];
  if (!preset) return input;

  return {
    ...preset,
    ...input,
    text_overlay: input.text_overlay || preset.text_overlay,
  } as CreateReelInput;
}
