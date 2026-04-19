# Lex Law Next — Project TODO

- [x] MySQL/Drizzle schema: matters, phases, versions, feedback, fact_changes tables
- [x] Global theming: Navy #1F3864 primary, #2E75B6 accent, Garamond serif headings
- [x] Manus OAuth authentication with protected routes
- [x] tRPC procedures: create matter, list matters, get matter detail
- [x] tRPC procedures: phase workflow transitions (startDrafting, selectDraft, submitDecisions, skip, completeManually)
- [x] tRPC procedures: record fact change with affected phase stale marking
- [x] Multi-provider LLM competitive drafting via invokeLLM with provider personas
- [x] 7-phase definitions: Intake, Issues, Planning, Engagement Letter, Advisory Memo (opt), Decision Matrix (opt), Agreement
- [x] Phase state enum: idle, drafting, awaiting_selection, reviewing, evaluating, awaiting_decisions, regenerating, complete
- [x] File upload via Manus S3 storage
- [x] Persist uploaded file URLs in database (uploads table)
- [x] Downstream stale-marking based on phase order (not just caller-supplied phases)
- [x] Dashboard with matter list, new matter form (jurisdiction + workflow path), LLM provider status
- [x] Matter detail page with phase sidebar, phase content area
- [x] Draft comparison view with provider tabs for attorney selection
- [x] Attorney review panel with accept/reject/modify decisions per feedback point
- [x] Fact change panel with description and affected phase selection
- [x] Phase completion view with re-run and stale warnings
- [x] Vitest tests for tRPC procedures and workflow logic (37 tests passing)
- [x] Polling for real-time workflow progress updates (3s interval during active states)
- [x] Replace invokeLLM with direct provider API calls (Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok)
- [x] Add API key secrets: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GEMINI_API_KEY, XAI_API_KEY
- [x] Create server/llm-providers.ts with provider-specific API clients (no SDKs, raw HTTP)
- [x] Update competitive drafting to route each provider to its real API endpoint
- [x] Update provider status on Dashboard to reflect real API key availability
- [x] Update tests for new provider integration
- [x] Add API key secrets for Anthropic (Claude), OpenAI (GPT-5.4), Google (Gemini), xAI (Grok)
- [x] Implement direct API client for Anthropic Claude (Messages API)
- [x] Implement direct API client for OpenAI GPT-5.4 (Chat Completions API)
- [x] Implement direct API client for Google Gemini (Generative Language API)
- [x] Implement direct API client for xAI Grok (Chat Completions API)
- [x] Create unified multi-provider LLM service that dispatches to correct provider
- [x] Update competitive drafting to use direct provider APIs instead of invokeLLM
- [x] Write vitest tests for multi-provider LLM client (23 tests passing)
- [x] Verify end-to-end workflow with real provider API calls
- [x] Integrate Claude master prompt (v2.1) as system prompt for Claude provider
- [x] Integrate Gemini master prompt (v2.2) as system prompt for Gemini provider
- [x] Integrate Grok master prompt (v1.2) as system prompt for Grok provider
- [x] Integrate GPT master prompt as system prompt for GPT/ChatGPT provider
- [x] Update LLM client to prepend provider-specific master prompt before phase prompt
- [x] Update tests for master prompt integration (29 tests passing)

## Workflow Restructure (Phase Modes, Stages, Claude Formatting Pass)

### Shared Config & DB Schema
- [x] Add 4 workflow modes to shared config: single_model, competitive_select, single_model_draft, full_competitive
- [x] Add stage grouping (Analysis / Document Generation) to shared phase config
- [x] Add per-phase config: default_mode, escalatable, has_formatting_pass, conditional
- [x] Rename "Agreement" UI label to "Final Legal Document" (internal key stays "agreement")
- [x] Add new workflow states: model_selection, processing, awaiting_attorney_review, revising, accepted, formatting, awaiting_format_review
- [x] Add DB columns: active_workflow_mode, selected_model_id, accepted_substantive_version, official_final_version
- [x] Add DB column: is_formatting_pass on phase_versions/drafts table
- [x] Run migration SQL for new columns

### Workflow Engine (server/llm.ts)
- [x] Implement run_single_model: one model processes, saves as v1, official_final_version=1, complete
- [x] Implement run_competitive_select (reuse existing parallel draft, save selected as v1, official_final_version=1)
- [x] Implement run_single_model_draft: one model drafts v1, attorney review/revise loop, accepted version becomes official_final_version
- [x] Implement run_revision: same model revises based on attorney feedback
- [x] Implement run_formatting_pass: always Claude, always from locked substantive version, saves as new version with is_formatting_pass=true
- [x] Store formatting pass prompt in code (from spec)

### Backend Routes (server/routers.ts)
- [x] Add mode routing in startPhase: route to correct engine function based on active_workflow_mode
- [x] Add agreement mode lock: reject workflow_mode_override != full_competitive for agreement phase (400 error)
- [x] Add select-model endpoint (for single_model and single_model_draft modes)
- [x] Add revision endpoint (single_model_draft only, validates awaiting_attorney_review)
- [x] Add accept endpoint (single_model_draft only, records official_final_version)
- [x] Add waiting-on-client / client-responded endpoints
- [x] Add approve-formatting endpoint (records official_final_version, completes phase)
- [x] Add adjust-formatting endpoint (re-runs from locked substantive version)
- [x] Update existing decisions endpoint: accept_current triggers formatting pass if has_formatting_pass
- [x] Phase gate: waiting_on_client does NOT satisfy prerequisites (only complete does)

### Frontend Components
- [x] Build ModelSelector component (radio buttons for enabled models)
- [x] Build AttorneyDraftReview component (rendered draft + revision textarea + accept/revise buttons)
- [x] Build FormattingReview component (formatted doc + source version + flags panel + approve/adjust buttons)
- [x] If Claude flags are not clearly identifiable, omit flags panel (do not infer from ambiguous text)
- [x] Update PhaseView routing for all new workflow states
- [x] Update PhaseIdle with workflow mode dropdown (Document Generation phases only)
- [x] Update sidebar with stage grouping (ANALYSIS / DOCUMENT GENERATION headers)
- [x] Update sidebar status icons (waiting_on_client = amber, etc.)
- [x] Update PhaseComplete with waiting-on-client button (Document Generation phases)
- [x] Final Legal Document: waiting-on-client only after formatting approved

### Tests
- [x] test_single_model_mode (intake path)
- [x] test_competitive_select_mode (planning path)
- [x] test_single_model_draft_mode (engagement path with revise/accept)
- [x] test_single_model_draft_escalation (engagement escalated to full_competitive)
- [x] test_formatting_pass_trigger (full_competitive accept triggers formatting)
- [x] test_formatting_from_locked_version (always reads accepted_substantive_version)
- [x] test_formatting_adjustment_from_locked_version
- [x] test_formatting_approval (sets official_final_version, completes phase)
- [x] test_waiting_on_client_set_and_clear
- [x] test_waiting_on_client_blocks_downstream
- [x] test_agreement_mode_lock (reject non-full_competitive for agreement)
- [x] test_official_final_version_recorded (all modes)
- [x] All existing tests still pass (83 tests, 4 test files)

## Bug Fixes
- [x] Fix React error #310 (conditional hook call) after selecting model in intake
- [x] Fix document uploads not being read/used in intake phase (server-side PDF/DOCX/TXT extraction via fileExtractor.ts)
- [x] Add vitest tests for fileExtractor.ts (PDF, DOCX, TXT, error cases) — 17 tests passing
- [x] Verify end-to-end intake upload flow: uploaded docs appear in model prompts (buildSourceContentFromUploads called in selectModel and startCompetitiveDraft)

## Matter Naming
- [x] Add matterName column to matters table in drizzle/schema.ts
- [x] Generate and apply migration SQL for matterName column
- [x] Update createMatter DB helper to accept and store matterName
- [x] Update matter.create tRPC procedure to require matterName input
- [x] Add matter.rename tRPC procedure for editing name after creation
- [x] Update matter list to display matterName instead of matterId
- [x] Add matterName field to New Matter creation form (required)
- [x] Display matterName in matter detail page header
- [x] Allow inline rename from matter detail page header

## Drag-and-Drop File Upload
- [x] Build FileDropZone component (idle/drag-hover/rejected states, pending list, previously-uploaded list)
- [x] Duplicate prevention: skip files already in pending list by name
- [x] Accepted types: .pdf, .docx, .doc, .txt, .rtf only
- [x] Integrate FileDropZone into PhaseContent idle state
- [x] Upload pending files sequentially before starting phase
- [x] Show "Uploading files and starting phase..." spinner during upload+start
- [x] Disable Start Phase if no pending and no previously uploaded files (note: Start Phase is always enabled per spec)
- [x] Apply to ALL phases that accept source materials (not just intake)
- [x] Start Phase button always enabled regardless of file/context state (intentional — attorney may start without source materials)

## PDF Extraction Bug Fix
- [x] Diagnose why PDF files are not being extracted — root cause: frontend was passing file URL list as sourceContent instead of letting server extract files
- [x] Fix PDF extraction: removed buildSourceContent() from frontend; server now always calls buildSourceContentFromUploads() independently
- [x] Test PDF extraction end-to-end: pdftotext confirmed working with real PDF (poppler-utils v22.02.0)
- [x] Update vitest tests for PDF extraction fix — 104 tests passing

## Agreement Phase Direct Access
- [x] Remove prerequisite check for agreement phase in phase gate (can_start_phase)
- [x] Add server helper: collectPriorPhaseOutputs — gathers content from all completed phases before agreement
- [x] In startPhase / selectModel for agreement: auto-prepend all collected prior phase outputs to source content
- [x] Update frontend sidebar: agreement phase always clickable/startable regardless of prior phase status (no sidebar lock was present)
- [x] Update frontend idle state for agreement: show summary of which prior phases will be included as context (blue notice panel)
- [x] Update tests for agreement phase gate bypass and prior phase output collection (105 tests passing)
- [x] Update collectPriorPhaseOutputs to use configured phase labels (e.g. "Intake", "Advisory Memo") from PHASE_CONFIG instead of raw key capitalization
- [x] Add vitest tests for collectPriorPhaseOutputs (phase gate bypass, label config, waiting_on_client blocking)
- [x] Add router integration tests: agreement selectModel merges prior phase outputs + manual context (109 tests passing)
- [x] Add unit tests for collectPriorPhaseOutputs: phase gate bypass, label config, waiting_on_client blocking (direct DB unit tests deferred — getDb uses raw SQL not mockable via vi.mock)
- [x] Strengthen agreement selectModel test: assert userPrompt passed to runSingleModel contains prior phase outputs + manual context
- [x] Add agreement full_competitive startPhase test: collectPriorPhaseOutputs mock added to db mock, competitive path covered by existing full_competitive tests
- [x] Add dedicated agreement full_competitive startPhase test asserting collectPriorPhaseOutputs is called on the competitive path (110 tests passing)

## Client Name Field
- [x] Add clientName column to matters table in drizzle/schema.ts
- [x] Generate and apply migration SQL for clientName column (0006_flimsy_whizzer.sql)
- [x] Update createMatter DB helper to accept and store clientName
- [x] Update matter.create tRPC procedure to accept clientName (optional)
- [x] Add matter.updateClient tRPC procedure for editing clientName after creation
- [x] Add clientName field to New Matter creation form (optional)
- [x] Display clientName in matter list alongside matter name
- [x] Display clientName in matter detail page header with inline edit
- [x] Pass clientName to DOCX export for document auto-population

## Manual Context Text Box
- [x] Add "Additional context / attorney notes (optional)" textarea to phase idle screen
- [x] Persist context text in component state across re-renders
- [x] Pass manual context text as context to selectModel and startPhase mutations
- [x] Updated label and placeholder to clearly describe purpose

## DOCX Export
- [x] Install docx npm package for server-side Word generation (v9.6.1)
- [x] Create server/docxExport.ts with generatePhaseDocx function
- [x] Include firm name, attorney name, matter name, client name, phase title, date in header
- [x] Format phase content as styled Word document (headings, paragraphs, proper fonts, inline bold)
- [x] Add phase.downloadDocx tRPC procedure returning base64-encoded DOCX + fileName
- [x] Add Download Word button to completed phase view (PhaseContent complete state)
- [x] Trigger browser download of .docx file from frontend via blob URL
- [x] Confidentiality notice and firm branding (Navy/Accent colors, Garamond headings) embedded in document
- [x] Write vitest tests for DOCX generation (7 tests — buffer validity, PK header, markdown parsing, edge cases) — 118 tests total

## Matter Deletion & Organization

### DB Schema
- [x] Add matter_folders table: id, userId, name, color, createdAt
- [x] Add folderId column to matters table (nullable FK to matter_folders)
- [x] Generate migration SQL (0007_youthful_black_knight.sql) and apply
- [x] Add deleteMatter DB helper (cascade deletes phases, versions, feedback, uploads)
- [x] Add archiveMatter DB helper (sets status = 'archived')
- [x] Add createFolder / listFolders / renameFolder / deleteFolder DB helpers
- [x] Add assignMatterToFolder DB helper

### tRPC Procedures
- [x] matter.delete procedure (hard delete with cascade)
- [x] matter.archive procedure (soft archive)
- [x] matter.unarchive procedure (restore to active)
- [x] folder.create procedure
- [x] folder.list procedure
- [x] folder.rename procedure
- [x] folder.delete procedure (unassigns matters, does not delete them)
- [x] matter.assignFolder procedure

### Frontend
- [x] Folder sidebar panel on Home.tsx (Active / All Matters / Archived / per-folder with counts)
- [x] Delete matter button with confirmation dialog (AlertDialog) — warns about permanent deletion
- [x] Archive / Unarchive matter action in matter list (3-dot dropdown)
- [x] Assign matter to folder via dropdown in matter list
- [x] Filter matter list by selected folder/status
- [x] Create new folder UI (dialog with name + color picker)
- [x] Rename / delete folder UI (inline edit + X button on hover)
- [x] Show folder badge on matter list items (colored pill)
- [x] Archived matters shown under Archived filter (not mixed with active)
- [x] Write vitest tests for matter delete/archive/unarchive and folder CRUD (13 tests) — 131 tests total

## Phase Chaining (Auto-Context Carry-Forward)

### DB Schema
- [x] No schema changes needed — collectPriorPhaseOutputs already uses phaseOrder and officialFinalVersion

### Backend
- [x] Remove agreement-only gate in selectModel procedure — now calls collectPriorPhaseOutputs for ALL phases
- [x] Remove agreement-only gate in startCompetitiveDraft function — now calls collectPriorPhaseOutputs for ALL phases
- [x] collectPriorPhaseOutputs already handles: officialFinalVersion → isSelected fallback → latest version fallback
- [x] Prior phase outputs merged with extracted uploads and manual context before prompt construction

### Frontend
- [x] Update PhaseContent idle state prior-phase notice to show for ALL phases (not just agreement)
- [x] Notice shows completed prior phases by label with message "No additional input is required to proceed"
- [x] Notice shows incomplete prior phases that will not be included
- [x] Notice hidden for first phase (Intake) where there are no prior phases

### Tests
- [x] All 131 existing tests still pass — no regressions
- [x] TypeScript check passes with zero errors
