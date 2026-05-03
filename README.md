# openclaw-onnx-embed

**OpenClaw 本地向量嵌入插件 — 完全离线，中文语义记忆搜索**

---

## ✨ 特性

- 🧠 **完全离线** — 本地计算向量，零外部依赖，无需 API Key
- 🔒 **进程隔离** — ONNX 模型运行在独立子进程，不阻塞 Gateway
- ⚡ **开箱即用** — 装好后无需任何配置，Gateway 重启自动加载模型
- 🌐 **中文优化** — 基于 `bge-large-zh-v1.5`（1024维），中文语义理解能力强

---

## 📊 性能

| 指标 | 数值 |
|------|------|
| 推理速度 | ~1.4秒/次（2核CPU） |
| 内存占用 | ~1.5GB（模型+运行时） |
| 向量维度 | 1024 |
| 模型大小 | 1.3GB |

---

## 🏗 架构

```
OpenClaw Gateway
    │
    └── memory-core（官方记忆插件）
            │
            └── openclaw-onnx-embed（onnx-bge-local provider）
                    │
                    └── subprocess.js（Node.js 子进程）
                            │
                            └── ONNX Runtime + bge-large-zh-v1.5
```

---

## 📦 安装

### 方式一：ClawHub（推荐）

```bash
openclaw extension install openclaw-onnx-embed
```

### 方式二：手动安装

```bash
git clone https://github.com/bbj375767338-arch/openclaw-onnx-embed.git \
  ~/.openclaw/extensions/openclaw-onnx-embed
```

---

## ⚙️ 配置

**装完即用，无需任何配置。** 

插件启用后会以 `onnx-bge-local` 作为 `memorySearch` 的 provider 自动被 memory-core 调用。

如需手动指定，在 `openclaw.json` 中添加：

```json
{
  "plugins": {
    "entries": {
      "openclaw-onnx-embed": {
        "enabled": true
      }
    }
  },
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

## 🔧 环境要求

- OpenClaw >= 2026.4.22
- Node.js >= 18
- 约 2GB 可用内存

**问：需要 GPU 吗？**  
不需要，纯 CPU 推理。

**问：和 Ollama 比有什么优势？**  
这个插件是进程内直接加载 ONNX Runtime，适合 OpenClaw 集成场景，启动更快、依赖更少。

---

## 🐛 故障排查

### "Subprocess initialization timed out"
模型首次加载需要 15~20 秒，请耐心等待。如果经常被 OOM Kill，请确保机器有足够内存。

### "Unknown memory embedding provider: onnx-bge-local"
确保插件在 `plugins.entries` 中（不只是 `plugins.allow`），然后重启 Gateway。

### 首次查询较慢
Gateway 重启后首次查询需要重新加载模型，属于正常现象。

---

## 📁 文件结构

```
openclaw-onnx-embed/
├── index.js              # 插件入口
├── subprocess.js         # 子进程：ONNX 推理
├── openclaw.plugin.json  # 插件清单
└── package.json
```

---

## 📌 更新日志

### v1.0.0 (2026-04-30)
- 首发版本
- 支持 `bge-large-zh-v1.5` ONNX 模型
- 进程内自动初始化

---

## 📄 License

MIT
