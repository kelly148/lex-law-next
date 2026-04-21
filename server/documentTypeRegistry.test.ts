/**
 * Phase A tests: shared/documentTypeRegistry.ts
 * Per v1.4.2 §A.4 — documentTypeRegistry.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPE_REGISTRY,
  getDocumentTypeDefinition,
  isValidDocumentTypeKey,
} from "../shared/documentTypeRegistry";

describe("DOCUMENT_TYPE_REGISTRY", () => {
  it("contains exactly 13 entries", () => {
    expect(DOCUMENT_TYPE_REGISTRY).toHaveLength(13);
  });

  it("contains 3 trust-category entries", () => {
    const trustEntries = DOCUMENT_TYPE_REGISTRY.filter((d) => d.category === "trust");
    expect(trustEntries).toHaveLength(3);
    const keys = trustEntries.map((d) => d.key);
    expect(keys).toContain("revocable_living_trust");
    expect(keys).toContain("certification_of_trust");
    expect(keys).toContain("assignment_of_personal_property");
  });

  it("contains 2 will-category entries", () => {
    const willEntries = DOCUMENT_TYPE_REGISTRY.filter((d) => d.category === "will");
    expect(willEntries).toHaveLength(2);
    const keys = willEntries.map((d) => d.key);
    expect(keys).toContain("pour_over_will");
    expect(keys).toContain("simple_will");
  });

  it("contains 3 poa-category entries", () => {
    const poaEntries = DOCUMENT_TYPE_REGISTRY.filter((d) => d.category === "poa");
    expect(poaEntries).toHaveLength(3);
    const keys = poaEntries.map((d) => d.key);
    expect(keys).toContain("financial_poa");
    expect(keys).toContain("medical_poa");
    expect(keys).toContain("hipaa_authorization");
  });

  it("contains 4 other-category entries", () => {
    const otherEntries = DOCUMENT_TYPE_REGISTRY.filter((d) => d.category === "other");
    expect(otherEntries).toHaveLength(4);
    const keys = otherEntries.map((d) => d.key);
    expect(keys).toContain("engagement_letter");
    expect(keys).toContain("memo");
    expect(keys).toContain("matrix");
    expect(keys).toContain("agreement");
  });

  it("contains 1 custom-category entry", () => {
    const customEntries = DOCUMENT_TYPE_REGISTRY.filter((d) => d.category === "custom");
    expect(customEntries).toHaveLength(1);
    expect(customEntries[0].key).toBe("custom");
  });

  it("all entries have non-empty key and displayName", () => {
    for (const entry of DOCUMENT_TYPE_REGISTRY) {
      expect(entry.key.length).toBeGreaterThan(0);
      expect(entry.displayName.length).toBeGreaterThan(0);
    }
  });

  it("all keys are unique", () => {
    const keys = DOCUMENT_TYPE_REGISTRY.map((d) => d.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});

describe("getDocumentTypeDefinition", () => {
  it("returns correct definition for revocable_living_trust", () => {
    const def = getDocumentTypeDefinition("revocable_living_trust");
    expect(def).toBeDefined();
    expect(def!.key).toBe("revocable_living_trust");
    expect(def!.displayName).toBe("Revocable Living Trust");
    expect(def!.category).toBe("trust");
  });

  it("returns correct definition for pour_over_will", () => {
    const def = getDocumentTypeDefinition("pour_over_will");
    expect(def).toBeDefined();
    expect(def!.key).toBe("pour_over_will");
    expect(def!.category).toBe("will");
  });

  it("returns correct definition for custom", () => {
    const def = getDocumentTypeDefinition("custom");
    expect(def).toBeDefined();
    expect(def!.category).toBe("custom");
  });

  it("returns undefined for a nonexistent key", () => {
    expect(getDocumentTypeDefinition("nonexistent")).toBeUndefined();
    expect(getDocumentTypeDefinition("")).toBeUndefined();
    expect(getDocumentTypeDefinition("REVOCABLE_LIVING_TRUST")).toBeUndefined(); // case-sensitive
  });
});

describe("isValidDocumentTypeKey", () => {
  it("returns true for pour_over_will", () => {
    expect(isValidDocumentTypeKey("pour_over_will")).toBe(true);
  });

  it("returns true for custom (custom is a registry key)", () => {
    expect(isValidDocumentTypeKey("custom")).toBe(true);
  });

  it("returns true for all 13 registry keys", () => {
    for (const entry of DOCUMENT_TYPE_REGISTRY) {
      expect(isValidDocumentTypeKey(entry.key)).toBe(true);
    }
  });

  it("returns false for made_up", () => {
    expect(isValidDocumentTypeKey("made_up")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidDocumentTypeKey("")).toBe(false);
  });

  it("returns false for uppercase variant of a valid key", () => {
    expect(isValidDocumentTypeKey("CUSTOM")).toBe(false);
  });
});
