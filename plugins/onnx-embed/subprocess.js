/**
 * ONNX subprocess - auto-initializes model at startup
 * Communicates with main process via JSON lines on stdin/stdout
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { cpus } from 'os';
const require = createRequire(import.meta.url);

const MODEL_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/model.onnx';
const TOKENIZER_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/tokenizer.json';
const SEQ_LEN = 512;
const HIDDEN_SIZE = 1024;

let ort = null;
let session = null;
let vocab = null;
let padId = null;
let tokenizer = null;

function loadTokenizer() {
  if (tokenizer) return tokenizer;
  const { PreTrainedTokenizer } = require('/root/.openclaw/embedding-model/node_modules/@xenova/transformers/src/tokenizers.js');
  const tokenizerJSON = JSON.parse(readFileSync(TOKENIZER_PATH, 'utf8'));
  tokenizer = new PreTrainedTokenizer(tokenizerJSON, {});
  return tokenizer;
}

function sanitizeAndNormalizeEmbedding(vec) {
  const sanitized = vec.map((value) => Number.isFinite(value) ? value : 0);
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((value) => value / magnitude);
}

function runInference(tokenIds) {
  const idsArr = new BigInt64Array(SEQ_LEN);
  const maskArr = new BigInt64Array(SEQ_LEN);
  const typeArr = new BigInt64Array(SEQ_LEN);

  const contentLen = Math.min(tokenIds.length, SEQ_LEN);
  for (let i = 0; i < contentLen; i++) {
    idsArr[i] = BigInt(tokenIds[i]);
    maskArr[i] = 1n;
  }
  for (let i = contentLen; i < SEQ_LEN; i++) {
    idsArr[i] = BigInt(padId);
    maskArr[i] = 0n;
  }

  const inputTensor = new ort.Tensor('int64', idsArr, [1, SEQ_LEN]);
  const maskTensor = new ort.Tensor('int64', maskArr, [1, SEQ_LEN]);
  const typeTensor = new ort.Tensor('int64', typeArr, [1, SEQ_LEN]);

  return session.run({
    'input_ids': inputTensor,
    'attention_mask': maskTensor,
    'token_type_ids': typeTensor
  });
}

async function embedText(text) {
  const tok = loadTokenizer();
  const inputIds = tok.encode(String(text).slice(0, 2048), null, { add_special_tokens: true });

  const t0 = Date.now();
  const results = await runInference(inputIds);
  const elapsed = Date.now() - t0;

  const output = results['last_hidden_state'];
  const embedding = new Float32Array(HIDDEN_SIZE);
  let count = 0;

  for (let i = 0; i < Math.min(inputIds.length, SEQ_LEN); i++) {
    count++;
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      embedding[j] += output.data[i * HIDDEN_SIZE + j];
    }
  }

  if (count > 0) {
    for (let j = 0; j < HIDDEN_SIZE; j++) embedding[j] /= count;
  }

  console.error('[onnx-sub] embedding done in ' + elapsed + 'ms, tokens=' + inputIds.length);
  return sanitizeAndNormalizeEmbedding(Array.from(embedding));
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// Auto-initialize at startup
async function init() {
  console.error('[onnx-sub] Loading ONNX model...');
  const t0 = Date.now();

  const mod = await import('/root/.openclaw/embedding-model/node_modules/onnxruntime-node/dist/index.js');
  ort = mod.default;

  const tok = JSON.parse(readFileSync(TOKENIZER_PATH, 'utf8'));
  vocab = tok.model.vocab;
  padId = vocab['[PAD]'] || 0;

  // Adaptive threading: use min(cores, 4) for intra, 2 for inter
  const cpuCount = cpus().length;
  const intraThreads = Math.min(cpuCount, 4);
  const interThreads = Math.min(Math.max(cpuCount - 1, 1), 2);

  const sessionOpts = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: intraThreads,
    interOpNumThreads: interThreads,
  };
  console.error('[onnx-sub] Thread config: intra=' + intraThreads + ', inter=' + interThreads);

  session = await ort.InferenceSession.create(MODEL_PATH, sessionOpts);
  console.error('[onnx-sub] Model ready in ' + (Date.now() - t0) + 'ms!');

  // Warmup with proper tokenization
  const warmupTok = loadTokenizer();
  const warmupIds = warmupTok.encode('warmup', null, { add_special_tokens: true });
  await runInference(warmupIds);
  console.error('[onnx-sub] Warmup done!');

  send({ type: 'ready' });
}

// Serial queue for embed requests - prevents concurrent ONNX inference corruption
let embedQueue = Promise.resolve();

function queueEmbed(text) {
  return new Promise((resolve, reject) => {
    embedQueue = embedQueue.then(async () => {
      try {
        const result = await embedText(text);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Handle messages
async function handleMessage(msg) {
  if (msg.type === 'embed') {
    try {
      const result = await queueEmbed(msg.text);
      send({ type: 'embedding', id: msg.id, result });
    } catch (e) {
      console.error('[onnx-sub] embed error:', e.message);
      send({ type: 'error', id: msg.id, error: e.message });
    }
  } else if (msg.type === 'ping') {
    send({ type: 'pong', id: msg.id });
  }
}

// Read stdin line by line
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) {
      try {
        const msg = JSON.parse(line);
        handleMessage(msg);
      } catch (e) {
        send({ type: 'error', error: 'Invalid JSON: ' + e.message });
      }
    }
  }
});

process.stderr.on('data', () => {}); // Suppress stderr from parent

// Start auto-init
init().catch((e) => {
  console.error('[onnx-sub] Init failed:', e.message, e.stack);
  process.exit(1);
});