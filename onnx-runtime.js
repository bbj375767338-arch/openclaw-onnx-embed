/**
 * ONNX Runtime inference for bge-large-zh-v1.5
 * Lazy-loaded on first embedText() call
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
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

export async function init() {
  if (session) return;

  const mod = await import('/root/.openclaw/embedding-model/node_modules/onnxruntime-node/dist/index.js');
  ort = mod.default;

  // Load vocab for padding
  const tok = JSON.parse(readFileSync(TOKENIZER_PATH, 'utf8'));
  vocab = tok.model.vocab;
  padId = vocab['[PAD]'] || 0;

  // Load proper tokenizer
  const { PreTrainedTokenizer } = require('/root/.openclaw/embedding-model/node_modules/@xenova/transformers/src/tokenizers.js');
  const tokenizerJSON = JSON.parse(readFileSync(TOKENIZER_PATH, 'utf8'));
  tokenizer = new PreTrainedTokenizer(tokenizerJSON, {});

  // Adaptive threading
  const cpuCount = require('os').cpus().length;
  const intraThreads = Math.min(cpuCount, 4);
  const interThreads = Math.min(Math.max(cpuCount - 1, 1), 2);

  const sessionOpts = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: intraThreads,
    interOpNumThreads: interThreads,
  };
  console.log(`[onnx-bge] Thread config: intra=${intraThreads}, inter=${interThreads}`);

  session = await ort.InferenceSession.create(MODEL_PATH, sessionOpts);
  console.log(`[onnx-bge] Model ready! Inputs: ${session.inputNames}`);
}

function sanitizeAndNormalizeEmbedding(vec) {
  const sanitized = vec.map((value) => Number.isFinite(value) ? value : 0);
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((value) => value / magnitude);
}

export async function embedText(text) {
  await init();

  // Use proper tokenizer - no manual truncation needed, encode() handles it
  const inputIds = tokenizer.encode(String(text).slice(0, 2048), null, { add_special_tokens: true });

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

  console.log(`[onnx-bge] embedding done in ${elapsed}ms, tokens=${inputIds.length}`);
  return sanitizeAndNormalizeEmbedding(Array.from(embedding));
}