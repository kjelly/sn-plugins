import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Advanced Features: Templates, Review, Palette, Callouts & Code Blocks", () => {
  test("Templates modal - open and insert built-in template", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Initial Note\n\n", "doc-tpl-1", false);

    // Open Templates modal from toolbar
    const tplBtn = editor.frame.locator('button:has-text("Templates")').first();
    await tplBtn.click();

    // Verify modal is open
    const modal = editor.frame.locator(".modal-backdrop");
    await expect(modal).toBeVisible();

    // Find Decision Snippet or Weekly Plan template
    const snippetTab = modal.locator('button:has-text("Snippets")');
    await snippetTab.click();

    const insertBtn = modal.locator('.template-card:has-text("Decision") button:has-text("Insert")');
    await expect(insertBtn).toBeVisible();
    await insertBtn.click();

    // Verify modal closed
    await expect(modal).not.toBeVisible();

    // Verify content inserted
    await page.waitForTimeout(500);
    const saved = await host.getLatestSavedText();
    expect(saved).toContain("Decision:");
  });

  test("Sidebar Review panel - health diagnostics and quick fix", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    // Review is a compact-sidebar tab. Exercise its actual drawer contract
    // instead of interacting with desktop-only hidden tab controls.
    await page.setViewportSize({ width: 700, height: 900 });

    // Note with heading jump and empty heading
    const markdownWithIssues = `# Project Title\n\n## Overview\n\n#### Direct H4 Jump\nBody content\n`;
    await host.goto(markdownWithIssues, "doc-diag-1", false);

    await editor.openReviewTab();

    // Verify Review Panel rendered
    const reviewPanel = editor.frame.locator(".review-panel");
    await expect(reviewPanel).toBeVisible();

    // Verify Health score card exists
    await expect(reviewPanel.locator(".health-score-card")).toBeVisible();

    // Verify diagnostic jump issue exists
    const quickFixBtn = reviewPanel.locator(".btn-quick-fix").first();
    await expect(quickFixBtn).toBeVisible();
    await quickFixBtn.click();

    // Verify level jump was fixed to H3
    await page.waitForTimeout(500);
    const savedAfterFix = await host.getLatestSavedText();
    expect(savedAfterFix).toContain("### Direct H4 Jump");
  });

  test("Command palette - open, search, and switch mode", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Title\n\n## Section A\n\n- [ ] Task A\n", "doc-palette-1", false);

    // Open palette from toolbar button
    const paletteBtn = editor.frame.locator('button:has-text("Palette")').first();
    await paletteBtn.click();

    const paletteDialog = editor.frame.locator(".palette-dialog");
    await expect(paletteDialog).toBeVisible();

    // Search for Source mode
    const searchInput = paletteDialog.locator(".palette-search-input");
    await searchInput.fill("Source");

    const sourceItem = paletteDialog.locator('.palette-item:has-text("Switch to Source Mode")');
    await expect(sourceItem).toBeVisible();
    await sourceItem.click();

    // Verify modal closed and mode switched to Source
    await expect(paletteDialog).not.toBeVisible();
    await expect(editor.sourceEditor).toBeVisible();
  });

  test("Writing mode - callout cards and code block tools rendering", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const markdown = `# Callouts & Code\n\n> [!NOTE]\n> This is a callout note\n\n\`\`\`javascript\nconst a = 1;\n\`\`\`\n`;
    await host.goto(markdown, "doc-callout-1", false);

    // Verify callout card rendering in writing mode
    const callout = editor.writingEditor.locator("blockquote.callout-card");
    await expect(callout).toBeVisible();
    await expect(callout).toHaveClass(/callout-type-note/);

    // Verify code block tools rendering
    const codeBlockWrapper = editor.writingEditor.locator(".code-block-wrapper");
    await expect(codeBlockWrapper).toBeVisible();
    await expect(codeBlockWrapper.locator(".btn-code-copy")).toBeVisible();
    await expect(codeBlockWrapper.locator(".btn-code-wrap")).toBeVisible();
  });
});
