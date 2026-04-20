/**
 * Vitest tests for the iterative_review LLM functions (Phase 2 additions).
 * All tests use mocked fetch — no live provider calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ENV before importing llm module
vi.mock('./_core/env', () => ({
  ENV: {
    anthropicApiKey: 'test-anthropic-key',
    openaiApiKey: 'test-openai-key',
    googleGeminiApiKey: 'test-gemini-key',
    xaiApiKey: 'test-xai-key',
    forgeApiUrl: '',
    forgeApiKey: '',
  },
}));

import {
  runSingleReview,
  runFeedbackEvaluation,
  runRevisionWithDecisions,
  runFormattingPassV2,
} from './llm';

// ── Helpers ──────────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ── runSingleReview ─────────────────────────────────────────────────

describe('runSingleReview', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns raw prose content from Claude reviewer', async () => {
    globalThis.fetch = mockFetchResponse({
      content: [{ type: 'text', text: 'The indemnification clause needs revision.' }],
    });

    const result = await runSingleReview('claude', 'Review this draft...');
    expect(result.provider).toBe('claude');
    expect(result.content).toBe('The indemnification clause needs revision.');
    expect(result.error).toBeUndefined();
  });

  it('returns raw prose content from GPT reviewer', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: 'GPT review feedback here.' } }],
    });

    const result = await runSingleReview('gpt', 'Review this draft...');
    expect(result.provider).toBe('gpt');
    expect(result.content).toBe('GPT review feedback here.');
    expect(result.error).toBeUndefined();
  });

  it('returns error on API failure without throwing', async () => {
    globalThis.fetch = mockFetchResponse({ error: 'rate limited' }, 429);

    const result = await runSingleReview('claude', 'Review this draft...');
    expect(result.provider).toBe('claude');
    expect(result.content).toBe('');
    expect(result.error).toContain('429');
  });

  it('does not request JSON mode (prose output per §9.2)', async () => {
    globalThis.fetch = mockFetchResponse({
      content: [{ type: 'text', text: 'Review output' }],
    });

    await runSingleReview('claude', 'Review this draft...');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    // Claude doesn't use response_format; verify no JSON mode markers
    expect(body.response_format).toBeUndefined();
  });
});

// ── runFeedbackEvaluation ───────────────────────────────────────────

describe('runFeedbackEvaluation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns raw JSON output from evaluator model', async () => {
    const evaluatorOutput = JSON.stringify({
      narrativeReasoning: 'Overall the draft is solid...',
      pointByPoint: [
        {
          sourceFeedbackId: 42,
          sourceReviewerProvider: 'gpt',
          sourceExcerpt: 'The indemnification clause...',
          sectionAnchor: { kind: 'section_reference', value: '4.2', locatorText: '4.2 Indemnification' },
          recommendation: 'modify',
          reasoning: 'Cap needs to be tied to purchase price.',
          suggestedText: 'capped at the Purchase Price',
        },
      ],
    });

    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: evaluatorOutput } }],
    });

    const result = await runFeedbackEvaluation('gpt', 'Evaluate this feedback...');
    expect(result.provider).toBe('gpt');
    expect(result.rawOutput).toBe(evaluatorOutput);
    expect(result.error).toBeUndefined();
  });

  it('requests JSON mode', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{}' } }],
    });

    await runFeedbackEvaluation('gpt', 'Evaluate...');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('returns error on API failure without throwing', async () => {
    globalThis.fetch = mockFetchResponse({ error: 'server error' }, 500);

    const result = await runFeedbackEvaluation('gpt', 'Evaluate...');
    expect(result.rawOutput).toBe('');
    expect(result.error).toContain('500');
  });
});

// ── runRevisionWithDecisions ────────────────────────────────────────

describe('runRevisionWithDecisions', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns raw JSON output from regenerator model', async () => {
    const regeneratorOutput = JSON.stringify({
      revisedDocument: 'The revised document text...',
      appliedChanges: [0, 1],
      unresolvedAnchors: [],
    });

    globalThis.fetch = mockFetchResponse({
      content: [{ type: 'text', text: regeneratorOutput }],
    });

    const result = await runRevisionWithDecisions('claude', 'Apply these changes...');
    expect(result.provider).toBe('claude');
    expect(result.rawOutput).toBe(regeneratorOutput);
    expect(result.error).toBeUndefined();
  });

  it('returns error on API failure without throwing', async () => {
    globalThis.fetch = mockFetchResponse({ error: 'timeout' }, 504);

    const result = await runRevisionWithDecisions('claude', 'Apply...');
    expect(result.rawOutput).toBe('');
    expect(result.error).toContain('504');
  });

  it('requests JSON mode for structured output', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{}' } }],
    });

    await runRevisionWithDecisions('gpt', 'Apply...');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
});

// ── runFormattingPassV2 ─────────────────────────────────────────────

describe('runFormattingPassV2', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls the specified model (not hardcoded Claude)', async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: 'Formatted document content' } }],
    });

    const result = await runFormattingPassV2('gpt', 'Substantive content here');
    expect(result.content).toBe('Formatted document content');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // GPT routes to OpenAI endpoint
    expect(call[0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('calls Claude when Claude is specified', async () => {
    globalThis.fetch = mockFetchResponse({
      content: [{ type: 'text', text: 'Claude formatted output' }],
    });

    const result = await runFormattingPassV2('claude', 'Substantive content');
    expect(result.content).toBe('Claude formatted output');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('includes adjustment notes when provided', async () => {
    globalThis.fetch = mockFetchResponse({
      content: [{ type: 'text', text: 'Formatted with adjustments' }],
    });

    await runFormattingPassV2('claude', 'Content', 'Fix the header spacing');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    const userMessage = body.messages[0].content;
    expect(userMessage).toContain('Fix the header spacing');
    expect(userMessage).toContain('Formatting Adjustment Notes');
  });

  it('returns parsed flags from formatted output', async () => {
    const formattedContent = `Formatted document here.

## Flags

- Cross-reference in Section 7.3 may be incorrect after renumbering
- Defined term "Purchase Price" used inconsistently in Exhibit B

---

End of document.`;

    globalThis.fetch = mockFetchResponse({
      content: [{ type: 'text', text: formattedContent }],
    });

    const result = await runFormattingPassV2('claude', 'Content');
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.flags[0]).toContain('Cross-reference');
  });
});
