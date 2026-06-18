import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CreateReelInput, KiroReelSpec, BatchReelInput } from './types.js';
import { executeCreateReel, executeKiroReel } from './executor.js';

const server = new Server(
  { name: 'instagram-reel-ffmpeg-skill', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// --- Tool definitions ---
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_kiro_reel',
      description: 'Create an Instagram Reel from an advanced Kiro Reel Spec. Accepts the full 6-layer format (project, content_source, viral_analysis, hook_strategy, editing_directive, timeline, caption_system, visual_direction, audio_direction, cta, output_requirements). Parses narrative structure → generates SRT captions → builds FFmpeg pipeline → renders 9:16 vertical video.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          input_video_path: { type: 'string', description: 'Path to the source video file (required)' },
          output_path: { type: 'string', description: 'Output path for the rendered reel' },
          project: {
            type: 'object', description: 'Project metadata',
            properties: {
              title: { type: 'string' }, language: { type: 'string' },
              format: { type: 'string' }, duration_seconds: { type: 'number' },
              aspect_ratio: { type: 'string' },
            },
          },
          content_source: {
            type: 'object', description: 'Content source info',
            properties: {
              speaker: { type: 'string' }, type: { type: 'string' }, context: { type: 'string' },
            },
          },
          viral_analysis: {
            type: 'object', description: 'Viral scoring',
            properties: {
              virality_score: { type: 'number' }, emotional_depth: { type: 'number' },
              authenticity: { type: 'number' }, engagement: { type: 'number' },
              practical_value: { type: 'number' }, hook_type: { type: 'string' },
            },
          },
          hook_strategy: {
            type: 'object', properties: { first_3_seconds: { type: 'string' }, reason: { type: 'string' } },
          },
          editing_directive: {
            type: 'object', properties: {
              style: { type: 'string' }, start_frame: { type: 'string' },
              pacing: { type: 'string' }, emotion_focus: { type: 'string' },
            },
          },
          timeline: {
            type: 'array', description: 'Narrative timeline segments',
            items: {
              type: 'object', properties: {
                segment: { type: 'string' }, type: { type: 'string' },
                audio: { type: 'string' }, visual_instruction: { type: 'string' },
                caption_style: { type: 'string' }, intent: { type: 'string' },
              },
            },
          },
          caption_system: {
            type: 'object', properties: {
              cards: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' }, type: { type: 'string' }, text: { type: 'string' } } } },
              style: { type: 'string' },
            },
          },
          visual_direction: {
            type: 'object', properties: {
              lighting: { type: 'string' }, camera_motion: { type: 'string' },
              framing: { type: 'string' }, aesthetic: { type: 'string' },
            },
          },
          audio_direction: {
            type: 'object', properties: {
              music_style: { type: 'string' }, voice_priority: { type: 'string' },
              music_volume: { type: 'number' }, music_path: { type: 'string' },
            },
          },
          cta: {
            type: 'object', properties: { type: { type: 'string' }, text: { type: 'string' }, placement: { type: 'string' } },
          },
          output_requirements: {
            type: 'object', properties: {
              resolution: { type: 'string' }, codec: { type: 'string' },
              audio_codec: { type: 'string' }, faststart: { type: 'boolean' },
            },
          },
        },
        required: ['input_video_path', 'project', 'timeline', 'caption_system', 'output_requirements'],
      },
    },
    {
      name: 'create_reel',
      description: 'Create an Instagram Reel with simple parameters (input video, duration, text overlay, subtitles, music). For quick one-shot rendering without the full Kiro spec.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          input_video_path: { type: 'string', description: 'Path to the source video file' },
          output_path: { type: 'string' },
          resolution: { type: 'string', default: '1080x1920' },
          start_time: { type: 'string' },
          duration: { type: 'number' },
          text_overlay: { type: 'object', properties: { text: { type: 'string' }, position: { type: 'string' }, font_size: { type: 'number' }, color: { type: 'string' } } },
          subtitles_path: { type: 'string' },
          background_music_path: { type: 'string' },
          music_volume: { type: 'number' },
          video_volume: { type: 'number' },
          preset: { type: 'string', enum: ['viral_reel_fast_cut', 'talking_head_subtitles', 'product_showcase', 'custom'] },
        },
        required: ['input_video_path'],
      },
    },
    {
      name: 'batch_create_reels',
      description: 'Create multiple reels in batch from an array of specs (Kiro or simple format).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          reels: { type: 'array', description: 'Array of reel specs', items: { type: 'object' } },
        },
        required: ['reels'],
      },
    },
    {
      name: 'list_presets',
      description: 'List available reel presets with their default configurations.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ],
}));

// --- Tool execution ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'create_kiro_reel': {
      const spec = args as unknown as KiroReelSpec;
      const result = await executeKiroReel(spec);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    case 'create_reel': {
      const input = args as unknown as CreateReelInput;
      const result = await executeCreateReel(input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    case 'batch_create_reels': {
      const { reels } = args as unknown as { reels: any[] };
      const results = [];
      let succeeded = 0, failed = 0;

      for (const reel of reels) {
        // Detect if it's a Kiro spec (has timeline) or simple input
        const isKiro = reel.timeline && reel.project;
        const result = isKiro ? await executeKiroReel(reel) : await executeCreateReel(reel);
        results.push(result);
        if (result.status === 'success') succeeded++; else failed++;
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ status: failed === 0 ? 'success' : succeeded === 0 ? 'error' : 'partial', results, total: reels.length, succeeded, failed }, null, 2) }],
      };
    }

    case 'list_presets': {
      const { PRESETS } = await import('./presets.js');
      return { content: [{ type: 'text' as const, text: JSON.stringify(PRESETS, null, 2) }] };
    }

    default:
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
  }
});

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Instagram Reel FFmpeg Skill v2.0 running (Kiro Spec support)');
}

main().catch((err) => { console.error('[MCP] Fatal:', err); process.exit(1); });
