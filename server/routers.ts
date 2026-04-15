import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createMatter, listMatters, getMatterByMatterId,
  createPhases, getPhasesByMatterId, getPhase, updatePhaseWorkflowState, skipPhase,
  createVersion, getVersionsByPhase, selectVersion, getLatestVersionNumber,
  createFeedbackBatch, getFeedbackByPhase, updateFeedbackDecision,
  createFactChange, getFactChangesByMatter,
  createUpload, getUploadsByPhase,
} from "./db";
import { storagePut } from "./storage";
import { runCompetitiveDraft, runReviewCycle } from "./llm";
import { PHASE_PROMPTS, REVIEWER_PROMPT } from "./prompts";
import {
  PHASE_NAMES, PHASE_LABELS, PHASE_ORDER, OPTIONAL_PHASES,
  PROVIDERS, ENABLED_PROVIDERS, type PhaseName,
} from "../shared/workflow";

// ── Routers ──────────────────────────────────────────────────────────

const matterRouter = router({
  create: protectedProcedure
    .input(z.object({
      jurisdiction: z.string().min(1),
      workflowPath: z.enum(["full", "core_only"]).default("full"),
    }))
    .mutation(async ({ ctx, input }) => {
      const matterId = nanoid(12);
      const matter = await createMatter({
        matterId,
        jurisdiction: input.jurisdiction,
        workflowPath: input.workflowPath,
        createdBy: ctx.user.id,
      });

      // Create all 7 phases
      const phaseData = PHASE_NAMES.map((name) => ({
        matterId,
        phaseName: name as any,
        phaseLabel: PHASE_LABELS[name],
        phaseOrder: PHASE_ORDER[name],
        isOptional: OPTIONAL_PHASES.includes(name) ? 1 : 0,
      }));
      const createdPhases = await createPhases(phaseData);

      return { matter, phases: createdPhases };
    }),

  list: protectedProcedure.query(async () => {
    return listMatters();
  }),

  get: protectedProcedure
    .input(z.object({ matterId: z.string() }))
    .query(async ({ input }) => {
      const matter = await getMatterByMatterId(input.matterId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Matter not found" });
      const matterPhases = await getPhasesByMatterId(input.matterId);
      return { matter, phases: matterPhases };
    }),
});

const phaseRouter = router({
  get: protectedProcedure
    .input(z.object({ matterId: z.string(), phaseName: z.string() }))
    .query(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      const phaseVersions = await getVersionsByPhase(input.matterId, input.phaseName);
      const phaseFeedback = await getFeedbackByPhase(input.matterId, input.phaseName);
      return { phase, versions: phaseVersions, feedback: phaseFeedback };
    }),

  startDrafting: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      context: z.string().optional(),
      sourceContent: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "idle" && phase.workflowState !== "regenerating") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot start drafting from state: ${phase.workflowState}` });
      }

      // Transition to drafting
      await updatePhaseWorkflowState(input.matterId, input.phaseName, "drafting");

      const phaseName = input.phaseName as PhaseName;
      const prompt = PHASE_PROMPTS[phaseName];
      if (!prompt) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phase name" });

      // Build user prompt with context
      let userPrompt = prompt.userTemplate
        .replace("{{jurisdiction}}", "the applicable jurisdiction")
        .replace("{{sourceContent}}", input.sourceContent || input.context || "No source materials provided.")
        .replace("{{intakeContent}}", input.sourceContent || input.context || "See prior phase output.")
        .replace("{{issuesContent}}", input.sourceContent || input.context || "See prior phase output.")
        .replace("{{planningContent}}", input.sourceContent || input.context || "See prior phase output.")
        .replace("{{engagementContent}}", input.sourceContent || input.context || "See prior phase output.")
        .replace("{{memoContent}}", input.sourceContent || input.context || "See prior phase output.")
        .replace("{{matrixContent}}", input.sourceContent || input.context || "See prior phase output.");

      try {
        // Run competitive drafting
        const drafts = await runCompetitiveDraft(prompt.system, userPrompt, input.context);
        const versionNumber = (await getLatestVersionNumber(input.matterId, input.phaseName)) + 1;

        // Store all drafts
        for (const draft of drafts) {
          await createVersion({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber,
            provider: draft.provider,
            content: draft.content || draft.error || "Draft generation failed",
            metadata: { providerLabel: draft.providerLabel, error: draft.error },
          });
        }

        // Transition to awaiting_selection
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_selection", {
          versionNumber,
          draftCount: drafts.length,
        });

        return { success: true, versionNumber, drafts: drafts.length };
      } catch (err: any) {
        // On failure, revert to idle
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "idle");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  selectDraft: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      versionId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "awaiting_selection") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not awaiting draft selection" });
      }

      await selectVersion(input.versionId, input.matterId, input.phaseName);

      // Start review cycle
      await updatePhaseWorkflowState(input.matterId, input.phaseName, "reviewing");

      // Get the selected draft content
      const allVersions = await getVersionsByPhase(input.matterId, input.phaseName);
      const selectedVersion = allVersions.find(v => v.id === input.versionId);
      if (!selectedVersion) throw new TRPCError({ code: "NOT_FOUND", message: "Selected version not found" });

      try {
        const reviews = await runReviewCycle(
          PHASE_PROMPTS[input.phaseName as PhaseName]?.system || "",
          selectedVersion.content,
          REVIEWER_PROMPT,
        );

        // Store feedback
        const feedbackData = reviews.flatMap(review =>
          review.points.map(point => ({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: selectedVersion.versionNumber,
            reviewerProvider: review.reviewerProvider,
            category: point.category,
            point: point.point,
          }))
        );

        if (feedbackData.length > 0) {
          await createFeedbackBatch(feedbackData);
        }

        // Transition to awaiting_decisions
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_decisions", {
          selectedVersionId: input.versionId,
          reviewCount: reviews.length,
          feedbackCount: feedbackData.length,
        });

        return { success: true, feedbackCount: feedbackData.length };
      } catch (err: any) {
        // On review failure, stay at awaiting_selection so user can retry
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_selection");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  submitDecisions: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      decisions: z.array(z.object({
        feedbackId: z.number(),
        decision: z.enum(["accepted", "rejected", "modified"]),
        attorneyNote: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "awaiting_decisions") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not awaiting decisions" });
      }

      // Apply all decisions
      for (const d of input.decisions) {
        await updateFeedbackDecision(d.feedbackId, d.decision, d.attorneyNote);
      }

      // Check if any decisions require regeneration
      const hasAccepted = input.decisions.some(d => d.decision === "accepted" || d.decision === "modified");

      if (hasAccepted) {
        // Mark phase complete — accepted feedback incorporated
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");
        return { success: true, nextState: "complete" as const };
      } else {
        // All rejected — mark complete anyway (attorney decided no changes needed)
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");
        return { success: true, nextState: "complete" as const };
      }
    }),

  skip: protectedProcedure
    .input(z.object({ matterId: z.string(), phaseName: z.string() }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (!phase.isOptional) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only optional phases can be skipped" });
      }
      return skipPhase(input.matterId, input.phaseName);
    }),

  completeManually: protectedProcedure
    .input(z.object({ matterId: z.string(), phaseName: z.string() }))
    .mutation(async ({ input }) => {
      return updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");
    }),
});

const feedbackRouter = router({
  list: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      versionNumber: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return getFeedbackByPhase(input.matterId, input.phaseName, input.versionNumber);
    }),

  updateDecision: protectedProcedure
    .input(z.object({
      feedbackId: z.number(),
      decision: z.enum(["accepted", "rejected", "modified"]),
      attorneyNote: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateFeedbackDecision(input.feedbackId, input.decision, input.attorneyNote);
      return { success: true };
    }),
});

const factChangeRouter = router({
  create: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      description: z.string().min(1),
      affectedPhases: z.array(z.string()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return createFactChange({
        matterId: input.matterId,
        description: input.description,
        affectedPhases: input.affectedPhases,
        createdBy: ctx.user.id,
      });
    }),

  list: protectedProcedure
    .input(z.object({ matterId: z.string() }))
    .query(async ({ input }) => {
      return getFactChangesByMatter(input.matterId);
    }),
});

const uploadRouter = router({
  uploadFile: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string().default("intake"),
      fileName: z.string(),
      fileBase64: z.string(),
      contentType: z.string().default("application/octet-stream"),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const suffix = nanoid(6);
      const fileKey = `matters/${input.matterId}/uploads/${suffix}-${input.fileName}`;
      const { url } = await storagePut(fileKey, buffer, input.contentType);
      // Persist in database
      const upload = await createUpload({
        matterId: input.matterId,
        phaseName: input.phaseName,
        fileName: input.fileName,
        fileUrl: url,
        contentType: input.contentType,
        uploadedBy: ctx.user.id,
      });
      return upload;
    }),

  listByPhase: protectedProcedure
    .input(z.object({ matterId: z.string(), phaseName: z.string() }))
    .query(async ({ input }) => {
      return getUploadsByPhase(input.matterId, input.phaseName);
    }),
});

const configRouter = router({
  providers: publicProcedure.query(() => {
    return PROVIDERS.map(p => ({ name: p.name, key: p.key, model: p.model, enabled: p.enabled }));
  }),
  workflow: publicProcedure.query(() => {
    return {
      phases: PHASE_NAMES.map(name => ({
        name,
        label: PHASE_LABELS[name],
        order: PHASE_ORDER[name],
        isOptional: OPTIONAL_PHASES.includes(name),
      })),
      providers: ENABLED_PROVIDERS.map(p => ({ name: p.name, key: p.key })),
    };
  }),
});

// ── App Router ───────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  matter: matterRouter,
  phase: phaseRouter,
  feedback: feedbackRouter,
  factChange: factChangeRouter,
  upload: uploadRouter,
  config: configRouter,
});

export type AppRouter = typeof appRouter;
