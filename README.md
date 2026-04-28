# openclaw-onnx-embed

**OpenClaw 本地 ONNX BGE 向量嵌入插件 / Local ONNX-based BGE Embedding Provider**

---

## 简介 / Introduction

本插件为 OpenClaw 提供本地中文语义记忆搜索能力，使用 `bge-large-zh-v1.5` 模型（1.3GB ONNX）通过 ONNX Runtime 在子进程中运行，完全离线，无需外部 API。

This plugin provides local Chinese semantic memory search for OpenClaw, using the `bge-large-zh-v1.5` model (1.3GB ONNX) via ONNX Runtime in a subprocess — fully offline, no external API calls needed.

---

## 特性 / Features

- 🧠 **完全离线 / Fully Offline** — 本地计算向量，无需 API Key / Embeddings computed locally, no API key needed
- 🔒 **安全隔离 / Subprocess Isolation** — ONNX 模型运行在独立进程，不阻塞 Gateway / Model runs in separate process to avoid blocking gateway
- ⚡ **自动初始化 / Auto-initialization** — 子进程启动时自动加载模型 / Model loads automatically at subprocess startup
- 🌐 **中文优化 / Chinese Optimized** — 使用 `bge-large-zh-v1.5` (1024 维) / Uses `bge-large-zh-v1.5` (1024 dimensions)
- 📝 **标准分词 / Proper Tokenization** — 使用 BERT WordPiece tokenizer，告别简陋的逐字符分词 / Uses proper BERT WordPiece tokenizer instead of crude character-by-character splitting
- 🔢 **自适应线程 / Adaptive Threading** — 根据 CPU 核心数自动调整 ONNX Runtime 线程数 / Automatically adjusts ONNX Runtime thread count based on CPU cores
- 📦 **批量索引 / Batch Indexing** — 支持 memory-core 批量 embedding，高效索引大量文件 / Supports memory-core batch embedding for efficient file indexing
- 🔄 **进程复用 / Process Reuse** — 单例模式避免重复加载模型 / Singleton pattern avoids repeated model loading

---

## 架构 / Architecture

```
OpenClaw Gateway
    │
    └── onnx-bge-local provider (index.js plugin)
            │
            └── subprocess.js (Node.js subprocess)
                    │
                    ├── PreTrainedTokenizer (BERT WordPiece)
                    │       └── tokenizer.json (21k vocab)
                    │
                    └── ONNX Runtime
                            └── bge-large-zh-v1.5.onnx (1.3GB, 1024dim)
```

---

## 环境要求 / Requirements

- OpenClaw >= 2026.4.22
- Node.js >= 18
- ~2GB RAM (模型 + 运行时 / model + runtime)
- 推荐 2+ 核 CPU / 2+ cores recommended

---

## 安装 / Installation

```bash
# 方式一：通过 ClawHub（推荐）/ Via ClawHub (recommended)
openclaw extension install openclaw-onnx-embed

# 方式二：手动安装 / Manual install
git clone https://github.com/bbj375767338-arch/openclaw-onnx-embed.git \
  ~/.openclaw/extensions/openclaw-onnx-embed
```

---

## 配置 / Configuration

### 基础配置 / Basic Configuration

在 `openclaw.json` 中启用插件：

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

### 启用批量索引 / Enable Batch Indexing

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "auto",
        "remote": {
          "baseUrl": "http://127.0.0.1:18790",
          "apiKey": "local-onnx-key",
          "batch": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

---

## 性能 / Performance

| 指标 | 值 |
|------|-----|
| 模型大小 | 1.3 GB |
| 向量维度 | 1024 |
| Embedding 速度 | ~1.5s/条 (2核 CPU) |
| 批量索引 | 支持 |
| 内存占用 | ~1.5GB |

**注意**: 实际速度受 CPU 核心数影响。双核 CPU ~1.5s/条，四核可提升至 ~0.8s/条。

Note: Actual speed depends on CPU cores. Dual-core ~1.5s/query, quad-core can reach ~0.8s/query.

---

## 模型 / Model

插件首次使用时会自动通过 `@xenova/transformers` 下载模型文件。

The plugin automatically downloads the `bge-large-zh-v1.5` ONNX model on first use via `@xenova/transformers`.

**模型路径 / Model location**: `~/.cache/Xenova/bge-large-zh-v1.5/`

---

## 优化记录 / Optimization History

### 2026-04-28 优化 v3

- **超时**: embedding 超时从 60s 增加到 180s（避免批量索引时超时）
- **问题修复**: batchEmbed 并行请求在串行队列处理时超时问题

### 2026-04-28 优化 v2

- **Tokenizer**: 替换简陋逐字符分词 → 标准 BERT WordPiece（支持中英文子词）
- **线程**: 固定 4 threads → 自适应（根据 CPU 核心数）
- **批量**: 添加 batchEmbed 方法，支持 memory-core 批量索引
- **进程**: subprocess 单例模式，避免重复加载模型
- **Manager 修复**: 修复 openclaw memory-core batch.enabled 初始计算 bug

### 初始版本 v1 (2026-04-25)

- 基础 ONNX subprocess 架构
- 简陋逐字符 tokenizer
- 固定线程数

---

## 故障排查 / Troubleshooting

### "Subprocess initialization timed out"

模型首次加载需要 ~15-20 秒，请耐心等待。如果子进程被强制终止，请增加超时时间或确保内存充足。

Model load takes ~15-20s on first startup. If subprocess gets killed, increase timeout or ensure sufficient memory.

### "Unknown memory embedding provider: onnx-bge-local"

确保插件在 `plugins.entries` 中（不只是 `plugins.allow`）。

Ensure plugin is in `plugins.entries` (not just `plugins.allow`) in `openclaw.json`.

### Batch 模式不工作 / Batch mode not working

检查 `openclaw.json` 中 `memorySearch.remote.batch.enabled` 是否为 `true`。

Check that `memorySearch.remote.batch.enabled` is `true` in `openclaw.json`.

---

## 文件结构 / Files

```
openclaw-onnx-embed/
├── index.js              ← 插件入口 (plugin-sdk) / Plugin entry
├── subprocess.js         ← 子进程：ONNX 推理 + tokenizer / Subprocess: ONNX inference + tokenizer
├── tokenizer.js          ← BERT WordPiece tokenizer / BERT WordPiece tokenizer
├── onnx-runtime.js       ← ONNX Runtime 封装 / ONNX Runtime wrapper
├── worker.js             ← (保留 / reserved)
├── adapter.js            ← (保留 / reserved)
├── openclaw.plugin.json  ← 插件清单 / Plugin manifest
├── package.json          ← 模块配置 / Module config
└── README.md
```

---

## 开源协议 / License

MIT
