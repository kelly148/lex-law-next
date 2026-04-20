/**
 * anchorLocator.ts
 *
 * Locates a text fragment inside a rendered markdown container and returns
 * the paragraph element that contains it.
 *
 * DESIGN CONSTRAINT (§3.3.2 of build instructions):
 *   The target text may span multiple DOM nodes (e.g. <p>text <strong>bold</strong>
 *   more text</p>). We MUST NOT use:
 *     - document.body.innerText.indexOf()   ← single-node, misses cross-tag spans
 *     - window.find()                       ← non-standard, unreliable cross-browser
 *   Instead we use a DOM tree-walker that concatenates text content across all
 *   descendant text nodes of each block-level element, then searches the
 *   concatenated string for the locator fragment.
 */

export interface LocateResult {
  /** The paragraph element whose concatenated text contains the locator. */
  element: Element;
  /** The stable ID attribute assigned by rehype-paragraph-ids (e.g. "p-3"). */
  stableId: string;
}

/**
 * Collects all text-node content under `root` in document order,
 * concatenating into a single string.
 */
function collectText(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    parts.push((node as Text).data);
  }
  return parts.join("");
}

/**
 * Searches `container` for the first paragraph-level element whose
 * concatenated text content contains `locatorText`.
 *
 * @param container  The DOM element that wraps the rendered markdown draft.
 * @param locatorText  The ~100-char excerpt to locate (from `sectionAnchor.locatorText`).
 * @returns  A `LocateResult` if found, or `null` if no paragraph matches.
 */
export function locateParagraph(
  container: Element,
  locatorText: string,
): LocateResult | null {
  if (!locatorText || locatorText.trim() === "") return null;

  // Walk direct children that are block-level elements (p, li, blockquote, h1-h6, td).
  // We check each element's full concatenated text for the locator fragment.
  const blockSelector = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td";
  const blocks = Array.from(container.querySelectorAll(blockSelector));

  for (const block of blocks) {
    const text = collectText(block);
    if (text.includes(locatorText)) {
      const stableId = block.id ?? "";
      return { element: block, stableId };
    }
  }

  return null;
}

/**
 * Scrolls the first paragraph in `container` that contains `locatorText`
 * into view. Uses `scrollIntoView({ behavior: 'smooth', block: 'center' })`.
 *
 * @returns `true` if a matching paragraph was found and scrolled to,
 *          `false` if no match was found.
 */
export function scrollToLocator(
  container: Element,
  locatorText: string,
): boolean {
  const result = locateParagraph(container, locatorText);
  if (!result) return false;

  result.element.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}
