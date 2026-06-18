# Instagram Reel FFmpeg Skill (MCP Server)

An MCP (Model Context Protocol) skill that generates Instagram Reels (9:16 vertical videos) using FFmpeg.

## Prerequisites

- **Node.js** ≥ 18
- **FFmpeg** installed and available in PATH (`brew install ffmpeg` on macOS)

## Setup

```bash
cd mcp-reel-skill
npm install
```

## Run

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## MCP Configuration

Add to your `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "instagram-reel": {
      "command": "npx",
      "args": ["tsx", "mcp-reel-skill/src/server.ts"],
      "disabled": false
    }
  }
}
```

## Tools

### `create_reel`

Create a single Instagram Reel from a source video.

**Example:**
```json
{
  "input_video_path": "/path/to/video.mp4",
  "output_path": "/path/to/output_reel.mp4",
  "start_time": "03:30",
  "duration": 30,
  "subtitles_path": "/path/to/captions.srt",
  "background_music_path": "/path/to/music.mp3",
  "music_volume": 0.2,
  "preset": "talking_head_subtitles"
}
```

### `batch_create_reels`

Process multiple reels in sequence.

**Example:**
```json
{
  "reels": [
    { "input_video_path": "video.mp4", "start_time": "03:30", "duration": 30, "output_path": "clip1.mp4" },
    { "input_video_path": "video.mp4", "start_time": "15:20", "duration": 28, "output_path": "clip2.mp4" },
    { "input_video_path": "video.mp4", "start_time": "47:04", "duration": 35, "output_path": "clip3.mp4" }
  ]
}
```

### `list_presets`

List available preset configurations.

## Presets

| Preset | Duration | Music Volume | Best For |
|--------|----------|--------------|----------|
| `viral_reel_fast_cut` | 15s | 0.4 | Fast-paced content, hooks |
| `talking_head_subtitles` | 30s | 0.15 | Podcast clips, interviews |
| `product_showcase` | 20s | 0.5 | Product demos, B-roll |

## Output Format

Every successful run returns:

```json
{
  "status": "success",
  "output_video": "/path/to/output.mp4",
  "ffmpeg_command": "ffmpeg -ss 03:30 -i input.mp4 -t 30 ...",
  "metadata": {
    "duration": 30,
    "resolution": "1080x1920",
    "format": "instagram_reel"
  }
}
```

## FFmpeg Pipeline

The generated command handles:
- Scale + pad to 1080x1920 (letterbox, no crop)
- H.264 encoding (libx264, CRF 23)
- AAC audio (128kbps, 48kHz)
- `drawtext` overlay for titles
- SRT subtitle burning (white text, black outline)
- Audio mixing (voice + background music)
- `-movflags +faststart` for streaming optimization
- 30fps, yuv420p for maximum compatibility
