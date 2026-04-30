/**
 * Inbound Hook
 * Captures new memories from OpenClaw workspace
 */

const fs = require('fs');
const path = require('path');
const { writeMemory } = require('../db/memory-db');
const { generateSummaries } = require('../db/summary-gen');

const MEMORY_DIR = '/root/.openclaw/workspace/memory';
const WATCH_INTERVAL = 10000;
const PROCESSED_LOG = '/tmp/.memory_processed.log';

let watchInterval = null;
let lastProcessed = new Map();

// Load processed files log
function loadProcessedLog() {
  if (fs.existsSync(PROCESSED_LOG)) {
    const lines = fs.readFileSync(PROCESSED_LOG, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const { file, mtime } = JSON.parse(line);
        lastProcessed.set(file, new Date(mtime));
      } catch (e) {}
    }
  }
}

// Save processed file
function logProcessed(file, mtime) {
  lastProcessed.set(file, new Date(mtime));
  fs.appendFileSync(PROCESSED_LOG, JSON.stringify({ file, mtime }) + '\n');
}

// Check if file changed since last processing
function hasFileChanged(file) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  const lastTime = lastProcessed.get(file);
  if (!lastTime) return true;
  return stat.mtime > lastTime;
}

// Extract topics from content
function extractTopics(content) {
  const topicMatches = content.match(/[#\[]([^\]#\[\]]+)[#\]]/g) || [];
  return [...new Set(topicMatches.map(t => t.replace(/[#\[\]]/g, '')))];
}

// Process a memory file
async function processFile(filePath) {
  if (!hasFileChanged(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const stat = fs.statSync(filePath);

  const filename = path.basename(filePath, '.md');
  const date = filename.match(/^\d{4}-\d{2}-\d{2}/) ? filename.slice(0, 10) : new Date().toISOString().slice(0, 10);

  if (filename.includes('light sleep') || filename.includes('dream') ||
      content.includes('Candidate:') || content.includes('Reflections:')) {
    logProcessed(filePath, stat.mtime);
    return;
  }

  const sections = content.split(/^##\s+/m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0].trim();
    const sectionBody = lines.slice(1).join('\n').trim();

    if (sectionBody.length < 20) continue;
    if (title.match(/^(User|Assistant|System):/i)) continue;

    try {
      const result = await writeMemory(sectionBody, {
        date,
        topics: extractTopics(sectionBody)
      });

      if (result.status === 'created') {
        await generateSummaries(result.entry);
        console.log(`[inbound] Captured: ${title}`);
      }
    } catch (err) {
      console.error(`[inbound] Error processing ${title}:`, err.message);
    }
  }

  logProcessed(filePath, stat.mtime);
}

// Watch memory directory
async function watch() {
  loadProcessedLog();
  console.log('[inbound] Starting memory watch...');

  async function checkFiles() {
    if (!fs.existsSync(MEMORY_DIR)) return;

    const files = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md') && !f.startsWith('.'))
      .map(f => path.join(MEMORY_DIR, f));

    for (const file of files) {
      await processFile(file);
    }
  }

  await checkFiles();
  watchInterval = setInterval(checkFiles, WATCH_INTERVAL);
}

// Stop watching
function stopWatch() {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
    console.log('[inbound] Stopped memory watch');
  }
}

module.exports = { watch, stopWatch };
