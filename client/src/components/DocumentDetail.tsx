/**
 * DocumentDetail
 *
 * Full-page view for a single document.
 * Features:
 *   - Breadcrumb back to matter dashboard
 *   - Inline title and notes editing
 *   - Reference picker (frontend React state only — never persisted, resets on reload)
 *   - Skipped-sibling banner (shown when referencedSiblingDocumentIds contains
 *     documents that are not yet in 'complete' status)
 *   - Download DOCX button (reuses v2.3 export pipeline scoped to officialFinalVersionNumber)
 *   - Archive button
 *
 * Per v2.4.2 §8.4, §8.5, §5.3.
 *
 * REFERENCE PICKER INVARIANT (v2.4.2 §8.4):
 *   selectedSiblingIds is React useState only.
 *   It is NEVER written to the database.
 *   It resets to [] on every page load / component mount.
 *   It is passed as referencedSiblingDocumentIds to the first requestFeedback
 *   call (initial-draft path) only.
 */
import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Download,
  Archive,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getDocumentTypeDefinition } from "@shared/documentTypeRegistry";
import {
  DOCUMENT_DETAIL,
  DOCUMENT_STATUS_LABELS,
  SIBLING_SKIP_BANNER,
  GENERAL,
} from "@shared/strings";
import type { DocumentSummary } from "@/types/document";

interface DocumentDetailProps {
  matterId: string;
  documentId: number;
}

export default function DocumentDetail({
  matterId,
  documentId,
}: DocumentDetailProps) {
  const [, setLocation] = useLocation();

  // ── Reference picker state (frontend-only, never persisted) ──────────────
  // Per v2.4.2 §8.4: resets on every mount.
  const [selectedSiblingIds, setSelectedSiblingIds] = useState<number[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [siblingSkipDismissed, setSiblingSkipDismissed] = useState(false);

  // ── Inline edit state ─────────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");

  // ── Queries ───────────────────────────────────────────────────────────────
  const docQuery = trpc.document.get.useQuery(
    { documentId },
    { enabled: Boolean(documentId) }
  );

  // Sibling documents in the same phase (for reference picker)
  const siblingsQuery = trpc.document.list.useQuery(
    { matterId, phaseName: docQuery.data?.phaseName, includeArchived: false },
    { enabled: Boolean(docQuery.data?.phaseName) }
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateTitleMutation = trpc.document.updateTitle.useMutation({
    onSuccess: () => {
      docQuery.refetch();
      setEditingTitle(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const setNotesMutation = trpc.document.setNotes.useMutation({
    onSuccess: () => {
      docQuery.refetch();
      setEditingNotes(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const archiveMutation = trpc.document.archive.useMutation({
    onSuccess: () => {
      toast.success("Document archived.");
      setLocation(`/matter/${matterId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const exportMutation = trpc.document.export.useMutation({
    onSuccess: (data) => {
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Reference picker helpers ──────────────────────────────────────────────
  const toggleSibling = useCallback((id: number) => {
    setSelectedSiblingIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  // ── Loading / error states ────────────────────────────────────────────────
  if (docQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (docQuery.error || !docQuery.data) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => setLocation(`/matter/${matterId}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {DOCUMENT_DETAIL.backToMatterLabel}
        </Button>
        <div className="text-center py-16 text-muted-foreground">
          <p>{GENERAL.error}</p>
        </div>
      </div>
    );
  }

  const doc = docQuery.data as DocumentSummary;
  const typeDef = getDocumentTypeDefinition(doc.documentType);
  const displayName =
    doc.documentType === "custom" && doc.customTypeLabel
      ? doc.customTypeLabel
      : typeDef?.displayName ?? doc.documentType;

  const siblings = ((siblingsQuery.data ?? []) as DocumentSummary[]).filter(
    (s) => s.id !== documentId
  );

  // Skipped-sibling banner: selected siblings that are not yet 'complete'
  const skippedSiblings = selectedSiblingIds.filter((id) => {
    const sib = siblings.find((s) => s.id === id);
    return sib && sib.status !== "complete";
  });

  const canExport =
    doc.status === "complete" && doc.officialFinalVersionNumber !== null;

  return (
    <div className="container py-6 space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          className="hover:text-foreground transition-colors"
          onClick={() => setLocation(`/matter/${matterId}`)}
        >
          {DOCUMENT_DETAIL.backToMatterLabel}
        </button>
        <span>{DOCUMENT_DETAIL.breadcrumbSeparator}</span>
        <span className="text-foreground font-medium">{displayName}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <Input
                className="text-xl font-serif font-bold"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && titleInput.trim()) {
                    updateTitleMutation.mutate({
                      documentId,
                      title: titleInput.trim(),
                    });
                  } else if (e.key === "Escape") {
                    setEditingTitle(false);
                  }
                }}
                autoFocus
              />
              <Button
                size="sm"
                disabled={!titleInput.trim() || updateTitleMutation.isPending}
                onClick={() =>
                  updateTitleMutation.mutate({
                    documentId,
                    title: titleInput.trim(),
                  })
                }
              >
                {GENERAL.save}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingTitle(false)}
              >
                {GENERAL.cancel}
              </Button>
            </div>
          ) : (
            <h1
              className="font-serif text-2xl font-bold text-primary cursor-pointer hover:underline"
              onClick={() => {
                setTitleInput(doc.title || displayName);
                setEditingTitle(true);
              }}
              title="Click to edit title"
            >
              {doc.title || displayName}
            </h1>
          )}
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-xs">
              {displayName}
            </Badge>
            <Badge
              variant={doc.status === "complete" ? "default" : "secondary"}
              className="text-xs"
            >
              {DOCUMENT_STATUS_LABELS[doc.status]}
            </Badge>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {canExport && (
            <Button
              size="sm"
              variant="outline"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate({ documentId })}
            >
              <Download className="h-4 w-4 mr-1.5" />
              {exportMutation.isPending
                ? DOCUMENT_DETAIL.exportingButton
                : DOCUMENT_DETAIL.downloadDocxButton}
            </Button>
          )}
          {doc.status !== "archived" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (confirm("Archive this document?")) {
                  archiveMutation.mutate({ documentId });
                }
              }}
            >
              <Archive className="h-4 w-4 mr-1.5" />
              Archive
            </Button>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notes
        </Label>
        {editingNotes ? (
          <div className="space-y-2">
            <Textarea
              placeholder={DOCUMENT_DETAIL.notesEditPlaceholder}
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={setNotesMutation.isPending}
                onClick={() =>
                  setNotesMutation.mutate({
                    documentId,
                    notes: notesInput.trim(),
                  })
                }
              >
                {GENERAL.save}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingNotes(false)}
              >
                {GENERAL.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors min-h-[2rem]"
            onClick={() => {
              setNotesInput(/* doc.notes ?? */ "");
              setEditingNotes(true);
            }}
          >
            {/* doc.notes is not in DocumentSummary — notes are write-only from this view */}
            Click to add notes…
          </p>
        )}
      </div>

      {/* ── Reference Picker ─────────────────────────────────────────────── */}
      {/* Per v2.4.2 §8.4: frontend state only, never persisted, resets on reload */}
      {siblings.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <button
            className="w-full flex items-center justify-between text-sm font-medium"
            onClick={() => setReferencePickerOpen((v) => !v)}
          >
            <span>{DOCUMENT_DETAIL.referencePickerTitle}</span>
            {referencePickerOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {referencePickerOpen && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {DOCUMENT_DETAIL.referencePickerDescription}
              </p>
              <div className="space-y-2">
                {siblings.map((sib) => {
                  const sibTypeDef = getDocumentTypeDefinition(sib.documentType);
                  const sibName =
                    sib.documentType === "custom" && sib.customTypeLabel
                      ? sib.customTypeLabel
                      : sibTypeDef?.displayName ?? sib.documentType;
                  return (
                    <div key={sib.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`sib-${sib.id}`}
                        checked={selectedSiblingIds.includes(sib.id)}
                        onCheckedChange={() => toggleSibling(sib.id)}
                      />
                      <Label
                        htmlFor={`sib-${sib.id}`}
                        className="text-sm cursor-pointer"
                      >
                        {sib.title || sibName}
                        {sib.status !== "complete" && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({DOCUMENT_STATUS_LABELS[sib.status]})
                          </span>
                        )}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Skipped-sibling banner ─────────────────────────────────────────── */}
      {/* Shown when selected siblings are not yet 'complete' */}
      {skippedSiblings.length > 0 && !siblingSkipDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="text-sm flex-1">
            {SIBLING_SKIP_BANNER.message(skippedSiblings.length)}
          </p>
          <button
            className="text-amber-600 hover:text-amber-800 transition-colors"
            onClick={() => setSiblingSkipDismissed(true)}
            aria-label={SIBLING_SKIP_BANNER.dismissLabel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Expose selectedSiblingIds for parent/sibling consumption via data attribute */}
      {/* This is the integration point for the initial requestFeedback call.        */}
      {/* The parent PhaseDocumentList or DocumentCard passes these IDs as            */}
      {/* referencedSiblingDocumentIds when calling iterativePhase.requestFeedback.  */}
      <div
        data-selected-sibling-ids={JSON.stringify(selectedSiblingIds)}
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * useSelectedSiblingIds
 *
 * Exported hook for consuming the reference picker selection in parent components.
 * Returns the currently selected sibling document IDs.
 *
 * Usage:
 *   const { selectedSiblingIds, setSelectedSiblingIds } = useSelectedSiblingIds();
 *
 * This hook is the canonical integration point between DocumentDetail's reference
 * picker and the initial requestFeedback call per v2.4.2 §8.4.
 */
export function useSelectedSiblingIds() {
  const [selectedSiblingIds, setSelectedSiblingIds] = useState<number[]>([]);
  return { selectedSiblingIds, setSelectedSiblingIds };
}
