# 003 — live-translate-mcp Extraction

## Context

The `live-translate` CLI bundled an MCP server (`live-translate-mcp` bin) that proxied to the
four local HTTP microservices (ASR, Translation, TTS, Orchestrator). This worked but had two
problems:

1. **Wrong audience**: Claude ecosystem users already have an API key; making them run 4 local
   services and download 3 GB of models for translation is friction that serves no one.
2. **Muddied pitch**: CLI users want "fully local, no API key." MCP users want
   "Claude can translate audio." One package cannot serve both well.

## Decision

Extract the MCP server into a standalone npm package: `live-translate-mcp` (repo:
`waxberry-dev/live-translate-mcp` on GitHub, published at `0.1.0`).

**What changed:**
- `cli/src/mcp.ts` deleted; `live-translate-mcp` bin removed from `cli/package.json`
- `@modelcontextprotocol/sdk` removed from `live-translate` dependencies
- `live-translate` bumped to `0.3.0`

## Architecture of live-translate-mcp

Single-process — no HTTP microservices:

```
Claude Desktop
    │  calls tool
    ▼
src/index.ts  (MCP server, stdio transport)
    │
    ├── src/asr.ts     → Whisper via @huggingface/transformers
    ├── src/translate.ts → Claude API (claude-opus-4-8)
    └── src/tts.ts     → Piper ONNX + espeak-ng
```

**Translation replaced by Claude API.** Claude users already have an API key; Opus 4.8 translates
EN↔ZH far better than Opus-MT. The `ANTHROPIC_API_KEY` env var is required.

**Shared data directory.** Models and voices are cached in `~/.live-translate/` — the same path
used by the CLI. Users who have the CLI installed don't re-download anything.

## Tools exposed

| Tool | Description |
|---|---|
| `translate_file` | Read WAV → ASR → Claude translate → TTS → write `_translated.wav` → play |
| `translate_speech` | Same pipeline but takes audio_base64 input, returns audio_base64 output |
| `health_check` | Verify voices, espeak-ng, and Whisper model cache are present |

## Claude Desktop config

```json
{
  "mcpServers": {
    "live-translate": {
      "command": "npx",
      "args": ["-y", "live-translate-mcp"],
      "env": { "ANTHROPIC_API_KEY": "your-key-here" }
    }
  }
}
```

## Status

- [x] Package created and published: `live-translate-mcp@0.1.0` on npm
- [x] Repo created: `github.com/waxberry-dev/live-translate-mcp`
- [ ] End-to-end test with Claude Desktop (health_check + translate_file)
- [ ] Submit to Anthropic MCP registry (PR to `modelcontextprotocol/servers`)
- [ ] Submit to `punkpeye/awesome-mcp-servers`
