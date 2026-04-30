/**
 * Outbound Hook (MySQL Backend)
 * Intercepts search results and re-ranks them
 */

const { getAllMemories, getMemoryById } = require('../db/memory-db');
const { getAllL0Summaries } = require('../db/summary-gen');

// Temporal decay function
function temporalDecay(dateStr, halfLifeDays = 30) {
  const date = new Date(dateStr);
  const now = new Date();
  const daysDiff = (now - date) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, daysDiff / halfLifeDays);
}

// Quality score based on confidence and evidence
function qualityScore(entry) {
  const confidence = entry.confidence || 0.5;
  const evidenceCount = entry.evidence_count || 1;

  const confidenceBonus = 1 - Math.abs(confidence - 0.7);
  const evidenceBonus = Math.min(evidenceCount / 5, 1);

  return confidenceBonus * 0.4 + evidenceBonus * 0.6;
}

// Re-rank search results
async function reRankResults(originalResults, query) {
  if (!originalResults || originalResults.length === 0) return [];

  const allMemories = await getAllMemories();
  const memoryMap = new Map(allMemories.map(m => [m.id, m]));

  const scored = originalResults.map(result => {
    const memory = memoryMap.get(result.id) || result;

    if (memory.status === 'superseded' && originalResults.length > 3) {
      return { ...result, finalScore: -1 };
    }

    const tempScore = temporalDecay(memory.updated_at || memory.created_at);
    const qualScore = qualityScore(memory);
    const relevanceScore = result.score || 0.5;

    const finalScore = relevanceScore * 0.5 + tempScore * 0.2 + qualScore * 0.3;

    return {
      ...result,
      finalScore,
      memoryStatus: memory.status,
      confidence: memory.confidence
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored;
}

// Get related memories (for context expansion)
async function getRelatedMemories(entryId, limit = 5) {
  const { getRelatedMemories: getRelated } = require('../db/memory-db');
  return await getRelated(entryId, limit);
}

module.exports = { reRankResults, getRelatedMemories };
