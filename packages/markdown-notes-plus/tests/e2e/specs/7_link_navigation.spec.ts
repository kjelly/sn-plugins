import { test, expect, type Frame, type Page } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

type OpenedLink = { url: string; target?: string; features?: string };
type OpenedLinks = { top: OpenedLink[]; editorFrame: OpenedLink[]; all: OpenedLink[] };

function findEditorFrame(page: Page): Frame {
  const editorFrame = page.frames().find((frame) => frame.parentFrame() === page.mainFrame() && frame.url().includes("/index.html"));
  if (!editorFrame) throw new Error("Editor frame was not available for link interception");
  return editorFrame;
}

function installLinkInterceptor(): void {
  const testWindow = self as Window & { __openedLinks?: OpenedLink[] };
  testWindow.__openedLinks = [];
  testWindow.open = (url, target, features) => {
    testWindow.__openedLinks?.push({
      url: String(url),
      target: target ? String(target) : undefined,
      features: features ? String(features) : undefined,
    });
    return null;
  };
}

async function interceptOpenedLinks(page: Page): Promise<void> {
  await page.evaluate(installLinkInterceptor);
  await findEditorFrame(page).evaluate(installLinkInterceptor);
}

async function readOpenedLinks(page: Page): Promise<OpenedLinks> {
  const editorFrame = await findEditorFrame(page).evaluate(() => {
    return (self as Window & { __openedLinks?: OpenedLink[] }).__openedLinks ?? [];
  });
  const top = await page.evaluate(() => {
    return (self as Window & { __openedLinks?: OpenedLink[] }).__openedLinks ?? [];
  });
  return { top, editorFrame, all: [...top, ...editorFrame] };
}

function expectSingleOpener(opened: OpenedLinks): void {
  expect(opened.all, "safe external link must open exactly once").toHaveLength(1);
  expect(opened.top.length + opened.editorFrame.length, "safe external link must not duplicate its opener").toBe(1);
}

test.describe("Link Navigation in New Tab", () => {
  test("Writing mode - clicking a safe external link opens with _blank and noopener,noreferrer", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Links Test\n\nVisit [Standard Notes](https://standardnotes.com) here.\n", "note-links-1");

    await interceptOpenedLinks(page);

    const link = editor.writingPane.locator("a", { hasText: "Standard Notes" });
    await expect(link).toBeVisible();
    await link.click();

    const opened = await readOpenedLinks(page);

    expectSingleOpener(opened);
    expect(opened.all[0].url).toBe("https://standardnotes.com");
    expect(opened.all[0].target).toBe("_blank");
    expect(opened.all[0].features).toBe("noopener,noreferrer");
  });

  test("Mindmap mode - clicking a safe external link in an SVG node opens with _blank", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Root\n\n## [External Docs](https://docs.standardnotes.com)\n\nSome note content\n", "note-links-2");

    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();

    await interceptOpenedLinks(page);

    const link = editor.mindmapSvg.locator("a", { hasText: "External Docs" });
    await expect(link).toBeVisible();
    await link.click();

    const opened = await readOpenedLinks(page);

    expectSingleOpener(opened);
    expect(opened.all[0].url).toBe("https://docs.standardnotes.com");
    expect(opened.all[0].target).toBe("_blank");
  });

  test("Source mode - Ctrl/Cmd+click on a safe external markdown link opens once", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("[Help Guide](https://standardnotes.com/help)\n", "note-links-3");
    await editor.switchMode("Source");

    await interceptOpenedLinks(page);

    const cmLine = editor.sourcePane.locator(".cm-line").first();
    await expect(cmLine).toBeVisible();

    // Plain click does NOT open link
    await cmLine.click();
    let opened = await readOpenedLinks(page);
    expect(opened.all).toHaveLength(0);

    // Ctrl+Click opens link
    await cmLine.click({
      modifiers: ["Control"],
    });

    opened = await readOpenedLinks(page);
    expectSingleOpener(opened);
    expect(opened.all[0].url).toBe("https://standardnotes.com/help");
  });

  test("Security - dangerous javascript: scheme is blocked and never opened", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("[Malicious Link](javascript:alert(1))\n", "note-links-4");

    await interceptOpenedLinks(page);

    const expectedReadOnlyStatus = "Writing read-only · Writing serializer changed the source; use Source mode for exact Markdown.";
    await expect(editor.status).toHaveText(expectedReadOnlyStatus);
    const editorFrame = findEditorFrame(page);
    const editorStateBeforeClick = {
      frameUrl: editorFrame.url(),
      status: await editor.status.textContent(),
      writingContent: await editor.writingPane.textContent(),
    };
    const link = editor.writingPane.locator("a", { hasText: "Malicious Link" });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAttribute("href");
    const frameNavigation = page.waitForEvent("framenavigated", {
      predicate: (frame) => frame === editorFrame,
      timeout: 500,
    });
    await link.click();
    await expect(frameNavigation).rejects.toThrow(/Timeout/);

    await expect(editor.writingPane).toBeVisible();
    await expect(editor.status).toHaveText(expectedReadOnlyStatus);
    expect(editorFrame.url()).toBe(editorStateBeforeClick.frameUrl);
    expect(await editor.status.textContent()).toBe(editorStateBeforeClick.status);
    expect(await editor.writingPane.textContent()).toBe(editorStateBeforeClick.writingContent);

    const opened = await readOpenedLinks(page);

    expect(opened.all).toHaveLength(0);
    expect(opened.top).toHaveLength(0);
    expect(opened.editorFrame).toHaveLength(0);
  });
});
