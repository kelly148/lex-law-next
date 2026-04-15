/**
 * Multi-provider competitive drafting service.
 * Each provider is called via its native API endpoint with its own API key.
 *
 * - Claude  → Anthropic Messages API (claude-sonnet-4-6)
 * - GPT-5.4 → OpenAI Chat Completions API (gpt-5.4)
 * - Gemini  → Google Generative Language API (gemini-2.5-pro)
 * - Grok    → xAI OpenAI-compatible API (grok-3) — wired but disabled
 */
import { ENV } from "./_core/env";
import { ENABLED_PROVIDERS, type ProviderKey } from "../shared/workflow";
import { MASTER_PROMPTS } from "./masterPrompts";

// ── Types ────────────────────────────────────────────────────────────

export interface DraftResult {
  provider: string;
  providerLabel: string;
  content: string;
  error?: string;
}

export interface ReviewResult {
  reviewerProvider: string;
  points: Array<{
    category: string;
    point: string;
  }>;
  error?: string;
}

// ── Provider-specific API callers ────────────────────────────────────

/**
 * Call Anthropic Messages API (Claude).
 * Docs: https://docs.anthropic.com/en/api/messages
 */
async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 16384,
  jsonMode: boolean = false,
): Promise<string> {
  const apiKey = ENV.anthropicApiKey;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  // Anthropic returns { content: [{ type: "text", text: "..." }] }
  const textBlocks = data.content?.filter((b: any) => b.type === "text") || [];
  return textBlocks.map((b: any) => b.text).join("\n") || "";
}

/**
 * Call OpenAI Chat Completions API (GPT-5.4).
 * Docs: https://platform.openai.com/docs/api-reference/chat/create
 */
async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 16384,
  jsonMode: boolean = false,
): Promise<string> {
  const apiKey = ENV.openaiApiKey;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: "gpt-5.4",
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Call Google Gemini Generative Language API.
 * Docs: https://ai.google.dev/api/generate-content
 */
async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 16384,
  jsonMode: boolean = false,
): Promise<string> {
  const apiKey = ENV.googleGeminiApiKey;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not configured");

  const model = "gemini-2.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  // Gemini returns { candidates: [{ content: { parts: [{ text: "..." }] } }] }
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p.text).join("\n") || "";
}

/**
 * Call xAI Grok API (OpenAI-compatible).
 * Docs: https://docs.x.ai/overview
 */
async function callGrok(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 16384,
  jsonMode: boolean = false,
): Promise<string> {
  const apiKey = ENV.xaiApiKey;
  if (!apiKey) throw new Error("XAI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: "grok-3",
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Grok API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Unified dispatcher ───────────────────────────────────────────────

const PROVIDER_CALLERS: Record<
  ProviderKey,
  (system: string, user: string, maxTokens: number, jsonMode: boolean) => Promise<string>
> = {
  claude: callClaude,
  gpt: callOpenAI,
  gemini: callGemini,
  grok: callGrok,
};

/**
 * Build the full system prompt for a provider by prepending its master prompt.
 */
export function buildProviderSystemPrompt(
  providerKey: ProviderKey,
  phaseSystemPrompt: string,
): string {
  const masterPrompt = MASTER_PROMPTS[providerKey];
  if (!masterPrompt) return phaseSystemPrompt;
  return `${masterPrompt}\n\n---\n\n## Current Task Instructions\n\n${phaseSystemPrompt}`;
}

/**
 * Call a specific provider by key.
 * Automatically prepends the provider's master prompt to the system prompt.
 */
export async function callProvider(
  providerKey: ProviderKey,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 16384,
  jsonMode: boolean = false,
): Promise<string> {
  const caller = PROVIDER_CALLERS[providerKey];
  if (!caller) throw new Error(`Unknown provider: ${providerKey}`);
  const fullSystemPrompt = buildProviderSystemPrompt(providerKey, systemPrompt);
  return caller(fullSystemPrompt, userPrompt, maxTokens, jsonMode);
}

// ── Competitive Drafting ─────────────────────────────────────────────

/**
 * Run competitive drafting: invoke all enabled providers in parallel
 * via their native APIs and return all draft results.
 */
export async function runCompetitiveDraft(
  systemPrompt: string,
  userPrompt: string,
  phaseContext?: string,
): Promise<DraftResult[]> {
  const providers = ENABLED_PROVIDERS;
  const fullUserPrompt = phaseContext
    ? `${userPrompt}\n\nAdditional context:\n${phaseContext}`
    : userPrompt;

  const promises = providers.map(async (provider) => {
    try {
      const content = await callProvider(
        provider.key as ProviderKey,
        systemPrompt,
        fullUserPrompt,
        16384,
        false,
      );

      return {
        provider: provider.key,
        providerLabel: provider.name,
        content,
      };
    } catch (err: any) {
      return {
        provider: provider.key,
        providerLabel: provider.name,
        content: "",
        error: err.message || "Unknown error",
      };
    }
  });

  return Promise.all(promises);
}

// ── Review Cycle ─────────────────────────────────────────────────────

/**
 * Run review cycle: each enabled provider reviews the selected draft
 * via its native API.
 */
export async function runReviewCycle(
  systemPrompt: string,
  draftContent: string,
  reviewerPrompt: string,
): Promise<ReviewResult[]> {
  const providers = ENABLED_PROVIDERS;

  const userPrompt = `Please review the following legal draft and provide your feedback as a JSON object with a "points" array. Each point should have "category" and "point" fields.\n\n${draftContent}`;

  const promises = providers.map(async (provider) => {
    try {
      const content = await callProvider(
        provider.key as ProviderKey,
        reviewerPrompt,
        userPrompt,
        8192,
        true, // JSON mode for structured review output
      );

      let points: Array<{ category: string; point: string }> = [];
      try {
        // Try to parse as JSON first
        const parsed = JSON.parse(content);
        points = parsed.points || [];
      } catch {
        // If JSON parsing fails, try to extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*"points"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            points = parsed.points || [];
          } catch {
            points = [{ category: "General", point: content }];
          }
        } else {
          points = [{ category: "General", point: content }];
        }
      }

      return { reviewerProvider: provider.key, points };
    } catch (err: any) {
      return {
        reviewerProvider: provider.key,
        points: [],
        error: err.message || "Unknown error",
      };
    }
  });

  return Promise.all(promises);
}
