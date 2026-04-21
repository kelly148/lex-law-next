/**
 * Phase A tests: shared/schemas/documentInput.ts
 * Per v1.4.2 §A.4 — documentInput.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  documentCreateInputSchema,
  documentUpdateTitleInputSchema,
  documentSetNotesInputSchema,
  documentArchiveInputSchema,
  phaseNameDocumentHoldingSchema,
} from "../shared/schemas/documentInput";

describe("phaseNameDocumentHoldingSchema", () => {
  it("accepts all four document-holding phases", () => {
    for (const phase of ["engagement", "memo", "matrix", "agreement"] as const) {
      expect(() => phaseNameDocumentHoldingSchema.parse(phase)).not.toThrow();
    }
  });

  it("rejects non-document-holding phases (intake, issues, planning)", () => {
    for (const phase of ["intake", "issues", "planning"]) {
      expect(() => phaseNameDocumentHoldingSchema.parse(phase)).toThrow();
    }
  });

  it("rejects arbitrary strings", () => {
    expect(() => phaseNameDocumentHoldingSchema.parse("drafting")).toThrow();
    expect(() => phaseNameDocumentHoldingSchema.parse("")).toThrow();
  });
});

describe("documentCreateInputSchema", () => {
  it("parses a valid predefined-type create input", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "agreement",
      documentType: "revocable_living_trust",
      title: "Smith Revocable Living Trust",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentType).toBe("revocable_living_trust");
      expect(result.data.title).toBe("Smith Revocable Living Trust");
    }
  });

  it("parses a valid custom type with customTypeLabel", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "memo",
      documentType: "custom",
      customTypeLabel: "Special Memorandum",
      title: "Special Memo",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customTypeLabel).toBe("Special Memorandum");
    }
  });

  it("fails when documentType is 'custom' but customTypeLabel is absent", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "engagement",
      documentType: "custom",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("customTypeLabel");
    }
  });

  it("fails when documentType is 'custom' but customTypeLabel is empty string", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "engagement",
      documentType: "custom",
      customTypeLabel: "",
    });
    expect(result.success).toBe(false);
  });

  it("fails for an invalid documentType key not in registry and not 'custom'", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "agreement",
      documentType: "made_up_type",
    });
    expect(result.success).toBe(false);
  });

  it("fails for a non-document-holding phaseName (intake)", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "intake",
      documentType: "revocable_living_trust",
    });
    expect(result.success).toBe(false);
  });

  it("fails for a non-document-holding phaseName (issues)", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "issues",
      documentType: "pour_over_will",
    });
    expect(result.success).toBe(false);
  });

  it("fails for a non-document-holding phaseName (planning)", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "planning",
      documentType: "financial_poa",
    });
    expect(result.success).toBe(false);
  });

  it("title and notes are optional and default to undefined", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "matrix",
      documentType: "matrix",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  it("accepts notes as optional string", () => {
    const result = documentCreateInputSchema.safeParse({
      matterId: "abc123",
      phaseName: "agreement",
      documentType: "simple_will",
      notes: "Client wants simple will only",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe("Client wants simple will only");
    }
  });

  it("fails when matterId is missing", () => {
    const result = documentCreateInputSchema.safeParse({
      phaseName: "agreement",
      documentType: "simple_will",
    });
    expect(result.success).toBe(false);
  });
});

describe("documentUpdateTitleInputSchema", () => {
  it("parses valid input", () => {
    const result = documentUpdateTitleInputSchema.safeParse({ documentId: 5, title: "New Title" });
    expect(result.success).toBe(true);
  });

  it("fails for non-positive documentId", () => {
    expect(documentUpdateTitleInputSchema.safeParse({ documentId: 0, title: "x" }).success).toBe(false);
    expect(documentUpdateTitleInputSchema.safeParse({ documentId: -1, title: "x" }).success).toBe(false);
  });

  it("fails for empty title", () => {
    expect(documentUpdateTitleInputSchema.safeParse({ documentId: 1, title: "" }).success).toBe(false);
  });
});

describe("documentSetNotesInputSchema", () => {
  it("parses valid input", () => {
    const result = documentSetNotesInputSchema.safeParse({ documentId: 1, notes: "Some notes" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string for notes (clearing notes)", () => {
    const result = documentSetNotesInputSchema.safeParse({ documentId: 1, notes: "" });
    expect(result.success).toBe(true);
  });
});

describe("documentArchiveInputSchema", () => {
  it("parses valid input", () => {
    expect(documentArchiveInputSchema.safeParse({ documentId: 42 }).success).toBe(true);
  });

  it("fails for zero or negative documentId", () => {
    expect(documentArchiveInputSchema.safeParse({ documentId: 0 }).success).toBe(false);
  });
});
