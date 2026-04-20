/**
 * Shared token estimation helper.
 *
 * Uses a 3-chars-per-token approximation — conservative per v2.3 §13.4.
 * Conservative means we prefer early truncation over API 400 errors.
 */

const FALLBACK_CHARS_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN);
}

export function truncateToTokenBudget(
  text: string,
  budgetTokens: number,
  marker: string = '[TRUNCATED AT LIMIT]'
): string {
  const estimated = estimateTokens(text);
  if (estimated <= budgetTokens) return text;

  // Bounded slice: always capped at the actual string length
  const reservedForMarker = marker.length + 2;
  const charBudget = Math.min(
    text.length,
    budgetTokens * FALLBACK_CHARS_PER_TOKEN
  );
  const truncateAt = Math.max(0, charBudget - reservedForMarker);
  return text.slice(0, truncateAt) + '\n' + marker;
}
