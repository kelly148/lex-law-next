/**
 * File text extraction utility for uploaded documents.
 * Downloads files from S3 URLs and extracts their text content
 * so it can be passed to LLM providers as source material.
 *
 * Supported formats:
 * - PDF: extracted via pdftotext (poppler-utils, pre-installed)
 * - DOCX/DOC: extracted via mammoth
 * - TXT/MD: read directly
 * - Other: best-effort UTF-8 decode
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import mammoth from "mammoth";

export interface UploadRecord {
  id: number;
  fileName: string;
  fileUrl: string;
  contentType: string;
}

/**
 * Download a file from a URL and return its buffer.
 */
async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download file (${res.status}): ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Extract text from a PDF buffer using pdftotext.
 */
function extractPdfText(buffer: Buffer): string {
  const tmpIn = join(tmpdir(), `lex-upload-${Date.now()}.pdf`);
  const tmpOut = join(tmpdir(), `lex-upload-${Date.now()}.txt`);
  try {
    writeFileSync(tmpIn, buffer);
    execSync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`, { timeout: 30000 });
    const text = readFileSync(tmpOut, "utf-8");
    return text.trim();
  } catch (err: any) {
    throw new Error(`PDF text extraction failed: ${err.message}`);
  } finally {
    if (existsSync(tmpIn)) unlinkSync(tmpIn);
    if (existsSync(tmpOut)) unlinkSync(tmpOut);
  }
}

/**
 * Extract text from a DOCX buffer using mammoth.
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

/**
 * Extract text from a single uploaded file.
 * Returns the extracted text, or an error message if extraction fails.
 */
export async function extractFileText(upload: UploadRecord): Promise<string> {
  const { fileName, fileUrl, contentType } = upload;
  const lowerName = fileName.toLowerCase();
  const lowerType = contentType.toLowerCase();

  try {
    const buffer = await downloadFile(fileUrl);

    // PDF
    if (lowerType.includes("pdf") || lowerName.endsWith(".pdf")) {
      return extractPdfText(buffer);
    }

    // DOCX / DOC
    if (
      lowerType.includes("wordprocessingml") ||
      lowerType.includes("msword") ||
      lowerName.endsWith(".docx") ||
      lowerName.endsWith(".doc")
    ) {
      return await extractDocxText(buffer);
    }

    // Plain text / Markdown
    if (
      lowerType.includes("text/") ||
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md") ||
      lowerName.endsWith(".rtf")
    ) {
      return buffer.toString("utf-8").trim();
    }

    // Fallback: attempt UTF-8 decode
    const text = buffer.toString("utf-8").trim();
    if (text.length > 0 && !text.includes("\x00")) {
      return text;
    }

    return `[Binary file: ${fileName} — content could not be extracted as text]`;
  } catch (err: any) {
    return `[Error extracting ${fileName}: ${err.message}]`;
  }
}

/**
 * Extended upload record that may include pre-extracted text from the DB.
 */
export interface UploadRecordWithCache extends UploadRecord {
  extractedText?: string | null;
}

/**
 * Extract text from multiple uploaded files and combine into a single
 * source content string suitable for passing to an LLM.
 *
 * Uses cached extractedText from the DB when available (set at upload time)
 * to avoid re-downloading and re-parsing files during phase start, which
 * would cause 524 gateway timeouts on large PDFs/DOCXs.
 */
export async function buildSourceContentFromUploads(
  uploads: UploadRecordWithCache[],
  additionalContext?: string,
): Promise<string> {
  if (uploads.length === 0 && !additionalContext) return "";

  const parts: string[] = [];

  if (uploads.length > 0) {
    const extractedParts = await Promise.all(
      uploads.map(async (upload) => {
        // Use cached text if available (pre-extracted at upload time)
        const text = upload.extractedText?.trim()
          ? upload.extractedText.trim()
          : await extractFileText(upload);
        return `=== Document: ${upload.fileName} ===\n\n${text}`;
      })
    );
    parts.push(...extractedParts);
  }

  if (additionalContext?.trim()) {
    parts.push(`=== Additional Context from Attorney ===\n\n${additionalContext.trim()}`);
  }

  return parts.join("\n\n---\n\n");
}
