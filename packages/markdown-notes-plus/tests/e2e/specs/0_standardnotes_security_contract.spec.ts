import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const RESTRICTIVE_CSP_HEADER = [
  "style-src * 'unsafe-hashes'",
  "connect-src https://api.standardnotes.com https://assets.standardnotes.com https://sync.standardnotes.org https://files.standardnotes.com ws://sockets.standardnotes.com https://raw.githubusercontent.com https://listed.to blob:",
].join("; ");

interface SecurityAudit {
  editorPageErrors: string[];
  editorCspViolations: Array<{
    blockedURI: string;
    violatedDirective: string;
    originalPolicy: string;
  }>;
  editorFailedRequests: Array<{
    url: string;
    failureText: string;
  }>;
  hostErrors: string[];
}

function setupSecurityAuditor(page: import("@playwright/test").Page): SecurityAudit {
  const audit: SecurityAudit = {
    editorPageErrors: [],
    editorCspViolations: [],
    editorFailedRequests: [],
    hostErrors: [],
  };

  page.on("pageerror", (error) => {
    const message = error.message || String(error);
    const stack = error.stack || "";
    const isEditor =
      stack.includes("index.html") ||
      stack.includes("/src/") ||
      stack.includes("/assets/") ||
      message.includes("SecurityError") ||
      message.includes("localStorage");

    if (isEditor) {
      audit.editorPageErrors.push(message);
    } else {
      audit.hostErrors.push(message);
    }
  });

  page.on("console", (msg) => {
    const text = msg.text();
    const type = msg.type();
    const location = msg.location();

    const isCsp =
      text.includes("Content Security Policy") ||
      text.includes("violates the following Content Security Policy") ||
      text.includes("Refused to apply inline style") ||
      text.includes("Refused to connect to");

    const isEditorLocation =
      location.url.includes("index.html") ||
      location.url.includes("/src/") ||
      location.url.includes("/assets/");

    if (isCsp && isEditorLocation) {
      audit.editorCspViolations.push({
        blockedURI: location.url,
        violatedDirective: text,
        originalPolicy: RESTRICTIVE_CSP_HEADER,
      });
    } else if (type === "error" && isEditorLocation) {
      // Catch SecurityError or storage access errors in console
      if (text.includes("SecurityError") || text.includes("localStorage") || text.includes("sessionStorage")) {
        audit.editorPageErrors.push(text);
      }
    }
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const failure = request.failure();
    const errorText = failure?.errorText || "Unknown network failure";

    // Ignore known host-only noise like sourcemaps or websocket poll from mock
    if (url.includes("app.js.map") || url.includes("app.css.map") || url.includes("sockets/tokens")) {
      return;
    }

    const isEditorResource =
      url.includes("/src/") ||
      url.includes("/assets/") ||
      url.includes("index.html") ||
      url.startsWith("data:") ||
      url.startsWith("blob:");

    if (isEditorResource) {
      audit.editorFailedRequests.push({
        url,
        failureText: errorText,
      });
    }
  });

  return audit;
}

test.describe("Standard Notes Security Contract & Integrity Gate", () => {
  test.beforeEach(async ({ page }) => {
    // Apply restrictive Standard Notes CSP to editor frame responses
    await page.route("**/index.html*", async (route) => {
      const response = await route.fetch();
      const headers = {
        ...response.headers(),
        "content-security-policy": RESTRICTIVE_CSP_HEADER,
      };
      await route.fulfill({
        response,
        headers,
      });
    });
  });

  test("P0: SN Sandbox Contract - Editor initializes and runs with opaque origin and zero SecurityError", async ({ page }) => {
    const audit = setupSecurityAuditor(page);
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const initialMarkdown = "# Security Contract Note\n\n- [ ] Task 1\n- [x] Completed task\n\n## Section 2\n\nBody content.";
    await host.goto(initialMarkdown, "security-contract-uuid", false);

    // Verify status is Ready
    await expect(editor.status).toHaveText("Ready");

    // Verify the iframe has opaque origin (null) as enforced by Standard Notes sandbox
    const origin = await editor.frame.locator("body").evaluate(() => self.origin);
    expect(origin).toBe("null");

    // Verify storage API denial does not throw unhandled exception or crash the editor
    const storageTestResult = await editor.frame.locator("body").evaluate(() => {
      let threw = false;
      try {
        const _ = self.localStorage;
      } catch (_e) {
        threw = true;
      }
      return { threw, hasApp: Boolean(document.getElementById("app")) };
    });
    expect(storageTestResult.hasApp).toBe(true);

    // Assert zero editor errors
    expect(audit.editorPageErrors).toHaveLength(0);
    expect(audit.editorCspViolations).toHaveLength(0);
    expect(audit.editorFailedRequests).toHaveLength(0);
  });

  test("P0: CSP Runtime Test - Full feature activation with zero CSP violations and zero page errors", async ({ page }) => {
    const audit = setupSecurityAuditor(page);
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    const initialMarkdown = [
      "# Security & Feature Activation Test",
      "",
      "This note verifies that all editor features execute under strict CSP without violations.",
      "",
      "- [ ] Open task item @repeat(1d)",
      "- [x] Done task item @done(2026-08-30)",
      "",
      "## Section Alpha",
      "",
      "Paragraph with [External Link](https://standardnotes.com).",
      "",
      "| Col 1 | Col 2 |",
      "| --- | --- |",
      "| Val A | Val B |",
      "",
      "## Section Beta",
      "",
      "Another section for structural reordering.",
    ].join("\n");

    // 1. Boot & Bridge Handshake
    await host.goto(initialMarkdown, "sec-full-activation", false);
    await expect(editor.status).toHaveText("Ready");

    // 2. Writing Mode - Formatting commands & typing
    await editor.writingEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("\n\nAppended writing text.");
    await editor.writingH2Button.click();
    await editor.writingBulletButton.click();
    await editor.writingTaskButton.click();
    await editor.writingQuoteButton.click();
    await editor.writingCodeButton.click();
    await editor.writingDividerButton.click();

    // 3. Source Mode - CM6 editor & search panel
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toBeVisible();
    await editor.sourceEditor.click();
    await page.keyboard.type("\n# Source Edit Section\n\nSource mode content.");
    await editor.sourceSearchButton.click();
    await expect(editor.sourceSearchPanel).toBeVisible();

    // 4. Sidebar Inspector & Outline Operations
    if (await editor.sidebarToggleBtn.isVisible()) {
      // Toggle sidebar open
      await editor.sidebarToggleBtn.click();
      await expect(editor.sidebarPane).toBeVisible();

      // Outline promote/demote or reorder buttons
      const outlineButtons = editor.outlinePanel.locator(".outline-item-actions button");
      if ((await outlineButtons.count()) > 0) {
        await outlineButtons.first().click();
      }

      // Tasks panel actions
      if (await editor.uncheckAllButton.isVisible()) {
        await editor.uncheckAllButton.click();
      }
    }

    // 5. Mind Map Mode - Rendering, filters, scopes, and interactive task toggle
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();
    // Exercise filter change
    await editor.mindmapFilterSelect.selectOption("open");
    await editor.mindmapFilterSelect.selectOption("all");
    // Exercise scope change
    await editor.mindmapScopeSelect.selectOption("entire-note");

    // 6. Split Mode
    await editor.switchMode("Split");
    await expect(editor.mindmapSvg).toBeVisible();
    await expect(editor.sourceEditor).toBeVisible();

    // 7. Theme Switching
    await host.setThemes(["https://assets.standardnotes.com/themes/dark.css"]);
    await host.setThemes([]);

    // 8. Debounced Save Cycle & Verification
    await editor.switchMode("Writing");
    const savePromise = host.waitForNextSave(4000);
    await editor.writingEditor.click();
    await page.keyboard.type("\nFinal verified text.");
    await savePromise;

    const latestSaved = await host.getLatestSavedText();
    expect(latestSaved).toContain("Final verified text.");

    // 9. Assert strict zero violations
    expect(audit.editorPageErrors).toEqual([]);
    expect(audit.editorCspViolations).toEqual([]);
    expect(audit.editorFailedRequests).toEqual([]);
  });

  test("P0: Production Bundle Static Security Audit - No WASM, octet-stream, or localStorage leaks", () => {
    const distDir = path.resolve(process.cwd(), "dist");
    if (!fs.existsSync(distDir)) {
      test.skip();
      return;
    }

    const files = fs.readdirSync(distDir, { recursive: true }) as string[];
    const jsFiles = files.filter((f) => f.endsWith(".js"));

    // 1. No .wasm files in dist
    const wasmFiles = files.filter((f) => f.endsWith(".wasm"));
    expect(wasmFiles, "dist directory must not contain .wasm binary files").toEqual([]);

    for (const jsFile of jsFiles) {
      const fullPath = path.join(distDir, jsFile);
      const content = fs.readFileSync(fullPath, "utf-8");

      // 2. No WebAssembly instantiations
      expect(content.includes("WebAssembly.instantiate"), `${jsFile} must not invoke WebAssembly.instantiate`).toBe(false);
      expect(content.includes("WebAssembly.compile"), `${jsFile} must not invoke WebAssembly.compile`).toBe(false);

      // 3. No base64 WASM magic header (AGFzbQE)
      expect(content.includes("AGFzbQE"), `${jsFile} must not contain base64 WASM magic header AGFzbQE`).toBe(false);

      // 4. No application/octet-stream data URIs
      expect(content.includes("data:application/octet-stream"), `${jsFile} must not contain octet-stream data URIs`).toBe(false);

      // 5. No direct localStorage access
      expect(content.includes("window.localStorage"), `${jsFile} must not access window.localStorage`).toBe(false);
    }
  });
});
