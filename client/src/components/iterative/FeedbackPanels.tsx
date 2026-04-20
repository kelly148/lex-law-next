/**
 * FeedbackPanels.tsx
 *
 * Two-panel reviewer feedback display per v2.3 §16.3 and §16.4.
 *
 * Two modes:
 *   - "view" (default): displays raw reviewer output with paragraph breaks.
 *     Panel headers show provider name + status. Two primary actions:
 *     "Get AI evaluation" and "Pick manually".
 *   - "select": paragraph hover highlight + click-to-select. Frontend captures
 *     ±100 chars context around each selection for positional disambiguation
 *     per §16.4 and §1.1 (R1.1).
 *
 * On narrow screens the two panels are shown as tabs.
 */

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";
import { BUTTON_LABELS } from "@shared/strings";
import type { ManualSelectionInput } from "@shared/schemas/manualSelection";
import { cn } from "@/lib/utils";

export interface FeedbackItem {
  id: number;
  reviewerProvider: string;
  /** Raw reviewer prose */
  content: string;
  /** Whether this reviewer's call failed */
  failed?: boolean;
  failureReason?: string;
}

export type FeedbackPanelsMode = "view" | "select";

export interface FeedbackPanelsProps {
  /** The two reviewer feedback items */
  feedbackItems: FeedbackItem[];
  /** "view" = read-only; "select" = paragraph selection mode */
  mode: FeedbackPanelsMode;
  /** Called when attorney clicks "Get AI evaluation" (view mode only) */
  onGetAiEvaluation?: () => void;
  /** Called when attorney clicks "Pick manually" (view mode only) */
  onPickManually?: () => void;
  /** Called when a paragraph is selected in select mode */
  onSelectionAdded?: (selection: ManualSelectionInput) => void;
  /** Called when a retry is requested for a failed reviewer */
  onRetry?: (feedbackId: number) => void;
  /** Whether action buttons are disabled (e.g. mutation in flight) */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  gpt: "GPT",
  gemini: "Gemini",
  grok: "Grok",
};

function providerLabel(key: string): string {
  return PROVIDER_LABELS[key] ?? key;
}

/**
 * Captures ±100 chars of context around the selected text within a paragraph.
 * Per §16.4 and §1.1 (R1.1): positional disambiguation for regeneration.
 */
function captureContext(
  fullText: string,
  selectedText: string,
): { precedingContext: string; followingContext: string } {
  const idx = fullText.indexOf(selectedText);
  if (idx === -1) {
    return { precedingContext: "", followingContext: "" };
  }
  const start = Math.max(0, idx - 100);
  const end = Math.min(fullText.length, idx + selectedText.length + 100);
  return {
    precedingContext: fullText.slice(start, idx),
    followingContext: fullText.slice(idx + selectedText.length, end),
  };
}

/**
 * Splits reviewer content into paragraphs for display.
 */
function splitParagraphs(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

interface ParagraphItemProps {
  text: string;
  feedbackId: number;
  selectionOrder: number;
  selectable: boolean;
  onSelect: (selection: ManualSelectionInput) => void;
}

function ParagraphItem({
  text,
  feedbackId,
  selectionOrder,
  selectable,
  onSelect,
}: ParagraphItemProps) {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(() => {
    if (!selectable) return;
    const { precedingContext, followingContext } = captureContext(text, text);
    onSelect({
      sourceFeedbackId: feedbackId,
      selectionOrder,
      selectionKind: "paragraph",
      sourceText: text,
      precedingContext,
      followingContext,
      editedText: null,
    });
  }, [selectable, text, feedbackId, selectionOrder, onSelect]);

  return (
    <p
      className={cn(
        "text-sm leading-relaxed py-1 px-2 rounded transition-colors",
        selectable && "cursor-pointer",
        selectable && hovered && "bg-primary/10",
      )}
      onMouseEnter={() => selectable && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      data-testid="feedback-paragraph"
    >
      {text}
    </p>
  );
}

interface ReviewerPanelProps {
  item: FeedbackItem;
  mode: FeedbackPanelsMode;
  onSelectionAdded?: (selection: ManualSelectionInput) => void;
  onRetry?: (feedbackId: number) => void;
  selectionCounter: number;
}

function ReviewerPanel({
  item,
  mode,
  onSelectionAdded,
  onRetry,
  selectionCounter,
}: ReviewerPanelProps) {
  const paragraphs = splitParagraphs(item.content);

  return (
    <div className="flex flex-col h-full" data-testid="reviewer-panel">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" data-testid="reviewer-panel-provider">
            {providerLabel(item.reviewerProvider)}
          </span>
          {item.failed && (
            <Badge variant="destructive" className="text-xs" data-testid="reviewer-panel-failed-badge">
              Failed
            </Badge>
          )}
          {mode === "select" && (
            <Badge variant="secondary" className="text-xs" data-testid="reviewer-panel-select-badge">
              Click to select
            </Badge>
          )}
        </div>
        {item.failed && onRetry && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => onRetry(item.id)}
            data-testid="reviewer-panel-retry-btn"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {item.failed ? (
            <p className="text-sm text-muted-foreground italic" data-testid="reviewer-panel-error">
              {item.failureReason ?? "Reviewer failed to produce output."}
            </p>
          ) : (
            paragraphs.map((para, idx) => (
              <ParagraphItem
                key={idx}
                text={para}
                feedbackId={item.id}
                selectionOrder={selectionCounter + idx}
                selectable={mode === "select"}
                onSelect={onSelectionAdded ?? (() => {})}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function FeedbackPanels({
  feedbackItems,
  mode,
  onGetAiEvaluation,
  onPickManually,
  onSelectionAdded,
  onRetry,
  disabled = false,
  className,
}: FeedbackPanelsProps) {
  const [selectionCounter, setSelectionCounter] = useState(0);

  const handleSelectionAdded = useCallback(
    (selection: ManualSelectionInput) => {
      setSelectionCounter((c) => c + 1);
      onSelectionAdded?.(selection);
    },
    [onSelectionAdded],
  );

  const [first, second] = feedbackItems;

  return (
    <div
      className={cn("flex flex-col gap-3", className)}
      data-testid="feedback-panels"
    >
      {/* Two panels — side by side on wide screens, tabs on narrow */}
      <div className="hidden md:grid md:grid-cols-2 gap-3 h-[400px]">
        {feedbackItems.map((item) => (
          <div key={item.id} className="border rounded-md overflow-hidden flex flex-col">
            <ReviewerPanel
              item={item}
              mode={mode}
              onSelectionAdded={handleSelectionAdded}
              onRetry={onRetry}
              selectionCounter={selectionCounter}
            />
          </div>
        ))}
      </div>

      {/* Tabs for narrow screens */}
      <div className="md:hidden">
        <Tabs defaultValue={first ? String(first.id) : "0"}>
          <TabsList className="w-full">
            {feedbackItems.map((item) => (
              <TabsTrigger
                key={item.id}
                value={String(item.id)}
                className="flex-1"
                data-testid={`feedback-tab-${item.reviewerProvider}`}
              >
                {providerLabel(item.reviewerProvider)}
                {item.failed && (
                  <Badge variant="destructive" className="ml-1 text-xs">!</Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {feedbackItems.map((item) => (
            <TabsContent
              key={item.id}
              value={String(item.id)}
              className="border rounded-md overflow-hidden h-[350px] flex flex-col mt-2"
            >
              <ReviewerPanel
                item={item}
                mode={mode}
                onSelectionAdded={handleSelectionAdded}
                onRetry={onRetry}
                selectionCounter={selectionCounter}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Action buttons — view mode only */}
      {mode === "view" && (
        <div
          className="flex flex-wrap gap-2"
          data-testid="feedback-panels-actions"
        >
          <Button
            variant="default"
            size="sm"
            onClick={onGetAiEvaluation}
            disabled={disabled}
            data-testid="feedback-panels-ai-eval-btn"
          >
            {BUTTON_LABELS.getAiEvaluation}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onPickManually}
            disabled={disabled}
            data-testid="feedback-panels-pick-manually-btn"
          >
            {BUTTON_LABELS.pickManually}
          </Button>
        </div>
      )}
    </div>
  );
}

// Re-export captureContext for testing
export { captureContext };
