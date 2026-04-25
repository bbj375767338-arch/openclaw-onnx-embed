# openclaw-onnx-embed

**OpenClaw 本地 ONNX Embedding 插件** — 为 bge-large-zh-v1.5 提供完全离线的向量嵌入，进程隔离确保 Gateway 不被 ONNX 推理阻塞。

## 功能

- **完全离线运行**（模型 + Tokenizer + ONNX Runtime 全部本地）
- **零 HTTP 开销**（进程内直接调用 ONNX Runtime，无网络延迟）
- **进程隔离**（Subprocess 架构，ONNX 推理不阻塞 Gateway 主线程）
- **启动预加载**（Gateway 启动时自动加载模型 + warmup）
- **多线程优化**（4 核推理，效率拉满）
- **自动注册**（`autoSelectPriority: 5`，高于 openai，默认选用）
- **1024 维向量**（基于 BGE Large 中文模型）

## 架构

```
memory-core (官方插件)
    ↓ 调用 provider
openclaw-onnx-embed 插件 (主进程)
    ↓ JSON over stdin/stdout
subprocess.js (独立进程 - 运行 ONNX 推理)
    ↓
向量存储 → sqlite-vec (memory-core 内置)
```

## 为什么用 Subprocess？

ONNX Runtime 推理是 CPU 密集型操作（2-3秒/次），会阻塞 Node.js 主线程的事件循环：

| 方案 | 结果 |
|------|------|
| 直接在主线程调 ONNX | Gateway 完全卡死，连 /health 都超时 |
| Worker Threads | NAPI 绑定在 Worker 里崩溃 |
| **Subprocess（当前方案）** | Gateway 主线程独立，推理在子进程跑 |

## 安装

### 1. 下载模型

```bash
mkdir -p ~/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova

npm install -g @xenova/transformers

node -e "
const { pipeline, env } = require('@xenova/transformers');
env.cacheFolder = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache';
const pipe = pipeline('feature-extraction', 'Xenova/bge-large-zh-v1.5');
" 2>&1 | tail -5
```

或者手动下载 ONNX 模型文件：
```
~/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/model.onnx
```

### 2. 克隆插件

```bash
git clone https://github.com/bbj375767338-arch/openclaw-onnx-embed.git \
  ~/.openclaw/extensions/openclaw-onnx-embed
```

### 3. 配置 OpenClaw

在 `~/.openclaw/openclaw.json` 中添加插件到白名单：

```json
{
  "plugins": {
    "allow": ["openclaw-onnx-embed", ...],
    "slots": {
      "memory": "memory-core"
    }
  }
}
```

**注意**：只加到 `allow`，不要加到 `entries`！Gateway 会自动管理 `entries` 并可能还原配置。

### 4. 重启 OpenClaw

```bash
pm2 restart HUAHUAclaw
```

### 5. 验证

```bash
openclaw memory status
# 应该显示：Provider: onnx-bge-local (requested: auto)
```

## 性能

| 指标 | 数值 |
|------|------|
| 模型冷启动 | ~30 秒（启动时一次） |
| Warmup | ~3-5 秒 |
| 单次推理 | ~2-3 秒 |
| 向量维度 | 1024 |

## 文件结构

```
openclaw-onnx-embed/
├── index.js          # 主插件（subprocess 管理）
├── subprocess.js     # ONNX 推理子进程
├── package.json
├── openclaw.plugin.json
└── README.md
```

## 已知问题

- 仅支持 `bge-large-zh-v1.5` 模型
- 模型加载期间 gateway 日志会显示 "Loading ONNX model..."

## License

MIT
