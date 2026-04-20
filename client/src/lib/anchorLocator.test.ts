/**
 * anchorLocator.test.ts
 *
 * Tests for the DOM tree-walker locator. Uses jsdom (provided by vitest's
 * default environment) to build real DOM trees.
 *
 * Key assertions:
 *   - Finds text that is split across inline tags (cross-tag span)
 *   - Returns null for no match
 *   - Returns the correct element when multiple paragraphs exist
 *   - scrollToLocator returns true/false correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { locateParagraph, scrollToLocator } from "./anchorLocator";

// Helper: build a container element from an HTML string
function makeContainer(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("locateParagraph", () => {
  it("finds a simple paragraph by plain text", () => {
    const container = makeContainer(
      `<p id="p-0">First paragraph.</p>
       <p id="p-1">Second paragraph with target text here.</p>
       <p id="p-2">Third paragraph.</p>`,
    );
    const result = locateParagraph(container, "target text here");
    expect(result).not.toBeNull();
    expect(result!.element.id).toBe("p-1");
    expect(result!.stableId).toBe("p-1");
  });

  it("finds text that spans inline tags (cross-tag span)", () => {
    // "indemnification obligations" spans across a <strong> boundary
    const container = makeContainer(
      `<p id="p-0">The party shall bear all <strong>indemnification</strong> obligations arising from this agreement.</p>`,
    );
    const result = locateParagraph(container, "indemnification obligations");
    expect(result).not.toBeNull();
    expect(result!.element.id).toBe("p-0");
  });

  it("returns null when locatorText is not found", () => {
    const container = makeContainer(
      `<p id="p-0">This paragraph does not contain the target.</p>`,
    );
    const result = locateParagraph(container, "completely absent text");
    expect(result).toBeNull();
  });

  it("returns null for empty locatorText", () => {
    const container = makeContainer(`<p id="p-0">Some content.</p>`);
    expect(locateParagraph(container, "")).toBeNull();
    expect(locateParagraph(container, "   ")).toBeNull();
  });

  it("returns the first matching paragraph when multiple match", () => {
    const container = makeContainer(
      `<p id="p-0">The word duplicate appears here.</p>
       <p id="p-1">The word duplicate appears here too.</p>`,
    );
    const result = locateParagraph(container, "duplicate appears here");
    expect(result!.element.id).toBe("p-0");
  });

  it("finds text inside a list item", () => {
    const container = makeContainer(
      `<ul><li id="li-0">Liability cap of <em>one million dollars</em> per claim.</li></ul>`,
    );
    const result = locateParagraph(container, "one million dollars per claim");
    expect(result).not.toBeNull();
    expect(result!.element.id).toBe("li-0");
  });

  it("finds text inside a blockquote", () => {
    const container = makeContainer(
      `<blockquote id="bq-0">As stated in the original agreement, all parties consent.</blockquote>`,
    );
    const result = locateParagraph(container, "all parties consent");
    expect(result).not.toBeNull();
    expect(result!.element.id).toBe("bq-0");
  });

  it("finds text inside a heading", () => {
    const container = makeContainer(
      `<h2 id="h-0">Section 4.2 — Indemnification Obligations</h2>
       <p id="p-0">Body text here.</p>`,
    );
    const result = locateParagraph(container, "Indemnification Obligations");
    expect(result).not.toBeNull();
    expect(result!.element.id).toBe("h-0");
  });

  it("handles deeply nested inline elements", () => {
    const container = makeContainer(
      `<p id="p-0">The <em><strong>governing law</strong></em> shall be the State of Delaware.</p>`,
    );
    const result = locateParagraph(container, "governing law shall be");
    expect(result).not.toBeNull();
    expect(result!.element.id).toBe("p-0");
  });
});

describe("scrollToLocator", () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView; mock it
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("returns true and calls scrollIntoView when text is found", () => {
    const container = makeContainer(
      `<p id="p-0">The indemnification clause applies here.</p>`,
    );
    const result = scrollToLocator(container, "indemnification clause");
    expect(result).toBe(true);
    const p = container.querySelector("#p-0")!;
    expect(p.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("returns false when text is not found", () => {
    const container = makeContainer(`<p id="p-0">Some content.</p>`);
    const result = scrollToLocator(container, "absent text");
    expect(result).toBe(false);
  });
});
