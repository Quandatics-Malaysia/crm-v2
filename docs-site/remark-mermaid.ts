import type { Root } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import type { Node, Parent } from "unist";

const toMermaidComponent = (chart: string): MdxJsxFlowElement => ({
  type: "mdxJsxFlowElement",
  children: [],
  name: "Mermaid",
  attributes: [
    {
      type: "mdxJsxAttribute",
      name: "chart",
      value: chart,
    },
  ],
});

const isParent = (node: Node): node is Parent =>
  "children" in node && Array.isArray(node.children);

export const transformMermaidBlocks = (node: Node) => {
  if (!isParent(node)) return;

  node.children = node.children.map((child) => {
    if (
      child.type === "code" &&
      "lang" in child &&
      typeof child.lang === "string" &&
      child.lang.toLowerCase() === "mermaid"
    ) {
      return toMermaidComponent(
        "value" in child && typeof child.value === "string" ? child.value : "",
      );
    }

    transformMermaidBlocks(child);
    return child;
  });
};

/**
 * Render standard ```mermaid fences with Zudoku's built-in Mermaid component.
 */
export const remarkMermaid = () => (tree: Root) => {
  transformMermaidBlocks(tree);
};
