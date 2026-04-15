/**
 * Multi-provider competitive drafting service.
 * Uses invokeLLM (Manus built-in) for all providers.
 * The provider label is passed as a system instruction prefix so the LLM
 * can role-play as that provider's style. All calls go through the same
 * Manus Forge endpoint.
 */
import { invokeLLM, type Message } from "./_core/llm";
import { ENABLED_PROVIDERS, type ProviderKey } from "../shared/workflow";

const PROVIDER_PERSONAS: Record<string, string> = {
  claude: "You are drafting as Claude — known for careful, nuanced legal analysis with thorough consideration of edge cases.",
  gpt: "You are drafting as GPT-5.4 — known for comprehensive, well-structured legal documents with clear organization.",
  gemini: "You are drafting as Gemini — known for balanced, practical legal analysis that considers multiple perspectives.",
};

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

/**
 * Run competitive drafting: invoke all enabled providers in parallel
 * and return all draft results.
 */
export async function runCompetitiveDraft(
  systemPrompt: string,
  userPrompt: string,
  phaseContext?: string,
): Promise<DraftResult[]> {
  const providers = ENABLED_PROVIDERS;

  const promises = providers.map(async (provider) => {
    try {
      const persona = PROVIDER_PERSONAS[provider.key] || "";
      const messages: Message[] = [
        { role: "system", content: `${persona}\n\n${systemPrompt}` },
        { role: "user", content: phaseContext ? `${userPrompt}\n\nAdditional context:\n${phaseContext}` : userPrompt },
      ];

      const result = await invokeLLM({ messages, maxTokens: 16384 });
      const content = typeof result.choices[0]?.message?.content === "string"
        ? result.choices[0].message.content
        : JSON.stringify(result.choices[0]?.message?.content);

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

/**
 * Run review cycle: each enabled provider reviews the selected draft.
 */
export async function runReviewCycle(
  systemPrompt: string,
  draftContent: string,
  reviewerPrompt: string,
): Promise<ReviewResult[]> {
  const providers = ENABLED_PROVIDERS;

  const promises = providers.map(async (provider) => {
    try {
      const messages: Message[] = [
        { role: "system", content: reviewerPrompt },
        { role: "user", content: `Please review the following legal draft:\n\n${draftContent}\n\nProvide your feedback as a JSON array of objects with "category" and "point" fields.` },
      ];

      const result = await invokeLLM({
        messages,
        maxTokens: 8192,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "review_feedback",
            strict: true,
            schema: {
              type: "object",
              properties: {
                points: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string", description: "Category of feedback" },
                      point: { type: "string", description: "Specific feedback point" },
                    },
                    required: ["category", "point"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["points"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = typeof result.choices[0]?.message?.content === "string"
        ? result.choices[0].message.content
        : JSON.stringify(result.choices[0]?.message?.content);

      let points: Array<{ category: string; point: string }> = [];
      try {
        const parsed = JSON.parse(content);
        points = parsed.points || [];
      } catch {
        points = [{ category: "General", point: content }];
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
