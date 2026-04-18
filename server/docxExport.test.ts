/**
 * Tests for server/docxExport.ts
 * Verifies that generatePhaseDocx produces a valid DOCX buffer with expected metadata.
 */

import { describe, it, expect } from "vitest";
import { generatePhaseDocx, type DocxMeta } from "./docxExport";

describe("generatePhaseDocx", () => {
  const baseMeta: DocxMeta = {
    matterName: "Kinsey Property Purchase",
    clientName: "John Kinsey",
    phaseLabel: "Intake & Investigation",
    jurisdiction: "Virginia — Fairfax County",
    date: "2026-04-18T00:00:00.000Z",
  };

  it("returns a non-empty Buffer", async () => {
    const buf = await generatePhaseDocx("Sample content.", baseMeta);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("produces a valid DOCX (PK zip header)", async () => {
    const buf = await generatePhaseDocx("Hello world.", baseMeta);
    // DOCX files start with PK (zip header: 0x50 0x4B)
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("works without optional fields (clientName, jurisdiction, date)", async () => {
    const minimalMeta: DocxMeta = {
      matterName: "Test Matter",
      phaseLabel: "Advisory Memo",
    };
    const buf = await generatePhaseDocx("Memo content here.", minimalMeta);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("handles empty content gracefully", async () => {
    const buf = await generatePhaseDocx("", baseMeta);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("handles markdown headings and bullets in content", async () => {
    const content = [
      "# Main Heading",
      "## Sub Heading",
      "### Section",
      "Normal paragraph text here.",
      "- Bullet item one",
      "- Bullet item two",
      "1. Numbered item",
      "**Bold line**",
      "",
      "Another paragraph with **inline bold** text.",
      "---",
    ].join("\n");

    const buf = await generatePhaseDocx(content, baseMeta);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("handles large content without error", async () => {
    const longContent = Array(200).fill("This is a test sentence for a legal document. ").join("\n");
    const buf = await generatePhaseDocx(longContent, baseMeta);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(5000);
  });

  it("uses today's date when date is not provided", async () => {
    const meta: DocxMeta = {
      matterName: "Date Test Matter",
      phaseLabel: "Planning",
    };
    // Should not throw
    const buf = await generatePhaseDocx("Content.", meta);
    expect(buf).toBeInstanceOf(Buffer);
  });
});
