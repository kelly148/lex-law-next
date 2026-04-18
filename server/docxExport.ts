/**
 * DOCX export for Lex Law Next
 * Generates a branded Word document for a completed phase output.
 * Uses the `docx` npm package (v9+).
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, Header, Footer, PageNumber,
  NumberFormat, convertInchesToTwip, LevelFormat,
} from "docx";

export interface DocxMeta {
  matterName: string;
  clientName?: string;
  phaseLabel: string;
  jurisdiction?: string;
  date?: string; // ISO string or formatted date; defaults to today
}

// ── Firm constants ────────────────────────────────────────────────────
const FIRM_NAME = "The Satterwhite Law Firm, PLLC";
const FIRM_ADDRESS = "Alexandria, Virginia";
const FIRM_ATTORNEY = "Dontavius L. Satterwhite, Esq.";

// Navy blue: #1F3864  Accent blue: #2E75B6
const NAVY = "1F3864";
const ACCENT = "2E75B6";

// ── Helpers ───────────────────────────────────────────────────────────

function formatDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Split raw text into paragraphs, treating blank lines as separators. */
function parseTextToParagraphs(text: string): Paragraph[] {
  const lines = text.split(/\r?\n/);
  const paragraphs: Paragraph[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Heading detection: lines starting with # / ## / ###
    if (/^###\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^###\s+/, ""),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 80 },
        })
      );
      continue;
    }
    if (/^##\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^##\s+/, ""),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 100 },
        })
      );
      continue;
    }
    if (/^#\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^#\s+/, ""),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 120 },
        })
      );
      continue;
    }

    // Bold lines: **text** or __text__ (entire line)
    const boldMatch = line.match(/^\*\*(.+)\*\*$/) || line.match(/^__(.+)__$/);
    if (boldMatch) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: boldMatch[1], bold: true })],
          spacing: { before: 120, after: 60 },
        })
      );
      continue;
    }

    // Bullet list items: lines starting with - / * / •
    if (/^[-*•]\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^[-*•]\s+/, ""),
          bullet: { level: 0 },
          spacing: { before: 60, after: 60 },
        })
      );
      continue;
    }

    // Numbered list items: lines starting with 1. / 2. etc.
    if (/^\d+\.\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^\d+\.\s+/, ""),
          numbering: { reference: "default-numbering", level: 0 },
          spacing: { before: 60, after: 60 },
        })
      );
      continue;
    }

    // Horizontal rule: --- or ===
    if (/^[-=]{3,}$/.test(line.trim())) {
      paragraphs.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT },
          },
          spacing: { before: 120, after: 120 },
        })
      );
      continue;
    }

    // Empty line → spacer
    if (line.trim() === "") {
      paragraphs.push(new Paragraph({ text: "", spacing: { before: 60, after: 60 } }));
      continue;
    }

    // Default: body paragraph with inline bold support
    const children = parseInlineBold(line);
    paragraphs.push(
      new Paragraph({
        children,
        spacing: { before: 80, after: 80 },
      })
    );
  }

  return paragraphs;
}

/** Parse inline **bold** and __bold__ markers within a line. */
function parseInlineBold(text: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((part) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/) || part.match(/^__(.+)__$/);
    if (boldMatch) {
      return new TextRun({ text: boldMatch[1], bold: true });
    }
    return new TextRun({ text: part });
  });
}

// ── Main export function ──────────────────────────────────────────────

export async function generatePhaseDocx(
  content: string,
  meta: DocxMeta,
): Promise<Buffer> {
  const dateStr = formatDate(meta.date);

  // ── Header ──
  const docHeader = new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: FIRM_NAME,
            bold: true,
            color: NAVY,
            size: 20, // 10pt
          }),
          new TextRun({
            text: `  ·  ${FIRM_ADDRESS}`,
            color: "666666",
            size: 18,
          }),
        ],
        alignment: AlignmentType.RIGHT,
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT },
        },
        spacing: { after: 0 },
      }),
    ],
  });

  // ── Footer ──
  const docFooter = new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: `${FIRM_NAME}  ·  CONFIDENTIAL  ·  Page `,
            color: "888888",
            size: 16,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            color: "888888",
            size: 16,
          }),
          new TextRun({
            text: " of ",
            color: "888888",
            size: 16,
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            color: "888888",
            size: 16,
          }),
        ],
        alignment: AlignmentType.CENTER,
        border: {
          top: { style: BorderStyle.SINGLE, size: 4, color: ACCENT },
        },
        spacing: { before: 0 },
      }),
    ],
  });

  // ── Cover block ──
  const coverParagraphs: Paragraph[] = [
    // Firm name large
    new Paragraph({
      children: [
        new TextRun({
          text: FIRM_NAME,
          bold: true,
          color: NAVY,
          size: 36, // 18pt
          font: "Garamond",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: FIRM_ADDRESS,
          color: "555555",
          size: 22,
          font: "Garamond",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: FIRM_ATTORNEY,
          color: "555555",
          size: 20,
          italics: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
    }),

    // Divider
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY },
      },
      spacing: { before: 0, after: 240 },
    }),

    // Phase label
    new Paragraph({
      children: [
        new TextRun({
          text: meta.phaseLabel.toUpperCase(),
          bold: true,
          color: ACCENT,
          size: 28,
          font: "Garamond",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 160 },
    }),

    // Matter name
    new Paragraph({
      children: [
        new TextRun({
          text: meta.matterName,
          bold: true,
          color: NAVY,
          size: 32,
          font: "Garamond",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
    }),

    // Client name (if present)
    ...(meta.clientName
      ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Client: ", bold: true, size: 22 }),
              new TextRun({ text: meta.clientName, size: 22 }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 80 },
          }),
        ]
      : []),

    // Jurisdiction (if present)
    ...(meta.jurisdiction
      ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Jurisdiction: ", bold: true, size: 22 }),
              new TextRun({ text: meta.jurisdiction, size: 22 }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 80 },
          }),
        ]
      : []),

    // Date
    new Paragraph({
      children: [
        new TextRun({ text: "Date: ", bold: true, size: 22 }),
        new TextRun({ text: dateStr, size: 22 }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
    }),

    // Confidentiality notice
    new Paragraph({
      children: [
        new TextRun({
          text: "CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED",
          bold: true,
          color: "CC0000",
          size: 18,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 0 },
    }),

    // Divider before content
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT },
      },
      spacing: { before: 240, after: 320 },
    }),
  ];

  // ── Body content ──
  const bodyParagraphs = parseTextToParagraphs(content);

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri",
            size: 22, // 11pt
            color: "222222",
          },
          paragraph: {
            spacing: { line: 276, lineRule: "auto" as any },
          },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Garamond",
            size: 32,
            bold: true,
            color: NAVY,
          },
          paragraph: {
            spacing: { before: 360, after: 120 },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Garamond",
            size: 26,
            bold: true,
            color: ACCENT,
          },
          paragraph: {
            spacing: { before: 280, after: 100 },
          },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Garamond",
            size: 24,
            bold: true,
            color: "444444",
          },
          paragraph: {
            spacing: { before: 200, after: 80 },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1.25),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
            },
          },
        },
        headers: { default: docHeader },
        footers: { default: docFooter },
        children: [...coverParagraphs, ...bodyParagraphs],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}
