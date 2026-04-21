/**
 * DocumentCard
 *
 * Compact card for a single document within PhaseDocumentList.
 * Shows document type, title, status badge, iteration/cycle counter,
 * waiting-on-client banner, and a download DOCX button when complete.
 *
 * Per v2.4.2 §8.3.
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { getDocumentTypeDefinition } from "@shared/documentTypeRegistry";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_CARD } from "@shared/strings";
import type { DocumentSummary } from "@/types/document";

interface DocumentCardProps {
  document: DocumentSummary;
  matterId: string;
  /** Called after a successful export so the parent can refetch. */
  onExported?: () => void;
}

function statusBadgeVariant(
  status: DocumentSummary["status"]
): "default" | "secondary" | "outline" {
  if (status === "complete") return "default";
  if (status === "archived") return "outline";
  return "secondary";
}

export default function DocumentCard({
  document,
  matterId,
  onExported,
}: DocumentCardProps) {
  const [, setLocation] = useLocation();

  const exportMutation = trpc.document.export.useMutation({
    onSuccess: (data) => {
      if (data.downloadUrl) {
        window.open(data.downloadUrl, "_blank");
      }
      onExported?.();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const typeDef = getDocumentTypeDefinition(document.documentType);
  const displayName =
    document.documentType === "custom" && document.customTypeLabel
      ? document.customTypeLabel
      : typeDef?.displayName ?? document.documentType;

  const isWaiting = document.workflowState === "waiting_on_client";
  const isComplete = document.status === "complete";
  const canExport = isComplete && document.officialFinalVersionNumber !== null;

  return (
    <div
      className="rounded-lg border bg-card p-4 space-y-2 hover:shadow-sm transition-shadow cursor-pointer"
      onClick={() =>
        setLocation(`/matter/${matterId}/document/${document.id}`)
      }
    >
      {/* Top row: icon + title + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {document.title || displayName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {displayName}
            </p>
          </div>
        </div>
        <Badge
          variant={statusBadgeVariant(document.status)}
          className="shrink-0 text-xs"
        >
          {DOCUMENT_STATUS_LABELS[document.status]}
        </Badge>
      </div>

      {/* Iteration/cycle counter */}
      <p className="text-xs text-muted-foreground">
        {DOCUMENT_CARD.iterationLabel(
          document.currentIteration,
          document.currentCycle
        )}
      </p>

      {/* Waiting-on-client banner */}
      {isWaiting && (
        <div className="flex items-center gap-1.5 text-amber-600 text-xs">
          <Clock className="h-3 w-3" />
          <span>{DOCUMENT_CARD.waitingOnClientBanner}</span>
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {canExport && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={exportMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              exportMutation.mutate({ documentId: document.id });
            }}
          >
            <Download className="h-3 w-3" />
            {exportMutation.isPending
              ? DOCUMENT_CARD.downloadDocxButton + "…"
              : DOCUMENT_CARD.downloadDocxButton}
          </Button>
        )}
      </div>
    </div>
  );
}
