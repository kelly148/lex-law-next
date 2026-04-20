/**
 * rehypeParagraphIds.ts
 *
 * A rehype plugin that assigns stable sequential IDs to every paragraph
 * element in the rendered markdown output.
 *
 * IDs are in the form "p-{n}" (1-indexed), e.g. "p-1", "p-2", "p-3".
 *
 * This enables AnchorDisplay to scroll directly to a paragraph by ID
 * when the locatorText matches, complementing the DOM tree-walker approach
 * in anchorLocator.ts.
 *
 * Usage with Streamdown:
 *   import { rehypeParagraphIds } from '@/lib/rehypeParagraphIds';
 *   <Streamdown rehypePlugins={[..., rehypeParagraphIds]}>
 *     {content}
 *   </Streamdown>
 */

import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

/**
 * Rehype plugin: assigns `id="p-{n}"` to every `<p>` element in the HAST tree.
 * Existing IDs are preserved (not overwritten).
 */
export const rehypeParagraphIds: Plugin<[], Root> = () => {
  return (tree: Root) => {
    let counter = 0;
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "p") {
        counter += 1;
        if (!node.properties) node.properties = {};
        // Only assign if no existing id
        if (!node.properties.id) {
          node.properties.id = `p-${counter}`;
        }
      }
    });
  };
};
