/**
 * Tests for server/fileExtractor.ts
 * Covers: PDF extraction, DOCX extraction, TXT extraction,
 * error handling, and buildSourceContentFromUploads assembly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock child_process.execSync and fs functions ──────────────────────
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

// ── Mock global fetch ─────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import mammoth from "mammoth";
import { extractFileText, buildSourceContentFromUploads } from "./fileExtractor";

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const mockMammoth = mammoth as { extractRawText: ReturnType<typeof vi.fn> };

function makeUpload(overrides: Partial<{
  id: number;
  fileName: string;
  fileUrl: string;
  contentType: string;
}> = {}) {
  return {
    id: 1,
    fileName: "test.pdf",
    fileUrl: "https://cdn.example.com/test.pdf",
    contentType: "application/pdf",
    ...overrides,
  };
}

function mockDownload(content: string | Buffer) {
  const buf = typeof content === "string" ? Buffer.from(content) : content;
  mockFetch.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── PDF extraction ────────────────────────────────────────────────────

describe("extractFileText — PDF", () => {
  it("extracts text from a PDF using pdftotext", async () => {
    mockDownload("fake-pdf-bytes");
    mockWriteFileSync.mockImplementation(() => {});
    mockExecSync.mockImplementation(() => {});
    mockReadFileSync.mockReturnValue("Extracted PDF text content.");

    const result = await extractFileText(makeUpload({
      fileName: "contract.pdf",
      contentType: "application/pdf",
    }));

    expect(result).toBe("Extracted PDF text content.");
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("pdftotext"),
      expect.any(Object),
    );
  });

  it("returns error message if pdftotext fails", async () => {
    mockDownload("fake-pdf-bytes");
    mockWriteFileSync.mockImplementation(() => {});
    mockExecSync.mockImplementation(() => { throw new Error("pdftotext not found"); });

    const result = await extractFileText(makeUpload({
      fileName: "broken.pdf",
      contentType: "application/pdf",
    }));

    expect(result).toContain("[Error extracting broken.pdf:");
    expect(result).toContain("pdftotext not found");
  });

  it("detects PDF by file extension when content-type is generic", async () => {
    mockDownload("fake-pdf-bytes");
    mockWriteFileSync.mockImplementation(() => {});
    mockExecSync.mockImplementation(() => {});
    mockReadFileSync.mockReturnValue("PDF via extension.");

    const result = await extractFileText(makeUpload({
      fileName: "document.pdf",
      contentType: "application/octet-stream",
    }));

    expect(result).toBe("PDF via extension.");
  });
});

// ── DOCX extraction ───────────────────────────────────────────────────

describe("extractFileText — DOCX", () => {
  it("extracts text from a DOCX file using mammoth", async () => {
    mockDownload("fake-docx-bytes");
    mockMammoth.extractRawText.mockResolvedValue({ value: "  DOCX content here.  " });

    const result = await extractFileText(makeUpload({
      fileName: "letter.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));

    expect(result).toBe("DOCX content here.");
    expect(mockMammoth.extractRawText).toHaveBeenCalledWith({
      buffer: expect.any(Buffer),
    });
  });

  it("detects DOCX by .docx extension", async () => {
    mockDownload("fake-docx-bytes");
    mockMammoth.extractRawText.mockResolvedValue({ value: "Extension-detected DOCX." });

    const result = await extractFileText(makeUpload({
      fileName: "memo.docx",
      contentType: "application/octet-stream",
    }));

    expect(result).toBe("Extension-detected DOCX.");
  });

  it("detects DOC by application/msword content type", async () => {
    mockDownload("fake-doc-bytes");
    mockMammoth.extractRawText.mockResolvedValue({ value: "Legacy DOC content." });

    const result = await extractFileText(makeUpload({
      fileName: "old.doc",
      contentType: "application/msword",
    }));

    expect(result).toBe("Legacy DOC content.");
  });

  it("returns error message if mammoth fails", async () => {
    mockDownload("fake-docx-bytes");
    mockMammoth.extractRawText.mockRejectedValue(new Error("mammoth parse error"));

    const result = await extractFileText(makeUpload({
      fileName: "corrupt.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));

    expect(result).toContain("[Error extracting corrupt.docx:");
    expect(result).toContain("mammoth parse error");
  });
});

// ── Plain text extraction ─────────────────────────────────────────────

describe("extractFileText — Plain text", () => {
  it("reads plain text files directly", async () => {
    mockDownload("This is plain text content.");

    const result = await extractFileText(makeUpload({
      fileName: "notes.txt",
      contentType: "text/plain",
    }));

    expect(result).toBe("This is plain text content.");
  });

  it("reads markdown files by extension", async () => {
    mockDownload("# Heading\n\nMarkdown content.");

    const result = await extractFileText(makeUpload({
      fileName: "readme.md",
      contentType: "application/octet-stream",
    }));

    expect(result).toBe("# Heading\n\nMarkdown content.");
  });

  it("reads text/html content type as text", async () => {
    mockDownload("<p>HTML content</p>");

    const result = await extractFileText(makeUpload({
      fileName: "page.html",
      contentType: "text/html",
    }));

    expect(result).toBe("<p>HTML content</p>");
  });
});

// ── Download failure ──────────────────────────────────────────────────

describe("extractFileText — Download failure", () => {
  it("returns error message if file download fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const result = await extractFileText(makeUpload({
      fileName: "restricted.pdf",
      fileUrl: "https://cdn.example.com/restricted.pdf",
      contentType: "application/pdf",
    }));

    expect(result).toContain("[Error extracting restricted.pdf:");
    expect(result).toContain("403");
  });

  it("returns error message if fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await extractFileText(makeUpload({
      fileName: "timeout.pdf",
      contentType: "application/pdf",
    }));

    expect(result).toContain("[Error extracting timeout.pdf:");
    expect(result).toContain("Network timeout");
  });
});

// ── buildSourceContentFromUploads ─────────────────────────────────────

describe("buildSourceContentFromUploads", () => {
  it("returns empty string when no uploads and no context", async () => {
    const result = await buildSourceContentFromUploads([]);
    expect(result).toBe("");
  });

  it("returns only context when no uploads", async () => {
    const result = await buildSourceContentFromUploads([], "Attorney context here.");
    expect(result).toBe("=== Additional Context from Attorney ===\n\nAttorney context here.");
  });

  it("combines multiple uploads into a single source string", async () => {
    // First upload: TXT
    mockDownload("First document content.");
    // Second upload: TXT
    mockDownload("Second document content.");

    const uploads = [
      makeUpload({ id: 1, fileName: "doc1.txt", contentType: "text/plain", fileUrl: "https://cdn.example.com/doc1.txt" }),
      makeUpload({ id: 2, fileName: "doc2.txt", contentType: "text/plain", fileUrl: "https://cdn.example.com/doc2.txt" }),
    ];

    const result = await buildSourceContentFromUploads(uploads);

    expect(result).toContain("=== Document: doc1.txt ===");
    expect(result).toContain("First document content.");
    expect(result).toContain("=== Document: doc2.txt ===");
    expect(result).toContain("Second document content.");
    expect(result).toContain("---");
  });

  it("appends additional context after uploaded documents", async () => {
    mockDownload("Document text.");

    const uploads = [
      makeUpload({ id: 1, fileName: "intake.txt", contentType: "text/plain" }),
    ];

    const result = await buildSourceContentFromUploads(uploads, "Extra attorney notes.");

    expect(result).toContain("=== Document: intake.txt ===");
    expect(result).toContain("Document text.");
    expect(result).toContain("=== Additional Context from Attorney ===");
    expect(result).toContain("Extra attorney notes.");
  });

  it("includes error messages for failed extractions without throwing", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const uploads = [
      makeUpload({ id: 1, fileName: "broken.pdf", contentType: "application/pdf" }),
    ];

    const result = await buildSourceContentFromUploads(uploads);

    expect(result).toContain("=== Document: broken.pdf ===");
    expect(result).toContain("[Error extracting broken.pdf:");
  });
});
