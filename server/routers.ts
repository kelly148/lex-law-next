import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createMatter, listMatters, getMatterByMatterId, renameMatter,
  createPhases, getPhasesByMatterId, getPhase, updatePhaseWorkflowState,
  updatePhaseFields, setPhaseStatus, skipPhase,
  createVersion, getVersionsByPhase, getVersionByNumber, selectVersion, getLatestVersionNumber,
  createFeedbackBatch, getFeedbackByPhase, updateFeedbackDecision,
  createFactChange, getFactChangesByMatter,
  createUpload, getUploadsByPhase,
} from "./db";
import { storagePut } from "./storage";
import { buildSourceContentFromUploads } from "./fileExtractor";
import {
  runSingleModel, runCompetitiveDraft, runSingleModelDraft,
  runRevision, runReviewCycle, runFormattingPass,
} from "./llm";
import { PHASE_PROMPTS, REVIEWER_PROMPT } from "./prompts";
import {
  PHASE_NAMES, PHASE_CONFIG, OPTIONAL_PHASES,
  PROVIDERS, ENABLED_PROVIDERS, canStartPhase,
  type PhaseName, type WorkflowMode, type ProviderKey,
} from "../shared/workflow";

// ── Helpers ─────────────────────────────────────────────────────────

function buildUserPrompt(phaseName: PhaseName, sourceContent?: string, context?: string): string {
  const prompt = PHASE_PROMPTS[phaseName];
  if (!prompt) throw new Error(`No prompt for phase: ${phaseName}`);
  return prompt.userTemplate
    .replace("{{jurisdiction}}", "the applicable jurisdiction")
    .replace("{{sourceContent}}", sourceContent || context || "No source materials provided.")
    .replace("{{intakeContent}}", sourceContent || context || "See prior phase output.")
    .replace("{{issuesContent}}", sourceContent || context || "See prior phase output.")
    .replace("{{planningContent}}", sourceContent || context || "See prior phase output.")
    .replace("{{engagementContent}}", sourceContent || context || "See prior phase output.")
    .replace("{{memoContent}}", sourceContent || context || "See prior phase output.")
    .replace("{{matrixContent}}", sourceContent || context || "See prior phase output.");
}

// ── Routers ──────────────────────────────────────────────────────────

const matterRouter = router({
  create: protectedProcedure
    .input(z.object({
      matterName: z.string().min(1, "Matter name is required").max(512),
      jurisdiction: z.string().min(1),
      workflowPath: z.enum(["full", "core_only"]).default("full"),
    }))
    .mutation(async ({ ctx, input }) => {
      const matterId = nanoid(12);
      const matter = await createMatter({
        matterId,
        matterName: input.matterName,
        jurisdiction: input.jurisdiction,
        workflowPath: input.workflowPath,
        createdBy: ctx.user.id,
      });

      // Create all 7 phases with config
      const phaseData = PHASE_NAMES.map((name) => ({
        matterId,
        phaseName: name as any,
        phaseLabel: PHASE_CONFIG[name].label,
        phaseOrder: PHASE_CONFIG[name].order,
        isOptional: PHASE_CONFIG[name].isOptional ? 1 : 0,
        activeWorkflowMode: PHASE_CONFIG[name].defaultMode,
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

  rename: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      matterName: z.string().min(1, "Matter name is required").max(512),
    }))
    .mutation(async ({ input }) => {
      const matter = await getMatterByMatterId(input.matterId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Matter not found" });
      return renameMatter(input.matterId, input.matterName);
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

  // ── Start Phase (mode routing) ────────────────────────────────────
  startPhase: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      context: z.string().optional(),
      sourceContent: z.string().optional(),
      workflowModeOverride: z.enum(["single_model_draft", "competitive_select", "full_competitive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "idle") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot start phase from state: ${phase.workflowState}` });
      }

      const phaseName = input.phaseName as PhaseName;
      const config = PHASE_CONFIG[phaseName];
      if (!config) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phase name" });

      // Phase gate: check prerequisites
      const allPhases = await getPhasesByMatterId(input.matterId);
      if (!canStartPhase(phaseName, allPhases as any)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot start this phase: prerequisite phases are not complete",
        });
      }

      // Handle mode override / escalation
      let activeMode: WorkflowMode = phase.activeWorkflowMode as WorkflowMode || config.defaultMode;

      if (input.workflowModeOverride) {
        // Agreement mode lock: reject any override that is not full_competitive
        if (phaseName === "agreement" && input.workflowModeOverride !== "full_competitive") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Final Legal Document cannot be downgraded from Full Recursive Review.",
          });
        }

        if (config.escalatable && config.availableModes.includes(input.workflowModeOverride)) {
          activeMode = input.workflowModeOverride;
          await updatePhaseFields(input.matterId, input.phaseName, {
            activeWorkflowMode: activeMode,
          });
        } else if (!config.escalatable) {
          // Non-escalatable phases ignore overrides silently (except agreement which throws above)
        }
      }

      // Route to correct workflow based on mode
      switch (activeMode) {
        case "single_model":
          // Transition to model_selection — attorney picks which model
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "model_selection");
          return { success: true, workflowState: "model_selection" as const, mode: activeMode };

        case "competitive_select":
          // Run all models in parallel, then attorney selects
          return await startCompetitiveDraft(input.matterId, phaseName, input.sourceContent, input.context);

        case "single_model_draft":
          // Transition to model_selection — attorney picks which model
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "model_selection");
          return { success: true, workflowState: "model_selection" as const, mode: activeMode };

        case "full_competitive":
          // Run all models in parallel (existing competitive flow)
          return await startCompetitiveDraft(input.matterId, phaseName, input.sourceContent, input.context);

        default:
          throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown workflow mode: ${activeMode}` });
      }
    }),

  // ── Select Model (single_model & single_model_draft) ──────────────
  selectModel: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      modelId: z.string(),
      sourceContent: z.string().optional(),
      context: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "model_selection") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not in model selection state" });
      }

      const phaseName = input.phaseName as PhaseName;
      const config = PHASE_CONFIG[phaseName];
      const activeMode = phase.activeWorkflowMode as WorkflowMode || config.defaultMode;
      const providerKey = input.modelId as ProviderKey;

      // Validate model is enabled
      const provider = ENABLED_PROVIDERS.find(p => p.key === providerKey);
      if (!provider) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Selected model is not available" });
      }

      // Store selected model
      await updatePhaseFields(input.matterId, input.phaseName, {
        selectedModelId: providerKey,
      });

      const prompt = PHASE_PROMPTS[phaseName];
      if (!prompt) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phase name" });

      // Fetch uploaded files and extract their text content for the LLM
      const uploads = await getUploadsByPhase(input.matterId, input.phaseName);
      const extractedSource = uploads.length > 0
        ? await buildSourceContentFromUploads(uploads as any, input.context)
        : undefined;

      // Use extracted file content if available, otherwise fall back to passed sourceContent
      const effectiveSource = extractedSource || input.sourceContent;
      const userPrompt = buildUserPrompt(phaseName, effectiveSource, input.context);

      if (activeMode === "single_model") {
        // Processing state
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "processing");

        try {
          const result = await runSingleModel(providerKey, prompt.system, userPrompt);

          // Save as v1
          await createVersion({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: 1,
            provider: result.provider,
            content: result.content || result.error || "Processing failed",
            isSelected: 1,
            metadata: { providerLabel: result.providerLabel, error: result.error },
          });

          // Set official_final_version = 1 and complete
          await updatePhaseFields(input.matterId, input.phaseName, {
            officialFinalVersion: 1,
          });
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");

          return { success: true, workflowState: "complete" as const };
        } catch (err: any) {
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "model_selection");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
        }
      } else if (activeMode === "single_model_draft") {
        // Drafting state
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "drafting");

        try {
          const result = await runSingleModelDraft(providerKey, prompt.system, userPrompt);

          // Save as v1
          await createVersion({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: 1,
            provider: result.provider,
            content: result.content || result.error || "Draft generation failed",
            isSelected: 1,
            metadata: { providerLabel: result.providerLabel, error: result.error },
          });

          // Transition to awaiting_attorney_review
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_attorney_review", {
            currentVersion: 1,
          });

          return { success: true, workflowState: "awaiting_attorney_review" as const, versionNumber: 1 };
        } catch (err: any) {
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "model_selection");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
        }
      }

      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid mode for model selection" });
    }),

  // ── Request Revision (single_model_draft only) ────────────────────
  requestRevision: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      feedback: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "awaiting_attorney_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not awaiting attorney review" });
      }

      const activeMode = phase.activeWorkflowMode as WorkflowMode;
      if (activeMode !== "single_model_draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Revision is only available in Simple Draft mode" });
      }

      const providerKey = phase.selectedModelId as ProviderKey;
      if (!providerKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No model selected for this phase" });
      }

      // Get current version content
      const latestVersionNum = await getLatestVersionNumber(input.matterId, input.phaseName);
      const currentVersion = await getVersionByNumber(input.matterId, input.phaseName, latestVersionNum);
      if (!currentVersion) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Current version not found" });
      }

      const phaseName = input.phaseName as PhaseName;
      const prompt = PHASE_PROMPTS[phaseName];

      await updatePhaseWorkflowState(input.matterId, input.phaseName, "revising");

      try {
        const result = await runRevision(
          providerKey,
          prompt?.system || "",
          currentVersion.content,
          input.feedback,
        );

        const newVersionNum = latestVersionNum + 1;
        await createVersion({
          matterId: input.matterId,
          phaseName: input.phaseName,
          versionNumber: newVersionNum,
          provider: result.provider,
          content: result.content || result.error || "Revision failed",
          isSelected: 1,
          metadata: { providerLabel: result.providerLabel, error: result.error, feedback: input.feedback },
        });

        await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_attorney_review", {
          currentVersion: newVersionNum,
        });

        return { success: true, workflowState: "awaiting_attorney_review" as const, versionNumber: newVersionNum };
      } catch (err: any) {
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_attorney_review");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  // ── Accept Draft (single_model_draft only) ────────────────────────
  acceptDraft: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "awaiting_attorney_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not awaiting attorney review" });
      }

      const latestVersionNum = await getLatestVersionNumber(input.matterId, input.phaseName);

      // Record official_final_version = the accepted version number
      await updatePhaseFields(input.matterId, input.phaseName, {
        officialFinalVersion: latestVersionNum,
      });
      await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");

      return { success: true, workflowState: "complete" as const, officialFinalVersion: latestVersionNum };
    }),

  // ── Select Draft (competitive_select & full_competitive) ──────────
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

      const activeMode = phase.activeWorkflowMode as WorkflowMode;
      const allVersions = await getVersionsByPhase(input.matterId, input.phaseName);
      const selectedVersion = allVersions.find(v => v.id === input.versionId);
      if (!selectedVersion) throw new TRPCError({ code: "NOT_FOUND", message: "Selected version not found" });

      if (activeMode === "competitive_select") {
        // competitive_select: selection completes the phase immediately
        await updatePhaseFields(input.matterId, input.phaseName, {
          officialFinalVersion: 1,
          selectedModelId: selectedVersion.provider,
        });
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");
        return { success: true, nextState: "complete" as const };
      }

      // full_competitive: proceed to review cycle
      await updatePhaseFields(input.matterId, input.phaseName, {
        selectedModelId: selectedVersion.provider,
      });
      await updatePhaseWorkflowState(input.matterId, input.phaseName, "reviewing");

      try {
        const reviews = await runReviewCycle(
          PHASE_PROMPTS[input.phaseName as PhaseName]?.system || "",
          selectedVersion.content,
          REVIEWER_PROMPT,
        );

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

        await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_decisions", {
          selectedVersionId: input.versionId,
          reviewCount: reviews.length,
          feedbackCount: feedbackData.length,
        });

        return { success: true, nextState: "awaiting_decisions" as const, feedbackCount: feedbackData.length };
      } catch (err: any) {
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "awaiting_selection");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  // ── Submit Decisions (full_competitive) ────────────────────────────
  submitDecisions: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      acceptCurrent: z.boolean().optional(),
      decisions: z.array(z.object({
        feedbackId: z.number(),
        decision: z.enum(["accepted", "rejected", "modified"]),
        attorneyNote: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "awaiting_decisions") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not awaiting decisions" });
      }

      // Accept current version (no more changes)
      if (input.acceptCurrent) {
        const phaseName = input.phaseName as PhaseName;
        const config = PHASE_CONFIG[phaseName];
        const latestVersionNum = await getLatestVersionNumber(input.matterId, input.phaseName);

        if (config.hasFormattingPass) {
          // Lock the substantive version and trigger formatting pass
          await updatePhaseFields(input.matterId, input.phaseName, {
            acceptedSubstantiveVersion: latestVersionNum,
          });
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "accepted");

          // Run formatting pass asynchronously
          triggerFormattingPass(input.matterId, input.phaseName, latestVersionNum).catch(err => {
            console.error("[FormattingPass] Error:", err);
          });

          return {
            success: true,
            nextState: "formatting" as const,
            message: "Content accepted. Applying firm formatting standards...",
          };
        } else {
          // Normal completion
          await updatePhaseFields(input.matterId, input.phaseName, {
            officialFinalVersion: latestVersionNum,
          });
          await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");
          return { success: true, nextState: "complete" as const };
        }
      }

      // Apply individual decisions
      if (input.decisions) {
        for (const d of input.decisions) {
          await updateFeedbackDecision(d.feedbackId, d.decision, d.attorneyNote);
        }
      }

      const hasAccepted = input.decisions?.some(d => d.decision === "accepted" || d.decision === "modified");

      if (hasAccepted) {
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");
        return { success: true, nextState: "complete" as const };
      } else {
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");
        return { success: true, nextState: "complete" as const };
      }
    }),

  // ── Approve Formatting (agreement only) ───────────────────────────
  approveFormatting: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "awaiting_format_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not awaiting formatting review" });
      }

      const latestVersionNum = await getLatestVersionNumber(input.matterId, input.phaseName);

      await updatePhaseFields(input.matterId, input.phaseName, {
        officialFinalVersion: latestVersionNum,
      });
      await updatePhaseWorkflowState(input.matterId, input.phaseName, "complete");

      return { success: true, workflowState: "complete" as const, officialFinalVersion: latestVersionNum };
    }),

  // ── Adjust Formatting (agreement only) ────────────────────────────
  adjustFormatting: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      notes: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "awaiting_format_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not awaiting formatting review" });
      }

      const substantiveVersion = phase.acceptedSubstantiveVersion;
      if (!substantiveVersion) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No accepted substantive version found" });
      }

      // Re-run formatting from LOCKED SUBSTANTIVE VERSION (not prior formatted output)
      await updatePhaseWorkflowState(input.matterId, input.phaseName, "formatting");

      triggerFormattingPass(input.matterId, input.phaseName, substantiveVersion, input.notes).catch(err => {
        console.error("[FormattingPass] Adjustment error:", err);
      });

      return { success: true, workflowState: "formatting" as const };
    }),

  // ── Waiting on Client ─────────────────────────────────────────────
  setWaitingOnClient: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });

      const phaseName = input.phaseName as PhaseName;
      const config = PHASE_CONFIG[phaseName];

      // Only available for document generation phases
      if (config.stage !== "document_generation") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Waiting on client is only available for document generation phases" });
      }

      // Phase must be completed
      if (phase.status !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase must be complete before marking as waiting on client" });
      }

      // For formatting pass phases, formatting must be approved (workflow_state must be complete)
      if (config.hasFormattingPass && phase.workflowState !== "complete") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Formatting must be approved before marking as waiting on client" });
      }

      await setPhaseStatus(input.matterId, input.phaseName, "waiting_on_client");
      return { success: true };
    }),

  clientResponded: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.status !== "waiting_on_client") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase is not waiting on client" });
      }

      await setPhaseStatus(input.matterId, input.phaseName, "completed");
      return { success: true };
    }),

  // ── Legacy: startDrafting (redirects to startPhase for backward compat)
  startDrafting: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      context: z.string().optional(),
      sourceContent: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Delegate to startPhase
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      if (phase.workflowState !== "idle" && phase.workflowState !== "regenerating") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot start drafting from state: ${phase.workflowState}` });
      }

      const phaseName = input.phaseName as PhaseName;
      const config = PHASE_CONFIG[phaseName];
      const activeMode = phase.activeWorkflowMode as WorkflowMode || config.defaultMode;

      // For modes that need model selection, go to model_selection
      if (activeMode === "single_model" || activeMode === "single_model_draft") {
        await updatePhaseWorkflowState(input.matterId, input.phaseName, "model_selection");
        return { success: true, versionNumber: 0, drafts: 0 };
      }

      // For competitive modes, run the draft
      return await startCompetitiveDraft(input.matterId, phaseName, input.sourceContent, input.context);
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

// ── Competitive Draft Helper ────────────────────────────────────────

async function startCompetitiveDraft(
  matterId: string,
  phaseName: PhaseName,
  sourceContent?: string,
  context?: string,
) {
  await updatePhaseWorkflowState(matterId, phaseName, "drafting");

  const prompt = PHASE_PROMPTS[phaseName];
  if (!prompt) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phase name" });

  // Fetch and extract uploaded files for this phase
  const uploads = await getUploadsByPhase(matterId, phaseName);
  const extractedSource = uploads.length > 0
    ? await buildSourceContentFromUploads(uploads as any, context)
    : undefined;
  const effectiveSource = extractedSource || sourceContent;
  const userPrompt = buildUserPrompt(phaseName, effectiveSource, context);

  try {
    const drafts = await runCompetitiveDraft(prompt.system, userPrompt, context);
    const versionNumber = (await getLatestVersionNumber(matterId, phaseName)) + 1;

    for (const draft of drafts) {
      await createVersion({
        matterId,
        phaseName,
        versionNumber,
        provider: draft.provider,
        content: draft.content || draft.error || "Draft generation failed",
        metadata: { providerLabel: draft.providerLabel, error: draft.error },
      });
    }

    await updatePhaseWorkflowState(matterId, phaseName, "awaiting_selection", {
      versionNumber,
      draftCount: drafts.length,
    });

    return { success: true, versionNumber, drafts: drafts.length };
  } catch (err: any) {
    await updatePhaseWorkflowState(matterId, phaseName, "idle");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
  }
}

// ── Formatting Pass Orchestration ───────────────────────────────────

async function triggerFormattingPass(
  matterId: string,
  phaseName: string,
  substantiveVersionNum: number,
  adjustmentNotes?: string,
) {
  try {
    // Transition to formatting
    await updatePhaseWorkflowState(matterId, phaseName, "formatting");

    // Always read from the LOCKED SUBSTANTIVE VERSION
    const substantiveVersion = await getVersionByNumber(matterId, phaseName, substantiveVersionNum);
    if (!substantiveVersion) {
      throw new Error(`Substantive version ${substantiveVersionNum} not found`);
    }

    // Run Claude formatting pass
    const result = await runFormattingPass(substantiveVersion.content, adjustmentNotes);

    // Save formatted output as new version with is_formatting_pass flag
    const newVersionNum = (await getLatestVersionNumber(matterId, phaseName)) + 1;
    await createVersion({
      matterId,
      phaseName,
      versionNumber: newVersionNum,
      provider: "claude",
      content: result.content,
      isSelected: 1,
      isFormattingPass: 1,
      metadata: {
        isFormattingPass: true,
        sourceSubstantiveVersion: substantiveVersionNum,
        flags: result.flags,
        adjustmentNotes: adjustmentNotes || null,
      },
    });

    // Transition to awaiting_format_review
    await updatePhaseWorkflowState(matterId, phaseName, "awaiting_format_review", {
      formattedVersionNumber: newVersionNum,
      substantiveVersionNumber: substantiveVersionNum,
      flags: result.flags,
    });
  } catch (err: any) {
    console.error("[FormattingPass] Failed:", err);
    // On failure, revert to accepted state so attorney can retry
    await updatePhaseWorkflowState(matterId, phaseName, "accepted");
  }
}

// ── Other Routers ───────────────────────────────────────────────────

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
      fileSize: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const suffix = nanoid(6);
      const fileKey = `matters/${input.matterId}/uploads/${suffix}-${input.fileName}`;
      const { url } = await storagePut(fileKey, buffer, input.contentType);
      const upload = await createUpload({
        matterId: input.matterId,
        phaseName: input.phaseName,
        fileName: input.fileName,
        fileUrl: url,
        contentType: input.contentType,
        fileSize: input.fileSize,
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
        label: PHASE_CONFIG[name].label,
        order: PHASE_CONFIG[name].order,
        stage: PHASE_CONFIG[name].stage,
        defaultMode: PHASE_CONFIG[name].defaultMode,
        escalatable: PHASE_CONFIG[name].escalatable,
        availableModes: PHASE_CONFIG[name].availableModes,
        hasFormattingPass: PHASE_CONFIG[name].hasFormattingPass,
        isOptional: PHASE_CONFIG[name].isOptional,
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
