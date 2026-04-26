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

---

## 架构 / Architecture

```
OpenClaw Gateway
    │
    └── onnx-bge-local provider (plugin)
            │
            └── subprocess.js (Node.js 子进程 / subprocess)
                    │
                    └── ONNX Runtime
                            └── bge-large-zh-v1.5.onnx (1.3GB)
```

---

## 环境要求 / Requirements

- OpenClaw >= 2026.4.22
- Node.js >= 18
- ~2GB RAM (模型 + 运行时 / model + runtime)

---

## 安装 / Installation

```bash
# 方式一：通过 ClawHub（推荐）/ Via ClawHub (recommended)
openclaw extension install openclaw-onnx-embed

# 方式二：手动安装 / Manual install
git clone https://github.com/bbj375767338-arch/openclaw-onnx-embed.git \
  /root/.openclaw/extensions/openclaw-onnx-embed
```

---

## 配置 / Configuration

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

设置记忆搜索 provider（可选，`auto` 也会自动选择）：

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

## 模型 / Model

插件首次使用时会自动通过 `@xenova/transformers` 下载模型文件。

The plugin automatically downloads the `bge-large-zh-v1.5` ONNX model on first use via `@xenova/transformers`.

**模型路径 / Model location**: `~/.cache/Xenova/bge-large-zh-v1.5/model.onnx`

---

## 故障排查 / Troubleshooting

### "Subprocess initialization timed out"

模型首次加载需要 ~15-20 秒，请耐心等待。如果子进程被强制终止，请增加超时时间或确保内存充足。

Model load takes ~15-20s on first startup. If subprocess gets killed, increase timeout or ensure sufficient memory.

### "Unknown memory embedding provider: onnx-bge-local"

确保插件在 `plugins.entries` 中（不只是 `plugins.allow`）。

Ensure plugin is in `plugins.entries` (not just `plugins.allow`) in `openclaw.json`.

### 首次查询慢 / Slow queries on first query

Gateway 重启后首次查询较慢是正常现象（需要重新加载模型）。

Slow first query after gateway restart is normal (model needs to reload).

---

## 文件结构 / Files

```
openclaw-onnx-embed/
├── index.js              ← 插件入口 / Plugin entry
├── subprocess.js         ← 子进程（ONNX 推理）/ Subprocess: ONNX inference
├── adapter.js            ← (保留 / reserved)
├── onnx-runtime.js       ← (保留 / reserved)
├── tokenizer.js          ← (保留 / reserved)
├── worker.js             ← (保留 / reserved)
├── openclaw.plugin.json  ← 插件清单 / Plugin manifest
└── package.json
```

---

## 开源协议 / License

MIT
