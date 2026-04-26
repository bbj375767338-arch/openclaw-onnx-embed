# openclaw-onnx-embed

**Local ONNX-based BGE embedding provider for OpenClaw memory search.**

Uses `bge-large-zh-v1.5` (Chinese BGE model, 1.3GB ONNX) via ONNX Runtime in a subprocess, providing fully offline semantic memory search with no external API calls.

---

## Features

- **Fully offline** — embeddings computed locally, no API key needed
- **Subprocess isolation** — ONNX model runs in separate process to avoid blocking gateway
- **Auto-initialization** — model loads at subprocess startup, warmup done automatically
- **High quality Chinese embeddings** — uses `bge-large-zh-v1.5` (1024 dimensions)

---

## Architecture

```
OpenClaw Gateway
    │
    └── onnx-bge-local provider (plugin)
            │
            └── subprocess.js (node child process)
                    │
                    └── ONNX Runtime
                            └── bge-large-zh-v1.5.onnx (1.3GB)
```

---

## Requirements

- OpenClaw >= 2026.4.22
- Node.js >= 18
- ~2GB RAM (model + runtime)
- Model file: `bge-large-zh-v1.5.onnx` (auto-downloaded to `~/.cache/` or use local path)

---

## Installation

```bash
# Via ClawHub (recommended)
openclaw extension install openclaw-onnx-embed

# Or manually
git clone <repo> /root/.openclaw/extensions/openclaw-onnx-embed
```

---

## Configuration

The plugin auto-registers the `onnx-bge-local` memory embedding provider. In `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-onnx-embed": {
        "enabled": true
      }
    }
  }
}
```

Set as memory search provider (optional — `auto` also works):

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "onnx-bge-local"
      }
    }
  }
}
```

---

## Model

The plugin downloads `bge-large-zh-v1.5` ONNX model automatically on first use via `@xenova/transformers`.

**Model location**: `~/.cache/Xenova/bge-large-zh-v1.5/model.onnx`

**Alternative**: Pre-download and set path in `openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "local": {
          "modelPath": "/path/to/bge-large-zh-v1.5/model.onnx"
        }
      }
    }
  }
}
```

---

## Troubleshooting

### "Subprocess initialization timed out"

Model load takes ~15-20s on first startup. If subprocess gets killed before loading completes, increase init timeout in plugin or ensure sufficient memory.

### "Unknown memory embedding provider: onnx-bge-local"

Ensure plugin is in `plugins.entries` (not just `plugins.allow`) in `openclaw.json`.

### Slow queries (~20-30s per query)

Normal on first query after gateway restart (model loading). Model stays in memory for subsequent queries within the same session.

---

## Files

```
openclaw-onnx-embed/
├── index.js          ← Plugin entry, registers provider
├── subprocess.js     ← Subprocess: loads ONNX, handles embedding requests
├── adapter.js        ← (reserved)
├── onnx-runtime.js   ← (reserved)
├── tokenizer.js      ← (reserved)
├── worker.js         ← (reserved)
├── openclaw.plugin.json  ← Plugin manifest
└── package.json
```

---

## License

MIT
