import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Structural Editing & Outline Controls", () => {
  test("Outline panel - promote and demote heading", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Section 1\n\n## Section 2\n\nBody content\n", "doc-1", false);

    // Find row for Section 2
    await editor.openOutlineTab();
    const rows = editor.outlinePanel.locator(".outline-row");
    await expect(rows).toHaveCount(2);

    const section2Row = rows.nth(1);
    await expect(section2Row).toContainText("Section 2");

    // Hover row to reveal action buttons
    await section2Row.hover();

    // Click Promote button (H2 -> H1)
    const promoteBtn = section2Row.locator('button[title*="Promote"]');
    await promoteBtn.click();

    await page.waitForTimeout(500);
    const savedAfterPromote = await host.getLatestSavedText();
    expect(savedAfterPromote).toContain("# Section 2");

    // Hover and Click Demote button (H1 -> H2)
    const updatedRows = editor.outlinePanel.locator(".outline-row");
    const updatedSection2 = updatedRows.nth(1);
    await updatedSection2.hover();
    const demoteBtn = updatedSection2.locator('button[title*="Demote"]');
    await demoteBtn.click();

    await page.waitForTimeout(500);
    const savedAfterDemote = await host.getLatestSavedText();
    expect(savedAfterDemote).toContain("## Section 2");
  });

  test("Outline panel - move section up and down", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Alpha\n\nContent A\n\n# Beta\n\nContent B\n", "doc-2", false);

    await editor.openOutlineTab();
    const rows = editor.outlinePanel.locator(".outline-row");
    await expect(rows).toHaveCount(2);

    // Hover Beta and move up
    const betaRow = rows.nth(1);
    await betaRow.hover();
    const moveUpBtn = betaRow.locator('button[title*="Move section up"]');
    await moveUpBtn.click();

    await page.waitForTimeout(500);
    const saved = await host.getLatestSavedText();
    const posAlpha = saved.indexOf("# Alpha");
    const posBeta = saved.indexOf("# Beta");
    expect(posBeta).toBeLessThan(posAlpha);
  });

  test("Outline panel - duplicate section", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Item A\n\nDetails of A\n\n# Item B\n", "doc-3", false);

    await editor.openOutlineTab();
    const rows = editor.outlinePanel.locator(".outline-row");
    const itemARow = rows.first();
    await itemARow.hover();

    const dupBtn = itemARow.locator('button[title*="Duplicate subtree"]');
    await dupBtn.click();

    await page.waitForTimeout(500);
    const saved = await host.getLatestSavedText();
    expect(saved).toContain("# Item A\n\nDetails of A\n\n# Item A\n\nDetails of A");
  });

  test("Outline panel - fold toggle collapses descendant items", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Parent\n\n## Child 1\n\n## Child 2\n\n# Sibling\n", "doc-4", false);

    await editor.openOutlineTab();
    const rows = editor.outlinePanel.locator(".outline-row");
    await expect(rows).toHaveCount(4);

    // Click fold toggle on Parent (always visible)
    const parentRow = rows.first();
    const foldBtn = parentRow.locator(".outline-fold-toggle");
    await foldBtn.click();

    // Child 1 and Child 2 should be hidden in outline
    const visibleRowsAfterFold = editor.outlinePanel.locator(".outline-row");
    await expect(visibleRowsAfterFold).toHaveCount(2);
    await expect(visibleRowsAfterFold.nth(0)).toContainText("Parent");
    await expect(visibleRowsAfterFold.nth(1)).toContainText("Sibling");

    // Unfold
    await foldBtn.click();
    await expect(editor.outlinePanel.locator(".outline-row")).toHaveCount(4);
  });

  test("Outline panel - focus on section shows breadcrumb banner and can reset", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Chapter 1\n\n## Topic A\n\nTopic A content\n\n# Chapter 2\n", "doc-5", false);

    await editor.openOutlineTab();
    const rows = editor.outlinePanel.locator(".outline-row");
    const topicARow = rows.nth(1);
    await topicARow.hover();

    // Focus Topic A
    const focusBtn = topicARow.locator('button[title*="Focus this section"]');
    await focusBtn.click();

    // Check banner appears
    const banner = editor.frame.locator(".section-focus-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Chapter 1");
    await expect(banner).toContainText("Topic A");

    // Click Reset button in banner
    // On a compact viewport the outline is a drawer above the editing area;
    // close it before interacting with the banner behind it.
    await editor.closeSidebar();
    const resetBtn = banner.locator("button.exit-focus-btn");
    await resetBtn.click();

    await expect(banner).not.toBeVisible();
  });
});
