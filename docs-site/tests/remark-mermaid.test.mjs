import assert from "node:assert/strict";
import test from "node:test";

import { transformMermaidBlocks } from "../remark-mermaid.ts";

test("converts Mermaid code fences into the built-in Mermaid component", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "code",
        lang: "MeRmAiD",
        value: "flowchart LR\n  A --> B",
      },
    ],
  };

  transformMermaidBlocks(tree);

  assert.deepEqual(tree.children[0], {
    type: "mdxJsxFlowElement",
    name: "Mermaid",
    attributes: [
      {
        type: "mdxJsxAttribute",
        name: "chart",
        value: "flowchart LR\n  A --> B",
      },
    ],
    children: [],
  });
});

test("preserves non-Mermaid code fences and transforms nested Mermaid blocks", () => {
  const javascript = {
    type: "code",
    lang: "javascript",
    value: "console.log('unchanged')",
  };
  const tree = {
    type: "root",
    children: [
      javascript,
      {
        type: "blockquote",
        children: [{ type: "code", lang: "mermaid", value: "" }],
      },
    ],
  };

  transformMermaidBlocks(tree);

  assert.equal(tree.children[0], javascript);
  assert.equal(tree.children[1].children[0].type, "mdxJsxFlowElement");
  assert.equal(tree.children[1].children[0].attributes[0].value, "");
});
