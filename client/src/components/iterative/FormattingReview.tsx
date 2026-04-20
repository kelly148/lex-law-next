/**
 * FormattingReview.tsx (iterative)
 *
 * Formatting review view per v2.3 §16.6 (awaiting_format_review).
 *
 * Actions:
 *   - Approve formatting → officialFinalVersion set, complete
 *   - Reject: formatting only → rejectFormatting({ kind: 'format_only' }); counter increments
 *   - Reject: substantive change needed → rejectFormatting({ kind: 'substantive' }); returns to iteration
 * Escape hatch (always available as secondary; promoted to primary after 3 consecutive format-only rejections):
 *   - Accept without formatting → acceptSubstantiveUnformatted
 *
 * NOTE: This is the NEW iterative-workflow version.
 * The legacy FormattingReview at client/src/components/FormattingReview.tsx
 * remains for non-iterative phases and must NOT be modified.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle2, Flag, Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { BUTTON_LABELS } from "@shared/strings";
import { cn } from "@/lib/utils";

export interface FormattingReviewProps {
  /** Formatted document content */
  formattedContent: string;
  /** Formatted version number (for display) */
  formattedVersionNumber: number;
  /** Substantive document content (for side-by-side comparison) */
  substantiveContent?: string;
  /** Substantive version number (for display) */
  substantiveVersionNumber?: number;
  /** Number of consecutive format-only rejections (from iterativeMeta.formatRejectionCount) */
  formatRejectionCount: number;
  /** Flags identified by the formatter (e.g. placeholders, ambiguous references) */
  flags?: string[];
  /** Called when attorney approves formatting */
  onApproveFormatting: () => void;
  /** Called when attorney rejects formatting */
  onRejectFormatting: (kind: "format_only" | "substantive") => void;
  /** Called when attorney accepts the substantive version without formatting */
  onAcceptWithoutFormatting: () => void;
  /** Whether any action mutation is in flight */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * After 3 consecutive format-only rejections the escape hatch is promoted
 * to primary styling per §16.6.
 */
const ESCAPE_HATCH_PROMOTION_THRESHOLD = 3;

export default function IterativeFormattingReview({
  formattedContent,
  formattedVersionNumber,
  substantiveContent,
  substantiveVersionNumber,
  formatRejectionCount,
  flags = [],
  onApproveFormatting,
  onRejectFormatting,
  onAcceptWithoutFormatting,
  disabled = false,
  className,
}: FormattingReviewProps) {
  const escapeHatchPromoted =
    formatRejectionCount >= ESCAPE_HATCH_PROMOTION_THRESHOLD;
  const hasFlags = flags.length > 0;

  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-testid="iterative-formatting-review"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-medium">Formatting Review</h3>
          <p className="text-sm text-muted-foreground">
            Claude formatting pass applied — review the formatted document
          </p>
        </div>
        <Badge className="bg-amber-500 text-white" data-testid="formatting-review-badge">
          <Flag className="h-3 w-3 mr-1" />
          Formatting Review
        </Badge>
      </div>

      {/* Flags panel */}
      {hasFlags && (
        <Card
          className="border-amber-500/50"
          data-testid="formatting-review-flags"
        >
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              <CardTitle className="text-sm font-medium">
                Flagged items ({flags.length})
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              These items were flagged during the formatting pass. Review before finalizing.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <ul className="space-y-1.5" data-testid="formatting-review-flags-list">
              {flags.map((flag, i) => (
                <li
                  key={i}
                  className="text-sm text-amber-800 flex items-start gap-2"
                  data-testid="formatting-review-flag-item"
                >
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span>{flag}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Formatted document */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-sm font-medium">Formatted Document</h4>
          <Badge variant="outline" className="text-xs">
            v{formattedVersionNumber}
          </Badge>
        </div>
        <ScrollArea
          className="h-[400px] rounded-lg border p-4"
          data-testid="formatting-review-content"
        >
          <div className="prose prose-sm max-w-none">
            <Streamdown>{formattedContent}</Streamdown>
          </div>
        </ScrollArea>
      </div>

      {/* Substantive comparison (collapsible) */}
      {substantiveContent && (
        <details className="rounded-lg border p-3" data-testid="formatting-review-substantive">
          <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
            View source (Substantive v{substantiveVersionNumber})
          </summary>
          <ScrollArea className="h-[250px] mt-3 rounded-lg border p-3 bg-muted/20">
            <div className="prose prose-sm max-w-none opacity-80">
              <Streamdown>{substantiveContent}</Streamdown>
            </div>
          </ScrollArea>
        </details>
      )}

      <Separator />

      {/* Actions */}
      <div
        className="flex flex-wrap gap-2"
        data-testid="formatting-review-actions"
      >
        {/* Primary: Approve formatting */}
        <Button
          variant="default"
          size="sm"
          onClick={onApproveFormatting}
          disabled={disabled}
          data-testid="formatting-review-approve-btn"
        >
          <CheckCircle2 className="h-4 w-4 mr-1.5" />
          {BUTTON_LABELS.acceptAndFinalize}
        </Button>

        {/* Reject: formatting only */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRejectFormatting("format_only")}
          disabled={disabled}
          data-testid="formatting-review-reject-format-btn"
        >
          {BUTTON_LABELS.rejectFormatting}
        </Button>

        {/* Reject: substantive change needed */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRejectFormatting("substantive")}
          disabled={disabled}
          data-testid="formatting-review-reject-substantive-btn"
        >
          {BUTTON_LABELS.needsSubstantiveChange}
        </Button>

        {/* Escape hatch: Accept without formatting */}
        <Button
          variant={escapeHatchPromoted ? "default" : "ghost"}
          size="sm"
          onClick={onAcceptWithoutFormatting}
          disabled={disabled}
          className={cn(
            escapeHatchPromoted && "border border-primary",
          )}
          data-testid="formatting-review-accept-unformatted-btn"
        >
          {BUTTON_LABELS.acceptWithoutFormatting}
          {formatRejectionCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-1.5 text-xs"
              data-testid="formatting-review-rejection-count"
            >
              {formatRejectionCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Promotion notice */}
      {escapeHatchPromoted && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="formatting-review-escape-hatch-notice"
        >
          After {ESCAPE_HATCH_PROMOTION_THRESHOLD} formatting rejections, "Accept without
          formatting" has been promoted to a primary action.
        </p>
      )}
    </div>
  );
}
