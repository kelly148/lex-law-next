/**
 * AddDocumentModal
 *
 * Modal for creating a new document within a phase.
 * Renders a document-type picker grouped by category,
 * a custom-label input (shown only when type === 'custom'),
 * an optional title input, and optional notes.
 *
 * Per v2.4.2 §8.3 and §5.1.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  DOCUMENT_TYPE_REGISTRY,
  type DocumentCategory,
} from "@shared/documentTypeRegistry";
import { ADD_DOCUMENT_MODAL } from "@shared/strings";

const CATEGORY_ORDER: DocumentCategory[] = [
  "trust",
  "will",
  "poa",
  "other",
  "custom",
];
const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  trust: "Trust",
  will: "Will",
  poa: "Power of Attorney",
  other: "Other",
  custom: "Custom",
};

interface AddDocumentModalProps {
  matterId: string;
  phaseName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export default function AddDocumentModal({
  matterId,
  phaseName,
  open,
  onOpenChange,
  onCreated,
}: AddDocumentModalProps) {
  const [documentType, setDocumentType] = useState<string>("");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [customLabelError, setCustomLabelError] = useState<string | null>(null);

  const createMutation = trpc.document.create.useMutation({
    onSuccess: () => {
      toast.success("Document created.");
      onCreated();
      onOpenChange(false);
      // Reset form
      setDocumentType("");
      setCustomTypeLabel("");
      setTitle("");
      setNotes("");
      setCustomLabelError(null);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function validate(): boolean {
    if (!documentType) return false;
    if (documentType === "custom") {
      if (!customTypeLabel.trim()) {
        setCustomLabelError(ADD_DOCUMENT_MODAL.customLabelRequiredError);
        return false;
      }
      if (customTypeLabel.trim().length > 200) {
        setCustomLabelError(ADD_DOCUMENT_MODAL.customLabelTooLongError);
        return false;
      }
    }
    setCustomLabelError(null);
    return true;
  }

  function handleCreate() {
    if (!validate()) return;
    createMutation.mutate({
      matterId,
      phaseName,
      documentType,
      customTypeLabel:
        documentType === "custom" ? customTypeLabel.trim() : undefined,
      title: title.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  // Group types by category
  const grouped = CATEGORY_ORDER.reduce<
    Record<DocumentCategory, typeof DOCUMENT_TYPE_REGISTRY>
  >(
    (acc, cat) => {
      acc[cat] = DOCUMENT_TYPE_REGISTRY.filter((d) => d.category === cat);
      return acc;
    },
    { trust: [], will: [], poa: [], other: [], custom: [] }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ADD_DOCUMENT_MODAL.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Document type picker */}
          <div className="space-y-1.5">
            <Label>{ADD_DOCUMENT_MODAL.typePickerLabel}</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger>
                <SelectValue placeholder="Select a document type…" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((cat) => (
                  <SelectGroup key={cat}>
                    <SelectLabel>{CATEGORY_LABELS[cat]}</SelectLabel>
                    {grouped[cat].map((def) => (
                      <SelectItem key={def.key} value={def.key}>
                        {def.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom label — only shown when type === 'custom' */}
          {documentType === "custom" && (
            <div className="space-y-1.5">
              <Label>{ADD_DOCUMENT_MODAL.customLabelInputLabel}</Label>
              <Input
                placeholder={ADD_DOCUMENT_MODAL.customLabelInputPlaceholder}
                value={customTypeLabel}
                onChange={(e) => {
                  setCustomTypeLabel(e.target.value);
                  setCustomLabelError(null);
                }}
                maxLength={200}
              />
              {customLabelError && (
                <p className="text-xs text-destructive">{customLabelError}</p>
              )}
            </div>
          )}

          {/* Title (optional) */}
          <div className="space-y-1.5">
            <Label>{ADD_DOCUMENT_MODAL.titleInputLabel}</Label>
            <Input
              placeholder={ADD_DOCUMENT_MODAL.titleInputPlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Notes (optional) */}
          <div className="space-y-1.5">
            <Label>{ADD_DOCUMENT_MODAL.notesInputLabel}</Label>
            <Textarea
              placeholder={ADD_DOCUMENT_MODAL.notesInputPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            {ADD_DOCUMENT_MODAL.cancelButton}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!documentType || createMutation.isPending}
          >
            {createMutation.isPending
              ? ADD_DOCUMENT_MODAL.creatingButton
              : ADD_DOCUMENT_MODAL.createButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
