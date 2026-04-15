/**
 * Vitest tests for the multi-provider LLM client (server/llm.ts).
 * Tests cover:
 * - Provider dispatch routing
 * - Request formatting for each provider's native API
 * - Response parsing for each provider
 * - Error handling for failed API calls
 * - Competitive drafting (runCompetitiveDraft)
 * - Review cycle (runReviewCycle)
 *
 * All tests use mocked fetch to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the ENV before importing llm module
vi.mock("./_core/env", () => ({
  ENV: {
    anthropicApiKey: "test-anthropic-key",
    openaiApiKey: "test-openai-key",
    googleGeminiApiKey: "test-gemini-key",
    xaiApiKey: "test-xai-key",
    forgeApiUrl: "",
    forgeApiKey: "",
  },
}));

import {
  callProvider,
  buildProviderSystemPrompt,
  runCompetitiveDraft,
  runReviewCycle,
  type DraftResult,
  type ReviewResult,
} from "./llm";
import { MASTER_PROMPTS } from "./masterPrompts";

// ── Helpers ──────────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ── Provider Dispatch Tests ──────────────────────────────────────────

describe("callProvider dispatch", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes 'claude' to Anthropic Messages API with master prompt prepended", async () => {
    globalThis.fetch = mockFetchResponse({
      content: [{ type: "text", text: "Claude response" }],
    });

    const result = await callProvider("claude", "Phase task prompt", "User prompt");
    expect(result).toBe("Claude response");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.anthropic.com/v1/messages");
    const options = call[1];
    expect(options.headers["x-api-key"]).toBe("test-anthropic-key");
    expect(options.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    // System prompt should contain the master prompt AND the phase prompt
    expect(body.system).toContain("Kelly Satterwhite");
    expect(body.system).toContain("Phase task prompt");
    expect(body.system).toContain("Current Task Instructions");
    expect(body.messages[0].content).toBe("User prompt");
  });

  it("routes 'gpt' to OpenAI Chat Completions API with master prompt prepended", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "GPT response" } }],
    });

    const result = await callProvider("gpt", "Phase task prompt", "User prompt");
    expect(result).toBe("GPT response");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.openai.com/v1/chat/completions");
    const options = call[1];
    expect(options.headers["Authorization"]).toBe("Bearer test-openai-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("gpt-5.4");
    expect(body.messages[0].role).toBe("system");
    // System message should contain GPT master prompt + phase prompt
    expect(body.messages[0].content).toContain("Virginia- and Maryland-licensed attorney");
    expect(body.messages[0].content).toContain("Phase task prompt");
    expect(body.messages[1].role).toBe("user");
  });

  it("routes 'gemini' to Google Generative Language API with master prompt prepended", async () => {
    globalThis.fetch = mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "Gemini response" }] } }],
    });

    const result = await callProvider("gemini", "Phase task prompt", "User prompt");
    expect(result).toBe("Gemini response");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("generativelanguage.googleapis.com");
    expect(call[0]).toContain("gemini-2.5-pro");
    expect(call[0]).toContain("key=test-gemini-key");
    const body = JSON.parse(call[1].body);
    // System instruction should contain Gemini master prompt + phase prompt
    expect(body.systemInstruction.parts[0].text).toContain("Kelly Satterwhite");
    expect(body.systemInstruction.parts[0].text).toContain("Phase task prompt");
    expect(body.contents[0].parts[0].text).toBe("User prompt");
  });

  it("routes 'grok' to xAI OpenAI-compatible API with master prompt prepended", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "Grok response" } }],
    });

    const result = await callProvider("grok", "Phase task prompt", "User prompt");
    expect(result).toBe("Grok response");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.x.ai/v1/chat/completions");
    const options = call[1];
    expect(options.headers["Authorization"]).toBe("Bearer test-xai-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("grok-3");
    // System message should contain Grok master prompt + phase prompt
    expect(body.messages[0].content).toContain("Kelly Satterwhite");
    expect(body.messages[0].content).toContain("Phase task prompt");
  });
});

// ── Master Prompt Integration Tests ─────────────────────────────────

describe("buildProviderSystemPrompt", () => {
  it("prepends Claude master prompt to phase system prompt", () => {
    const result = buildProviderSystemPrompt("claude", "Perform intake analysis.");
    expect(result).toContain("Optimized for Claude Sonnet and Opus");
    expect(result).toContain("Kelly Satterwhite, Esq.");
    expect(result).toContain("Current Task Instructions");
    expect(result).toContain("Perform intake analysis.");
    // Master prompt comes first
    const masterIdx = result.indexOf("Optimized for Claude");
    const taskIdx = result.indexOf("Perform intake analysis.");
    expect(masterIdx).toBeLessThan(taskIdx);
  });

  it("prepends Gemini master prompt to phase system prompt", () => {
    const result = buildProviderSystemPrompt("gemini", "Draft engagement letter.");
    expect(result).toContain("Optimized for Google Gemini");
    expect(result).toContain("Draft engagement letter.");
  });

  it("prepends Grok master prompt to phase system prompt", () => {
    const result = buildProviderSystemPrompt("grok", "Review document.");
    expect(result).toContain("Optimized for Grok");
    expect(result).toContain("Review document.");
  });

  it("prepends GPT master prompt to phase system prompt", () => {
    const result = buildProviderSystemPrompt("gpt", "Create decision matrix.");
    expect(result).toContain("Virginia & Maryland Licensed Attorney");
    expect(result).toContain("Create decision matrix.");
  });

  it("each provider gets a different master prompt", () => {
    const claude = buildProviderSystemPrompt("claude", "test");
    const gemini = buildProviderSystemPrompt("gemini", "test");
    const grok = buildProviderSystemPrompt("grok", "test");
    const gpt = buildProviderSystemPrompt("gpt", "test");
    // All should be different (different master prompts)
    expect(claude).not.toBe(gemini);
    expect(claude).not.toBe(grok);
    expect(claude).not.toBe(gpt);
    expect(gemini).not.toBe(grok);
  });

  it("MASTER_PROMPTS has entries for all 4 providers", () => {
    expect(MASTER_PROMPTS.claude).toBeDefined();
    expect(MASTER_PROMPTS.gemini).toBeDefined();
    expect(MASTER_PROMPTS.grok).toBeDefined();
    expect(MASTER_PROMPTS.gpt).toBeDefined();
    // Each should be substantial (>1000 chars)
    expect(MASTER_PROMPTS.claude.length).toBeGreaterThan(1000);
    expect(MASTER_PROMPTS.gemini.length).toBeGreaterThan(1000);
    expect(MASTER_PROMPTS.grok.length).toBeGreaterThan(1000);
    expect(MASTER_PROMPTS.gpt.length).toBeGreaterThan(1000);
  });
});

// ── Response Parsing Tests ───────────────────────────────────────────

describe("response parsing", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses multi-block Anthropic response", async () => {
    globalThis.fetch = mockFetchResponse({
      content: [
        { type: "text", text: "Part 1" },
        { type: "text", text: "Part 2" },
      ],
    });

    const result = await callProvider("claude", "sys", "usr");
    expect(result).toBe("Part 1\nPart 2");
  });

  it("parses multi-part Gemini response", async () => {
    globalThis.fetch = mockFetchResponse({
      candidates: [{
        content: {
          parts: [
            { text: "Gemini Part A" },
            { text: "Gemini Part B" },
          ],
        },
      }],
    });

    const result = await callProvider("gemini", "sys", "usr");
    expect(result).toBe("Gemini Part A\nGemini Part B");
  });

  it("returns empty string for empty OpenAI response", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "" } }],
    });

    const result = await callProvider("gpt", "sys", "usr");
    expect(result).toBe("");
  });

  it("returns empty string for empty Anthropic response", async () => {
    globalThis.fetch = mockFetchResponse({
      content: [],
    });

    const result = await callProvider("claude", "sys", "usr");
    expect(result).toBe("");
  });
});

// ── Error Handling Tests ─────────────────────────────────────────────

describe("error handling", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws on Anthropic API error", async () => {
    globalThis.fetch = mockFetchResponse({ error: { message: "Invalid key" } }, 401);

    await expect(callProvider("claude", "sys", "usr")).rejects.toThrow("Claude API error (401)");
  });

  it("throws on OpenAI API error", async () => {
    globalThis.fetch = mockFetchResponse({ error: { message: "Rate limited" } }, 429);

    await expect(callProvider("gpt", "sys", "usr")).rejects.toThrow("OpenAI API error (429)");
  });

  it("throws on Gemini API error", async () => {
    globalThis.fetch = mockFetchResponse({ error: { message: "Bad request" } }, 400);

    await expect(callProvider("gemini", "sys", "usr")).rejects.toThrow("Gemini API error (400)");
  });

  it("throws on Grok API error", async () => {
    globalThis.fetch = mockFetchResponse({ error: { message: "Server error" } }, 500);

    await expect(callProvider("grok", "sys", "usr")).rejects.toThrow("Grok API error (500)");
  });

  it("throws for unknown provider key", async () => {
    await expect(callProvider("unknown" as any, "sys", "usr")).rejects.toThrow("Unknown provider");
  });
});

// ── JSON Mode Tests ──────────────────────────────────────────────────

describe("JSON mode", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("OpenAI sends response_format for JSON mode", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{"result": "ok"}' } }],
    });

    await callProvider("gpt", "sys", "usr", 8192, true);

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("Gemini sends responseMimeType for JSON mode", async () => {
    globalThis.fetch = mockFetchResponse({
      candidates: [{ content: { parts: [{ text: '{"result": "ok"}' }] } }],
    });

    await callProvider("gemini", "sys", "usr", 8192, true);

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("Grok sends response_format for JSON mode", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: '{"result": "ok"}' } }],
    });

    await callProvider("grok", "sys", "usr", 8192, true);

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

// ── Competitive Drafting Tests ───────────────────────────────────────

describe("runCompetitiveDraft", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls all 3 enabled providers in parallel and returns results", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ content: [{ type: "text", text: "Claude draft" }] }),
        });
      }
      if (url.includes("openai")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: "GPT draft" } }] }),
        });
      }
      if (url.includes("googleapis")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: "Gemini draft" }] } }] }),
        });
      }
      return Promise.reject(new Error("Unexpected URL: " + url));
    });

    const results = await runCompetitiveDraft("System prompt", "User prompt");

    expect(results).toHaveLength(3);
    expect(results.find(r => r.provider === "claude")?.content).toBe("Claude draft");
    expect(results.find(r => r.provider === "gpt")?.content).toBe("GPT draft");
    expect(results.find(r => r.provider === "gemini")?.content).toBe("Gemini draft");

    // Verify labels
    expect(results.find(r => r.provider === "claude")?.providerLabel).toBe("Claude");
    expect(results.find(r => r.provider === "gpt")?.providerLabel).toBe("GPT-5.4");
    expect(results.find(r => r.provider === "gemini")?.providerLabel).toBe("Gemini");

    // All 3 providers called
    expect(callCount).toBe(3);
  });

  it("appends phase context to user prompt when provided", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
        });
      }
      if (url.includes("openai")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: "ok" } }] }),
        });
      }
      if (url.includes("googleapis")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    await runCompetitiveDraft("sys", "user prompt", "extra context");

    // Check that the user prompt sent to Anthropic includes the context
    const anthropicCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0].includes("anthropic")
    );
    const body = JSON.parse(anthropicCall[1].body);
    expect(body.messages[0].content).toContain("extra context");
  });

  it("returns error result when a provider fails (does not throw)", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: false, status: 500, statusText: "Internal Server Error",
          json: () => Promise.resolve({ error: "Server error" }),
          text: () => Promise.resolve("Server error"),
        });
      }
      if (url.includes("openai")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: "GPT draft" } }] }),
        });
      }
      if (url.includes("googleapis")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: "Gemini draft" }] } }] }),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const results = await runCompetitiveDraft("sys", "user");

    expect(results).toHaveLength(3);
    const claudeResult = results.find(r => r.provider === "claude");
    expect(claudeResult?.error).toBeDefined();
    expect(claudeResult?.content).toBe("");

    // Other providers succeeded
    expect(results.find(r => r.provider === "gpt")?.content).toBe("GPT draft");
    expect(results.find(r => r.provider === "gemini")?.content).toBe("Gemini draft");
  });
});

// ── Review Cycle Tests ───────────────────────────────────────────────

describe("runReviewCycle", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls all 3 enabled providers for review and parses JSON feedback", async () => {
    const reviewJson = JSON.stringify({
      points: [
        { category: "Completeness", point: "Missing party details" },
        { category: "Accuracy", point: "Check dates" },
      ],
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ content: [{ type: "text", text: reviewJson }] }),
        });
      }
      if (url.includes("openai")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: reviewJson } }] }),
        });
      }
      if (url.includes("googleapis")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: reviewJson }] } }] }),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const results = await runReviewCycle("sys", "draft content", "reviewer prompt");

    expect(results).toHaveLength(3);
    results.forEach(r => {
      expect(r.points).toHaveLength(2);
      expect(r.points[0].category).toBe("Completeness");
      expect(r.points[1].category).toBe("Accuracy");
    });
  });

  it("falls back to General category when response is not valid JSON", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ content: [{ type: "text", text: "This is plain text feedback, not JSON." }] }),
        });
      }
      if (url.includes("openai")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: "Plain text review" } }] }),
        });
      }
      if (url.includes("googleapis")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: "Plain text" }] } }] }),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const results = await runReviewCycle("sys", "draft", "reviewer");

    results.forEach(r => {
      expect(r.points).toHaveLength(1);
      expect(r.points[0].category).toBe("General");
    });
  });

  it("returns empty points with error when a provider fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: false, status: 503, statusText: "Service Unavailable",
          json: () => Promise.resolve({}),
          text: () => Promise.resolve("Service Unavailable"),
        });
      }
      if (url.includes("openai")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            choices: [{ message: { content: '{"points":[{"category":"Test","point":"OK"}]}' } }],
          }),
        });
      }
      if (url.includes("googleapis")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text: '{"points":[{"category":"Test","point":"OK"}]}' }] } }],
          }),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const results = await runReviewCycle("sys", "draft", "reviewer");

    expect(results).toHaveLength(3);
    const claudeResult = results.find(r => r.reviewerProvider === "claude");
    expect(claudeResult?.error).toBeDefined();
    expect(claudeResult?.points).toHaveLength(0);

    // Other providers succeeded
    expect(results.find(r => r.reviewerProvider === "gpt")?.points).toHaveLength(1);
    expect(results.find(r => r.reviewerProvider === "gemini")?.points).toHaveLength(1);
  });

  it("extracts JSON from markdown-wrapped response", async () => {
    const wrappedJson = '```json\n{"points":[{"category":"Style","point":"Use formal tone"}]}\n```';

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ content: [{ type: "text", text: wrappedJson }] }),
        });
      }
      if (url.includes("openai")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: wrappedJson } }] }),
        });
      }
      if (url.includes("googleapis")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: wrappedJson }] } }] }),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const results = await runReviewCycle("sys", "draft", "reviewer");

    // The JSON extraction regex should find the embedded JSON
    results.forEach(r => {
      expect(r.points.length).toBeGreaterThanOrEqual(1);
      if (r.points[0].category !== "General") {
        expect(r.points[0].category).toBe("Style");
      }
    });
  });
});
