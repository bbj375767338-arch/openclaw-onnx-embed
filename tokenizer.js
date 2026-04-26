/**
 * BERT tokenizer with Chinese character-level handling
 * Reuses tokenizer.json from existing cache
 */

import { readFileSync } from 'fs';

const TOKENIZER_PATH = '/root/.openclaw/embedding-model/node_modules/@xenova/transformers/.cache/Xenova/bge-large-zh-v1.5/tokenizer.json';

let vocab = null;

export function loadVocab() {
  if (vocab) return vocab;
  const tok = JSON.parse(readFileSync(TOKENIZER_PATH, 'utf8'));
  vocab = tok.model.vocab;
  return vocab;
}

export function tokenize(text) {
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
      // Chinese character
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

  // Convert to IDs
  const ids = [clsId];
  for (const t of tokens) {
    if (ids.length >= 510) break;
    if (t === '[UNK]') { ids.push(unkId); continue; }
    if (t in v) ids.push(v[t]);
    else {
      // Sub-word fallback to character level
      for (const c of t) {
        if (ids.length >= 510) break;
        ids.push(c in v ? v[c] : unkId);
      }
    }
  }
  ids.push(sepId);
  return ids;
}
