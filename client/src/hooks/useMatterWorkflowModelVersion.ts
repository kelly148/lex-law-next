/**
 * useMatterWorkflowModelVersion
 *
 * Reads workflowModelVersion from the matter query.
 * Returns 2 (legacy v2.3 phase model), 3 (v2.4.2 document-layer model),
 * or undefined while loading.
 *
 * Used by MatterPage to branch between LegacyMatterView and MatterDashboard.
 */
import { trpc } from "@/lib/trpc";

export function useMatterWorkflowModelVersion(
  matterId: string
): 2 | 3 | undefined {
  const { data } = trpc.matter.get.useQuery(
    { matterId },
    { enabled: Boolean(matterId) }
  );

  const version = data?.matter?.workflowModelVersion;
  if (version === 2 || version === 3) return version;
  return undefined;
}
