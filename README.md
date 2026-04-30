# OpenClaw 本地记忆方案

**中文优化 · 完全本地 · 高效检索 · 永久记忆**

| 特性 | 说明 |
|------|------|
| 🧠 本地 embedding | bge-large-zh-v1.5 ONNX 模型，完全离线运行 |
| 🔍 混合检索 | ANN 向量召回 + BM25 精确匹配 + 关键词叠加 |
| 💾 MySQL 永久记忆 | 结构化存储，支持记忆演化(evolving)和淘汰(superseded) |
| 📈 L0/L1 多层摘要 | 增量摘要加速检索，节省 token |

---

## 包含插件

| 插件 | 功能 |
|------|------|
| `openclaw-onnx-embed` | 本地 BGE 向量 embedding 提供者 |
| `openclaw-memory-sync` | MySQL 记忆同步与检索工具 |

## 架构

```
OpenClaw Agent
    │
    ├── openclaw-onnx-embed
    │       └── bge-large-zh-v1.5 ONNX (1024dim) ← 本地离线，中文优化
    │
    └── openclaw-memory-sync
            ├── memory_recall    ← 记忆召回
            ├── memory_search    ← BM25+向量混合搜索
            ├── memory_save      ← 记忆保存
            └── memory_stats     ← 状态统计
                    │
                    └── MySQL (openclaw_memory)
                            ├── memories          ← 原始记忆 + 版本链
                            ├── summaries         ← L0/L1 摘要
                            └── memory_topics     ← Topic 图谱
```

---

## 特性 / Features

### openclaw-onnx-embed

- 🧠 **完全离线** — 本地计算向量，无需 API Key
- 🔒 **安全隔离** — ONNX 运行在独立子进程
- 🌐 **中文优化** — bge-large-zh-v1.5 (1024 维)
- 📝 **标准分词** — BERT WordPiece tokenizer
- 🔢 **自适应线程** — 根据 CPU 核心数自动调整
- 📦 **批量索引** — 支持 memory-core 批量 embedding

### openclaw-memory-sync

- 💾 **MySQL 持久化** — 结构化存储，永久保存
- 🔄 **记忆演化** — 支持膨胀(evolving)和淘汰(superseded)
- 📊 **多层摘要** — L0 (~100 tokens), L1 (~1k tokens)
- 🔍 **混合检索** — 向量 + 关键词 + 时间权重重排序
- 🔗 **关联图谱** — Topic 和 Link 图谱支持
- ⚡ **增量迁移** — 幂等迁移 OpenClaw 已有记忆

---

## 环境要求

- OpenClaw >= 2026.4.22
- Node.js >= 18
- MySQL >= 5.7 (或使用 Docker)
- ~2GB RAM (embedding 模型 + 运行时)

---

## 安装

### 方式一：ClawHub (推荐)

```bash
openclaw plugins install openclaw-onnx-embed
openclaw plugins install openclaw-memory-sync
```

### 方式二：手动安装

```bash
git clone https://github.com/bbj375767338-arch/openclaw-onnx-embed.git \
  ~/.openclaw/extensions/openclaw-local-memory
```

---

## 配置

### 1. MySQL 数据库

```bash
# 创建数据库和用户
mysql -u root -p

CREATE DATABASE openclaw_memory;
CREATE USER 'openclaw'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON openclaw_memory.* TO 'openclaw'@'localhost';
FLUSH PRIVILEGES;
```

### 2. 插件配置

在 `openclaw.json` 中启用：

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

### 3. memory-sync 数据库配置

在插件目录创建 `db/config.js` 或设置环境变量：

```javascript
// ~/.openclaw/extensions/openclaw-local-memory/plugins/memory-sync/db/config.js
module.exports = {
  host: 'localhost',
  user: 'openclaw',
  password: 'your_password',
  database: 'openclaw_memory'
};
```

---

## 使用方法

### Agent 工具

| 工具 | 说明 |
|------|------|
| `memory_recall` | 任务前召回相关记忆 |
| `memory_search` | BM25+向量混合搜索 |
| `memory_save` | 保存任务结果到记忆 |
| `memory_stats` | 查看记忆系统状态 |

### 手动触发迁移

```bash
node plugins/memory-sync/db/migrator.js
```

---

## 数据库结构

```sql
memories          -- 主记忆表
memory_versions   -- 版本历史链
summaries         -- L0/L1 摘要
memory_topics     -- Topic 关联
memory_links      -- Link 关联
contradictions    -- 矛盾记录
```

---

## 文件结构

```
openclaw-onnx-embed/
├── README.md
├── package.json
│
├── plugins/
│   ├── onnx-embed/
│   │   ├── index.js
│   │   ├── subprocess.js
│   │   ├── tokenizer.js
│   │   ├── onnx-runtime.js
│   │   └── openclaw.plugin.json
│   │
│   └── memory-sync/
│       ├── index.js
│       ├── db/
│       │   ├── memory-db.js
│       │   ├── migrator.js
│       │   └── summary-gen.js
│       ├── hooks/
│       │   └── inbound.js
│       └── openclaw.plugin.json
```

---

## License

MIT