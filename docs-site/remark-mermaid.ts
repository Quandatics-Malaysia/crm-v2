type MarkdownNode = {
  [key: string]: unknown;
  type: string;
  children?: MarkdownNode[];
  lang?: string | null;
  value?: string;
};

type MarkdownParent = MarkdownNode & {
  children: MarkdownNode[];
};

const toMermaidComponent = (chart: string): MarkdownNode => ({
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

const transformMermaidBlocks = (node: MarkdownNode) => {
  if (!node.children) return;

  node.children = node.children.map((child) => {
    if (
      child.type === "code" &&
      child.lang?.toLowerCase() === "mermaid"
    ) {
      return toMermaidComponent(child.value ?? "");
    }

    transformMermaidBlocks(child);
    return child;
  });
};

/**
 * Render standard ```mermaid fences with Zudoku's built-in Mermaid component.
 */
export const remarkMermaid = () => (tree: MarkdownParent) => {
  transformMermaidBlocks(tree);
};
