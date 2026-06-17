import { CreateReelInput, TextOverlay, SubtitleStyle } from './types.js';

/**
 * FFmpeg command builder for Instagram Reels.
 * Generates deterministic FFmpeg commands from structured parameters.
 */
export function buildFfmpegCommand(input: CreateReelInput): string[] {
  const {
    input_video_path,
    output_path = 'output_reel.mp4',
    resolution = '1080x1920',
    start_time,
    duration,
    text_overlay,
    subtitles_path,
    subtitle_style,
    background_music_path,
    music_volume = 0.3,
    video_volume = 1.0,
    language,
  } = input;

  const [width, height] = resolution.split('x').map(Number);
  const args: string[] = [];

  // Input seeking (before -i for fast seek)
  if (start_time) {
    args.push('-ss', start_time);
  }

  // Primary video input
  args.push('-i', input_video_path);

  // Background music input
  if (background_music_path) {
    args.push('-i', background_music_path);
  }

  // Duration limit
  if (duration) {
    args.push('-t', String(duration));
  }

  // Build filter complex
  const filters = buildFilterComplex({
    width,
    height,
    text_overlay,
    subtitles_path,
    subtitle_style,
    background_music_path,
    music_volume,
    video_volume,
    language,
  });

  if (filters.filterComplex) {
    args.push('-filter_complex', filters.filterComplex);
    args.push('-map', filters.videoMap);
    args.push('-map', filters.audioMap);
  } else {
    // Simple scale + crop without complex filter
    args.push('-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`);
  }

  // Video encoding
  args.push('-c:v', 'libx264');
  args.push('-preset', 'medium');
  args.push('-crf', '23');
  args.push('-r', '30');
  args.push('-pix_fmt', 'yuv420p');

  // Audio encoding
  args.push('-c:a', 'aac');
  args.push('-b:a', '128k');
  args.push('-ar', '48000');

  // Social media optimization
  args.push('-movflags', '+faststart');

  // Overwrite
  args.push('-y');

  // Output
  args.push(output_path);

  return args;
}

interface FilterOptions {
  width: number;
  height: number;
  text_overlay?: TextOverlay;
  subtitles_path?: string;
  subtitle_style?: SubtitleStyle;
  background_music_path?: string;
  music_volume: number;
  video_volume: number;
  language?: string;
}

function buildFilterComplex(opts: FilterOptions): {
  filterComplex: string;
  videoMap: string;
  audioMap: string;
} | { filterComplex: null; videoMap: string; audioMap: string } {
  const { width, height, text_overlay, subtitles_path, subtitle_style, background_music_path, music_volume, video_volume, language } = opts;

  const videoFilters: string[] = [];
  const needsComplex = !!(text_overlay || subtitles_path || background_music_path);

  if (!needsComplex) {
    return { filterComplex: null, videoMap: '0:v', audioMap: '0:a' };
  }

  // Scale and pad to target resolution
  videoFilters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
  videoFilters.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`);

  // Text overlay
  if (text_overlay) {
    const drawtext = buildDrawtext(text_overlay);
    videoFilters.push(drawtext);
  }

  // Subtitles with language-aware styling
  if (subtitles_path) {
    const escapedPath = subtitles_path.replace(/'/g, "\\'").replace(/:/g, "\\:");
    const style = buildSubtitleForceStyle(subtitle_style, language);
    videoFilters.push(`subtitles='${escapedPath}':force_style='${style}'`);
  }

  let filterComplex = `[0:v]${videoFilters.join(',')}[vout]`;
  let audioMap = '[aout]';

  // Audio mixing
  if (background_music_path) {
    filterComplex += `;[0:a]volume=${video_volume}[va];[1:a]volume=${music_volume}[ma];[va][ma]amix=inputs=2:duration=first[aout]`;
  } else {
    filterComplex += `;[0:a]volume=${video_volume}[aout]`;
  }

  return {
    filterComplex,
    videoMap: '[vout]',
    audioMap,
  };
}

function buildDrawtext(overlay: TextOverlay): string {
  const {
    text,
    position = 'bottom',
    font_size = 48,
    color = 'white',
    background = 'black@0.6',
    font = '/System/Library/Fonts/Supplemental/Arial.ttf',
  } = overlay;

  // Escape text for ffmpeg drawtext
  const escapedText = text.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\\/g, '\\\\');

  // Position mapping
  let x = '(w-text_w)/2';
  let y: string;
  switch (position) {
    case 'top':
      y = 'h*0.08';
      break;
    case 'center':
      y = '(h-text_h)/2';
      break;
    case 'bottom':
    default:
      y = 'h*0.85';
      break;
  }

  return `drawtext=text='${escapedText}':fontfile='${font}':fontsize=${font_size}:fontcolor=${color}:x=${x}:y=${y}:box=1:boxcolor=${background}:boxborderw=10`;
}

/** Get the full ffmpeg command as a string (for logging) */
export function commandToString(args: string[]): string {
  return `ffmpeg ${args.map(a => a.includes(' ') || a.includes('[') ? `'${a}'` : a).join(' ')}`;
}

/**
 * RTL language codes that require special font/encoding handling.
 * Encoding=1 = Hebrew, Encoding=178 = Arabic
 */
const RTL_LANGUAGES: Record<string, { fontName: string; encoding: number }> = {
  he: { fontName: 'Arial Hebrew', encoding: 1 },
  ar: { fontName: 'Geeza Pro', encoding: 178 },
  fa: { fontName: 'Geeza Pro', encoding: 178 },
};

/**
 * Default subtitle styles per language/context.
 * Hebrew: smaller font (12), purple, RTL encoding.
 */
const DEFAULT_SUBTITLE_STYLES: Record<string, SubtitleStyle> = {
  he: {
    font_name: 'Arial Hebrew',
    font_size: 12,
    primary_color: '&H00FF00FF', // Purple (BGR format)
    outline_color: '&H00000000',
    background_color: '&H80000000',
    bold: true,
    outline: 1,
    shadow: 1,
    margin_v: 60,
    alignment: 2,
    encoding: 1, // Hebrew encoding for RTL
  },
  default: {
    font_name: 'Arial',
    font_size: 12,
    primary_color: '&H00FFFFFF', // White
    outline_color: '&H00000000',
    background_color: '&H80000000',
    bold: true,
    outline: 1,
    shadow: 1,
    margin_v: 60,
    alignment: 2,
    encoding: 0,
  },
};

/**
 * Build the ASS force_style string for subtitles.
 * Applies language-aware defaults (RTL, font, encoding) then user overrides.
 */
function buildSubtitleForceStyle(style?: SubtitleStyle, language?: string): string {
  // Pick language defaults
  const lang = language || 'default';
  const defaults = DEFAULT_SUBTITLE_STYLES[lang] || DEFAULT_SUBTITLE_STYLES['default'];

  // Merge: defaults < user overrides
  const merged: SubtitleStyle = { ...defaults, ...style };

  // Check if RTL language needs special font
  const rtl = language ? RTL_LANGUAGES[language] : undefined;
  if (rtl && !style?.font_name) {
    merged.font_name = rtl.fontName;
    merged.encoding = rtl.encoding;
  }

  const parts: string[] = [];
  if (merged.font_name) parts.push(`FontName=${merged.font_name}`);
  if (merged.font_size) parts.push(`FontSize=${merged.font_size}`);
  if (merged.primary_color) parts.push(`PrimaryColour=${merged.primary_color}`);
  if (merged.outline_color) parts.push(`OutlineColour=${merged.outline_color}`);
  if (merged.background_color) parts.push(`BackColour=${merged.background_color}`);
  if (merged.bold) parts.push(`Bold=1`);
  if (merged.outline !== undefined) parts.push(`Outline=${merged.outline}`);
  if (merged.shadow !== undefined) parts.push(`Shadow=${merged.shadow}`);
  if (merged.margin_v !== undefined) parts.push(`MarginV=${merged.margin_v}`);
  if (merged.alignment !== undefined) parts.push(`Alignment=${merged.alignment}`);
  if (merged.encoding !== undefined) parts.push(`Encoding=${merged.encoding}`);

  return parts.join(',');
}
