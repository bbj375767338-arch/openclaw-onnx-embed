/**
 * ONNX subprocess - runs in separate process to avoid blocking main thread
 * Communicates with main process via JSON lines on stdin/stdout
 */

const path = require('path');
const fs = require('fs');

const MODEL_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/model.onnx';
const TOKENIZER_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/tokenizer.json';
const SEQ_LEN = 512;
const HIDDEN_SIZE = 1024;

let ort = null;
let session = null;
let vocab = null;
let padId = null;

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

function sanitizeAndNormalizeEmbedding(vec) {
  const sanitized = vec.map((value) => Number.isFinite(value) ? value : 0);
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((value) => value / magnitude);
}

async function init() {
  if (session) return;

  console.error('[onnx-sub] Loading ONNX model...');
  const t0 = Date.now();

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
  console.error(`[onnx-sub] Model ready in ${Date.now() - t0}ms!`);

  // Warmup
  await runInference([101, 102]);
  console.error('[onnx-sub] Warmup done!');
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
  const inputIds = tokenize(String(text).slice(0, 300));

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

  console.error(`[onnx-sub] embedding done in ${elapsed}ms`);
  return sanitizeAndNormalizeEmbedding(Array.from(embedding));
}

// Main loop - read JSON lines from stdin, write to stdout
let initPromise = null;

async function handleMessage(msg) {
  if (msg.type === 'init') {
    if (!initPromise) {
      initPromise = init();
    }
    try {
      await initPromise;
      send({ type: 'ready' });
    } catch (e) {
      send({ type: 'error', error: e.message });
    }
  } else if (msg.type === 'embed') {
    try {
      const result = await embedText(msg.text);
      send({ type: 'embedding', id: msg.id, result });
    } catch (e) {
      send({ type: 'error', id: msg.id, error: e.message });
    }
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// Read stdin line by line
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
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
console.error('[onnx-sub] Subprocess started, waiting for init...');
