/**
 * AnchorDisplay.tsx
 *
 * Clickable anchor badge per v2.3 §16.5.
 * Shows "Applies to: <value>" and scrolls to the matching paragraph in the
 * draft preview when clicked.
 *
 * SCROLL-TO-LOCATION IMPLEMENTATION (§3.3.2 constraint):
 *   Uses `scrollToLocator` from `client/src/lib/anchorLocator.ts`.
 *   That function uses a DOM tree-walker to concatenate text across nested
 *   nodes (e.g. <p>text <strong>bold</strong> more</p>) before searching.
 *   This is the ONLY correct approach — do NOT use indexOf or window.find.
 *
 * The `draftContainerRef` prop must point to the DOM element that wraps the
 * rendered markdown draft (e.g. the <div> around <Streamdown>).
 */

import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import { scrollToLocator } from "@/lib/anchorLocator";
import type { SectionAnchor } from "@shared/schemas/pointByPoint";
import { cn } from "@/lib/utils";

export interface AnchorDisplayProps {
  /** The sectionAnchor object from the evaluator's point-by-point item */
  anchor: SectionAnchor;
  /**
   * Ref to the DOM element wrapping the rendered markdown draft.
   * When provided, clicking the badge scrolls to the matching paragraph.
   * When null/undefined, the badge is shown but the scroll button is disabled.
   */
  draftContainerRef?: React.RefObject<Element | null>;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Returns a human-readable kind label for display.
 */
function kindLabel(kind: SectionAnchor["kind"]): string {
  switch (kind) {
    case "section_reference":
      return "Section";
    case "paragraph_start":
      return "Paragraph";
    case "exact_match":
      return "Exact match";
  }
}

export default function AnchorDisplay({
  anchor,
  draftContainerRef,
  className,
}: AnchorDisplayProps) {
  /**
   * Scroll-to-location handler.
   *
   * CRITICAL: Uses `scrollToLocator` from anchorLocator.ts which implements
   * a DOM tree-walker (NodeIterator) to search across nested text nodes.
   * This correctly handles markdown-rendered paragraphs where the locatorText
   * may span multiple DOM nodes (e.g. <p>text <strong>bold</strong> more</p>).
   *
   * DO NOT replace with indexOf, window.find, or any single-node text search.
   */
  const handleScrollTo = useCallback(() => {
    const container = draftContainerRef?.current;
    if (!container) return;
    const found = scrollToLocator(container, anchor.locatorText);
    if (!found) {
      // Anchor not found in current rendered content — no-op (silent fail)
      // The regenerator handles unresolved anchors server-side; this is a
      // best-effort UI scroll, not a hard requirement.
      console.debug("[AnchorDisplay] locatorText not found in draft:", anchor.locatorText);
    }
  }, [draftContainerRef, anchor.locatorText]);

  const canScroll = Boolean(draftContainerRef) && Boolean(anchor.locatorText);

  return (
    <div
      className={cn("flex items-center gap-1.5 flex-wrap", className)}
      data-testid="anchor-display"
    >
      <span className="text-xs text-muted-foreground">Applies to:</span>
      <Badge
        variant="outline"
        className="text-xs font-normal"
        data-testid="anchor-display-badge"
      >
        {kindLabel(anchor.kind)}: {anchor.value}
      </Badge>
      {canScroll && (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={handleScrollTo}
          title="Scroll to location in draft"
          data-testid="anchor-display-scroll-btn"
        >
          <MapPin className="h-3 w-3 mr-0.5" />
          Go to
        </Button>
      )}
    </div>
  );
}
