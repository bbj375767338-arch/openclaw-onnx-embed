/**
 * OpenClaw ONNX BGE Memory Embedding Provider Plugin
 * Provides local bge-large-zh-v1.5 embedding via ONNX Runtime in a subprocess
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { readFileSync, writeFileSync } = fs;

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
// Subprocess manager - true singleton
// ============================================================
let subprocess = null;
let subprocessPid = null;
let pending = new Map();
let idCounter = 0;
let initPromise = null;

function isSubprocessAlive() {
  if (!subprocess || !subprocessPid) return false;
  try {
    process.kill(subprocessPid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function resetSubprocess() {
  subprocess = null;
  subprocessPid = null;
  initPromise = null;
  for (const [id, { resolve, reject }] of pending) {
    reject(new Error('Subprocess restarted'));
  }
  pending.clear();
}

function initSubprocess() {
  if (initPromise && isSubprocessAlive()) {
    return initPromise;
  }
  if (subprocess && !isSubprocessAlive()) {
    resetSubprocess();
  }
  if (initPromise) return initPromise;

  console.log('[onnx-bge] Starting ONNX subprocess...');
  initPromise = new Promise((resolve, reject) => {
    subprocess = spawn('node', [SUBPROCESS_PATH], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    subprocessPid = subprocess.pid;
    console.log('[onnx-bge] Subprocess spawned with PID:', subprocessPid);

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
            console.log('[onnx-bge] Subprocess ready!');
            resolve();
          } else if (msg.type === 'embedding') {
            const { id, result } = msg;
            const p = pending.get(id);
            if (p) {
              p.resolve(result);
              pending.delete(id);
            }
          } else if (msg.type === 'error') {
            const { id, error } = msg;
            console.error('[onnx-bge] Subprocess error:', error);
            const p = pending.get(id);
            if (p) {
              p.resolve(null);
              pending.delete(id);
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    });

    subprocess.stderr.on('data', (chunk) => {
      process.stderr.write('[onnx-sub] ' + chunk.toString());
    });

    subprocess.on('error', (err) => {
      console.error('[onnx-bge] Subprocess error:', err.message);
      resetSubprocess();
      reject(err);
    });

    subprocess.on('exit', (code) => {
      console.log('[onnx-bge] Subprocess exited with code:', code);
      resetSubprocess();
    });

    const timeout = setTimeout(() => {
      if (!subprocess || subprocess.exitCode !== null) {
        return;
      }
      console.error('[onnx-bge] Subprocess init timed out after 90s');
      subprocess.kill();
      resetSubprocess();
      reject(new Error('Subprocess initialization timed out'));
    }, 90000);

    subprocess.once('ready', () => clearTimeout(timeout));
  });

  return initPromise;
}

function sendToSubprocess(msg) {
  if (!subprocess || subprocess.stdin.destroyed) {
    return false;
  }
  subprocess.stdin.write(JSON.stringify(msg) + '\n');
  return true;
}

async function embedInSubprocess(text) {
  await initSubprocess();

  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    pending.set(id, { resolve, reject });

    if (!sendToSubprocess({ type: 'embed', id, text })) {
      pending.delete(id);
      reject(new Error('Subprocess died during embedding'));
      return;
    }

    const timeout = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Embedding timed out after 180s'));
      }
    }, 180000);

    pending.get(id)?.ref?.();
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
    initSubprocess().catch(err => console.error('[onnx-bge] Subprocess init failed:', err.message));

    const provider = {
      id: PROVIDER_ID,
      model: DEFAULT_MODEL,

      embedQuery: async (text) => {
        return await embedInSubprocess(text);
      },

      embedBatch: async (texts) => {
        return Promise.all(texts.map(t => embedInSubprocess(t)));
      }
    };

    return {
      provider,
      runtime: {
        id: PROVIDER_ID,
        cacheKeyData: {
          provider: PROVIDER_ID,
          model: DEFAULT_MODEL
        },
        batchEmbed: async (options) => {
          if (!options.chunks.length) return [];
          try {
            return await provider.embedBatch(options.chunks.map(c => c.text));
          } catch (err) {
            console.error('[onnx-bge] batchEmbed failed:', err.message);
            return null;
          }
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
