import { test, expect, type Page } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";
import * as fs from "node:fs";
import * as path from "node:path";

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
  editorCspHeaders: string[];
}

function isEditorFrameUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname.endsWith("/index.html") || pathname.includes("/assets/") || pathname.endsWith("/main.tsx");
  } catch {
    return false;
  }
}

function isEditorFrame(frame: import("@playwright/test").Frame): boolean {
  return frame.parentFrame() !== null && isEditorFrameUrl(frame.url());
}

async function setupSecurityAuditor(page: Page): Promise<SecurityAudit> {
  const audit: SecurityAudit = {
    editorPageErrors: [],
    editorCspViolations: [],
    editorFailedRequests: [],
    editorCspHeaders: [],
  };

  // pageerror does not expose a Frame. Record errors inside the child frame
  // before app code runs so host-frame failures cannot be attributed to the
  // editor by accident.
  await page.exposeBinding("__snEditorSecurityEvent", (source, event: {
    type: "error" | "unhandledrejection" | "csp";
    message?: string;
    blockedURI?: string;
    violatedDirective?: string;
    originalPolicy?: string;
  }) => {
    if (!isEditorFrame(source.frame)) return;

    if (event.type === "csp") {
      audit.editorCspViolations.push({
        blockedURI: event.blockedURI ?? "",
        violatedDirective: event.violatedDirective ?? "",
        originalPolicy: event.originalPolicy ?? "",
      });
      return;
    }
    audit.editorPageErrors.push(event.message ?? event.type);
  });

  await page.addInitScript(() => {
    if (self.parent === self) return;

    const report = (event: Record<string, string>) => {
      void (self as unknown as { __snEditorSecurityEvent?: (value: Record<string, string>) => Promise<void> })
        .__snEditorSecurityEvent?.(event);
    };

    self.addEventListener("error", (event) => {
      report({
        type: "error",
        message: event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message,
      });
    });
    self.addEventListener("unhandledrejection", (event) => {
      report({
        type: "unhandledrejection",
        message: event.reason instanceof Error ? (event.reason.stack ?? event.reason.message) : String(event.reason),
      });
    });
    self.addEventListener("securitypolicyviolation", (event) => {
      report({
        type: "csp",
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
        originalPolicy: event.originalPolicy,
      });
    });
  });

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
    }
  });

  page.on("console", (msg) => {
    const text = msg.text();
    const type = msg.type();
    const location = msg.location();

    const isEditorLocation = isEditorFrameUrl(location.url);

    if (type === "error" && isEditorLocation) {
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

    if (isEditorFrame(request.frame())) {
      audit.editorFailedRequests.push({
        url,
        failureText: errorText,
      });
    }
  });

  page.on("response", (response) => {
    // The mock host is test-host.html, so its sole index.html response is the
    // editor document. At response time Playwright may still report the
    // frame's prior URL, hence URL attribution is deliberately used here.
    if (new URL(response.url()).pathname.endsWith("/index.html")) {
      const csp = response.headers()["content-security-policy"];
      if (csp) audit.editorCspHeaders.push(csp);
    }
  });

  return audit;
}

async function expectSecurityAuditClean(audit: SecurityAudit): Promise<void> {
  // Allow events forwarded from the sandboxed frame to reach Playwright before
  // asserting. This keeps the gate deterministic without observing host noise.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(audit.editorPageErrors, "editor frame must have no uncaught errors").toEqual([]);
  expect(audit.editorCspViolations, "editor frame must have no CSP violations").toEqual([]);
  expect(audit.editorFailedRequests, "editor frame must have no failed requests").toEqual([]);
}

test.describe("Standard Notes Security Contract & Integrity Gate", () => {
  test("P0: SN Sandbox Contract - Editor initializes and runs with opaque origin and zero SecurityError", async ({ page }) => {
    const audit = await setupSecurityAuditor(page);
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
    expect(storageTestResult.threw).toBe(true);
    expect(storageTestResult.hasApp).toBe(true);

    expect(audit.editorCspHeaders).toHaveLength(1);
    expect(audit.editorCspHeaders[0]).toContain("style-src");
    expect(audit.editorCspHeaders[0]).toContain("connect-src");
    expect(audit.editorCspHeaders[0]).not.toContain("unsafe-inline");
    await expectSecurityAuditClean(audit);
  });

  test("P0: CSP Runtime Test - Full feature activation with zero CSP violations and zero page errors", async ({ page }) => {
    const audit = await setupSecurityAuditor(page);
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
      "## Section Beta",
      "",
      "Another section for structural reordering.",
    ].join("\n");

    // 1. Boot & Bridge Handshake
    await host.goto(initialMarkdown, "sec-full-activation", false);
    await expect(editor.status).toHaveText("Ready");

    // 2. Template manager - create, edit, import, and export while storage
    // APIs are denied by the opaque-origin sandbox.
    const templatesButton = editor.frame.getByRole("button", { name: "Templates" });
    await templatesButton.click();
    const templateModal = editor.frame.locator(".modal-backdrop");
    await expect(templateModal).toBeVisible();
    await templateModal.getByRole("button", { name: "+ New Template" }).click();
    const templateForm = templateModal.locator(".template-edit-form");
    await templateForm.locator('input[type="text"]').nth(0).fill("Sandbox Template");
    await templateForm.locator("textarea").fill("# Sandbox template\n\n{{cursor}}");
    await templateForm.getByRole("button", { name: "Save Template" }).click();

    const customTemplateCard = templateModal.locator(".template-card").filter({ hasText: "Sandbox Template" });
    await expect(customTemplateCard).toBeVisible();
    await customTemplateCard.getByRole("button", { name: "Edit" }).click();
    await templateForm.locator('input[type="text"]').nth(0).fill("Edited Sandbox Template");
    await templateForm.getByRole("button", { name: "Save Template" }).click();
    await expect(templateModal.getByText("Edited Sandbox Template", { exact: true })).toBeVisible();

    const importedLibrary = JSON.stringify({
      schemaVersion: 1,
      templates: [{
        id: "imported-sandbox-template",
        name: "Imported Sandbox Template",
        category: "Security",
        content: "Imported content",
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
      }],
      snippets: [],
      hiddenBuiltins: [],
    });
    await templateModal.locator('input[type="file"]').setInputFiles({
      name: "sandbox-library.json",
      mimeType: "application/json",
      buffer: Buffer.from(importedLibrary),
    });
    await expect(templateModal.getByText("Imported Sandbox Template", { exact: true })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      templateModal.getByRole("button", { name: "Export JSON" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("markdown-notes-plus-library.json");
    await templateModal.getByRole("button", { name: "Close modal" }).click();

    // 3. Writing Mode - Formatting commands & typing
    await editor.writingEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("\n\nAppended writing text.");
    await editor.writingH2Button.click();
    await editor.writingBulletButton.click();
    await editor.writingTaskButton.click();
    await editor.writingQuoteButton.click();
    await editor.writingCodeButton.click();
    await editor.writingDividerButton.click();

    // 4. Source Mode - CM6 editor & search panel
    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toBeVisible();
    await editor.sourceEditor.click();
    await page.keyboard.type("\n# Source Edit Section\n\nSource mode content.");
    await editor.sourceSearchButton.click();
    await expect(editor.sourceSearchPanel).toBeVisible();

    // 5. Sidebar Inspector & Outline Operations
    const sidebarToggle = editor.frame.locator(".sidebar-toggle-btn:visible").first();
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
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

      // Close sidebar so subsequent clicks are not intercepted
      const closeBtn = editor.frame.locator(".sidebar-close-btn:visible").first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      } else if (await sidebarToggle.isVisible()) {
        await sidebarToggle.click();
      }
    }

    // 6. Mind Map Mode - Rendering, filters, scopes, and interactive task toggle
    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();
    // Exercise filter change
    await editor.mindmapFilterSelect.selectOption("open");
    await editor.mindmapFilterSelect.selectOption("all");
    // Exercise scope change
    await editor.mindmapScopeSelect.selectOption("entire-note");

    // 7. Split Mode
    await editor.switchMode("Split");
    await expect(editor.mindmapSvg).toBeVisible();
    await expect(editor.writingEditor).toBeVisible();

    // 8. Theme Switching
    // Use a local stylesheet fixture so this test verifies the theme lifecycle
    // without coupling the network gate to external Standard Notes hosting.
    const themeUrl = new URL("/e2e-theme.css", page.url()).href;
    const themeResponsePromise = page.waitForResponse((response) => response.url() === themeUrl);
    await host.setThemes([themeUrl]);
    const themeResponse = await themeResponsePromise;
    expect(themeResponse.ok(), `Theme stylesheet request failed: ${themeUrl}`).toBe(true);
    const themeLink = editor.frame.locator(`link.custom-theme[href="${themeUrl}"]`);
    await expect(themeLink).toHaveCount(1);
    await themeLink.evaluate((link) => new Promise<void>((resolve, reject) => {
      if ((link as HTMLLinkElement).sheet) {
        resolve();
        return;
      }
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => reject(new Error("Test theme stylesheet failed to load")), { once: true });
    }));

    // 9. Debounced Save Cycle & Verification
    await editor.switchMode("Writing");
    await expect(editor.status).toHaveText(
      /^Writing read-only · (?:Writing cannot preserve this Markdown exactly; use Source mode\.|This edit cannot be preserved exactly in Writing; use Source mode\.)$/,
    );
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "false");

    // Structural operations above intentionally exercise the read-only boundary.
    // Load a lossless fixture before verifying the normal debounced save path.
    await host.setNote("# Save verification\n\nReady for final verification.\n", "sec-final-save", false);
    await expect(editor.status).toHaveText("Ready");
    await expect(editor.writingEditor).toHaveAttribute("contenteditable", "true");

    const savePromise = host.waitForNextSave(4000);
    await editor.writingEditor.click();
    await page.keyboard.type("\nFinal verified text.");
    await savePromise;

    const latestSaved = await host.getLatestSavedText();
    expect(latestSaved).toContain("Final verified text.");

    // Code-block copy uses a temporary textarea when Clipboard API is not
    // available. Exercise that CSP-sensitive fallback with a loaded block.
    await host.setNote("# Copy fallback\n\n```ts\nconst securityContract = true;\n```\n", "sec-code-copy", false);
    const codeCopyButton = editor.writingEditor.locator(".btn-code-copy");
    await expect(codeCopyButton).toBeVisible();
    await codeCopyButton.click();

    await expectSecurityAuditClean(audit);
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
