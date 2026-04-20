import { describe, it, expect } from 'vitest';
import { estimateTokens, truncateToTokenBudget } from './tokens';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for null-ish input', () => {
    // @ts-expect-error — testing runtime safety
    expect(estimateTokens(null)).toBe(0);
    // @ts-expect-error — testing runtime safety
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('estimates tokens at 3 chars per token (ceil)', () => {
    // 9 chars → 3 tokens
    expect(estimateTokens('123456789')).toBe(3);
    // 10 chars → 4 tokens (ceil)
    expect(estimateTokens('1234567890')).toBe(4);
    // 1 char → 1 token
    expect(estimateTokens('a')).toBe(1);
    // 3 chars → 1 token
    expect(estimateTokens('abc')).toBe(1);
  });

  it('handles long text', () => {
    const text = 'x'.repeat(300);
    expect(estimateTokens(text)).toBe(100);
  });
});

describe('truncateToTokenBudget', () => {
  it('returns text unchanged when within budget', () => {
    const text = 'Hello world'; // 11 chars → 4 tokens
    expect(truncateToTokenBudget(text, 10)).toBe(text);
  });

  it('truncates and appends marker when over budget', () => {
    const text = 'x'.repeat(300); // 300 chars → 100 tokens
    const result = truncateToTokenBudget(text, 10); // budget = 10 tokens = 30 chars
    expect(result).toContain('[TRUNCATED AT LIMIT]');
    expect(result.length).toBeLessThan(300);
  });

  it('uses custom marker', () => {
    const text = 'x'.repeat(300);
    const marker = '[CUT]';
    const result = truncateToTokenBudget(text, 10, marker);
    expect(result).toContain(marker);
    expect(result).not.toContain('[TRUNCATED AT LIMIT]');
  });

  it('respects budget within ±5% tolerance', () => {
    const text = 'x'.repeat(3000); // 1000 tokens
    const budget = 100; // 100 tokens = 300 chars
    const result = truncateToTokenBudget(text, budget);
    // Result should be close to 300 chars (budget * 3) including marker
    const resultTokens = estimateTokens(result);
    // Allow ±5% of budget
    expect(resultTokens).toBeLessThanOrEqual(budget * 1.05);
  });

  it('handles budget of 0', () => {
    const text = 'Hello world';
    const result = truncateToTokenBudget(text, 0);
    expect(result).toContain('[TRUNCATED AT LIMIT]');
  });

  it('never exceeds original text length in char budget', () => {
    // Edge case: budget is larger than text but estimateTokens says over budget
    // This shouldn't happen, but the Math.min guard protects against it
    const text = 'abc'; // 3 chars → 1 token
    const result = truncateToTokenBudget(text, 1);
    expect(result).toBe(text); // within budget
  });

  it('marker is appended with newline separator', () => {
    const text = 'x'.repeat(300);
    const result = truncateToTokenBudget(text, 10);
    const parts = result.split('\n');
    expect(parts[parts.length - 1]).toBe('[TRUNCATED AT LIMIT]');
  });
});
