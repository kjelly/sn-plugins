import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Mind Map Visualization", () => {
  test("Renders Mind Map SVG with document structure and handles task filtering", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = "# Architecture Plan\n\n## Backend\n\n- [ ] Database setup\n- [x] API routes\n\n## Frontend\n\n- [ ] UI Components\n";
    await host.goto(doc, "note-mindmap-1", false);

    // Switch to Mindmap mode
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();

    // Markmap debounces render by 350ms, poll for SVG content
    await expect.poll(async () => {
      return editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).toContain("Architecture Plan");

    let svgContent = await editor.mindmapSvg.innerHTML();
    expect(svgContent).toContain("Backend");
    expect(svgContent).toContain("Frontend");

    // Test Tasks filter dropdown
    await expect(editor.mindmapFilterSelect).toBeVisible();

    // Change filter to "Open only"
    await editor.mindmapFilterSelect.selectOption("open");

    await expect.poll(async () => {
      return editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).not.toContain("API routes");

    svgContent = await editor.mindmapSvg.innerHTML();
    expect(svgContent).toContain("Database setup");

    // Change filter to "Hide tasks"
    await editor.mindmapFilterSelect.selectOption("hide");

    await expect.poll(async () => {
      return editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).not.toContain("Database setup");

    svgContent = await editor.mindmapSvg.innerHTML();
    expect(svgContent).toContain("Backend");
    expect(svgContent).toContain("Frontend");
  });

  test("Mind Map scope switching between Entire note and Current section", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = "# Root\n\n## Section Alpha\n\nParagraph in Alpha\n\n## Section Beta\n\nParagraph in Beta\n";
    await host.goto(doc, "note-mindmap-scope", false);

    // In Outline panel, click Section Alpha
    await editor.outlineHeadings.nth(1).click();
    await expect(editor.currentSection).toContainText("Section Alpha");

    // Switch to Mindmap mode
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapScopeSelect).toBeVisible();

    // Select "Current section"
    await editor.mindmapScopeSelect.selectOption("current-section");

    await expect.poll(async () => {
      return editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).toContain("Section Alpha");

    const sectionMapContent = await editor.mindmapSvg.innerHTML();
    expect(sectionMapContent).not.toContain("Section Beta");
  });
});
