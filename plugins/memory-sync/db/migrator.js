/**
 * Historical Memory Migrator (MySQL Backend)
 * Phase 0: Import existing OpenClaw memories into MySQL
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_CONFIG = {
  host: 'localhost',
  user: 'openclaw',
  password: 'openclaw_mem_2026',
  database: 'openclaw_memory',
  waitForConnections: true,
  connectionLimit: 10
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  return pool;
}

const WORKSPACE = '/root/.openclaw/workspace';
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

// Reuse contentToUuid from memory-db
const crypto = require('crypto');
function contentToUuid(content) {
  const hash = crypto.createHash('sha256').update(content.trim()).digest('hex');
  return hash.slice(0, 16);
}

// Parse a daily memory file
function parseDailyMemory(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath, '.md');

  const sections = content.split(/^##\s+/m).filter(s => s.trim());
  const memories = [];

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();

    if (title.toLowerCase().includes('light sleep') ||
        title.toLowerCase().includes('dream') ||
        title.toLowerCase().includes('candidate') ||
        title.toLowerCase().includes('reflections')) {
      continue;
    }

    if (body.length < 10) continue;

    const isConversation = body.match(/^[-\*]\s+(User|Assistant|System):/m);
    memories.push({
      title,
      content: isConversation ? body : `${title}\n\n${body}`,
      date: filename,
      topics: []
    });
  }

  return memories;
}

// Parse MEMORY.md
function parseMememoryMd() {
  const filePath = path.join(WORKSPACE, 'MEMORY.md');
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const sections = content.split(/^##\s+/m).filter(s => s.trim());
  const memories = [];

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();

    if (['身份', '技术配置', '用户重要偏好'].includes(title)) {
      memories.push({
        title,
        content: body,
        date: '2026-04-12',
        topics: [title],
        importance: title.includes('重要') ? 0.8 : 0.6
      });
      continue;
    }

    if (body.length > 50) {
      memories.push({
        title,
        content: body,
        date: '2026-04-12',
        topics: [title],
        importance: 0.6
      });
    }
  }

  return memories;
}

// Check if already migrated
async function isAlreadyMigrated(pool, uuid) {
  const [rows] = await pool.query('SELECT id FROM memories WHERE id = ?', [uuid]);
  return rows.length > 0;
}

// Write to MySQL (simplified version of memory-db writeMemory)
async function writeMemoryToMySQL(pool, content, options = {}) {
  const { date = '2026-04-12', topics = [], importance = 0.5 } = options;
  const uuid = contentToUuid(content);

  if (await isAlreadyMigrated(pool, uuid)) {
    return { status: 'exists', id: uuid };
  }

  await pool.query(
    `INSERT INTO memories (id, content, status, confidence, evidence_count, topics)
     VALUES (?, ?, 'valid', ?, 1, ?)`,
    [uuid, content, importance, JSON.stringify(topics)]
  );

  await pool.query(
    'INSERT INTO memory_versions (memory_id, version, content) VALUES (?, 1, ?)',
    [uuid, content]
  );

  for (const topic of topics) {
    await pool.query(
      'INSERT INTO memory_topics (memory_id, topic) VALUES (?, ?)',
      [uuid, topic]
    );
  }

  return { status: 'created', id: uuid };
}

// Generate L0 summary
function generateL0(content) {
  const sentences = content.split(/[。！？\n]/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return content.slice(0, 400);
  const scored = sentences.map((s, i) => ({ text: s.trim(), score: (1 / (i + 1)) * Math.min(s.length / 100, 1) }));
  scored.sort((a, b) => b.score - a.score);
  let result = [], tokenCount = 0;
  for (const s of scored) {
    const sentenceTokens = s.text.length / 4;
    if (tokenCount + sentenceTokens > 100 && result.length > 0) break;
    result.push(s.text);
    tokenCount += sentenceTokens;
  }
  return result.join('。') + (result.length > 0 ? '。' : '');
}

// Run migration
async function runMigration() {
  const pool = await getPool();
  console.log('[migrator] Starting historical memory migration to MySQL...');

  let migrated = 0;
  let skipped = 0;

  // 1. Migrate MEMORY.md
  console.log('[migrator] Processing MEMORY.md...');
  const mememoryEntries = parseMememoryMd();
  for (const entry of mememoryEntries) {
    const result = await writeMemoryToMySQL(pool, entry.content, {
      date: entry.date,
      topics: entry.topics,
      importance: entry.importance
    });
    if (result.status === 'created') {
      migrated++;
      // Generate summary
      const summary = generateL0(entry.content);
      await pool.query(
        'INSERT INTO summaries (id, memory_id, type, summary) VALUES (?, ?, ?, ?)',
        [result.id, result.id, 'l0', summary]
      );
      console.log(`[migrator] Migrated: ${entry.title}`);
    } else {
      skipped++;
    }
  }

  // 2. Migrate daily memories
  console.log('[migrator] Processing daily memories...');
  if (fs.existsSync(MEMORY_DIR)) {
    const files = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
      .map(f => path.join(MEMORY_DIR, f))
      .sort();

    for (const file of files) {
      const memories = parseDailyMemory(file);
      for (const entry of memories) {
        const result = await writeMemoryToMySQL(pool, entry.content, {
          date: entry.date,
          topics: entry.topics
        });
        if (result.status === 'created') {
          migrated++;
          // Generate summary
          const summary = generateL0(entry.content);
          await pool.query(
            'INSERT INTO summaries (id, memory_id, type, summary) VALUES (?, ?, ?, ?)',
            [result.id, result.id, 'l0', summary]
          );
          console.log(`[migrator] Migrated: ${entry.title} (${entry.date})`);
        } else {
          skipped++;
        }
      }
    }
  }

  console.log(`[migrator] Migration complete: ${migrated} migrated, ${skipped} skipped`);
  return { migrated, skipped };
}

module.exports = { runMigration };
