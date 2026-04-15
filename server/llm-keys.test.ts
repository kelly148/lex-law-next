import { describe, it, expect } from "vitest";

/*
 * Lightweight validation tests for each LLM provider API key.
 * Each test makes a minimal API call to verify the key is accepted.
 * These tests require real API keys set in the environment.
 */

describe("LLM Provider API Key Validation", () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY ?? "";
  const xaiKey = process.env.XAI_API_KEY ?? "";

  it("Anthropic API key is valid", async () => {
    if (!anthropicKey) {
      console.warn("ANTHROPIC_API_KEY not set, skipping");
      return;
    }
    // Minimal messages request — short prompt, max_tokens=1
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    // 200 = success, 429 = rate limited (key is valid)
    expect([200, 429]).toContain(res.status);
  }, 30000);

  it("OpenAI API key is valid", async () => {
    if (!openaiKey) {
      console.warn("OPENAI_API_KEY not set, skipping");
      return;
    }
    // List models endpoint — lightweight, no tokens consumed
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${openaiKey}`,
      },
    });
    expect([200, 429]).toContain(res.status);
  }, 30000);

  it("Google Gemini API key is valid", async () => {
    if (!geminiKey) {
      console.warn("GOOGLE_GEMINI_API_KEY not set, skipping");
      return;
    }
    // List models endpoint — lightweight
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`
    );
    expect([200, 429]).toContain(res.status);
  }, 30000);

  it("xAI (Grok) API key is valid (optional)", async () => {
    if (!xaiKey) {
      console.warn("XAI_API_KEY not set, skipping (Grok is disabled)");
      return;
    }
    // xAI uses OpenAI-compatible API
    const res = await fetch("https://api.x.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${xaiKey}`,
      },
    });
    expect([200, 429]).toContain(res.status);
  }, 30000);
});
