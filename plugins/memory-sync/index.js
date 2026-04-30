/**
 * OpenClaw Memory Sync Plugin (MySQL Backend)
 * Uses registerMemoryPromptSupplement to inject memories into agent context
 */

const { watch, stopWatch } = require('./hooks/inbound');
const { runMigration } = require('./db/migrator');
const { writeMemory, getAllMemories, contentToUuid } = require('./db/memory-db');
const { getAllL0Summaries } = require('./db/summary-gen');

// Load SDK
const openclawSdk = require('/usr/local/nodejs/lib/node_modules/openclaw/dist/plugin-sdk/core.js');
const definePluginEntry = openclawSdk.definePluginEntry;

// ============================================================
// Tool implementations
// ============================================================

async function memoryRecallImpl(task, top = 5) {
  const memories = await getAllMemories();
  const summaries = await getAllL0Summaries();

  if (!summaries.length) {
    return { content: [{ type: 'text', text: 'No memories found.' }] };
  }

  const taskWords = task.toLowerCase().match(/[一-龥a-zA-Z]+/g) || [];
  const scored = summaries.map(s => {
    const summaryText = (s.summary || '').toLowerCase();
    const matchCount = taskWords.filter(w => summaryText.includes(w)).length;
    return { ...s, score: matchCount };
  });

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, top);

  if (!topResults.length || topResults[0].score === 0) {
    return { content: [{ type: 'text', text: `No relevant memories found for: ${task}` }] };
  }

  const lines = [`## Memory Recall: "${task}"\n`];
  for (const r of topResults) {
    const memory = memories.find(m => m.id === r.id);
    const status = memory?.status || 'unknown';
    const date = r.created_at ? new Date(r.created_at).toLocaleDateString('zh-CN') : '';
    const statusLabel = status === 'evolving' ? '[evolving]' : status === 'superseded' ? '[superseded]' : '';
    lines.push(`${statusLabel} ${r.summary.slice(0, 150)}...`);
    lines.push(`   (${date}) [id: ${r.id}]`);
    lines.push('');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function memorySearchImpl(query, top = 5) {
  const memories = await getAllMemories();
  const summaries = await getAllL0Summaries();

  if (!summaries.length) {
    return { content: [{ type: 'text', text: 'No memories found.' }] };
  }

  const queryWords = query.toLowerCase().match(/[一-龥a-zA-Z]+/g) || [];
  const scored = summaries.map(s => {
    const summaryText = (s.summary || '').toLowerCase();
    const matchCount = queryWords.filter(w => summaryText.includes(w)).length;
    return { ...s, score: matchCount };
  });

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, top);

  if (!topResults.length) {
    return { content: [{ type: 'text', text: `No results for: ${query}` }] };
  }

  const lines = [`## Memory Search: "${query}"\n`];
  for (const r of topResults) {
    lines.push(`${r.score} matches: ${r.summary.slice(0, 100)}...`);
    lines.push(`   [id: ${r.id}]`);
    lines.push('');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function memorySaveImpl(task, result = '') {
  const content = result || task;
  try {
    const writeResult = await writeMemory(content, {
      topics: extractTopics(task + ' ' + result)
    });
    if (writeResult.status === 'created') {
      return { content: [{ type: 'text', text: `Memory saved with ID: ${writeResult.id}` }] };
    } else {
      return { content: [{ type: 'text', text: `Memory already exists: ${writeResult.id}` }] };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error saving memory: ${err.message}` }] };
  }
}

async function memoryStatsImpl() {
  const memories = await getAllMemories();
  const summaries = await getAllL0Summaries();

  const byStatus = { valid: 0, evolving: 0, superseded: 0 };
  for (const m of memories) {
    byStatus[m.status] = (byStatus[m.status] || 0) + 1;
  }

  const lines = [
    '## Memory Statistics',
    '',
    `Total memories: ${memories.length}`,
    `Total summaries: ${summaries.length}`,
    '',
    'By status:',
    `  - valid: ${byStatus.valid || 0}`,
    `  - evolving: ${byStatus.evolving || 0}`,
    `  - superseded: ${byStatus.superseded || 0}`,
    '',
    'Database: MySQL (openclaw_memory)',
    'MySQL user: openclaw'
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function extractTopics(content) {
  const topicMatches = content.match(/[#\[]([^\]#\[\]]+)[#\]]/g) || [];
  return [...new Set(topicMatches.map(t => t.replace(/[#\[\]]/g, '')))];
}

// ============================================================
// Memory prompt supplement (injects memories into context)
// ============================================================

let cachedMemories = [];
let lastMemoryUpdate = 0;
const MEMORY_CACHE_TTL = 60000; // 1 minute

async function buildMemoryPrompt(availableTools) {
  const now = Date.now();

  // Refresh memory cache if stale
  if (now - lastMemoryUpdate > MEMORY_CACHE_TTL) {
    cachedMemories = await getAllMemories();
    lastMemoryUpdate = now;
  }

  if (cachedMemories.length === 0) {
    return [];
  }

  // Build a brief summary of recent/high-confidence memories
  const relevantMemories = cachedMemories
    .filter(m => m.status !== 'superseded')
    .sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5))
    .slice(0, 10);

  const memoryLines = [
    '## My Structured Memory (MySQL)',
    '',
    `Total memories: ${cachedMemories.length}`,
    '',
    'Recent high-confidence memories:'
  ];

  for (const m of relevantMemories) {
    const date = new Date(m.created_at).toLocaleDateString('zh-CN');
    memoryLines.push(`- [${date}] ${m.content.slice(0, 100)}... (confidence: ${m.confidence || 0.5})`);
  }

  memoryLines.push('');
  memoryLines.push('Use `memory_search` tool to query these memories for specific topics.');

  return [memoryLines.join('\n')];
}

// ============================================================
// Plugin
// ============================================================
const plugin = definePluginEntry({
  id: 'openclaw-memory-sync',
  name: 'Memory Sync',
  description: 'Structured memory with evolution and superseding support (MySQL)',

  register(api) {
    console.log('[memory-sync] Registering memory sync plugin...');

    // Register memory prompt supplement (non-exclusive)
    api.registerMemoryPromptSupplement(buildMemoryPrompt);

    // Register tools
    api.registerTool(() => ({
      name: 'memory_recall',
      description: 'Recall relevant memories before a task. Searches memories by keyword overlap.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description' },
          top: { type: 'number', description: 'Number of memories (default: 5)' }
        },
        required: ['task']
      },
      execute: async function(toolCallId, params) {
        return await memoryRecallImpl(params.task, params.top || 5);
      }
    }), { optional: false });

    api.registerTool(() => ({
      name: 'memory_search',
      description: 'Full-text search over memories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          top: { type: 'number', description: 'Number of results (default: 5)' }
        },
        required: ['query']
      },
      execute: async function(toolCallId, params) {
        return await memorySearchImpl(params.query, params.top || 5);
      }
    }), { optional: false });

    api.registerTool(() => ({
      name: 'memory_save',
      description: 'Save a task or result to memory.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description' },
          result: { type: 'string', description: 'Result to save' }
        },
        required: ['task']
      },
      execute: async function(toolCallId, params) {
        return await memorySaveImpl(params.task, params.result || '');
      }
    }), { optional: false });

    api.registerTool(() => ({
      name: 'memory_stats',
      description: 'Get memory statistics.',
      parameters: { type: 'object', properties: {} },
      execute: async function(toolCallId, params) {
        return await memoryStatsImpl();
      }
    }), { optional: false });

    // Start inbound hook
    watch();

    console.log('[memory-sync] Memory sync plugin registered');
  },

  async onLoad() {
    console.log('[memory-sync] Plugin loaded, running Phase 0 migration...');
    try {
      await runMigration();
      // Refresh cache after migration
      cachedMemories = await getAllMemories();
      lastMemoryUpdate = Date.now();
      console.log('[memory-sync] Phase 0 migration complete');
    } catch (err) {
      console.error('[memory-sync] Migration failed:', err.message);
    }
  },

  onUnload() {
    stopWatch();
    console.log('[memory-sync] Plugin unloaded');
  }
});

module.exports = plugin;
