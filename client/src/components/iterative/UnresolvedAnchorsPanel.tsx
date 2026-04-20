/**
 * UnresolvedAnchorsPanel.tsx
 *
 * Detail view for failed anchors per v2.3 §16.8.
 *
 * Accessed from the banner on `awaiting_attorney_review` when
 * `metadata.unresolvedAnchors` is non-empty.
 *
 * Shows each unresolved item with:
 *   - Source reviewer + excerpt
 *   - Attempted anchor (section reference, paragraph start, or manual sourceText)
 *   - Reason: "not found" / "multiple matches" / "ambiguous"
 *
 * Actions:
 *   - Accept partial result — dismiss and proceed with current version
 *   - Apply manually — open freeform revision with items pre-populated
 *   - Re-decide — return to evaluation or manual selection view
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { UnresolvedAnchor } from "@shared/schemas/versionMetadata";
import { cn } from "@/lib/utils";

export interface UnresolvedAnchorsPanelProps {
  /** List of anchors that could not be resolved during regeneration */
  unresolvedAnchors: UnresolvedAnchor[];
  /** Called when attorney chooses "Accept partial result" */
  onAcceptPartial: () => void;
  /** Called when attorney chooses "Apply manually" */
  onApplyManually: (items: UnresolvedAnchor[]) => void;
  /** Called when attorney chooses "Re-decide" */
  onReDecide: () => void;
  /** Whether action mutations are in flight */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const REASON_LABELS: Record<UnresolvedAnchor["reason"], string> = {
  not_found: "Not found",
  multiple_matches: "Multiple matches",
  ambiguous: "Ambiguous",
};

const REASON_VARIANT: Record<
  UnresolvedAnchor["reason"],
  "destructive" | "secondary" | "outline"
> = {
  not_found: "destructive",
  multiple_matches: "secondary",
  ambiguous: "outline",
};

function getAttemptedAnchorLabel(anchor: UnresolvedAnchor["attemptedAnchor"]): string {
  if ("sourceText" in anchor) {
    return `Selected text: "${anchor.sourceText.slice(0, 60)}${anchor.sourceText.length > 60 ? "…" : ""}"`;
  }
  return `${anchor.kind === "section_reference" ? "Section" : anchor.kind === "paragraph_start" ? "Paragraph" : "Exact match"}: ${anchor.value}`;
}

function UnresolvedAnchorItem({ item }: { item: UnresolvedAnchor }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border rounded-md p-3 space-y-2"
      data-testid="unresolved-anchor-item"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={REASON_VARIANT[item.reason]}
              className="text-xs"
              data-testid="unresolved-anchor-reason"
            >
              {REASON_LABELS[item.reason]}
            </Badge>
            {item.sourceFeedbackId !== null && (
              <span className="text-xs text-muted-foreground">
                Feedback #{item.sourceFeedbackId}
              </span>
            )}
          </div>
          <p
            className="text-sm mt-1 text-muted-foreground truncate"
            data-testid="unresolved-anchor-attempted"
          >
            {getAttemptedAnchorLabel(item.attemptedAnchor)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse" : "Expand"}
          data-testid="unresolved-anchor-expand-btn"
        >
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>
      </div>

      {expanded && (
        <div
          className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-1"
          data-testid="unresolved-anchor-excerpt"
        >
          <p className="font-medium text-foreground">Reviewer excerpt:</p>
          <p className="italic">"{item.sourceExcerpt}"</p>
        </div>
      )}
    </div>
  );
}

export default function UnresolvedAnchorsPanel({
  unresolvedAnchors,
  onAcceptPartial,
  onApplyManually,
  onReDecide,
  disabled = false,
  className,
}: UnresolvedAnchorsPanelProps) {
  const count = unresolvedAnchors.length;

  return (
    <Card
      className={cn("border-amber-500/50", className)}
      data-testid="unresolved-anchors-panel"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 text-amber-500 shrink-0"
            data-testid="unresolved-anchors-icon"
          />
          <CardTitle className="text-sm font-medium">
            {count} {count === 1 ? "change" : "changes"} could not be applied
          </CardTitle>
        </div>
        <CardDescription className="text-xs">
          The regenerator could not locate{" "}
          {count === 1 ? "this location" : "these locations"} in the draft.
          Review the items below and choose how to proceed.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div
          className="space-y-2"
          data-testid="unresolved-anchors-list"
        >
          {unresolvedAnchors.map((item, idx) => (
            <UnresolvedAnchorItem key={idx} item={item} />
          ))}
        </div>

        <div
          className="flex flex-wrap gap-2 pt-2 border-t"
          data-testid="unresolved-anchors-actions"
        >
          <Button
            variant="default"
            size="sm"
            onClick={onAcceptPartial}
            disabled={disabled}
            data-testid="unresolved-anchors-accept-btn"
          >
            Accept partial result
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onApplyManually(unresolvedAnchors)}
            disabled={disabled}
            data-testid="unresolved-anchors-apply-manually-btn"
          >
            Apply manually
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReDecide}
            disabled={disabled}
            data-testid="unresolved-anchors-re-decide-btn"
          >
            Re-decide
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
