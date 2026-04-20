/**
 * EvaluationPanel.tsx
 *
 * Review Recommendations view per v2.3 §16.5 (awaiting_evaluation_decisions).
 *
 * Structure:
 *   - Narrative reasoning at top (collapsible)
 *   - Point-by-point list, each item:
 *     - Source excerpt + reviewer badge
 *     - Section anchor display (click to scroll to draft)
 *     - Evaluator recommendation (ADOPT / MODIFY / SKIP) with reasoning
 *     - Decision buttons: Accept / Override: Adopt / Override: Modify / Override: Skip
 *   - Regenerator model picker (default: currentVersionModel)
 *   - "Regenerate with these decisions" → submitEvaluationDecisions
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";
import AnchorDisplay from "./AnchorDisplay";
import ModelPicker from "./ModelPicker";
import { BUTTON_LABELS } from "@shared/strings";
import type { PointByPointItem } from "@shared/schemas/pointByPoint";
import type { ProviderKey } from "@shared/workflow";
import { cn } from "@/lib/utils";

export interface EvaluationPanelProps {
  /** Narrative reasoning text from the evaluator (collapsible) */
  narrativeReasoning: string;
  /** Point-by-point evaluation items */
  items: PointByPointItem[];
  /** Current version model (used as default for regenerator picker) */
  currentVersionModel: string;
  /** Ref to the draft container for anchor scroll */
  draftContainerRef?: React.RefObject<Element | null>;
  /** Called when attorney submits decisions */
  onSubmit: (
    decisions: PointByPointItem[],
    regeneratorModel: string,
  ) => void;
  /** Whether submit is in flight */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const RECOMMENDATION_LABELS: Record<PointByPointItem["recommendation"], string> = {
  adopt: "ADOPT",
  modify: "MODIFY",
  skip: "SKIP",
};

const RECOMMENDATION_VARIANT: Record<
  PointByPointItem["recommendation"],
  "default" | "secondary" | "outline"
> = {
  adopt: "default",
  modify: "secondary",
  skip: "outline",
};

interface PointByPointItemCardProps {
  item: PointByPointItem;
  index: number;
  draftContainerRef?: React.RefObject<Element | null>;
  onChange: (updated: PointByPointItem) => void;
  disabled: boolean;
}

function PointByPointItemCard({
  item,
  index,
  draftContainerRef,
  onChange,
  disabled,
}: PointByPointItemCardProps) {
  const [showModifyInput, setShowModifyInput] = useState(
    item.attorneyDecision === "modify",
  );
  const [modifyText, setModifyText] = useState(
    item.attorneyModifiedText ?? item.suggestedText ?? "",
  );

  const handleDecision = useCallback(
    (decision: PointByPointItem["attorneyDecision"]) => {
      const isModify = decision === "modify";
      setShowModifyInput(isModify);
      onChange({
        ...item,
        attorneyDecision: decision,
        attorneyModifiedText: isModify ? (modifyText || null) : null,
      });
    },
    [item, modifyText, onChange],
  );

  const handleModifyTextChange = useCallback(
    (text: string) => {
      setModifyText(text);
      onChange({
        ...item,
        attorneyDecision: "modify",
        attorneyModifiedText: text || null,
      });
    },
    [item, onChange],
  );

  const decision = item.attorneyDecision;
  const isAccepted = decision === item.recommendation;
  const isOverrideAdopt = decision === "adopt" && item.recommendation !== "adopt";
  const isOverrideSkip = decision === "skip" && item.recommendation !== "skip";

  return (
    <Card
      className={cn(
        "border",
        decision !== null && "border-primary/30",
      )}
      data-testid="evaluation-item"
    >
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start gap-2 flex-wrap">
          <Badge
            variant="secondary"
            className="text-xs"
            data-testid="evaluation-item-provider"
          >
            {item.sourceReviewerProvider}
          </Badge>
          <Badge
            variant={RECOMMENDATION_VARIANT[item.recommendation]}
            className="text-xs font-medium"
            data-testid="evaluation-item-recommendation"
          >
            {RECOMMENDATION_LABELS[item.recommendation]}
          </Badge>
          {decision !== null && (
            <Badge
              variant={decision === item.recommendation ? "default" : "outline"}
              className="text-xs"
              data-testid="evaluation-item-decision-badge"
            >
              {decision === item.recommendation
                ? "Accepted"
                : `Override: ${RECOMMENDATION_LABELS[decision]}`}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-3">
        {/* Source excerpt */}
        <blockquote
          className="text-sm text-muted-foreground italic border-l-2 pl-3"
          data-testid="evaluation-item-excerpt"
        >
          "{item.sourceExcerpt}"
        </blockquote>

        {/* Section anchor */}
        <AnchorDisplay
          anchor={item.sectionAnchor}
          draftContainerRef={draftContainerRef}
          data-testid="evaluation-item-anchor"
        />

        {/* Reasoning */}
        <p
          className="text-sm"
          data-testid="evaluation-item-reasoning"
        >
          {item.reasoning}
        </p>

        {/* Suggested text (for modify recommendations) */}
        {item.suggestedText && item.recommendation === "modify" && (
          <div
            className="text-sm bg-muted/50 rounded p-2"
            data-testid="evaluation-item-suggested-text"
          >
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Suggested text:
            </p>
            <p>{item.suggestedText}</p>
          </div>
        )}

        {/* Decision buttons */}
        <div
          className="flex flex-wrap gap-1.5"
          data-testid="evaluation-item-decisions"
        >
          <Button
            variant={isAccepted ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => handleDecision(item.recommendation)}
            disabled={disabled}
            data-testid="evaluation-item-accept-btn"
          >
            Accept
          </Button>
          {item.recommendation !== "adopt" && (
            <Button
              variant={isOverrideAdopt ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleDecision("adopt")}
              disabled={disabled}
              data-testid="evaluation-item-override-adopt-btn"
            >
              Override: Adopt
            </Button>
          )}
          <Button
            variant={decision === "modify" ? "secondary" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => handleDecision("modify")}
            disabled={disabled}
            data-testid="evaluation-item-override-modify-btn"
          >
            Override: Modify
          </Button>
          {item.recommendation !== "skip" && (
            <Button
              variant={isOverrideSkip ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleDecision("skip")}
              disabled={disabled}
              data-testid="evaluation-item-override-skip-btn"
            >
              Override: Skip
            </Button>
          )}
        </div>

        {/* Modify text input */}
        {showModifyInput && (
          <Textarea
            value={modifyText}
            onChange={(e) => handleModifyTextChange(e.target.value)}
            placeholder="Enter modified text..."
            className="text-sm min-h-[80px]"
            disabled={disabled}
            data-testid="evaluation-item-modify-textarea"
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function EvaluationPanel({
  narrativeReasoning,
  items,
  currentVersionModel,
  draftContainerRef,
  onSubmit,
  disabled = false,
  className,
}: EvaluationPanelProps) {
  const [narrativeExpanded, setNarrativeExpanded] = useState(false);
  const [localItems, setLocalItems] = useState<PointByPointItem[]>(items);
  const [regeneratorModel, setRegeneratorModel] = useState<ProviderKey | "">(currentVersionModel as ProviderKey | "");

  const handleItemChange = useCallback(
    (index: number, updated: PointByPointItem) => {
      setLocalItems((prev) =>
        prev.map((item, i) => (i === index ? updated : item)),
      );
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    onSubmit(localItems, regeneratorModel);
  }, [localItems, regeneratorModel, onSubmit]);

  const decidedCount = localItems.filter((i) => i.attorneyDecision !== null).length;
  const allDecided = decidedCount === localItems.length;

  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-testid="evaluation-panel"
    >
      {/* Narrative reasoning (collapsible) */}
      {narrativeReasoning && (
        <Card data-testid="evaluation-narrative">
          <CardHeader className="pb-2 pt-3 px-4">
            <button
              className="flex items-center justify-between w-full text-sm font-medium text-left"
              onClick={() => setNarrativeExpanded((v) => !v)}
              data-testid="evaluation-narrative-toggle"
            >
              <span>Evaluator reasoning</span>
              {narrativeExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {narrativeExpanded && (
            <CardContent className="px-4 pb-3">
              <p
                className="text-sm text-muted-foreground whitespace-pre-wrap"
                data-testid="evaluation-narrative-text"
              >
                {narrativeReasoning}
              </p>
            </CardContent>
          )}
        </Card>
      )}

      {/* Point-by-point items */}
      <div className="space-y-3" data-testid="evaluation-items-list">
        {localItems.map((item, idx) => (
          <PointByPointItemCard
            key={idx}
            item={item}
            index={idx}
            draftContainerRef={draftContainerRef}
            onChange={(updated) => handleItemChange(idx, updated)}
            disabled={disabled}
          />
        ))}
      </div>

      {/* Footer: model picker + submit */}
      <div
        className="flex flex-wrap items-center gap-3 pt-2 border-t"
        data-testid="evaluation-footer"
      >
        <ModelPicker
          context="regenerator"
          currentVersionModel={currentVersionModel as ProviderKey}
          value={regeneratorModel}
          onChange={setRegeneratorModel}
          disabled={disabled}
          label="Regenerate with"
        />
        <Button
          variant="default"
          size="sm"
          onClick={handleSubmit}
          disabled={disabled || !allDecided}
          data-testid="evaluation-submit-btn"
        >
          {BUTTON_LABELS.regenerateWithDecisions}
          {!allDecided && ` (${decidedCount}/${localItems.length})`}
        </Button>
      </div>
    </div>
  );
}
