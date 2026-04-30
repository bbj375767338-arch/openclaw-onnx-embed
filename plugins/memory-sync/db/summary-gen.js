/**
 * Summary Generator (MySQL Backend)
 * Generates L0/L1 summaries for memories
 */

const mysql = require('mysql2/promise');

const L0_TOKENS = 100;
const L1_TOKENS = 1000;

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

// Simple extractive summarization (no AI needed)
function extractiveSummary(text, maxTokens) {
  const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 10);

  if (sentences.length === 0) {
    return text.slice(0, maxTokens * 4);
  }

  const scored = sentences.map((s, i) => ({
    text: s.trim(),
    score: (1 / (i + 1)) * Math.min(s.length / 100, 1)
  }));

  scored.sort((a, b) => b.score - a.score);

  let result = [];
  let tokenCount = 0;

  for (const s of scored) {
    const sentenceTokens = s.text.length / 4;
    if (tokenCount + sentenceTokens > maxTokens && result.length > 0) break;
    result.push(s.text);
    tokenCount += sentenceTokens;
  }

  return result.join('。') + (result.length > 0 ? '。' : '');
}

// Generate L0 - brief abstract
function generateL0(entry) {
  return {
    id: entry.id,
    type: 'l0',
    summary: extractiveSummary(entry.content, L0_TOKENS)
  };
}

// Generate L1 - full overview
function generateL1(entry) {
  return {
    id: entry.id,
    type: 'l1',
    summary: extractiveSummary(entry.content, L1_TOKENS),
    topics: entry.topics
  };
}

// Save summaries to database
async function saveSummary(summary) {
  const pool = await getPool();
  await pool.query(
    'INSERT INTO summaries (id, memory_id, type, summary) VALUES (?, ?, ?, ?)',
    [summary.id, summary.id, summary.type, summary.summary]
  );
}

// Generate and save summaries for an entry
async function generateSummaries(entry) {
  const l0 = generateL0(entry);
  const l1 = generateL1(entry);
  await saveSummary(l0);
  await saveSummary(l1);
  return { l0, l1 };
}

// Get cached summary
async function getSummary(id, type = 'l0') {
  const pool = await getPool();
  const [rows] = await pool.query(
    'SELECT * FROM summaries WHERE id = ? AND type = ?',
    [id, type]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Get all L0 summaries
async function getAllL0Summaries() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM summaries WHERE type = "l0"');
  return rows;
}

module.exports = {
  generateSummaries,
  generateL0,
  generateL1,
  getSummary,
  getAllL0Summaries
};
