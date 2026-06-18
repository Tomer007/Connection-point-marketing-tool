import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat, unlink } from 'fs/promises';
import { CreateReelInput, CreateReelOutput, KiroReelSpec } from './types.js';
import { buildFfmpegCommand, commandToString } from './ffmpeg-builder.js';
import { applyPreset } from './presets.js';
import { parseKiroSpec, ParsedPipeline } from './narrative-parser.js';

const execFileAsync = promisify(execFile);

/**
 * Execute a reel creation from the simple CreateReelInput format.
 */
export async function executeCreateReel(input: CreateReelInput): Promise<CreateReelOutput> {
  const resolvedInput = applyPreset(input);

  try {
    await stat(resolvedInput.input_video_path);
  } catch {
    return { status: 'error', error: `Input file not found: ${resolvedInput.input_video_path}` };
  }

  if (!resolvedInput.output_path) {
    resolvedInput.output_path = `reel_${Date.now()}.mp4`;
  }

  const args = buildFfmpegCommand(resolvedInput);
  const commandStr = commandToString(args);
  console.error(`[FFmpeg] Executing: ${commandStr}`);

  try {
    await execFileAsync('ffmpeg', args, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
    await stat(resolvedInput.output_path);

    return {
      status: 'success',
      output_video: resolvedInput.output_path,
      ffmpeg_command: commandStr,
      metadata: {
        duration: resolvedInput.duration || 30,
        resolution: resolvedInput.resolution || '1080x1920',
        format: 'instagram_reel',
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'FFmpeg execution failed';
    return { status: 'error', ffmpeg_command: commandStr, error: message.substring(0, 500) };
  }
}

/**
 * Execute a reel creation from the advanced KiroReelSpec format.
 * Parses the 6-layer spec → builds FFmpeg pipeline → renders.
 */
export async function executeKiroReel(spec: KiroReelSpec): Promise<CreateReelOutput> {
  // Validate input
  try {
    await stat(spec.input_video_path);
  } catch {
    return { status: 'error', error: `Input file not found: ${spec.input_video_path}` };
  }

  // Parse the spec into FFmpeg-ready pipeline
  let pipeline: ParsedPipeline;
  try {
    pipeline = await parseKiroSpec(spec);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to parse Kiro spec';
    return { status: 'error', error: `Spec parsing failed: ${message}` };
  }

  // Build FFmpeg args from parsed pipeline
  const args = buildKiroFfmpegArgs(pipeline);
  const commandStr = commandToString(args);
  console.error(`[FFmpeg/Kiro] Executing: ${commandStr}`);

  try {
    const { stderr } = await execFileAsync('ffmpeg', args, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
    if (stderr) console.error(`[FFmpeg] ${stderr.substring(0, 300)}`);

    await stat(pipeline.outputPath);

    return {
      status: 'success',
      output_video: pipeline.outputPath,
      ffmpeg_command: commandStr,
      srt_file: pipeline.srtPath,
      editing_notes: pipeline.editingNotes,
      metadata: {
        duration: pipeline.duration,
        resolution: `${pipeline.resolution.width}x${pipeline.resolution.height}`,
        format: 'instagram_reel',
        title: spec.project.title,
        speaker: spec.content_source.speaker,
        virality_score: spec.viral_analysis.virality_score,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'FFmpeg execution failed';
    return {
      status: 'error',
      ffmpeg_command: commandStr,
      srt_file: pipeline.srtPath,
      editing_notes: pipeline.editingNotes,
      error: message.substring(0, 500),
    };
  }
}

/** Build FFmpeg args from a parsed Kiro pipeline */
function buildKiroFfmpegArgs(pipeline: ParsedPipeline): string[] {
  const { inputPath, outputPath, startTime, duration, resolution, srtPath, musicPath, musicVolume, voiceVolume } = pipeline;
  const { width, height } = resolution;
  const args: string[] = [];

  // Seek
  if (startTime && startTime !== '00:00') {
    args.push('-ss', startTime);
  }

  // Input video
  args.push('-i', inputPath);

  // Music input
  if (musicPath) {
    args.push('-i', musicPath);
  }

  // Duration
  args.push('-t', String(duration));

  // Build filter complex
  const escapedSrt = srtPath.replace(/'/g, "\\'").replace(/:/g, "\\:");

  let vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;

  // Add subtitle burn
  vf += `,subtitles='${escapedSrt}':force_style='FontSize=28,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,Alignment=2,MarginV=80'`;

  if (musicPath) {
    // Complex filter with audio mixing
    const filterComplex = `[0:v]${vf}[vout];[0:a]volume=${voiceVolume}[va];[1:a]volume=${musicVolume}[ma];[va][ma]amix=inputs=2:duration=first[aout]`;
    args.push('-filter_complex', filterComplex);
    args.push('-map', '[vout]');
    args.push('-map', '[aout]');
  } else {
    // Simple video filter
    args.push('-vf', vf);
  }

  // Encoding
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23');
  args.push('-r', '30');
  args.push('-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000');
  args.push('-movflags', '+faststart');
  args.push('-y');
  args.push(outputPath);

  return args;
}
