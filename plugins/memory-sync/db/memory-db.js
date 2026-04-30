/**
 * Memory DB Writer (MySQL Backend)
 * Handles writing raw memories with evolution/superseding logic
 */

const mysql = require('mysql2/promise');
const crypto = require('crypto');

const DB_CONFIG = {
  host: 'localhost',
  user: 'openclaw',
  password: 'openclaw_mem_2026',
  database: 'openclaw_memory',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool = null;

// Get connection pool
async function getPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  return pool;
}

// Generate deterministic UUID from content hash (idempotent)
function contentToUuid(content) {
  const hash = crypto.createHash('sha256').update(content.trim()).digest('hex');
  return hash.slice(0, 16);
}

// Calculate similarity between two strings (simple word overlap)
function calculateSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

// Check if content contradicts existing memory
function detectContradiction(newContent, existingContent) {
  const similarity = calculateSimilarity(newContent, existingContent);
  if (similarity < 0.3) {
    const negations = ['不', '没', '无', '非', '别', '否', '不是', '没有', '不会', '不要'];
    const hasNegation = (text) => negations.some(n => text.includes(n));
    if (hasNegation(newContent) !== hasNegation(existingContent)) {
      return true;
    }
  }
  return false;
}

// Main write function
async function writeMemory(content, options = {}) {
  const pool = await getPool();
  const { date = new Date().toISOString().slice(0, 10), topics = [], importance = 0.5 } = options;

  const uuid = contentToUuid(content);

  // Check if exists
  const [existing] = await pool.query('SELECT * FROM memories WHERE id = ?', [uuid]);
  if (existing.length > 0) {
    console.log(`[memory-db] Entry ${uuid} already exists, skipping`);
    return { status: 'exists', id: uuid, entry: existing[0] };
  }

  // Search for potential superseded or related entries
  const [allMemories] = await pool.query('SELECT * FROM memories WHERE status != "superseded"');
  let supersessions = [];
  let contradictions = [];

  for (const other of allMemories) {
    if (other.id === uuid) continue;

    const similarity = calculateSimilarity(content, other.content);
    if (similarity > 0.7 && similarity < 0.95 && content.length > other.content.length * 1.2) {
      // Evolution case
      supersessions.push(other.id);
      await pool.query('UPDATE memories SET status = "superseded", superseded_by = ? WHERE id = ?', [uuid, other.id]);
    }

    if (detectContradiction(content, other.content)) {
      contradictions.push(other.id);
    }
  }

  // Insert new memory
  await pool.query(
    `INSERT INTO memories (id, content, status, confidence, evidence_count, topics, superseded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid, content, contradictions.length > 0 ? 'evolving' : 'valid', importance, 1, JSON.stringify(topics), null]
  );

  // Insert version 1
  await pool.query(
    'INSERT INTO memory_versions (memory_id, version, content) VALUES (?, 1, ?)',
    [uuid, content]
  );

  // Insert topics
  for (const topic of topics) {
    await pool.query(
      'INSERT INTO memory_topics (memory_id, topic) VALUES (?, ?)',
      [uuid, topic]
    );
  }

  // Insert contradictions
  for (const contraId of contradictions) {
    await pool.query(
      'INSERT INTO contradictions (memory_id, contradicts_id) VALUES (?, ?)',
      [uuid, contraId]
    );
  }

  // Get the inserted entry
  const [newEntry] = await pool.query('SELECT * FROM memories WHERE id = ?', [uuid]);

  console.log(`[memory-db] Created memory ${uuid}`);
  return { status: 'created', id: uuid, entry: newEntry[0] };
}

// Get all memories
async function getAllMemories() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM memories ORDER BY created_at DESC');
  return rows;
}

// Get memory by ID
async function getMemoryById(id) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM memories WHERE id = ?', [id]);
  return rows.length > 0 ? rows[0] : null;
}

// Get related memories
async function getRelatedMemories(entryId, limit = 5) {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT m.* FROM memories m
    INNER JOIN memory_topics mt ON m.id = mt.memory_id
    WHERE mt.topic IN (SELECT topic FROM memory_topics WHERE memory_id = ?)
    AND m.id != ?
    AND m.status != 'superseded'
    LIMIT ?
  `, [entryId, entryId, limit]);
  return rows;
}

// Get memory versions
async function getMemoryVersions(memoryId) {
  const pool = await getPool();
  const [rows] = await pool.query(
    'SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version',
    [memoryId]
  );
  return rows;
}

// Close pool
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  writeMemory,
  getAllMemories,
  getMemoryById,
  getRelatedMemories,
  getMemoryVersions,
  contentToUuid,
  closePool
};
