import { test, expect, type Page } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

type OpenedLink = { url: string; target?: string; features?: string };

async function interceptOpenedLinks(page: Page): Promise<void> {
  await page.evaluate(() => {
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
  });
}

async function readOpenedLinks(page: Page): Promise<OpenedLink[]> {
  return await page.evaluate(() => {
    return (self as Window & { __openedLinks?: OpenedLink[] }).__openedLinks ?? [];
  });
}

test.describe("Link Navigation in New Tab", () => {
  test("Writing mode - clicking a link calls the host window opener with _blank and noopener,noreferrer", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Links Test\n\nVisit [Standard Notes](https://standardnotes.com) here.\n", "note-links-1");

    await interceptOpenedLinks(page);

    const link = editor.writingPane.locator("a", { hasText: "Standard Notes" });
    await expect(link).toBeVisible();
    await link.click();

    const opened = await readOpenedLinks(page);

    expect(opened.length).toBe(1);
    expect(opened[0].url).toBe("https://standardnotes.com");
    expect(opened[0].target).toBe("_blank");
    expect(opened[0].features).toBe("noopener,noreferrer");
  });

  test("Mindmap mode - clicking a link in SVG node calls the host window opener with _blank", async ({ page }) => {
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

    expect(opened.length).toBe(1);
    expect(opened[0].url).toBe("https://docs.standardnotes.com");
    expect(opened[0].target).toBe("_blank");
  });

  test("Source mode - Ctrl/Cmd+click on markdown link calls the host window opener", async ({ page }) => {
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
    expect(opened.length).toBe(0);

    // Ctrl+Click opens link
    await cmLine.click({
      modifiers: ["Control"],
    });

    opened = await readOpenedLinks(page);
    expect(opened.length).toBe(1);
    expect(opened[0].url).toBe("https://standardnotes.com/help");
  });

  test("Security - dangerous javascript: scheme is blocked and never opened", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("[Malicious Link](javascript:alert(1))\n", "note-links-4");

    await interceptOpenedLinks(page);

    const link = editor.writingPane.locator("a", { hasText: "Malicious Link" });
    if (await link.count() > 0) {
      await link.click();
    }

    const opened = await readOpenedLinks(page);

    expect(opened.length).toBe(0);
  });
});
