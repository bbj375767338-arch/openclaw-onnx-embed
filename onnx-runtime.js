/**
 * ONNX Runtime inference for bge-large-zh-v1.5
 * Lazy-loaded on first embedText() call
 */

import { readFileSync } from 'fs';

const MODEL_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/model.onnx';

const SEQ_LEN = 512;
const HIDDEN_SIZE = 1024;

let ort = null;
let session = null;
let vocab = null;
let padId = null;

export async function init() {
  if (session) return;

  const mod = await import('/root/.openclaw/embedding-model/node_modules/onnxruntime-node/dist/index.js');
  ort = mod.default;

  // Load vocab
  const tok = JSON.parse(readFileSync('/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/tokenizer.json', 'utf8'));
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

function sanitizeAndNormalizeEmbedding(vec) {
  const sanitized = vec.map((value) => Number.isFinite(value) ? value : 0);
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((value) => value / magnitude);
}

export async function embedText(text) {
  await init();

  const { tokenize } = await import('./tokenizer.js');
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
