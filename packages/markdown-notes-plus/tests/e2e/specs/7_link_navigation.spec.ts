import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Link Navigation in New Tab", () => {
  test("Writing mode - clicking a link calls window.open with _blank and noopener,noreferrer", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Links Test\n\nVisit [Standard Notes](https://standardnotes.com) here.\n", "note-links-1");

    // Intercept window.open in the iframe
    await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks = [];
      frame.contentWindow!.open = (url, target, features) => {
        (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks.push({
          url: String(url),
          target: target ? String(target) : undefined,
          features: features ? String(features) : undefined,
        });
        return null;
      };
    });

    const link = editor.writingPane.locator("a", { hasText: "Standard Notes" });
    await expect(link).toBeVisible();
    await link.click();

    const opened = await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      return (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks;
    });

    expect(opened.length).toBeGreaterThan(0);
    expect(opened[0].url).toBe("https://standardnotes.com");
    expect(opened[0].target).toBe("_blank");
    expect(opened[0].features).toBe("noopener,noreferrer");
  });

  test("Mindmap mode - clicking a link in SVG node calls window.open with _blank", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Root\n\n## [External Docs](https://docs.standardnotes.com)\n\nSome note content\n", "note-links-2");

    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();

    await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks = [];
      frame.contentWindow!.open = (url, target, features) => {
        (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks.push({
          url: String(url),
          target: target ? String(target) : undefined,
          features: features ? String(features) : undefined,
        });
        return null;
      };
    });

    const link = editor.mindmapSvg.locator("a", { hasText: "External Docs" });
    await expect(link).toBeVisible();
    await link.click();

    const opened = await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      return (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks;
    });

    expect(opened.length).toBeGreaterThan(0);
    expect(opened[0].url).toBe("https://docs.standardnotes.com");
    expect(opened[0].target).toBe("_blank");
  });

  test("Source mode - Ctrl/Cmd+click on markdown link calls window.open", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("[Help Guide](https://standardnotes.com/help)\n", "note-links-3");
    await editor.switchMode("Source");

    await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks = [];
      frame.contentWindow!.open = (url, target, features) => {
        (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks.push({
          url: String(url),
          target: target ? String(target) : undefined,
          features: features ? String(features) : undefined,
        });
        return null;
      };
    });

    const cmLine = editor.sourcePane.locator(".cm-line").first();
    await expect(cmLine).toBeVisible();

    // Plain click does NOT open link
    await cmLine.click();
    let opened = await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      return (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks;
    });
    expect(opened.length).toBe(0);

    // Ctrl+Click opens link
    await cmLine.click({
      modifiers: ["Control"],
    });

    opened = await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      return (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks;
    });
    expect(opened.length).toBeGreaterThan(0);
    expect(opened[0].url).toBe("https://standardnotes.com/help");
  });

  test("Security - dangerous javascript: scheme is blocked and never opened", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("[Malicious Link](javascript:alert(1))\n", "note-links-4");

    await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks = [];
      frame.contentWindow!.open = (url, target, features) => {
        (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks.push({
          url: String(url),
          target: target ? String(target) : undefined,
          features: features ? String(features) : undefined,
        });
        return null;
      };
    });

    const link = editor.writingPane.locator("a", { hasText: "Malicious Link" });
    if (await link.count() > 0) {
      await link.click();
    }

    const opened = await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      return (frame.contentWindow as unknown as { __openedLinks: Array<{ url: string; target?: string; features?: string }> }).__openedLinks;
    });

    expect(opened.length).toBe(0);
  });
});
