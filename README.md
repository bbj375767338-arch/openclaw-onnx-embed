# OpenClaw Local Memory Solution

**Chinese-Optimized · Fully Local · Efficient Retrieval · Permanent Memory**

A memory plugin for [OpenClaw](https://github.com/openclaw/openclaw) that provides local embedding generation using ONNX BGE model, combined with MySQL for permanent structured storage.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E%3D2026.4.22-blue)](https://github.com/openclaw/openclaw)

---

## Features

### `openclaw-onnx-embed` — Local Embedding Provider

- 🧠 **Fully Offline** — Generate embeddings locally without any API calls
- 🔒 **Process Isolation** — ONNX runtime runs in an isolated subprocess
- 🌐 **Chinese Optimized** — Uses BGE large Chinese model (bge-large-zh-v1.5, 1024 dimensions)
- 📝 **Standard Tokenizer** — BERT WordPiece tokenizer with 28K vocabulary
- 🔢 **Auto Threading** — Automatically adjusts threads based on CPU cores
- 📦 **Batch Indexing** — Supports batch embedding for memory-core plugin

### `openclaw-memory-sync` — MySQL Memory Sync

- 💾 **MySQL Persistence** — Structured storage, permanent retention
- 🔄 **Memory Evolution** — Supports expanding (evolving) and deprecating (superseded) memories
- 📊 **Multi-tier Summaries** — L0 (~100 tokens), L1 (~1K tokens) incremental summaries
- 🔍 **Hybrid Search** — Vector + keyword + time-weighted re-ranking
- 🔗 **Topic Graph** — Topic and link graph support for memory organization
- ⚡ **Idempotent Migration** — Migrates existing OpenClaw memories without duplicates

---

## Architecture

```
OpenClaw Agent
    │
    ├── openclaw-onnx-embed
    │       └── bge-large-zh-v1.5 ONNX (1024dim) ← fully offline, Chinese-optimized
    │
    └── openclaw-memory-sync
            ├── memory_recall    ← context-aware memory retrieval
            ├── memory_search    ← BM25 + vector hybrid search
            ├── memory_save      ← save memories with evolution tracking
            └── memory_stats     ← memory system statistics
                    │
                    └── MySQL (openclaw_memory)
                            ├── memories          ← raw memories + version chain
                            ├── summaries         ← L0/L1 summaries
                            └── memory_topics     ← topic graph
```

---

## Requirements

- OpenClaw >= 2026.4.22
- Node.js >= 18
- MySQL >= 5.7 (or Docker)
- ~2GB RAM (embedding model + runtime)

---

## Quick Start

### 1. Install Plugins

```bash
openclaw plugins install openclaw-onnx-embed
openclaw plugins install openclaw-memory-sync
```

Or manual installation:

```bash
git clone https://github.com/bbj375767338-arch/openclaw-onnx-embed.git \
  ~/.openclaw/extensions/openclaw-local-memory
```

### 2. Set Up MySQL Database

```bash
mysql -u root -p

CREATE DATABASE openclaw_memory;
CREATE USER 'openclaw'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON openclaw_memory.* TO 'openclaw'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Configure `openclaw.json`

```json
{
  "plugins": {
    "entries": {
      "openclaw-onnx-embed": {
        "enabled": true
      },
      "openclaw-memory-sync": {
        "enabled": true
      }
    },
    "allow": [
      "openclaw-onnx-embed",
      "openclaw-memory-sync"
    ]
  }
}
```

### 4. Configure Database Connection

Create `db/config.js` in the plugin directory or set environment variables:

```javascript
// ~/.openclaw/extensions/openclaw-local-memory/plugins/memory-sync/db/config.js
module.exports = {
  host: 'localhost',
  user: 'openclaw',
  password: 'your_password',
  database: 'openclaw_memory'
};
```

### 5. Run Migration

```bash
node plugins/memory-sync/db/migrator.js
```

---

## Agent Tools

| Tool | Description |
|------|-------------|
| `memory_recall` | Retrieve relevant memories before tasks |
| `memory_search` | BM25 + vector hybrid search |
| `memory_save` | Save task results to memory |
| `memory_stats` | View memory system statistics |

---

## How It Works

### Embedding Generation

The `onnx-bge-local` provider generates 1024-dimensional embeddings using the BGE large Chinese model. It runs entirely in a subprocess, isolated from the main OpenClaw process. The model and tokenizer are bundled with the plugin — no external API calls.

### Memory Search

When you call `memory_search`, the system:

1. Generates an embedding for your query
2. Performs ANN vector search to find similar memories
3. Applies BM25 keyword matching
4. Re-ranks results using time权重 (recency weighting)
5. Returns top-k results with relevance scores

### Memory Evolution

Memories can evolve over time. When a new memory supersedes an old one, the old memory is marked as `superseded` rather than deleted, preserving the version chain for auditability.

---

## Performance

- **Embedding speed**: ~1.4s per query (1024 dimensions, 2-core CPU)
- **Batch indexing**: Supports up to 40+ chunks per batch with 180s timeout
- **Storage**: MySQL with proper indexing for sub-second retrieval

---

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

## License

MIT License - see [LICENSE](LICENSE) for details.
