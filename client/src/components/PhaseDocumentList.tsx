/**
 * PhaseDocumentList
 *
 * Lists all documents for a given matter + phase.
 * Includes the "Add document" button and the show/hide archived toggle.
 *
 * Per v2.4.2 §8.3.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle } from "lucide-react";
import { DASHBOARD } from "@shared/strings";
import DocumentCard from "./DocumentCard";
import AddDocumentModal from "./AddDocumentModal";
import type { DocumentSummary } from "@/types/document";

interface PhaseDocumentListProps {
  matterId: string;
  phaseName: string;
  /** Called after any document mutation so parent can refresh container status. */
  onStatusChange?: () => void;
}

export default function PhaseDocumentList({
  matterId,
  phaseName,
  onStatusChange,
}: PhaseDocumentListProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const listQuery = trpc.document.list.useQuery(
    { matterId, phaseName, includeArchived: showArchived },
    { enabled: Boolean(matterId) }
  );

  const documents: DocumentSummary[] = (listQuery.data ?? []) as DocumentSummary[];

  function handleCreated() {
    listQuery.refetch();
    onStatusChange?.();
  }

  function handleExported() {
    listQuery.refetch();
  }

  if (listQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const activeDocuments = documents.filter((d) => d.status !== "archived");
  const archivedDocuments = documents.filter((d) => d.status === "archived");
  const displayDocuments = showArchived ? documents : activeDocuments;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {DASHBOARD.documentCount(activeDocuments.length)}
          {archivedDocuments.length > 0 && (
            <span className="ml-1 text-muted-foreground/60">
              ({archivedDocuments.length} archived)
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {archivedDocuments.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived
                ? DASHBOARD.hideArchivedToggle
                : DASHBOARD.showArchivedToggle}
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setAddModalOpen(true)}
          >
            <PlusCircle className="h-3.5 w-3.5" />
            {DASHBOARD.addDocumentButton}
          </Button>
        </div>
      </div>

      {/* Document grid */}
      {displayDocuments.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            {DASHBOARD.noDocumentsYet}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddModalOpen(true)}
          >
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
            {DASHBOARD.noDocumentsCtaButton}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayDocuments.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              matterId={matterId}
              onExported={handleExported}
            />
          ))}
        </div>
      )}

      {/* Add Document Modal */}
      <AddDocumentModal
        matterId={matterId}
        phaseName={phaseName}
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
