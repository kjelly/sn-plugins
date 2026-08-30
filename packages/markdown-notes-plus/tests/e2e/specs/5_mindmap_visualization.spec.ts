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
      return await editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).toContain("Architecture Plan");

    let svgContent = await editor.mindmapSvg.innerHTML();
    expect(svgContent).toContain("Backend");
    expect(svgContent).toContain("Frontend");

    // Test Tasks filter dropdown
    await expect(editor.mindmapFilterSelect).toBeVisible();

    // Change filter to "Open only"
    await editor.mindmapFilterSelect.selectOption("open");

    await expect.poll(async () => {
      return await editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).not.toContain("API routes");

    svgContent = await editor.mindmapSvg.innerHTML();
    expect(svgContent).toContain("Database setup");

    // Change filter to "Hide tasks"
    await editor.mindmapFilterSelect.selectOption("hide");

    await expect.poll(async () => {
      return await editor.mindmapSvg.innerHTML();
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
    await editor.openOutlineTab();
    await editor.outlineHeadings.nth(1).click();
    await expect(editor.currentSection).toContainText("Section Alpha");

    // Switch to Mindmap mode
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapScopeSelect).toBeVisible();

    // Select "Current section"
    await editor.mindmapScopeSelect.selectOption("current-section");

    await expect.poll(async () => {
      return await editor.mindmapSvg.innerHTML();
    }, { timeout: 5000 }).toContain("Section Alpha");

    const sectionMapContent = await editor.mindmapSvg.innerHTML();
    expect(sectionMapContent).not.toContain("Section Beta");
  });

  test("Mind Map interactive checkbox toggle updates document without folding", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const doc = "# Tasks Plan\n\n- [ ] Deploy v1\n- [x] Write specs\n";
    await host.goto(doc, "note-mindmap-checkbox", false);

    // Switch to Mindmap mode
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();

    // Wait for Mindmap SVG checkboxes to render
    const mindmapCheckboxes = editor.mindmapSvg.locator('foreignObject svg[viewBox="0 -3 24 24"]');
    await expect(mindmapCheckboxes).toHaveCount(2);

    // Click the first checkbox in the Mindmap SVG to check it
    await mindmapCheckboxes.nth(0).click();

    // Verify in Source mode that the document was updated to [x] Deploy v1
    await editor.switchMode("Source");
    const sourceText = await editor.getSourceText();
    expect(sourceText).toContain("- [x] Deploy v1");
    expect(sourceText).toContain("- [x] Write specs");
  });
});
