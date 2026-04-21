/**
 * MatterPage
 *
 * Top-level matter routing gate per v2.4.2 §3.0 and §8.5.
 *
 * Reads workflowModelVersion from the matter query and branches:
 *   version === 2  →  LegacyMatterView (v2.3 single-document-per-phase UI)
 *   version === 3  →  MatterDashboard  (v2.4.2 document-layer UI)
 *   undefined      →  loading skeleton
 *
 * No business logic lives here — this is a pure routing gate.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams } from "wouter";
import { useMatterWorkflowModelVersion } from "@/hooks/useMatterWorkflowModelVersion";
import LegacyMatterView from "@/components/LegacyMatterView";
import MatterDashboard from "@/components/MatterDashboard";

export default function MatterPage() {
  useAuth({ redirectOnUnauthenticated: true });
  const params = useParams<{ matterId: string }>();
  const version = useMatterWorkflowModelVersion(params.matterId);

  if (version === undefined) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96 col-span-3" />
        </div>
      </div>
    );
  }

  if (version === 2) {
    return <LegacyMatterView matterId={params.matterId} />;
  }

  // version === 3
  return <MatterDashboard matterId={params.matterId} />;
}
