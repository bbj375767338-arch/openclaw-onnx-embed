/**
 * OpenClaw ONNX BGE Memory Embedding Provider Plugin
 * Provides local bge-large-zh-v1.5 embedding via ONNX Runtime in a subprocess
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Load SDK via absolute path
const openclawSdk = require('/usr/local/nodejs/lib/node_modules/openclaw/dist/plugin-sdk/core.js');
const definePluginEntry = openclawSdk.definePluginEntry;

// ============================================================
// Constants
// ============================================================
const SUBPROCESS_PATH = '/root/.openclaw/extensions/openclaw-onnx-embed/subprocess.js';
const PROVIDER_ID = 'onnx-bge-local';
const DEFAULT_MODEL = 'bge-large-zh-v1.5';

// ============================================================
// Subprocess manager
// ============================================================
let subprocess = null;
let pending = new Map();
let subprocessReady = false;
let initPromise = null;
let idCounter = 0;

function initSubprocess() {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve, reject) => {
    console.log('[onnx-bge] Starting ONNX subprocess...');
    subprocess = spawn('node', [SUBPROCESS_PATH], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutBuffer = '';

    subprocess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'ready') {
            subprocessReady = true;
            console.log('[onnx-bge] Subprocess ready!');
            resolve();
          } else if (msg.type === 'embedding') {
            const { id, result } = msg;
            const resolve = pending.get(id);
            if (resolve) {
              resolve(result);
              pending.delete(id);
            }
          } else if (msg.type === 'error') {
            const { id, error } = msg;
            console.error('[onnx-bge] Subprocess error:', error);
            const resolve = pending.get(id);
            if (resolve) {
              resolve(null);
              pending.delete(id);
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    });

    subprocess.stderr.on('data', (chunk) => {
      // Log subprocess stderr to main process logs
      process.stderr.write('[onnx-sub] ' + chunk.toString());
    });

    subprocess.on('error', (err) => {
      console.error('[onnx-bge] Subprocess error:', err.message);
      subprocessReady = false;
      reject(err);
    });

    subprocess.on('exit', (code) => {
      console.log('[onnx-bge] Subprocess exited with code:', code);
      subprocessReady = false;
    });

    // Timeout after 90 seconds for init
    setTimeout(() => {
      if (!subprocessReady) {
        reject(new Error('Subprocess initialization timed out'));
      }
    }, 90000);
  });
  return initPromise;
}

function sendToSubprocess(msg) {
  if (subprocess && subprocess.stdin && !subprocess.stdin.destroyed) {
    subprocess.stdin.write(JSON.stringify(msg) + '\n');
  }
}

async function embedInSubprocess(text) {
  await initSubprocess();

  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    pending.set(id, resolve);

    sendToSubprocess({ type: 'embed', id, text });

    // Timeout after 30 seconds per embedding
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Embedding timed out'));
      }
    }, 30000);
  });
}

// ============================================================
// Adapter
// ============================================================
const onnxBgeMemoryEmbeddingProviderAdapter = {
  id: PROVIDER_ID,
  defaultModel: DEFAULT_MODEL,
  transport: 'local',
  autoSelectPriority: 5,
  shouldContinueAutoSelection: () => true,

  create: async (options) => {
    // Start subprocess initialization at plugin load time (non-blocking)
    initSubprocess().catch(err => console.error('[onnx-bge] Subprocess init failed:', err.message));

    const provider = {
      id: PROVIDER_ID,
      model: DEFAULT_MODEL,

      embedQuery: async (text) => {
        return await embedInSubprocess(text);
      },

      embedBatch: async (texts) => {
        // Run sequentially via subprocess (no concurrent ONNX load)
        const results = [];
        for (const t of texts) {
          results.push(await embedInSubprocess(t));
        }
        return results;
      }
    };

    return {
      provider,
      runtime: {
        id: PROVIDER_ID,
        cacheKeyData: {
          provider: PROVIDER_ID,
          model: DEFAULT_MODEL
        }
      }
    };
  }
};

// ============================================================
// Plugin entry
// ============================================================
const plugin = definePluginEntry({
  id: 'openclaw-onnx-embed',
  name: 'ONNX BGE Embeddings',
  description: 'Local ONNX-based BGE embedding provider for memory search (bge-large-zh-v1.5)',
  register(api) {
    api.registerMemoryEmbeddingProvider(onnxBgeMemoryEmbeddingProviderAdapter);
  }
});

module.exports = plugin;
