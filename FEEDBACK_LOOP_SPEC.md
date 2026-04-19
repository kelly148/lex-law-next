# Three-Way Feedback Loop System: Complete Specification

**Project:** Lex Law Next  
**Feature:** Self-Improving Legal Draft Generation via Attorney + Model Feedback  
**Version:** 1.0  
**Date:** April 2026

---

## Executive Summary

This document describes a comprehensive feedback system that learns from three sources:

1. **Attorney Edits** — What attorneys manually change in drafts
2. **Model-to-Model Feedback** — What models critique in each other's work
3. **Model Selection** — Which model the attorney chooses

These three feedback streams are unified into a single learning system that continuously improves draft quality by:
- Identifying missing content and style issues
- Learning which models excel at different tasks
- Enhancing prompts based on real attorney behavior
- Optimizing model selection for each matter type
- Allowing attorneys to toggle between "Learning Mode" and "Base Mode" prompts

---

## System Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ Attorney starts phase (e.g., Engagement Letter)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Attorney selects Prompt Mode:                                        │
│   ○ Base Mode (original prompts, no learning)                        │
│   ○ Learning Mode (enhanced by feedback patterns)                    │
│                                                                      │
│ System generates 3 drafts (Claude, GPT-5.4, Gemini):                │
│   - If Learning Mode: use enhanced prompts                           │
│   - If Base Mode: use original prompts                               │
│                                                                      │
│ Each model reviews the other models' drafts:                         │
│   - Claude reviews GPT-5.4 and Gemini                                │
│   - GPT-5.4 reviews Claude and Gemini                                │
│   - Gemini reviews Claude and GPT-5.4                                │
│   - Each provides structured feedback (critiques + suggestions)      │
│                                                                      │
│ Attorney sees:                                                       │
│   - 3 drafts                                                         │
│   - Model feedback on each draft                                     │
│   - Severity indicators (high/medium/low)                            │
│                                                                      │
│ Attorney selects one draft                                           │
│                                                                      │
│ Attorney can apply model feedback:                                   │
│   - "Apply Claude's suggestion: Add HOA clause"                      │
│   - "Apply GPT-5.4's suggestion: Clarify fees"                       │
│   - "Ignore Gemini's suggestion: Too creative"                       │
│                                                                      │
│ Attorney makes additional manual edits                               │
│                                                                      │
│ Attorney saves final version                                         │
│                                                                      │
│ System captures all feedback:                                        │
│   ├─ Which model was selected                                        │
│   ├─ Which model feedback was accepted/rejected                      │
│   ├─ Attorney's manual edits                                         │
│   ├─ Quality rating (1-10)                                           │
│   └─ Attorney notes (optional)                                       │
│                                                                      │
│ System aggregates patterns:                                          │
│   ├─ Model performance (win rates, edit counts, quality)             │
│   ├─ Feedback accuracy (how often attorney accepts feedback)         │
│   ├─ Content patterns (what's missing, what's wrong)                 │
│   └─ Model-specific weaknesses                                       │
│                                                                      │
│ System regenerates enhanced prompts:                                 │
│   ├─ Inject learned patterns                                         │
│   ├─ Add model-specific guidance                                     │
│   ├─ Include attorney-approved templates                             │
│   └─ Prioritize high-performing models                               │
│                                                                      │
│ Next matter of same type gets better drafts                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Components

### 1. Prompt Mode Selection

#### Purpose
Allow attorneys to choose between:
- **Base Mode**: Original, hand-crafted prompts with no learning applied
- **Learning Mode**: Base prompts enhanced with patterns from feedback history

#### User Interface

**Location:** Phase idle screen (PhaseContent.tsx)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Engagement Letter - Ready to Start                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Additional Context / Attorney Notes (optional):                      │
│ [Textarea for context]                                               │
│                                                                      │
│ Prompt Mode:                                                         │
│ ○ Base Prompts (original instructions, no learning)                  │
│ ✓ Learning Mode (enhanced by 12 recent patterns)                    │
│                                                                      │
│ [Info] Learning Mode uses patterns from your previous edits to       │
│ improve drafts. Switch to Base Prompts to start fresh with original  │
│ instructions.                                                        │
│                                                                      │
│ [Start Phase]                                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Implementation Details

**Database Table: `workflow_config`**
```sql
CREATE TABLE workflow_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  matterId VARCHAR(255) NOT NULL,
  phaseName VARCHAR(255) NOT NULL,
  promptMode ENUM('base', 'learning') DEFAULT 'learning',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (matterId) REFERENCES matters(matterId) ON DELETE CASCADE,
  INDEX (matterId, phaseName)
);
```

**tRPC Procedure: `phase.startPhaseWithMode`**
```typescript
startPhaseWithMode: protectedProcedure
  .input(z.object({
    matterId: z.string(),
    phaseName: z.string(),
    promptMode: z.enum(["base", "learning"]),
    context: z.string().optional(),
    sourceContent: z.string().optional(),
    workflowModeOverride: z.enum(["single_model_draft", "competitive_select", "full_competitive"]).optional(),
  }))
  .mutation(async ({ input }) => {
    // Load base prompt from config
    const basePrompt = await getBasePrompt(input.phaseName);
    
    // If Learning Mode, enhance prompt with patterns
    let finalPrompt = basePrompt;
    if (input.promptMode === "learning") {
      const matter = await getMatterByMatterId(input.matterId);
      const patterns = await getFeedbackPatterns({
        matterType: matter.matterType,
        phase: input.phaseName,
        jurisdiction: matter.jurisdiction,
      });
      finalPrompt = injectPatternsIntoPrompt(basePrompt, patterns);
    }
    
    // Record which mode was used
    await recordPhaseStart({
      matterId: input.matterId,
      phaseName: input.phaseName,
      promptMode: input.promptMode,
    });
    
    // Continue with existing phase start logic
    // (generate drafts, etc.)
  })
```

---

### 2. Model-to-Model Feedback Generation

#### Purpose
Each model reviews the other models' drafts and provides structured feedback.

#### Feedback Types

**Structured Feedback Object:**
```typescript
{
  critiques: string[],        // List of issues found
  suggestions: string[],      // Specific suggestions
  severity: "high" | "medium" | "low",
  feedbackType: "compliance" | "clarity" | "completeness" | "style" | "accuracy",
  confidence: number,         // 0-1 confidence in the feedback
}
```

**Example:**
```json
{
  "critiques": [
    "Missing HOA disclosure clause required by Virginia law",
    "Billing frequency not specified"
  ],
  "suggestions": [
    "Add: 'Our firm will ensure compliance with Virginia Code § 55.1-2200 regarding HOA disclosure requirements.'",
    "Specify: 'Our fees are billed monthly in arrears.'"
  ],
  "severity": "high",
  "feedbackType": "compliance",
  "confidence": 0.95
}
```

#### Implementation Details

**Database Table: `model_feedback`**
```sql
CREATE TABLE model_feedback (
  id INT PRIMARY KEY AUTO_INCREMENT,
  matterId VARCHAR(255) NOT NULL,
  phaseName VARCHAR(255) NOT NULL,
  reviewingModel VARCHAR(50) NOT NULL,  -- claude, gpt54, gemini
  reviewedModel VARCHAR(50) NOT NULL,
  feedbackType VARCHAR(100) NOT NULL,
  critiques JSON NOT NULL,
  suggestions JSON NOT NULL,
  severity ENUM('high', 'medium', 'low') NOT NULL,
  confidence DECIMAL(3,2) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (matterId) REFERENCES matters(matterId) ON DELETE CASCADE,
  INDEX (matterId, phaseName, reviewingModel, reviewedModel)
);
```

**Database Table: `model_feedback_patterns`**
```sql
CREATE TABLE model_feedback_patterns (
  id INT PRIMARY KEY AUTO_INCREMENT,
  reviewingModel VARCHAR(50) NOT NULL,
  reviewedModel VARCHAR(50) NOT NULL,
  matterType VARCHAR(100) NOT NULL,
  phase VARCHAR(100) NOT NULL,
  jurisdiction VARCHAR(255) NOT NULL,
  feedbackType VARCHAR(100) NOT NULL,
  pattern VARCHAR(255) NOT NULL,
  frequency INT DEFAULT 0,
  accuracy DECIMAL(3,2) DEFAULT 0,  -- how often attorney accepts this feedback
  avgSeverity ENUM('high', 'medium', 'low'),
  avgConfidence DECIMAL(3,2),
  lastUpdated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (reviewingModel, reviewedModel, matterType, phase, jurisdiction, feedbackType, pattern),
  INDEX (matterType, phase, jurisdiction)
);
```

**tRPC Procedure: `phase.generateModelFeedback`**
```typescript
generateModelFeedback: protectedProcedure
  .input(z.object({
    matterId: z.string(),
    phaseName: z.string(),
    drafts: z.object({
      model: z.enum(["claude", "gpt54", "gemini"]),
      content: z.string(),
    }).array(),
  }))
  .mutation(async ({ input }) => {
    const matter = await getMatterByMatterId(input.matterId);
    const feedbackResults = [];

    // Each model reviews the other models' drafts
    for (const reviewer of input.drafts) {
      for (const reviewed of input.drafts) {
        if (reviewer.model === reviewed.model) continue;

        // Build context-aware system prompt
        const systemPrompt = `You are ${reviewer.model}, an AI legal assistant reviewing a ${input.phaseName} 
          draft written by ${reviewed.model} for a ${matter.matterType} matter in ${matter.jurisdiction}.
          
          Provide constructive, specific feedback on:
          1. Missing required clauses or information (legal compliance)
          2. Accuracy of legal statements
          3. Clarity and organization
          4. Tone and style appropriateness
          5. Completeness relative to the matter type and jurisdiction
          
          Be specific about what's missing or wrong, and suggest concrete improvements.
          Focus on substantive issues, not minor wording.`;

        // Call the reviewing model
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: `Review this ${input.phaseName} draft:\n\n${reviewed.content}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "model_feedback",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  critiques: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of specific issues found",
                  },
                  suggestions: {
                    type: "array",
                    items: { type: "string" },
                    description: "Specific suggestions for improvement",
                  },
                  severity: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description: "Overall severity of issues",
                  },
                  feedbackType: {
                    type: "string",
                    enum: ["compliance", "clarity", "completeness", "style", "accuracy"],
                    description: "Category of feedback",
                  },
                  confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                    description: "Confidence in this feedback (0-1)",
                  },
                },
                required: ["critiques", "suggestions", "severity", "feedbackType", "confidence"],
                additionalProperties: false,
              },
            },
          },
        });

        // Parse response
        const feedbackData = JSON.parse(response.choices[0].message.content);

        // Store feedback
        await db.insert(modelFeedback).values({
          matterId: input.matterId,
          phaseName: input.phaseName,
          reviewingModel: reviewer.model,
          reviewedModel: reviewed.model,
          feedbackType: feedbackData.feedbackType,
          critiques: JSON.stringify(feedbackData.critiques),
          suggestions: JSON.stringify(feedbackData.suggestions),
          severity: feedbackData.severity,
          confidence: feedbackData.confidence,
        });

        feedbackResults.push({
          reviewer: reviewer.model,
          reviewed: reviewed.model,
          feedback: feedbackData,
        });
      }
    }

    return feedbackResults;
  })
```

---

### 3. Attorney Feedback Application UI

#### Purpose
Show model feedback to attorney and allow them to apply or ignore suggestions.

#### User Interface

**Draft Review Screen (after generation, before selection):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Engagement Letter - Review Drafts                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ DRAFT 1: Claude (Recommended) ⭐                                     │
│ ────────────────────────────────────────────────────────────────    │
│ [Draft content - scrollable]                                         │
│                                                                      │
│ Feedback from other models:                                          │
│ • GPT-5.4: "Good structure, add more detail on fees" (medium)       │
│   [Apply] [Ignore]                                                   │
│ • Gemini: "Could be more creative in language" (low)                │
│   [Apply] [Ignore]                                                   │
│                                                                      │
│ [Select This Draft] [Compare Drafts]                                 │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ DRAFT 2: GPT-5.4                                                     │
│ ────────────────────────────────────────────────────────────────    │
│ [Draft content - scrollable]                                         │
│                                                                      │
│ Feedback from other models:                                          │
│ • Claude: "Missing HOA disclosure clause" ⚠️ HIGH PRIORITY          │
│   Severity: High | Confidence: 95%                                   │
│   Suggestion: "Add: 'Our firm will ensure compliance with Virginia   │
│   Code § 55.1-2200 regarding HOA disclosure requirements.'"          │
│   [Apply] [Ignore]                                                   │
│ • Gemini: "Too verbose in places" (medium)                           │
│   [Apply] [Ignore]                                                   │
│                                                                      │
│ [Select This Draft] [Compare Drafts]                                 │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ DRAFT 3: Gemini                                                      │
│ ────────────────────────────────────────────────────────────────    │
│ [Draft content - scrollable]                                         │
│                                                                      │
│ Feedback from other models:                                          │
│ • Claude: "Missing HOA disclosure clause" ⚠️ HIGH PRIORITY          │
│   [Apply] [Ignore]                                                   │
│ • GPT-5.4: "Missing compliance details" ⚠️ HIGH PRIORITY            │
│   [Apply] [Ignore]                                                   │
│                                                                      │
│ [Select This Draft] [Compare Drafts]                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**After Attorney Selects Draft:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Engagement Letter - Edit Selected Draft                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Selected: Claude                                                     │
│                                                                      │
│ Applied Model Feedback:                                              │
│ ✓ Claude's suggestion: "Add HOA disclosure clause"                  │
│ ✓ GPT-5.4's suggestion: "Clarify fee structure"                     │
│ ✗ Gemini's suggestion: "Make language more creative" (rejected)     │
│                                                                      │
│ [Draft content with applied suggestions highlighted]                │
│                                                                      │
│ Your Additional Edits:                                               │
│ • Changed: "Our fees are $X" → "Our fees are $X, billed monthly"   │
│ • Added: Specific timeline for deliverables                         │
│ • Removed: Overly technical section on discovery                    │
│                                                                      │
│ Quality Rating: [1 ★ 2 ★ 3 ★ 4 ★ 5 ★ 6 ★ 7 ★ 8 ★ 9 ★ 10 ★]      │
│                                                                      │
│ Additional Notes (optional):                                         │
│ [Textarea]                                                           │
│                                                                      │
│ [Save & Learn] [Discard]                                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Implementation Details

**Frontend Component: `ModelFeedbackPanel.tsx`**
```typescript
interface ModelFeedback {
  reviewingModel: string;
  feedbackType: string;
  critiques: string[];
  suggestions: string[];
  severity: "high" | "medium" | "low";
  confidence: number;
}

interface DraftWithFeedback {
  model: string;
  content: string;
  feedback: ModelFeedback[];
}

export function ModelFeedbackPanel({ draft }: { draft: DraftWithFeedback }) {
  const [appliedFeedback, setAppliedFeedback] = useState<Set<string>>(new Set());

  const toggleFeedback = (feedbackId: string) => {
    const newSet = new Set(appliedFeedback);
    if (newSet.has(feedbackId)) {
      newSet.delete(feedbackId);
    } else {
      newSet.add(feedbackId);
    }
    setAppliedFeedback(newSet);
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Feedback from other models:</h3>
      {draft.feedback.map((fb, idx) => (
        <div key={idx} className={`border rounded-lg p-3 ${
          fb.severity === "high" ? "border-red-300 bg-red-50" :
          fb.severity === "medium" ? "border-yellow-300 bg-yellow-50" :
          "border-blue-300 bg-blue-50"
        }`}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <span className="font-medium">{fb.reviewingModel}</span>
              <span className="text-xs text-muted-foreground ml-2">
                Severity: {fb.severity} | Confidence: {(fb.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <button
              onClick={() => toggleFeedback(`${idx}`)}
              className={`px-2 py-1 rounded text-sm ${
                appliedFeedback.has(`${idx}`)
                  ? "bg-green-600 text-white"
                  : "bg-gray-200 text-gray-700"
              }`}
            >
              {appliedFeedback.has(`${idx}`) ? "Applied" : "Apply"}
            </button>
          </div>
          <div className="space-y-1">
            {fb.critiques.map((c, i) => (
              <p key={i} className="text-sm">• {c}</p>
            ))}
          </div>
          {fb.suggestions.length > 0 && (
            <div className="mt-2 pt-2 border-t">
              <p className="text-xs font-semibold mb-1">Suggestions:</p>
              {fb.suggestions.map((s, i) => (
                <p key={i} className="text-sm text-gray-700">• {s}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

### 4. Unified Feedback Capture

#### Purpose
Record all three feedback streams (model selection, model feedback acceptance, attorney edits) in a unified way.

#### Implementation Details

**Database Table: `feedback_capture`**
```sql
CREATE TABLE feedback_capture (
  id INT PRIMARY KEY AUTO_INCREMENT,
  matterId VARCHAR(255) NOT NULL,
  phaseName VARCHAR(255) NOT NULL,
  selectedModel VARCHAR(50) NOT NULL,
  promptMode ENUM('base', 'learning') NOT NULL,
  qualityRating INT NOT NULL,  -- 1-10
  attorneyNotes TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (matterId) REFERENCES matters(matterId) ON DELETE CASCADE,
  INDEX (matterId, phaseName, selectedModel)
);
```

**Database Table: `feedback_acceptance`**
```sql
CREATE TABLE feedback_acceptance (
  id INT PRIMARY KEY AUTO_INCREMENT,
  feedbackCaptureId INT NOT NULL,
  modelFeedbackId INT NOT NULL,
  reviewingModel VARCHAR(50) NOT NULL,
  feedbackType VARCHAR(100) NOT NULL,
  suggestion TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feedbackCaptureId) REFERENCES feedback_capture(id) ON DELETE CASCADE,
  FOREIGN KEY (modelFeedbackId) REFERENCES model_feedback(id) ON DELETE CASCADE,
  INDEX (feedbackCaptureId, accepted)
);
```

**Database Table: `attorney_edits`**
```sql
CREATE TABLE attorney_edits (
  id INT PRIMARY KEY AUTO_INCREMENT,
  feedbackCaptureId INT NOT NULL,
  editType ENUM('addition', 'deletion', 'rewrite') NOT NULL,
  originalText TEXT,
  revisedText TEXT,
  editTag VARCHAR(100),  -- missing_clause, too_formal, too_verbose, accuracy, style, other
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feedbackCaptureId) REFERENCES feedback_capture(id) ON DELETE CASCADE,
  INDEX (feedbackCaptureId, editTag)
);
```

**tRPC Procedure: `phase.recordCompleteFeedback`**
```typescript
recordCompleteFeedback: protectedProcedure
  .input(z.object({
    matterId: z.string(),
    phaseName: z.string(),
    selectedModel: z.enum(["claude", "gpt54", "gemini"]),
    promptMode: z.enum(["base", "learning"]),
    appliedModelFeedback: z.object({
      modelFeedbackId: z.number(),
      reviewingModel: z.string(),
      suggestion: z.string(),
      accepted: z.boolean(),
    }).array(),
    attorneyEdits: z.object({
      editType: z.enum(["addition", "deletion", "rewrite"]),
      originalText: z.string().optional(),
      revisedText: z.string().optional(),
      editTag: z.enum(["missing_clause", "too_formal", "too_verbose", "accuracy", "style", "other"]),
    }).array(),
    qualityRating: z.number().min(1).max(10),
    attorneyNotes: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const matter = await getMatterByMatterId(input.matterId);

    // Record main feedback capture
    const feedbackCapture = await db.insert(feedbackCapture).values({
      matterId: input.matterId,
      phaseName: input.phaseName,
      selectedModel: input.selectedModel,
      promptMode: input.promptMode,
      qualityRating: input.qualityRating,
      attorneyNotes: input.attorneyNotes,
    });

    // Record which model feedback was accepted
    for (const feedback of input.appliedModelFeedback) {
      await db.insert(feedbackAcceptance).values({
        feedbackCaptureId: feedbackCapture.insertId,
        modelFeedbackId: feedback.modelFeedbackId,
        reviewingModel: feedback.reviewingModel,
        feedbackType: "user_applied",  // Mark as attorney-applied
        suggestion: feedback.suggestion,
        accepted: feedback.accepted,
      });

      // Update model feedback pattern accuracy
      if (feedback.accepted) {
        await updateFeedbackPatternAccuracy({
          reviewingModel: feedback.reviewingModel,
          matterType: matter.matterType,
          phase: input.phaseName,
          jurisdiction: matter.jurisdiction,
          feedbackType: "compliance",  // TODO: get from feedback
          increment: true,
        });
      }
    }

    // Record attorney's own edits
    for (const edit of input.attorneyEdits) {
      await db.insert(attorneyEdits).values({
        feedbackCaptureId: feedbackCapture.insertId,
        editType: edit.editType,
        originalText: edit.originalText,
        revisedText: edit.revisedText,
        editTag: edit.editTag,
      });
    }

    // Aggregate all feedback sources
    await updateUnifiedPatterns({
      matterType: matter.matterType,
      phase: input.phaseName,
      jurisdiction: matter.jurisdiction,
      sources: ["model_feedback", "attorney_acceptance", "attorney_edits", "model_selection"],
    });

    // Regenerate enhanced prompts if patterns changed significantly
    await regenerateEnhancedPrompts({
      matterType: matter.matterType,
      phase: input.phaseName,
      jurisdiction: matter.jurisdiction,
    });

    return { success: true, feedbackCaptureId: feedbackCapture.insertId };
  })
```

---

### 5. Pattern Aggregation & Analysis

#### Purpose
Aggregate feedback from all three sources into unified patterns that inform prompt enhancement.

#### Pattern Types

**1. Content Patterns (from attorney edits)**
```typescript
interface ContentPattern {
  pattern: string;  // "missing_HOA_clause", "too_verbose", "needs_billing_clarity"
  frequency: number;  // how many times this pattern appeared
  severity: "high" | "medium" | "low";
  source: "attorney_edit" | "model_feedback";
  examples: string[];  // actual examples from edits
}
```

**2. Model Performance Patterns (from model selection)**
```typescript
interface ModelPerformancePattern {
  model: string;  // "claude", "gpt54", "gemini"
  winRate: number;  // percentage selected
  avgEditsNeeded: number;
  avgQualityScore: number;
  strengths: string[];
  weaknesses: string[];
}
```

**3. Model Feedback Accuracy Patterns (from feedback acceptance)**
```typescript
interface FeedbackAccuracyPattern {
  reviewingModel: string;  // "claude"
  reviewedModel: string;  // "gpt54"
  feedbackType: string;  // "compliance", "clarity", etc.
  acceptanceRate: number;  // how often attorney accepts this feedback
  frequency: number;  // how many times this feedback was given
  reliability: number;  // 0-1 score of how reliable this feedback is
}
```

#### Implementation Details

**Database Table: `unified_patterns`**
```sql
CREATE TABLE unified_patterns (
  id INT PRIMARY KEY AUTO_INCREMENT,
  matterType VARCHAR(100) NOT NULL,
  phase VARCHAR(100) NOT NULL,
  jurisdiction VARCHAR(255) NOT NULL,
  patternType VARCHAR(100) NOT NULL,  -- content, model_performance, feedback_accuracy
  pattern VARCHAR(255) NOT NULL,
  frequency INT DEFAULT 0,
  reliability DECIMAL(3,2) DEFAULT 0,  -- 0-1 confidence
  sources JSON NOT NULL,  -- which feedback sources contributed to this pattern
  lastUpdated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (matterType, phase, jurisdiction, patternType, pattern),
  INDEX (matterType, phase, jurisdiction)
);
```

**tRPC Procedure: `analysis.getUnifiedPatterns`**
```typescript
getUnifiedPatterns: protectedProcedure
  .input(z.object({
    matterType: z.string(),
    phase: z.string(),
    jurisdiction: z.string(),
  }))
  .query(async ({ input }) => {
    // Get all patterns for this matter type/phase/jurisdiction
    const patterns = await db.query.unifiedPatterns.findMany({
      where: and(
        eq(unifiedPatterns.matterType, input.matterType),
        eq(unifiedPatterns.phase, input.phase),
        eq(unifiedPatterns.jurisdiction, input.jurisdiction),
      ),
      orderBy: desc(unifiedPatterns.frequency),
    });

    // Organize by type
    const contentPatterns = patterns.filter(p => p.patternType === "content");
    const modelPerformance = patterns.filter(p => p.patternType === "model_performance");
    const feedbackAccuracy = patterns.filter(p => p.patternType === "feedback_accuracy");

    return {
      contentPatterns,
      modelPerformance,
      feedbackAccuracy,
      summary: {
        totalMatters: patterns.reduce((sum, p) => sum + p.frequency, 0),
        topIssues: contentPatterns.slice(0, 5),
        bestModel: modelPerformance.sort((a, b) => b.reliability - a.reliability)[0],
        mostReliableFeedback: feedbackAccuracy.sort((a, b) => b.reliability - a.reliability)[0],
      },
    };
  })
```

---

### 6. Enhanced Prompt Injection

#### Purpose
Dynamically enhance base prompts with learned patterns from all three feedback sources.

#### Prompt Structure

**Base Prompt (static):**
```
Generate an [PHASE_TYPE] for a [MATTER_TYPE] transaction in [JURISDICTION].

Include:
- [Standard section 1]
- [Standard section 2]
- [Standard section 3]

Use clear, professional language appropriate for [CLIENT_TYPE].
```

**Learning Prompt (dynamic, injected patterns):**
```
Generate an [PHASE_TYPE] for a [MATTER_TYPE] transaction in [JURISDICTION].

Include:
- [Standard section 1]
- [Standard section 2]
- [Standard section 3]

LEARNED PATTERNS (from attorney feedback):
[INJECTED_CONTENT_PATTERNS]

MODEL-SPECIFIC GUIDANCE:
[INJECTED_MODEL_GUIDANCE]

TEMPLATES (from approved attorney versions):
[INJECTED_TEMPLATES]

VALIDATION REQUIREMENTS:
[INJECTED_VALIDATION_RULES]

Use clear, professional language appropriate for [CLIENT_TYPE].
```

#### Implementation Details

**Function: `injectPatternsIntoPrompt`**
```typescript
async function injectPatternsIntoPrompt(
  basePrompt: string,
  patterns: UnifiedPatterns,
  model: string,
): Promise<string> {
  let enhancedPrompt = basePrompt;

  // 1. Inject content patterns
  if (patterns.contentPatterns.length > 0) {
    const contentInjection = buildContentInjection(patterns.contentPatterns);
    enhancedPrompt += `\n\nLEARNED PATTERNS (from attorney feedback):\n${contentInjection}`;
  }

  // 2. Inject model-specific guidance
  const modelGuidance = buildModelGuidance(patterns, model);
  if (modelGuidance) {
    enhancedPrompt += `\n\nMODEL-SPECIFIC GUIDANCE:\n${modelGuidance}`;
  }

  // 3. Inject templates
  const templates = await getApprovedTemplates(patterns);
  if (templates.length > 0) {
    const templateInjection = buildTemplateInjection(templates);
    enhancedPrompt += `\n\nTEMPLATES (from approved attorney versions):\n${templateInjection}`;
  }

  // 4. Inject validation rules
  const validationRules = buildValidationRules(patterns);
  if (validationRules) {
    enhancedPrompt += `\n\nVALIDATION REQUIREMENTS:\n${validationRules}`;
  }

  return enhancedPrompt;
}

function buildContentInjection(contentPatterns: ContentPattern[]): string {
  return contentPatterns
    .filter(p => p.frequency >= 3)  // Only inject high-frequency patterns
    .map(p => {
      if (p.severity === "high") {
        return `✓ CRITICAL: ${p.pattern} (appears in ${p.frequency} recent matters)`;
      } else if (p.severity === "medium") {
        return `• IMPORTANT: ${p.pattern} (appears in ${p.frequency} recent matters)`;
      } else {
        return `◦ Consider: ${p.pattern} (appears in ${p.frequency} recent matters)`;
      }
    })
    .join("\n");
}

function buildModelGuidance(patterns: UnifiedPatterns, model: string): string {
  const modelPerf = patterns.modelPerformance.find(p => p.pattern === model);
  if (!modelPerf) return "";

  let guidance = `You are ${model}.\n`;

  // If this model has high win rate, reinforce strengths
  if (modelPerf.reliability > 0.7) {
    guidance += `You excel at: ${modelPerf.sources.join(", ")}\n`;
    guidance += `Continue focusing on these strengths.\n`;
  }

  // If this model has low win rate, provide specific guidance
  if (modelPerf.reliability < 0.5) {
    const weaknesses = patterns.feedbackAccuracy
      .filter(p => p.pattern === model)
      .map(p => p.sources);
    if (weaknesses.length > 0) {
      guidance += `You have historically missed: ${weaknesses.join(", ")}\n`;
      guidance += `CRITICAL: Make sure to include these in your generation.\n`;
    }
  }

  return guidance;
}

function buildTemplateInjection(templates: ApprovedTemplate[]): string {
  return templates
    .map(t => `SECTION: ${t.section}\n${t.content}`)
    .join("\n\n---\n\n");
}

function buildValidationRules(patterns: UnifiedPatterns): string {
  const criticalPatterns = patterns.contentPatterns.filter(p => p.severity === "high");
  if (criticalPatterns.length === 0) return "";

  return `Before returning your draft, verify:\n${
    criticalPatterns
      .map(p => `- [ ] ${p.pattern}`)
      .join("\n")
  }`;
}
```

---

### 7. Dashboards & Insights

#### Purpose
Provide visibility into what's informing the system and how it's improving over time.

#### Dashboard 1: Feedback Sources

```
┌─────────────────────────────────────────────────────────────────────┐
│ Feedback Sources: What's Informing Your System?                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ VIRGINIA REAL ESTATE ENGAGEMENT LETTERS                              │
│                                                                      │
│ ATTORNEY EDITS (Direct manual changes):                              │
│ • Added HOA clause: 12 times                                         │
│ • Clarified billing frequency: 8 times                               │
│ • Removed verbose sections: 5 times                                  │
│ • Added scope limitations: 4 times                                   │
│                                                                      │
│ MODEL-TO-MODEL FEEDBACK (Peer review):                               │
│ • Claude → GPT-5.4/Gemini: "Missing HOA clause" (12 instances)      │
│   Accuracy: 95% (attorney accepted 11/12 times)                      │
│ • Claude → Others: "Missing compliance details" (8 instances)        │
│   Accuracy: 87%                                                      │
│ • GPT-5.4 → Gemini: "Too verbose" (6 instances)                      │
│   Accuracy: 60%                                                      │
│                                                                      │
│ MODEL SELECTION (Which model attorney chose):                        │
│ • Claude: 65% selected (avg 3 edits, 8.2/10 quality)                │
│ • GPT-5.4: 28% selected (avg 5 edits, 7.3/10 quality) ↑ improving   │
│ • Gemini: 10% selected (avg 9 edits, 5.3/10 quality)                │
│                                                                      │
│ UNIFIED SIGNAL:                                                      │
│ ✓ HOA clause is CRITICAL (3 sources agree)                           │
│ ✓ Claude is best at identifying it (high feedback accuracy)          │
│ ✓ GPT-5.4 is improving (feedback is helping)                         │
│ ✓ Gemini needs more help (low selection rate)                        │
│                                                                      │
│ IMPACT:                                                              │
│ • 40% reduction in editing time                                      │
│ • 15% improvement in quality scores                                  │
│ • 30% cost savings (skip low-performing models)                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Dashboard 2: Model Performance

```
┌─────────────────────────────────────────────────────────────────────┐
│ Model Performance: Which Models Excel?                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ REAL ESTATE ENGAGEMENT LETTERS (Virginia)                            │
│                                                                      │
│ Selection Rate:                                                      │
│ Claude:    ████████████████░░░░ 65%                                  │
│ GPT-5.4:   ███████░░░░░░░░░░░░░ 28%                                  │
│ Gemini:    ████░░░░░░░░░░░░░░░░ 10%                                  │
│                                                                      │
│ Average Edits Needed (lower is better):                              │
│ Claude:    ███ 3.0                                                   │
│ GPT-5.4:   █████ 5.3                                                 │
│ Gemini:    █████████ 9.1                                             │
│                                                                      │
│ Quality Score (1-10):                                                │
│ Claude:    ████████░░ 8.2                                            │
│ GPT-5.4:   ███████░░░ 7.3                                            │
│ Gemini:    █████░░░░░ 5.3                                            │
│                                                                      │
│ Feedback Accuracy (how often attorney accepts model feedback):       │
│ Claude:    ██████████ 95%                                            │
│ GPT-5.4:   ███████░░░ 70%                                            │
│ Gemini:    ████░░░░░░ 40%                                            │
│                                                                      │
│ Recommendation:                                                      │
│ • Prioritize Claude for this matter type                             │
│ • Enhance GPT-5.4 prompts (feedback accuracy improving)              │
│ • Consider skipping Gemini (low performance)                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Dashboard 3: Prompt Mode Comparison

```
┌─────────────────────────────────────────────────────────────────────┐
│ Learning Mode vs. Base Mode: Impact Analysis                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ REAL ESTATE ENGAGEMENT LETTERS (Virginia)                            │
│                                                                      │
│ Learning Mode (24 drafts):                                           │
│ • Avg edits needed: 3.2                                              │
│ • Avg quality: 8.1/10                                                │
│ • Time to finalize: 14 min                                           │
│ • Attorney satisfaction: 8.3/10                                      │
│                                                                      │
│ Base Mode (8 drafts):                                                │
│ • Avg edits needed: 5.1                                              │
│ • Avg quality: 7.2/10                                                │
│ • Time to finalize: 22 min                                           │
│ • Attorney satisfaction: 7.1/10                                      │
│                                                                      │
│ Improvement with Learning Mode:                                      │
│ • 37% fewer edits needed                                             │
│ • 13% better quality                                                 │
│ • 36% faster to finalize                                             │
│ • 17% higher satisfaction                                            │
│                                                                      │
│ Recommendation:                                                      │
│ Learning Mode is significantly better for this matter type.          │
│ Consider making it the default.                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Model Feedback Generation
**Duration:** 1-2 weeks  
**Deliverables:**
- `generateModelFeedback` tRPC procedure
- Model-to-model feedback generation (each model reviews others)
- Store feedback in `model_feedback` table
- Basic UI to display feedback on draft review screen

**Success Criteria:**
- Models generate structured feedback for each other
- Feedback is stored and retrievable
- Attorney can see feedback in UI

### Phase 2: Attorney Feedback Application
**Duration:** 1 week  
**Deliverables:**
- UI to apply/ignore model suggestions
- Track which suggestions attorney accepts
- Store acceptance data in `feedback_acceptance` table
- Show applied feedback summary after draft selection

**Success Criteria:**
- Attorney can apply model feedback
- System tracks acceptance/rejection
- Feedback application is visible in edit screen

### Phase 3: Unified Feedback Capture
**Duration:** 1 week  
**Deliverables:**
- `recordCompleteFeedback` tRPC procedure
- Capture model selection + feedback acceptance + attorney edits
- Store in unified tables
- Calculate feedback acceptance rates

**Success Criteria:**
- All three feedback streams are captured
- Data is stored in normalized tables
- Acceptance rates are calculated

### Phase 4: Pattern Aggregation & Analysis
**Duration:** 1-2 weeks  
**Deliverables:**
- Aggregate patterns from all three feedback sources
- Calculate model performance metrics
- Calculate feedback accuracy metrics
- Store in `unified_patterns` table
- `getUnifiedPatterns` query for analysis

**Success Criteria:**
- Patterns are aggregated correctly
- Metrics are calculated accurately
- Patterns can be queried by matter type/phase/jurisdiction

### Phase 5: Enhanced Prompt Injection
**Duration:** 1-2 weeks  
**Deliverables:**
- `injectPatternsIntoPrompt` function
- Dynamic prompt enhancement based on patterns
- Model-specific guidance injection
- Template injection
- Validation rule injection
- Regenerate prompts when patterns change

**Success Criteria:**
- Enhanced prompts are generated correctly
- Patterns are injected appropriately
- Models generate better drafts with enhanced prompts

### Phase 6: Dashboards & Insights
**Duration:** 1-2 weeks  
**Deliverables:**
- "Feedback Sources" dashboard
- "Model Performance" dashboard
- "Prompt Mode Comparison" dashboard
- Charts and visualizations
- Recommendations based on patterns

**Success Criteria:**
- Dashboards display accurate data
- Visualizations are clear and actionable
- Recommendations are helpful

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                    ATTORNEY FEEDBACK                                 │
│                    (manual edits)                                    │
│                          ▲                                           │
│                          │                                           │
│                          │                                           │
│        ┌─────────────────┼─────────────────┐                        │
│        │                 │                 │                        │
│        ▼                 ▼                 ▼                        │
│    CLAUDE            GPT-5.4             GEMINI                     │
│   (Draft A)          (Draft B)           (Draft C)                  │
│        │                 │                 │                        │
│        └─────────────────┼─────────────────┘                        │
│                          │                                           │
│              MODEL-TO-MODEL FEEDBACK                                 │
│         (peer review & critiques)                                    │
│                          │                                           │
│        ┌─────────────────┼─────────────────┐                        │
│        │                 │                 │                        │
│        ▼                 ▼                 ▼                        │
│    FEEDBACK A        FEEDBACK B        FEEDBACK C                   │
│  (Claude reviews)  (GPT-5.4 reviews)  (Gemini reviews)              │
│        │                 │                 │                        │
│        └─────────────────┼─────────────────┘                        │
│                          │                                           │
│                          ▼                                           │
│                  ATTORNEY REVIEWS                                    │
│            (selects draft + applies feedback)                        │
│                          │                                           │
│        ┌─────────────────┼─────────────────┐                        │
│        │                 │                 │                        │
│        ▼                 ▼                 ▼                        │
│   MODEL SELECTION  FEEDBACK ACCEPT    ATTORNEY EDITS                │
│   (which model)    (which feedback)    (manual changes)              │
│        │                 │                 │                        │
│        └─────────────────┼─────────────────┘                        │
│                          │                                           │
│                          ▼                                           │
│                  UNIFIED PATTERNS                                    │
│            (aggregate all feedback)                                  │
│                          │                                           │
│        ┌─────────────────┼─────────────────┐                        │
│        │                 │                 │                        │
│        ▼                 ▼                 ▼                        │
│  CONTENT PATTERNS  MODEL PERFORMANCE  FEEDBACK ACCURACY              │
│  (what's missing)  (which models win) (which feedback works)         │
│        │                 │                 │                        │
│        └─────────────────┼─────────────────┘                        │
│                          │                                           │
│                          ▼                                           │
│              ENHANCED PROMPTS                                        │
│         (informed by all feedback)                                   │
│                          │                                           │
│        ┌─────────────────┼─────────────────┐                        │
│        │                 │                 │                        │
│        ▼                 ▼                 ▼                        │
│    CLAUDE            GPT-5.4             GEMINI                     │
│  (Better Draft)    (Better Draft)     (Better Draft)                │
│                                                                      │
│                    LOOP CONTINUES...                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Prompt Mode Toggle (Base vs. Learning)
**Rationale:** Attorneys need the ability to revert to original prompts if learning introduces bias or if they want to start fresh with a new matter type.

**Implementation:** Simple radio button on phase start screen. System records which mode was used for analysis.

### 2. Model-to-Model Feedback
**Rationale:** Models are good at identifying issues in other models' work. This creates a peer review system that's more reliable than attorney feedback alone.

**Implementation:** Each model reviews others' drafts using structured JSON schema. Feedback is stored separately from attorney feedback so we can track accuracy.

### 3. Unified Pattern Aggregation
**Rationale:** Patterns from all three feedback sources (attorney edits, model feedback, model selection) should inform the same prompts. This creates a multi-signal learning system.

**Implementation:** Single `unified_patterns` table that tracks which sources contributed to each pattern. Patterns are weighted by reliability (how often they're correct).

### 4. Feedback Accuracy Tracking
**Rationale:** Not all feedback is equally valuable. We need to track which feedback the attorney actually accepts so we can prioritize reliable feedback.

**Implementation:** `feedback_acceptance` table tracks acceptance rate for each feedback type from each model. Models with high acceptance rates get more weight in prompt injection.

### 5. Incremental Prompt Enhancement
**Rationale:** We don't want to overwhelm prompts with too much information. Only inject high-frequency, high-reliability patterns.

**Implementation:** Patterns must appear at least 3 times and have >70% reliability to be injected. This prevents noise from affecting prompt quality.

---

## Metrics & Success Criteria

### Phase 1-2 Metrics
- Number of model feedback items generated per draft
- Percentage of feedback attorney applies
- Distribution of feedback types (compliance, clarity, etc.)

### Phase 3 Metrics
- Feedback capture rate (% of phases that record feedback)
- Data quality (completeness of feedback records)
- Feedback sources represented (model selection, model feedback, attorney edits)

### Phase 4 Metrics
- Number of unique patterns identified
- Pattern frequency distribution
- Feedback accuracy rates by model

### Phase 5 Metrics
- Prompt injection rate (% of prompts enhanced)
- Average number of injections per prompt
- Model performance improvement after enhancement

### Phase 6 Metrics
- Dashboard usage (how often attorneys view insights)
- Actionability of recommendations
- Adoption of suggested improvements

### Overall Success Metrics
- **Editing time reduction:** Target 30-40% fewer edits per draft
- **Quality improvement:** Target 15-20% increase in quality scores
- **Cost savings:** Target 20-30% reduction in API costs (skip low-performing models)
- **Model performance:** Target 10-15% improvement in win rates for underperforming models
- **Attorney satisfaction:** Target 8+/10 satisfaction with Learning Mode

---

## Risk Mitigation

### Risk 1: Learning Introduces Bias
**Mitigation:** Prompt Mode toggle allows attorneys to revert to Base Mode. Dashboard shows comparison between modes.

### Risk 2: Model Feedback Is Unreliable
**Mitigation:** Track feedback accuracy. Only inject high-accuracy feedback. Attorney can ignore suggestions.

### Risk 3: Patterns Are Too Specific
**Mitigation:** Only inject high-frequency patterns (3+ occurrences). Use matter type + phase + jurisdiction as grouping.

### Risk 4: System Becomes Overfit to Early Data
**Mitigation:** Patterns are recalculated regularly. Old data is weighted less. Manual override available.

### Risk 5: Prompt Injection Becomes Too Complex
**Mitigation:** Start with simple injections (content patterns). Add complexity gradually. Monitor prompt length.

---

## Future Enhancements

### Short Term (1-2 months)
- A/B testing framework (compare Learning vs. Base mode systematically)
- Feedback export (CSV/JSON for external analysis)
- Custom pattern creation (attorneys can define their own patterns)

### Medium Term (3-6 months)
- Fine-tuning integration (use approved attorney versions to fine-tune models)
- Feedback templates (pre-built feedback for common issues)
- Cross-matter-type learning (patterns from real estate inform corporate, etc.)

### Long Term (6+ months)
- Custom model training (train a firm-specific model on approved versions)
- Automated validation (system flags drafts that don't meet requirements before showing to attorney)
- Predictive quality scoring (estimate quality before attorney reviews)

---

## Conclusion

This three-way feedback loop creates a **self-improving legal draft generation system** that learns from:
1. **Attorney behavior** (what they manually change)
2. **Model peer review** (what models critique in each other)
3. **Model selection** (which models attorneys prefer)

Together, these three feedback sources create a powerful learning signal that continuously improves draft quality, reduces editing time, and optimizes model selection.

The system is designed with **safety guardrails** (Base Mode toggle, feedback accuracy tracking, incremental enhancement) to ensure attorneys maintain control and can revert to original prompts if needed.

Implementation is phased, starting with feedback generation and ending with dashboards and insights. Each phase is independent and can be deployed separately.

---

## Appendix: Example Scenarios

### Scenario 1: Virginia Real Estate Engagement Letter

**Week 1:**
```
Matter 1: Kinsey Property Purchase
- Attorney selects: Claude
- Attorney edits: adds HOA clause, clarifies billing
- Model feedback: Claude correctly identified missing HOA in GPT-5.4 and Gemini
- System learns: HOA clause is critical for Virginia real estate
```

**Week 2:**
```
Matter 2: Smith Property Purchase
- Attorney selects: Claude (again)
- Attorney edits: minimal (HOA clause already there)
- Model feedback: Claude again identifies missing HOA in competitors
- System learns: Pattern is consistent, Claude is reliable
```

**Week 3:**
```
Matter 3: Jones Property Purchase
- Enhanced prompt for GPT-5.4: "CRITICAL: Include HOA clause"
- GPT-5.4 now includes HOA clause (improved!)
- Attorney selects: Claude (still preferred, but GPT-5.4 is closer)
- System learns: Enhanced prompts are working
```

**Result after 3 weeks:**
- HOA clause appears in 100% of drafts (was 33%)
- Editing time down 40%
- GPT-5.4 win rate improved from 25% to 28%
- Attorney satisfaction up from 7.2/10 to 8.1/10

### Scenario 2: Corporate Engagement Letter

**Week 1:**
```
Matter 1: Tech Startup Engagement
- Attorney selects: GPT-5.4 (more detailed)
- Attorney edits: adds IP ownership clause, removes overly formal language
- Model feedback: GPT-5.4 criticized Claude for "too conservative"
- System learns: For corporate, detail is valued; formal language is not
```

**Week 2:**
```
Matter 2: SaaS Company Engagement
- Attorney selects: GPT-5.4 (again)
- Attorney edits: minimal changes
- Model feedback: GPT-5.4's feedback about formality was correct (attorney rejected formal language)
- System learns: GPT-5.4 is better for corporate; Claude's feedback about formality is unreliable
```

**Week 3:**
```
Matter 3: Fintech Company Engagement
- Enhanced prompt for Claude: "For corporate matters, use less formal language"
- Enhanced prompt for GPT-5.4: "You excel at detail in corporate matters; continue"
- Attorney selects: GPT-5.4 (still preferred, but Claude is closer)
- System learns: Model-specific guidance is working
```

**Result after 3 weeks:**
- GPT-5.4 win rate for corporate: 65% (was 40%)
- Claude win rate for corporate: 28% (was 20%, improving with guidance)
- Editing time down 30%
- Quality scores up 12%

---

**End of Specification**
