/**
 * OpenClaw ONNX BGE Memory Embedding Provider Plugin
 * Provides local bge-large-zh-v1.5 embedding via ONNX Runtime
 * All-in-one module to avoid ESM/CJS module resolution issues
 */

const path = require('path');
const fs = require('fs');

// Load SDK via absolute path
const openclawSdk = require('/usr/local/nodejs/lib/node_modules/openclaw/dist/plugin-sdk/core.js');
const definePluginEntry = openclawSdk.definePluginEntry;

// ============================================================
// Constants
// ============================================================
const MODEL_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/model.onnx';
const TOKENIZER_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/tokenizer.json';
const SEQ_LEN = 512;
const HIDDEN_SIZE = 1024;
const PROVIDER_ID = 'onnx-bge-local';
const DEFAULT_MODEL = 'bge-large-zh-v1.5';

// ============================================================
// Lazy-loaded state
// ============================================================
let ort = null;
let session = null;
let vocab = null;
let padId = null;

// ============================================================
// Tokenizer
// ============================================================
function loadVocab() {
  if (vocab) return vocab;
  const tok = JSON.parse(fs.readFileSync(TOKENIZER_PATH, 'utf8'));
  vocab = tok.model.vocab;
  return vocab;
}

function tokenize(text) {
  const v = loadVocab();
  const clsId = v['[CLS]'] || 101;
  const sepId = v['[SEP]'] || 102;
  const unkId = v['[UNK]'] || 100;

  const tokens = [];
  let currentWord = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);

    if (code > 127) {
      if (currentWord) {
        if (currentWord in v) tokens.push(currentWord);
        else tokens.push('[UNK]');
        currentWord = '';
      }
      if (ch in v) tokens.push(ch);
      else tokens.push('[UNK]');
    } else if (/\s/.test(ch)) {
      if (currentWord) { tokens.push(currentWord); currentWord = ''; }
    } else if (/[.,!?;:'"()\[\]{}]/.test(ch)) {
      if (currentWord) { tokens.push(currentWord); currentWord = ''; }
    } else {
      currentWord += ch.toLowerCase();
    }
  }
  if (currentWord) tokens.push(currentWord);

  const ids = [clsId];
  for (const t of tokens) {
    if (ids.length >= 510) break;
    if (t === '[UNK]') { ids.push(unkId); continue; }
    if (t in v) ids.push(v[t]);
    else {
      for (const c of t) {
        if (ids.length >= 510) break;
        ids.push(c in v ? v[c] : unkId);
      }
    }
  }
  ids.push(sepId);
  return ids;
}

// ============================================================
// ONNX Runtime initialization
// ============================================================
async function init() {
  if (session) return;

  const mod = await import('/root/.openclaw/embedding-model/node_modules/onnxruntime-node/dist/index.js');
  ort = mod.default;

  const tok = JSON.parse(fs.readFileSync(TOKENIZER_PATH, 'utf8'));
  vocab = tok.model.vocab;
  padId = vocab['[PAD]'] || 0;

  const sessionOpts = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 4,
    interOpNumThreads: 2,
  };
  session = await ort.InferenceSession.create(MODEL_PATH, sessionOpts);
  console.log(`[onnx-bge] Model ready! Inputs: ${session.inputNames}`);
}

// ============================================================
// Embedding function
// ============================================================
function sanitizeAndNormalizeEmbedding(vec) {
  const sanitized = vec.map((value) => Number.isFinite(value) ? value : 0);
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((value) => value / magnitude);
}

async function embedText(text) {
  await init();

  const inputIds = tokenize(String(text).slice(0, 300));

  const idsArr = new BigInt64Array(SEQ_LEN);
  const maskArr = new BigInt64Array(SEQ_LEN);
  const typeArr = new BigInt64Array(SEQ_LEN);

  const contentLen = Math.min(inputIds.length, SEQ_LEN);
  for (let i = 0; i < contentLen; i++) {
    idsArr[i] = BigInt(inputIds[i]);
    maskArr[i] = 1n;
  }
  for (let i = contentLen; i < SEQ_LEN; i++) {
    idsArr[i] = BigInt(padId);
    maskArr[i] = 0n;
  }

  const inputTensor = new ort.Tensor('int64', idsArr, [1, SEQ_LEN]);
  const maskTensor = new ort.Tensor('int64', maskArr, [1, SEQ_LEN]);
  const typeTensor = new ort.Tensor('int64', typeArr, [1, SEQ_LEN]);

  const t0 = Date.now();
  const results = await session.run({
    'input_ids': inputTensor,
    'attention_mask': maskTensor,
    'token_type_ids': typeTensor
  });
  const elapsed = Date.now() - t0;

  const output = results['last_hidden_state'];
  const embedding = new Float32Array(HIDDEN_SIZE);
  let count = 0;

  for (let i = 0; i < SEQ_LEN; i++) {
    if (maskArr[i] === 1n) {
      count++;
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        embedding[j] += output.data[i * HIDDEN_SIZE + j];
      }
    }
  }

  if (count > 0) {
    for (let j = 0; j < HIDDEN_SIZE; j++) embedding[j] /= count;
  }

  console.log(`[onnx-bge] embedding done in ${elapsed}ms`);
  return sanitizeAndNormalizeEmbedding(Array.from(embedding));
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
    const provider = {
      id: PROVIDER_ID,
      model: DEFAULT_MODEL,

      embedQuery: async (text) => {
        return await embedText(text);
      },

      embedBatch: async (texts) => {
        return await Promise.all(texts.map(t => embedText(t)));
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
