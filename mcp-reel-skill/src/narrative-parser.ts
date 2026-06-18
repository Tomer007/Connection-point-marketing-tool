import { KiroReelSpec, TimelineSegment, CaptionCard } from './types.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * Narrative Parser — converts Kiro Reel Spec into FFmpeg-ready parameters.
 * Handles: timeline → filter graph, captions → SRT, visual directives → ffmpeg filters
 */

export interface ParsedPipeline {
  inputPath: string;
  outputPath: string;
  startTime: string;
  duration: number;
  resolution: { width: number; height: number };
  srtPath: string;
  musicPath?: string;
  musicVolume: number;
  voiceVolume: number;
  videoFilters: string[];
  editingNotes: string;
}

/**
 * Parse a KiroReelSpec into FFmpeg pipeline parameters.
 */
export async function parseKiroSpec(spec: KiroReelSpec): Promise<ParsedPipeline> {
  const { project, timeline, caption_system, visual_direction, audio_direction, output_requirements } = spec;

  // 1. Resolve resolution
  const [width, height] = output_requirements.resolution.split('x').map(Number);

  // 2. Parse timeline to determine start time and duration
  const { startSeconds, endSeconds } = parseTimeline(timeline);
  const duration = project.duration_seconds || (endSeconds - startSeconds);
  const startTime = formatTime(startSeconds);

  // 3. Generate SRT from caption cards
  const srtPath = await generateSrt(caption_system.cards, timeline);

  // 4. Build video filters from visual direction
  const videoFilters = buildVisualFilters(visual_direction, timeline);

  // 5. Generate editing notes for human reference
  const editingNotes = buildEditingNotes(spec);

  // 6. Output path
  const outputPath = spec.output_path || join(tmpdir(), `kiro_reel_${randomUUID()}.mp4`);

  return {
    inputPath: spec.input_video_path,
    outputPath,
    startTime,
    duration,
    resolution: { width, height },
    srtPath,
    musicPath: audio_direction.music_path,
    musicVolume: audio_direction.music_volume,
    voiceVolume: audio_direction.voice_priority === 'very_high' ? 1.0 : 0.85,
    videoFilters,
    editingNotes,
  };
}

/** Parse timeline segments to get video start/end in seconds */
function parseTimeline(timeline: TimelineSegment[]): { startSeconds: number; endSeconds: number } {
  let startSeconds = 0;
  let endSeconds = 30;

  if (timeline.length > 0) {
    const firstSeg = timeline[0].segment; // "0-5"
    const lastSeg = timeline[timeline.length - 1].segment; // "25-30"
    startSeconds = parseInt(firstSeg.split('-')[0], 10);
    endSeconds = parseInt(lastSeg.split('-')[1], 10);
  }

  return { startSeconds, endSeconds };
}

/** Generate an SRT file from caption cards + timeline */
async function generateSrt(cards: CaptionCard[], timeline: TimelineSegment[]): Promise<string> {
  const srtPath = join(tmpdir(), `captions_${randomUUID()}.srt`);
  const entries: string[] = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    // Map card to timeline segment timing
    const segment = timeline[i];
    let startSrt = '00:00:00,000';
    let endSrt = '00:00:30,000';

    if (segment) {
      const [segStart, segEnd] = segment.segment.split('-').map(Number);
      startSrt = secondsToSrt(segStart);
      endSrt = secondsToSrt(segEnd);
    } else {
      // Default timing based on card type
      switch (card.type) {
        case 'hook':
          startSrt = '00:00:00,000'; endSrt = '00:00:05,000'; break;
        case 'peak_quote':
          startSrt = '00:00:05,000'; endSrt = '00:00:25,000'; break;
        case 'cta':
          startSrt = '00:00:25,000'; endSrt = '00:00:30,000'; break;
      }
    }

    entries.push(`${i + 1}\n${startSrt} --> ${endSrt}\n${card.text}\n`);
  }

  await writeFile(srtPath, entries.join('\n'), 'utf-8');
  return srtPath;
}

/** Build video filters based on visual direction */
function buildVisualFilters(visual: VisualDirection, timeline: TimelineSegment[]): string[] {
  const filters: string[] = [];

  // Camera motion simulation
  switch (visual.camera_motion) {
    case 'static_with_micro_movement':
      // Slight zoom for a "alive" feel (1% zoom over duration)
      filters.push('zoompan=z=1.01:d=1:s=1080x1920:fps=30');
      break;
    case 'slow_zoom_in':
      filters.push('zoompan=z=\'min(zoom+0.0005,1.3)\':d=900:s=1080x1920:fps=30');
      break;
    case 'slow_zoom_out':
      filters.push('zoompan=z=\'if(eq(on,1),1.3,max(zoom-0.0005,1))\':d=900:s=1080x1920:fps=30');
      break;
  }

  return filters;
}

/** Build human-readable editing notes */
function buildEditingNotes(spec: KiroReelSpec): string {
  const lines: string[] = [];
  lines.push(`📋 הוראות עריכה: "${spec.project.title}"`);
  lines.push(`🎬 סגנון: ${spec.editing_directive.style}`);
  lines.push(`📐 פורמט: ${spec.project.aspect_ratio} (${spec.output_requirements.resolution})`);
  lines.push(`⏱️ משך: ${spec.project.duration_seconds} שניות`);
  lines.push(`🎤 דובר: ${spec.content_source.speaker}`);
  lines.push('');
  lines.push('--- TIMELINE ---');
  for (const seg of spec.timeline) {
    lines.push(`[${seg.segment}s] ${seg.type.toUpperCase()}: ${seg.audio}`);
    lines.push(`   Visual: ${seg.visual_instruction} | Caption: ${seg.caption_style}`);
  }
  lines.push('');
  lines.push(`🎵 מוזיקה: ${spec.audio_direction.music_style} (vol: ${spec.audio_direction.music_volume})`);
  lines.push(`📱 CTA: ${spec.cta.text}`);
  lines.push(`🔥 Virality Score: ${spec.viral_analysis.virality_score}/100`);
  return lines.join('\n');
}

/** Convert seconds to SRT timestamp format */
function secondsToSrt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},000`;
}

/** Format seconds as MM:SS */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Re-export for type usage
import type { VisualDirection } from './types.js';
