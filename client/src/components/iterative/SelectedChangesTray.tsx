/**
 * SelectedChangesTray.tsx
 *
 * Reorderable tray for manual selections per v2.3 §16.4.
 *
 * Shows selected changes with:
 *   - Source provider badge
 *   - Preview of selected text
 *   - Edit button (opens inline textarea to modify the text)
 *   - Remove button
 *   - Reorder via Up/Down buttons
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ChevronUp, ChevronDown, Pencil, X, Check } from "lucide-react";
import type { ManualSelectionInput } from "@shared/schemas/manualSelection";
import { cn } from "@/lib/utils";

export interface SelectedChangesTrayProps {
  /** Ordered list of selected changes */
  selections: ManualSelectionInput[];
  /** Provider label for each feedbackId (feedbackId → provider name) */
  feedbackProviders: Record<number, string>;
  /** Called when the ordered list changes (reorder, remove, edit) */
  onChange: (selections: ManualSelectionInput[]) => void;
  /** Whether the tray is disabled (e.g. mutation in flight) */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface SelectionItemProps {
  selection: ManualSelectionInput;
  providerLabel: string;
  index: number;
  total: number;
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onEdit: (editedText: string | null) => void;
}

function SelectionItem({
  selection,
  providerLabel,
  index,
  total,
  disabled,
  onMoveUp,
  onMoveDown,
  onRemove,
  onEdit,
}: SelectionItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    selection.editedText ?? selection.sourceText,
  );

  const handleSaveEdit = useCallback(() => {
    const trimmed = editValue.trim();
    onEdit(trimmed === selection.sourceText ? null : trimmed);
    setEditing(false);
  }, [editValue, selection.sourceText, onEdit]);

  const handleCancelEdit = useCallback(() => {
    setEditValue(selection.editedText ?? selection.sourceText);
    setEditing(false);
  }, [selection.editedText, selection.sourceText]);

  const displayText = selection.editedText ?? selection.sourceText;
  const isEdited = selection.editedText !== null;

  return (
    <div
      className="border rounded-md p-3 space-y-2"
      data-testid="selected-change-item"
    >
      <div className="flex items-start gap-2">
        {/* Reorder controls */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={onMoveUp}
            disabled={disabled || index === 0}
            aria-label="Move up"
            data-testid="selected-change-move-up"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={onMoveDown}
            disabled={disabled || index === total - 1}
            aria-label="Move down"
            data-testid="selected-change-move-down"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs" data-testid="selected-change-provider">
              {providerLabel}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs"
              data-testid="selected-change-kind"
            >
              {selection.selectionKind}
            </Badge>
            {isEdited && (
              <Badge variant="default" className="text-xs" data-testid="selected-change-edited-badge">
                Edited
              </Badge>
            )}
          </div>

          {editing ? (
            <div className="space-y-1.5">
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="text-sm min-h-[80px]"
                disabled={disabled}
                data-testid="selected-change-edit-textarea"
              />
              <div className="flex gap-1.5">
                <Button
                  variant="default"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleSaveEdit}
                  disabled={disabled}
                  data-testid="selected-change-save-edit"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleCancelEdit}
                  disabled={disabled}
                  data-testid="selected-change-cancel-edit"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p
              className="text-sm text-muted-foreground line-clamp-3"
              data-testid="selected-change-preview"
            >
              {displayText}
            </p>
          )}
        </div>

        {/* Action buttons */}
        {!editing && (
          <div className="flex gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setEditing(true)}
              disabled={disabled}
              aria-label="Edit"
              data-testid="selected-change-edit-btn"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={onRemove}
              disabled={disabled}
              aria-label="Remove"
              data-testid="selected-change-remove-btn"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SelectedChangesTray({
  selections,
  feedbackProviders,
  onChange,
  disabled = false,
  className,
}: SelectedChangesTrayProps) {
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const next = [...selections];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      // Update selectionOrder to match new positions
      onChange(next.map((s, i) => ({ ...s, selectionOrder: i })));
    },
    [selections, onChange],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index === selections.length - 1) return;
      const next = [...selections];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      onChange(next.map((s, i) => ({ ...s, selectionOrder: i })));
    },
    [selections, onChange],
  );

  const handleRemove = useCallback(
    (index: number) => {
      const next = selections.filter((_, i) => i !== index);
      onChange(next.map((s, i) => ({ ...s, selectionOrder: i })));
    },
    [selections, onChange],
  );

  const handleEdit = useCallback(
    (index: number, editedText: string | null) => {
      const next = selections.map((s, i) =>
        i === index ? { ...s, editedText } : s,
      );
      onChange(next);
    },
    [selections, onChange],
  );

  if (selections.length === 0) {
    return (
      <div
        className={cn(
          "border rounded-md p-4 text-center text-sm text-muted-foreground",
          className,
        )}
        data-testid="selected-changes-tray-empty"
      >
        No changes selected. Click paragraphs above to add them.
      </div>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
      data-testid="selected-changes-tray"
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Selected changes ({selections.length})
      </p>
      {selections.map((selection, index) => (
        <SelectionItem
          key={`${selection.sourceFeedbackId}-${selection.selectionOrder}`}
          selection={selection}
          providerLabel={
            feedbackProviders[selection.sourceFeedbackId] ??
            `Reviewer ${selection.sourceFeedbackId}`
          }
          index={index}
          total={selections.length}
          disabled={disabled}
          onMoveUp={() => handleMoveUp(index)}
          onMoveDown={() => handleMoveDown(index)}
          onRemove={() => handleRemove(index)}
          onEdit={(editedText) => handleEdit(index, editedText)}
        />
      ))}
    </div>
  );
}
