import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const pagesDirectory = join(root, "pages");
const baseUrl = "http://localhost:4000";

const collectMarkdownFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collectMarkdownFiles(path) : [path];
    }),
  );
  return files.flat();
};

const routeForFile = (path) => {
  const extension = extname(path);
  const route = relative(pagesDirectory, path)
    .slice(0, -extension.length)
    .split(sep)
    .join("/");
  return route === "index" ? "/" : `/${route.replace(/\/index$/, "")}`;
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Zudoku preview server did not start");
};

const markdownFiles = await collectMarkdownFiles(pagesDirectory);
const mermaidRoutes = [];
for (const path of markdownFiles) {
  if (![".md", ".mdx"].includes(extname(path))) continue;
  const source = await readFile(path, "utf8");
  const diagramCount = source.match(/^```mermaid\s*$/gmu)?.length ?? 0;
  if (diagramCount > 0) {
    mermaidRoutes.push({ route: routeForFile(path), diagramCount });
  }
}

assert.ok(mermaidRoutes.length > 0, "Expected at least one Mermaid documentation page");

const server = spawn(
  process.execPath,
  [join(root, "node_modules/zudoku/cli.js"), "preview"],
  { cwd: root, stdio: "inherit" },
);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const { route, diagramCount } of mermaidRoutes) {
    const response = await page.goto(`${baseUrl}${route}`, {
      waitUntil: "networkidle",
    });
    assert.ok(response?.ok(), `${route} returned ${response?.status()}`);
    const diagrams = page.locator("main svg[aria-roledescription]");
    await diagrams.first().waitFor({ state: "visible" });
    assert.equal(
      await diagrams.count(),
      diagramCount,
      `${route} rendered the wrong number of Mermaid diagrams`,
    );
    assert.equal(await page.getByText("Mermaid Error").count(), 0, `${route} has a Mermaid error`);
    assert.equal(await page.locator("code.language-mermaid").count(), 0, `${route} contains an unrendered Mermaid fence`);
  }

  assert.deepEqual(pageErrors, [], `Browser page errors:\n${pageErrors.join("\n")}`);
  console.log(`Verified rendered Mermaid SVGs on ${mermaidRoutes.length} routes.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
