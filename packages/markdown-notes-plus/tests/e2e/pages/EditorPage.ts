import type { FrameLocator, Locator, Page } from "@playwright/test";

export type EditorMode = "Writing" | "Split" | "Source" | "Mindmap";

export class EditorPage {
  readonly frame: FrameLocator;
  readonly toolbar: Locator;
  readonly status: Locator;
  readonly currentSection: Locator;
  readonly conflictBanner: Locator;
  readonly keepLocalButton: Locator;
  readonly acceptRemoteButton: Locator;

  readonly modeButtons: Locator;
  readonly undoButton: Locator;
  readonly redoButton: Locator;

  // Writing pane
  readonly writingPane: Locator;
  readonly writingEditor: Locator;
  readonly writingH1Button: Locator;
  readonly writingH2Button: Locator;
  readonly writingBulletButton: Locator;
  readonly writingTaskButton: Locator;
  readonly writingQuoteButton: Locator;
  readonly writingCodeButton: Locator;
  readonly writingTableButton: Locator;
  readonly writingLinkButton: Locator;
  readonly writingDividerButton: Locator;

  // Source pane
  readonly sourcePane: Locator;
  readonly sourceEditor: Locator;
  readonly sourceSearchButton: Locator;
  readonly sourceSearchPanel: Locator;

  // Mind map pane
  readonly mindmapPane: Locator;
  readonly mindmapSvg: Locator;
  readonly mindmapFilterSelect: Locator;
  readonly mindmapScopeSelect: Locator;

  // Sidebar & Layout
  readonly workspaceLayout: Locator;
  readonly sidebarPane: Locator;
  readonly sidebarToggleBtn: Locator;
  readonly sidebarCloseBtn: Locator;
  readonly sidebarBackdrop: Locator;

  // Completed Tasks panel
  readonly tasksPanel: Locator;
  readonly completedCountHeading: Locator;
  readonly tasksCollapseButton: Locator;
  readonly completedTaskList: Locator;
  readonly uncheckAllButton: Locator;
  readonly deleteCompletedButton: Locator;

  // Outline panel
  readonly outlinePanel: Locator;
  readonly outlineHeadings: Locator;

  // Footer
  readonly footerMeta: Locator;

  constructor(readonly page: Page) {
    this.frame = page.frameLocator("#editor-frame");

    this.toolbar = this.frame.locator(".app-toolbar");
    this.status = this.frame.locator(".app-toolbar .status");
    this.currentSection = this.frame.locator(".app-toolbar .current-section");
    this.conflictBanner = this.frame.locator("aside.conflict");
    this.keepLocalButton = this.conflictBanner.getByRole("button", { name: "Keep local" });
    this.acceptRemoteButton = this.conflictBanner.getByRole("button", { name: "Accept remote" });

    this.modeButtons = this.frame.locator(".mode-buttons");
    this.undoButton = this.frame.getByRole("button", { name: "Undo" });
    this.redoButton = this.frame.getByRole("button", { name: "Redo" });

    this.writingPane = this.frame.locator(".writing-pane");
    this.writingEditor = this.writingPane.locator(".milkdown .editor");
    this.writingH1Button = this.writingPane.getByRole("button", { name: "H1" });
    this.writingH2Button = this.writingPane.getByRole("button", { name: "H2" });
    this.writingBulletButton = this.writingPane.getByRole("button", { name: "Bullet" });
    this.writingTaskButton = this.writingPane.getByRole("button", { name: "Task" });
    this.writingQuoteButton = this.writingPane.getByRole("button", { name: "Quote" });
    this.writingCodeButton = this.writingPane.getByRole("button", { name: "Code" });
    this.writingTableButton = this.writingPane.getByRole("button", { name: "Table" });
    this.writingLinkButton = this.writingPane.getByRole("button", { name: "Link" });
    this.writingDividerButton = this.writingPane.getByRole("button", { name: "Divider" });

    this.sourcePane = this.frame.locator(".source-pane");
    this.sourceEditor = this.sourcePane.locator(".cm-content");
    this.sourceSearchButton = this.sourcePane.getByRole("button", { name: "Search / Replace" });
    this.sourceSearchPanel = this.sourcePane.locator(".cm-search");

    this.mindmapPane = this.frame.locator(".map-pane");
    this.mindmapSvg = this.mindmapPane.locator(".mindmap-svg");
    this.mindmapFilterSelect = this.mindmapPane.locator('label:has-text("Tasks") select');
    this.mindmapScopeSelect = this.mindmapPane.locator('label:has-text("Scope") select');

    this.workspaceLayout = this.frame.locator(".workspace-layout");
    this.sidebarPane = this.frame.locator(".sidebar-pane");
    this.sidebarToggleBtn = this.frame.locator(".sidebar-toggle-btn");
    this.sidebarCloseBtn = this.frame.locator(".sidebar-close-btn");
    this.sidebarBackdrop = this.frame.locator(".sidebar-backdrop");

    this.tasksPanel = this.frame.locator(".tasks-panel");
    this.completedCountHeading = this.tasksPanel.locator(".panel-heading h2");
    this.tasksCollapseButton = this.tasksPanel.locator(".panel-heading button");
    this.completedTaskList = this.tasksPanel.locator("ul li");
    this.uncheckAllButton = this.tasksPanel.getByRole("button", { name: "Uncheck all" });
    this.deleteCompletedButton = this.tasksPanel.getByRole("button", { name: "Delete completed" });

    this.outlinePanel = this.frame.locator(".outline-panel");
    this.outlineHeadings = this.outlinePanel.locator("ol li button");

    this.footerMeta = this.frame.locator("footer.note-meta");
  }

  async switchMode(mode: EditorMode): Promise<void> {
    await this.modeButtons.getByRole("button", { name: mode }).click();
  }

  async typeInSource(text: string): Promise<void> {
    await this.sourceEditor.click();
    await this.page.keyboard.type(text);
  }

  async selectAllAndTypeInSource(text: string): Promise<void> {
    await this.sourceEditor.click();
    await this.page.keyboard.press("ControlOrMeta+a");
    await this.page.keyboard.press("Backspace");
    await this.page.keyboard.type(text);
  }

  async getSourceText(): Promise<string> {
    return (await this.sourceEditor.textContent()) ?? "";
  }

  async typeInWriting(text: string): Promise<void> {
    await this.writingEditor.click();
    await this.page.keyboard.type(text);
  }
}
