// server/tokens.ts — Token counting and budget management utilities
// Used by contextBuilder.ts for section-level token budgets.
// Approximation: 1 token ≈ 4 characters (conservative for English legal text).

const CHARS_PER_TOKEN = 4;

/** Estimate the number of tokens in a string. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface AccumulateResult {
  /** The accumulated text sections, joined by separator. */
  accumulated: string;
  /** Items that were omitted because the budget was exceeded. */
  omitted: string[];
  /** Whether any items were omitted due to budget. */
  truncated: boolean;
}

/**
 * Accumulate items into a string up to a token budget.
 * Items are added in order; once the budget is exceeded, remaining items are omitted.
 * A truncation marker is appended if any items are omitted.
 *
 * @param items     Array of { label, content } pairs to accumulate.
 * @param budget    Maximum token count for the accumulated result.
 * @param separator Separator between items (default: '\n\n').
 */
export function accumulateWithBudget(
  items: Array<{ label: string; content: string }>,
  budget: number,
  separator = '\n\n',
): AccumulateResult {
  const parts: string[] = [];
  const omitted: string[] = [];
  let usedTokens = 0;

  for (const item of items) {
    const section = item.label ? `${item.label}\n${item.content}` : item.content;
    const sectionTokens = estimateTokens(section);
    if (usedTokens + sectionTokens <= budget) {
      parts.push(section);
      usedTokens += sectionTokens;
    } else {
      omitted.push(item.label || '(unlabeled)');
    }
  }

  const truncated = omitted.length > 0;
  if (truncated) {
    parts.push(`[TRUNCATED — ${omitted.length} item(s) omitted due to token budget: ${omitted.join(', ')}]`);
  }

  return {
    accumulated: parts.join(separator),
    omitted,
    truncated,
  };
}
