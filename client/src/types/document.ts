/**
 * Client-side DocumentSummary type.
 *
 * Mirrors the server-side DocumentSummary interface from
 * server/routers/documentRouter.ts. Kept in sync manually.
 * The tRPC client infers this at runtime; this type is for
 * local component prop typing only.
 */
export interface DocumentSummary {
  id: number;
  matterId: string;
  phaseName: string;
  documentType: string;
  customTypeLabel: string | null;
  title: string;
  status: "drafting" | "complete" | "archived";
  workflowState: string;
  currentIteration: number;
  currentCycle: number;
  officialFinalVersionNumber: number | null;
  updatedAt: Date;
}
