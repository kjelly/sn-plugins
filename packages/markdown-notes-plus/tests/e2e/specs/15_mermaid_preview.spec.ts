import { expect, test } from "@playwright/test";
import { EditorPage } from "../pages/EditorPage.ts";
import { MockHost } from "../pages/MockHost.ts";

const FLOWCHART = "```mermaid\nflowchart LR\n  Source --> Writing\n```\n";

async function enterWritingIfPrompted(editor: EditorPage): Promise<void> {
  const dialog = editor.frame.getByRole("dialog", { name: "Writing normalization required" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "套用並進入 Writing" }).click();
  }
  await expect(editor.writingPane).toBeVisible();
}

test.describe("Mermaid Writing preview", () => {
  test("renders an accessible, isolated preview without changing canonical Markdown", async ({ page }) => {
    const source = "```mermaid\nflowchart LR\n  A[Source] --> B[Writing]\n```\n";
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(source, "doc-mermaid-preview", false);
    await enterWritingIfPrompted(editor);

    const block = editor.writingEditor.locator('.code-block-wrapper[data-language="mermaid"]');
    await expect(block).toBeVisible();
    await expect(block.getByRole("button", { name: "Show editable Mermaid source" })).toHaveAttribute("aria-pressed", "true");
    await host.clearSaves();

    await block.getByRole("button", { name: "Render Mermaid preview" }).click();
    const image = block.locator("img.mermaid-preview-image");
    await expect(image).toBeVisible({ timeout: 15_000 });
    await expect(image).toHaveAttribute("alt", "Mermaid flowchart diagram");
    await expect(block.locator(".mermaid-preview-description")).toContainText("only exact Markdown editing surface");
    await expect(block.locator("a")).toHaveCount(0);

    await page.keyboard.type("MUST_NOT_EDIT_HIDDEN_SOURCE");
    await page.waitForTimeout(550);
    expect(await host.getSaves()).toHaveLength(0);
    await editor.switchMode("Source");
    expect(await editor.getSourceText()).toBe(source);
  });

  for (const allowed of [
    {
      name: "sequence",
      source: "```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```\n",
      alt: "Mermaid sequence diagram",
    },
    {
      name: "class",
      source: "```mermaid\nclassDiagram\n  Animal <|-- Duck\n```\n",
      alt: "Mermaid class diagram",
    },
    {
      name: "state",
      source: "```mermaid\nstateDiagram-v2\n  [*] --> Ready\n```\n",
      alt: "Mermaid state diagram",
    },
    {
      name: "entity relationship",
      source: "```mermaid\nerDiagram\n  USER ||--o{ NOTE : owns\n```\n",
      alt: "Mermaid entity relationship diagram",
    },
  ]) {
    test(`renders the allowed ${allowed.name} diagram type`, async ({ page }) => {
      const host = new MockHost(page);
      const editor = new EditorPage(page);
      await host.goto(allowed.source, `doc-mermaid-allowed-${allowed.name}`, false);
      await enterWritingIfPrompted(editor);

      const block = editor.writingEditor.locator('.code-block-wrapper[data-language="mermaid"]');
      await block.getByRole("button", { name: "Render Mermaid preview" }).click();
      await expect(block.locator("img.mermaid-preview-image")).toHaveAttribute("alt", allowed.alt, { timeout: 15_000 });
    });
  }

  test("keeps non-Mermaid fenced code as code-only", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto("```mermaid-js\nflowchart LR\n  A --> B\n```\n", "doc-non-mermaid-code", false);
    await enterWritingIfPrompted(editor);

    const block = editor.writingEditor.locator('.code-block-wrapper[data-language="mermaid-js"]');
    await expect(block).toBeVisible();
    await expect(block.getByRole("button", { name: "Render Mermaid preview" })).toHaveCount(0);
  });

  test("rerenders the active preview after a theme or remote source change", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(FLOWCHART, "doc-mermaid-refresh", false);
    await enterWritingIfPrompted(editor);

    const block = editor.writingEditor.locator('.code-block-wrapper[data-language="mermaid"]');
    await block.getByRole("button", { name: "Render Mermaid preview" }).click();
    const image = block.locator("img.mermaid-preview-image");
    await expect(image).toBeVisible({ timeout: 15_000 });
    const lightUrl = await image.getAttribute("src");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => image.getAttribute("src"), { timeout: 15_000 }).not.toBe(lightUrl);
    const darkUrl = await image.getAttribute("src");

    await host.updateCurrentNote("```mermaid\nflowchart LR\n  Source --> Preview --> Save\n```\n");
    await expect.poll(() => image.getAttribute("src"), { timeout: 15_000 }).not.toBe(darkUrl);
  });

  test("waits for a delayed host theme stylesheet before rerendering", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(FLOWCHART, "doc-mermaid-delayed-theme", false);
    await enterWritingIfPrompted(editor);

    const block = editor.writingEditor.locator('.code-block-wrapper[data-language="mermaid"]');
    await block.getByRole("button", { name: "Render Mermaid preview" }).click();
    const image = block.locator("img.mermaid-preview-image");
    await expect(image).toBeVisible({ timeout: 15_000 });
    const initialUrl = await image.getAttribute("src");
    const initialBackground = await editor.frame.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);

    const themeUrl = new URL("/delayed-mermaid-theme.css", page.url()).href;
    let releaseTheme: (() => void) | undefined;
    await page.route(themeUrl, async (route) => {
      await new Promise<void>((resolve) => {
        releaseTheme = resolve;
      });
      await route.fulfill({
        contentType: "text/css",
        body: "body { background-color: rgb(12, 34, 56) !important; color: rgb(240, 241, 242) !important; }",
      });
    });
    const requestPromise = page.waitForRequest(themeUrl);
    await host.setThemes([themeUrl]);
    await requestPromise;
    await expect.poll(() => Boolean(releaseTheme)).toBe(true);
    await page.waitForTimeout(550);
    expect(await image.getAttribute("src")).toBe(initialUrl);
    expect(await editor.frame.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor)).toBe(initialBackground);

    releaseTheme?.();
    await expect.poll(
      () => editor.frame.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor),
      { timeout: 15_000 },
    ).toBe("rgb(12, 34, 56)");
    await expect.poll(() => image.getAttribute("src"), { timeout: 15_000 }).not.toBe(initialUrl);
  });

  for (const scenario of [
    {
      name: "invalid syntax",
      source: "```mermaid\nflowchart LR\n  A[unterminated\n```\n",
      message: "could not be rendered",
    },
    {
      name: "an oversized source",
      source: `\`\`\`mermaid\nflowchart LR\n${"A".repeat(20_001)}\n\`\`\`\n`,
      message: "too large",
    },
    {
      name: "a disallowed diagram type",
      source: "```mermaid\npie\n  \"Allowed?\" : 1\n```\n",
      message: "not allowed",
    },
    {
      name: "an interactive link",
      source: "```mermaid\nflowchart LR\n  A --> B\n  click A href \"https://preview-must-not-fetch.invalid/path\"\n```\n",
      message: "links are not supported",
    },
    {
      name: "an HTML label",
      source: "```mermaid\nflowchart LR\n  A[\"<b>Unsafe</b>\"] --> B\n```\n",
      message: "HTML labels are not supported",
    },
    {
      name: "remote icon syntax",
      source: '```mermaid\nflowchart LR\n  A@{ icon: "logos:github", label: "Remote" }\n```\n',
      message: "remote icon packs are not supported",
    },
    {
      name: "diagram-level config",
      source: "```mermaid\n%%{init: { 'theme': 'forest' }}%%\nflowchart LR\n  A --> B\n```\n",
      message: "configuration is not supported",
    },
  ]) {
    test(`falls back to unchanged code for ${scenario.name}`, async ({ page }) => {
      const externalRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().startsWith("https://preview-must-not-fetch.invalid")) externalRequests.push(request.url());
      });
      const host = new MockHost(page);
      const editor = new EditorPage(page);
      await host.goto(scenario.source, `doc-mermaid-${scenario.name}`, false);
      await enterWritingIfPrompted(editor);

      const block = editor.writingEditor.locator('.code-block-wrapper[data-language="mermaid"]');
      const originalCode = await block.locator("code.code-block-content").textContent();
      await host.clearSaves();
      await block.getByRole("button", { name: "Render Mermaid preview" }).click();
      await expect(block.locator("pre.code-block-pre")).toBeVisible({ timeout: 15_000 });
      await expect(block.getByRole("alert")).toContainText(scenario.message);
      await expect(block.locator("img.mermaid-preview-image")).not.toBeVisible();
      expect(await block.locator("code.code-block-content").textContent()).toBe(originalCode);
      expect(await host.getSaves()).toHaveLength(0);
      expect(externalRequests).toEqual([]);

      // CodeMirror virtualizes an exceptionally long line, so its DOM helper
      // cannot reconstruct the oversized case. The lossless Source assertion
      // is made for every ordinary-size fallback and the code-node assertion
      // above covers the oversized input without relying on virtualized DOM.
      if (scenario.name !== "an oversized source") {
        await editor.switchMode("Source");
        expect(await editor.getSourceText()).toBe(scenario.source);
      }
    });
  }
});
