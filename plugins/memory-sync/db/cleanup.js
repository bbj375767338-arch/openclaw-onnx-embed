/**
 * Memory Cleanup Script
 * 清理 memory/ 目录下已迁移到 MySQL 的旧文件
 * 由 systemd timer 定时触发
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'localhost',
  user: 'openclaw',
  password: 'openclaw_mem_2026',
  database: 'openclaw_memory',
  waitForConnections: true,
  connectionLimit: 5
};

const MEMORY_DIR = '/root/.openclaw/workspace/memory';
const DAYS_TO_KEEP = 7; // 保留最近 7 天

// 保护的文件（永远不删）
const PROTECTED_FILES = new Set([
  'SOUL.md',
  'DREAMS.md',
  'HEARTBEAT.md',
  'TODO.md',
  'MEMORY.md',
  'ARCHITECTURE.md',
  '.gitignore'
]);

// 生成内容 hash（与 migrator.js 一致）
const crypto = require('crypto');
function contentToUuid(content) {
  const hash = crypto.createHash('sha256').update(content.trim()).digest('hex');
  return hash.slice(0, 16);
}

async function getMigratedRecords() {
  const pool = mysql.createPool(DB_CONFIG);
  try {
    const [rows] = await pool.query('SELECT id, updated_at FROM memories WHERE status = ?', ['valid']);
    return rows.map(r => ({ id: r.id, updated_at: new Date(r.updated_at) }));
  } finally {
    await pool.end();
  }
}

function shouldDelete(filename, fileStat, migratedRecords) {
  // 保护文件不删
  if (PROTECTED_FILES.has(filename)) return false;

  // 不是日期格式的 .md 文件不删
  if (!filename.match(/^\d{4}-\d{2}-\d{2}\.md$/)) return false;

  return true;
}

// 检查某段内容是否已迁移（MySQL 记录存在且 updated_at > 文件 mtime）
function isMigrated(content, fileMtime, migratedRecords) {
  const uuid = contentToUuid(content);
  const record = migratedRecords.find(r => r.id === uuid);
  if (!record) return false;
  // MySQL 更新时间必须晚于文件修改时间（确保迁移已完成）
  return record.updated_at > fileMtime;
}

function getFileDate(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? new Date(match[1]) : null;
}

async function cleanup() {
  console.log(`[cleanup] Starting memory cleanup (保留最近 ${DAYS_TO_KEEP} 天)...`);

  const migratedRecords = await getMigratedRecords();
  console.log(`[cleanup] MySQL 中已有 ${migratedRecords.length} 条有效记忆`);

  if (!fs.existsSync(MEMORY_DIR)) {
    console.log(`[cleanup] Memory dir not found: ${MEMORY_DIR}`);
    return;
  }

  const files = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fPath = path.join(MEMORY_DIR, f);
      const stat = fs.statSync(fPath);
      return {
        name: f,
        path: fPath,
        date: getFileDate(f),
        mtime: new Date(stat.mtime)
      };
    })
    .filter(f => f.date !== null);

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000);

  let deleted = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    if (!shouldDelete(file.name, file.mtime, migratedRecords)) {
      skipped++;
      continue;
    }

    // 检查是否超过保留期限
    if (file.date >= cutoffDate) {
      skipped++;
      continue;
    }

    try {
      // 验证文件已迁移到 MySQL 且 MySQL 已更新
      // 注意：migrator 存储的是 title + newline + body
      // 注意：migrator 会跳过 light sleep, dream, candidate, reflections
      const content = fs.readFileSync(file.path, 'utf-8');
      const sections = content.split(/^##\s+/m).filter(s => s.trim());

      let allMigrated = true;
      for (const section of sections) {
        const lines = section.split('\n');
        const title = lines[0].trim();
        const body = lines.slice(1).join('\n').trim();

        // 跳过 migrator 不迁移的内容类型
        if (title.toLowerCase().includes('light sleep') ||
            title.toLowerCase().includes('dream') ||
            title.toLowerCase().includes('candidate') ||
            title.toLowerCase().includes('reflections')) {
          continue;
        }

        if (body.length < 10) continue;

        // 构造与 migrator 一致的内容
        const migratedContent = `${title}\n\n${body}`;
        if (!isMigrated(migratedContent, file.mtime, migratedRecords)) {
          allMigrated = false;
          break;
        }
      }

      if (allMigrated) {
        fs.unlinkSync(file.path);
        deleted++;
        console.log(`[cleanup] Deleted: ${file.name}`);
      } else {
        skipped++;
        console.log(`[cleanup] Skipped (not migrated or MySQL not updated): ${file.name}`);
      }
    } catch (err) {
      errors++;
      console.error(`[cleanup] Error processing ${file.name}: ${err.message}`);
    }
  }

  console.log(`[cleanup] Done: ${deleted} deleted, ${skipped} skipped, ${errors} errors`);
}

cleanup().catch(err => {
  console.error('[cleanup] Fatal error:', err);
  process.exit(1);
});
