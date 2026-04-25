# openclaw-onnx-embed

**OpenClaw 本地 ONNX Embedding 插件** — 为 bge-large-zh-v1.5 提供完全离线的向量嵌入。

## 功能

- 完全离线运行（模型 + Tokenizer + ONNX Runtime 全部本地）
- 零 HTTP 开销（进程内直接调用 ONNX Runtime）
- 自动注册为 memory embedding provider，`autoSelectPriority: 5` 高优先级自动选用
- 支持 `embedQuery` / `embedBatch` 接口
- 基于 BGE Large 中文模型（1024 维向量）

## 系统要求

- Node.js >= 18
- OpenClaw >= 2026.4.22
- 至少 2GB 可用内存
- 模型文件：`bge-large-zh-v1.5` ONNX 模型（约 1.3GB）

## 安装

### 1. 下载模型

```bash
# 创建缓存目录
mkdir -p ~/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova

# 使用 Transformers.js 下载模型
npm install -g @xenova/transformers

node -e "
const { pipeline, env } = require('@xenova/transformers');
env.cacheFolder = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache';
const pipe = pipeline('feature-extraction', 'Xenova/bge-large-zh-v1.5');
" 2>&1 | tail -5
```

或者手动下载 ONNX 模型文件，放到：
```
~/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/model.onnx
```

### 2. 克隆插件

```bash
# 方式一：直接克隆到 extensions 目录
git clone https://github.com/bbj375767338-arch/openclaw-onnx-embed.git \
  ~/.openclaw/extensions/openclaw-onnx-embed

# 方式二：下载 Release 包解压
# https://github.com/bbj375767338-arch/openclaw-onnx-embed/releases
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

**注意**：只加到 `allow` 列表，不要加到 `entries`！Gateway 会自动管理 `entries` 并可能还原配置。

### 4. 重启 OpenClaw

```bash
# 如果用 systemd
sudo systemctl restart openclaw-gateway

# 如果用 PM2
pm2 restart HUAHUAclaw
```

### 5. 验证

```bash
openclaw memory status
# 应该显示：Provider: onnx-bge-local (requested: auto)
```

## 配置参数

插件提供以下常量（可在代码中调整）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `SEQ_LEN` | 512 | 最大序列长度 |
| `HIDDEN_SIZE` | 1024 | 嵌入向量维度 |
| `PROVIDER_ID` | `onnx-bge-local` | Provider 标识符 |
| `DEFAULT_MODEL` | `bge-large-zh-v1.5` | 默认模型名 |

## 架构

```
memory-core (官方插件)
    ↓ 调用 provider
openclaw-onnx-embed 插件 ← 进程内直接加载 ONNX Runtime
    ↓
向量存储 → sqlite-vec (memory-core 内置)
```

## 性能

- 单次推理：约 2-3 秒（1024 维，M1 MacBook 测试）
- 内存占用：约 1.5-2GB（模型 + ONNX Runtime）
- 完全离线，无任何外部网络依赖

## 已知问题

- 首次加载较慢（ONNX Runtime 初始化）
- 仅支持 `bge-large-zh-v1.5` 模型

## License

MIT
