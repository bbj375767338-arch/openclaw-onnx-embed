/**
 * BERT tokenizer using @xenova/transformers PreTrainedTokenizer
 * Loads tokenizer.json from bge-large-zh-v1.5 cache
 * Provides proper WordPiece tokenization for both Chinese and English text
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const TOKENIZER_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/tokenizer.json';

let tokenizer = null;

export function loadTokenizer() {
  if (tokenizer) return tokenizer;

  // Use PreTrainedTokenizer directly from JSON - no network needed
  const { PreTrainedTokenizer } = require('/root/.openclaw/embedding-model/node_modules/@xenova/transformers/src/tokenizers.js');

  const tokenizerJSON = JSON.parse(readFileSync(TOKENIZER_PATH, 'utf8'));
  const tokenizerConfig = {};
  tokenizer = new PreTrainedTokenizer(tokenizerJSON, tokenizerConfig);

  return tokenizer;
}

/**
 * Tokenize text and return token IDs
 * Handles both Chinese (character-level WordPiece) and English (subword WordPiece)
 * @param {string} text - Input text (will be truncated at 512 tokens)
 * @returns {number[]} Array of token IDs with [CLS] and [SEP] already added
 */
export function tokenize(text) {
  const tok = loadTokenizer();
  // encode() adds [CLS] and [SEP] automatically when add_special_tokens=true (default)
  const ids = tok.encode(String(text).slice(0, 2048), null, { add_special_tokens: true });
  // Truncate to max 512 (model's SEQ_LEN)
  return ids.slice(0, 512);
}

/**
 * Get tokenizer info for debugging
 */
export function getTokenizerInfo() {
  const tok = loadTokenizer();
  return {
    vocab_size: tok.model.vocab_size,
    special_tokens: tok.all_special_ids,
  };
}