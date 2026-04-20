/**
 * Multi-provider LLM service with 4 workflow modes + Claude formatting pass.
 *
 * Providers (native API calls):
 * - Claude  → Anthropic Messages API (claude-sonnet-4-6)
 * - GPT-5.4 → OpenAI Chat Completions API (gpt-5.4)
 * - Gemini  → Google Generative Language API (gemini-2.5-pro)
 * - Grok    → xAI OpenAI-compatible API (grok-3) — wired but disabled
 */
import { ENV } from "./_core/env";
import { ENABLED_PROVIDERS, FORMATTING_PASS_PROMPT, type ProviderKey } from "../shared/workflow";
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

export interface FormattingResult {
  content: string;
  flags: string[];
}

// ── Provider-specific API callers ────────────────────────────────────

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
  const textBlocks = data.content?.filter((b: any) => b.type === "text") || [];
  return textBlocks.map((b: any) => b.text).join("\n") || "";
}

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
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p.text).join("\n") || "";
}

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

// ── Mode: single_model ──────────────────────────────────────────────

/**
 * Run a single model to process source materials.
 * Used for Intake and Issues phases. Output saved as v1, immediately complete.
 */
export async function runSingleModel(
  providerKey: ProviderKey,
  systemPrompt: string,
  userPrompt: string,
): Promise<DraftResult> {
  try {
    const content = await callProvider(providerKey, systemPrompt, userPrompt);
    const provider = ENABLED_PROVIDERS.find(p => p.key === providerKey) ||
      { key: providerKey, name: providerKey };
    return {
      provider: provider.key,
      providerLabel: provider.name,
      content,
    };
  } catch (err: any) {
    return {
      provider: providerKey,
      providerLabel: providerKey,
      content: "",
      error: err.message || "Unknown error",
    };
  }
}

// ── Mode: competitive_select (reuses runCompetitiveDraft) ───────────

/**
 * Run competitive drafting: invoke all enabled providers in parallel
 * via their native APIs and return all draft results.
 * Used for competitive_select (Planning) and full_competitive (Agreement).
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

// ── Mode: single_model_draft ────────────────────────────────────────

/**
 * Run a single model draft (same as runSingleModel but used in the
 * single_model_draft workflow where attorney can revise).
 */
export async function runSingleModelDraft(
  providerKey: ProviderKey,
  systemPrompt: string,
  userPrompt: string,
): Promise<DraftResult> {
  return runSingleModel(providerKey, systemPrompt, userPrompt);
}

/**
 * Run a revision: same model revises based on attorney feedback.
 */
export async function runRevision(
  providerKey: ProviderKey,
  systemPrompt: string,
  currentContent: string,
  feedback: string,
): Promise<DraftResult> {
  const revisionPrompt = `You previously drafted the following document. The attorney has reviewed it and provided feedback. Please revise the document based on the feedback below.\n\n## Current Draft\n\n${currentContent}\n\n## Attorney Feedback\n\n${feedback}\n\nPlease produce the complete revised document.`;

  try {
    const content = await callProvider(providerKey, systemPrompt, revisionPrompt);
    const provider = ENABLED_PROVIDERS.find(p => p.key === providerKey) ||
      { key: providerKey, name: providerKey };
    return {
      provider: provider.key,
      providerLabel: provider.name,
      content,
    };
  } catch (err: any) {
    return {
      provider: providerKey,
      providerLabel: providerKey,
      content: "",
      error: err.message || "Unknown error",
    };
  }
}

// ── Review Cycle (full_competitive only) ────────────────────────────

/**
 * Run review cycle: each enabled provider reviews the selected draft.
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
        true,
      );

      let points: Array<{ category: string; point: string }> = [];
      try {
        const parsed = JSON.parse(content);
        points = parsed.points || [];
      } catch {
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

// ── Claude Formatting Pass ──────────────────────────────────────────

/**
 * Run the Claude formatting pass on the locked substantive version.
 * Always uses Claude regardless of which model drafted the document.
 * Returns formatted content and any flagged issues.
 */
export async function runFormattingPass(
  substantiveContent: string,
  adjustmentNotes?: string,
): Promise<FormattingResult> {
  const systemPrompt = FORMATTING_PASS_PROMPT;

  let userPrompt = `Please apply the formatting pass to the following document:\n\n${substantiveContent}`;

  if (adjustmentNotes) {
    userPrompt += `\n\n## Formatting Adjustment Notes\n\nThe attorney has requested the following formatting adjustments:\n${adjustmentNotes}`;
  }

  // Always call Claude for formatting, using its master prompt
  const content = await callProvider("claude", systemPrompt, userPrompt, 16384, false);

  // Parse flags from Claude's response
  const flags = parseFormattingFlags(content);

  return { content, flags };
}

/**
 * Parse flagged items from Claude's formatting response.
 * Looks for clearly identifiable flag sections.
 * If no clear flags are found, returns empty array (per user requirement:
 * do not infer flags from ambiguous text).
 */
export function parseFormattingFlags(content: string): string[] {
  const flags: string[] = [];

  // Look for explicit flag sections with common patterns
  const flagPatterns = [
    /(?:^|\n)(?:##?\s*)?(?:flags?|issues?\s+flagged|substantive\s+issues?|flagged\s+items?)[\s:]*\n([\s\S]*?)(?=\n##|\n---|\Z)/im,
    /(?:^|\n)(?:##?\s*)?(?:issues?\s+noticed|concerns?|open\s+decisions?)[\s:]*\n([\s\S]*?)(?=\n##|\n---|\Z)/im,
  ];

  for (const pattern of flagPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const section = match[1].trim();
      // Extract bullet points
      const bullets = section.split(/\n/).filter(line => {
        const trimmed = line.trim();
        return trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed);
      });

      for (const bullet of bullets) {
        const cleaned = bullet.replace(/^[\s•\-\*\d.]+/, "").trim();
        if (cleaned.length > 10) { // Only include substantive flags
          flags.push(cleaned);
        }
      }
    }
  }

  return flags;
}

// ── Iterative Review LLM Functions (Phase 2) ────────────────────────

import {
  REVIEW_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT,
  REGENERATION_SYSTEM_PROMPT,
} from './iterativeReviewPrompts';

/**
 * Single reviewer call for iterative_review mode.
 * Returns raw prose feedback (no JSON parsing — per §9.2, category='review', raw output stored).
 */
export async function runSingleReview(
  reviewerModelId: ProviderKey,
  userPrompt: string,
): Promise<{ provider: string; content: string; error?: string }> {
  try {
    const content = await callProvider(
      reviewerModelId,
      REVIEW_SYSTEM_PROMPT,
      userPrompt,
      16384,
      false,
    );
    return { provider: reviewerModelId, content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { provider: reviewerModelId, content: '', error: message };
  }
}

/**
 * Evaluator call for iterative_review mode.
 * Returns structured JSON (point-by-point recommendations per §11.2).
 * JSON parsing is the caller's responsibility (Zod boundary in canonicalMutation).
 */
export async function runFeedbackEvaluation(
  evaluatorModelId: ProviderKey,
  userPrompt: string,
): Promise<{ provider: string; rawOutput: string; error?: string }> {
  try {
    const rawOutput = await callProvider(
      evaluatorModelId,
      EVALUATION_SYSTEM_PROMPT,
      userPrompt,
      16384,
      true, // JSON mode
    );
    return { provider: evaluatorModelId, rawOutput };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { provider: evaluatorModelId, rawOutput: '', error: message };
  }
}

/**
 * Regenerator call for iterative_review mode.
 * Applies attorney-selected changes at anchored locations per §11.4.
 * Returns structured JSON with revisedDocument + appliedChanges + unresolvedAnchors.
 */
export async function runRevisionWithDecisions(
  regeneratorModelId: ProviderKey,
  userPrompt: string,
): Promise<{ provider: string; rawOutput: string; error?: string }> {
  try {
    const rawOutput = await callProvider(
      regeneratorModelId,
      REGENERATION_SYSTEM_PROMPT,
      userPrompt,
      16384,
      true, // JSON mode
    );
    return { provider: regeneratorModelId, rawOutput };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { provider: regeneratorModelId, rawOutput: '', error: message };
  }
}

/**
 * Formatting pass with explicit model parameter (§12.6).
 * v1 default is Claude; function accepts any provider for future flexibility.
 */
export async function runFormattingPassV2(
  modelId: ProviderKey,
  substantiveContent: string,
  adjustmentNotes?: string,
): Promise<FormattingResult> {
  let userPrompt = `Please apply the formatting pass to the following document:\n\n${substantiveContent}`;

  if (adjustmentNotes) {
    userPrompt += `\n\n## Formatting Adjustment Notes\n\nThe attorney has requested the following formatting adjustments:\n${adjustmentNotes}`;
  }

  const content = await callProvider(modelId, FORMATTING_PASS_PROMPT, userPrompt, 16384, false);
  const flags = parseFormattingFlags(content);
  return { content, flags };
}
