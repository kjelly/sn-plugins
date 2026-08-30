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

    this.toolbar = this.frame.locator(".app-toolbar:visible");
    this.status = this.frame.locator(".app-toolbar:visible .status").first();
    this.currentSection = this.frame.locator(".app-toolbar:visible .current-section").first();
    this.conflictBanner = this.frame.locator("aside.conflict");
    this.keepLocalButton = this.conflictBanner.getByRole("button", { name: "Keep local" });
    this.acceptRemoteButton = this.conflictBanner.getByRole("button", { name: "Accept remote" });

    this.modeButtons = this.frame.locator(".mode-buttons:visible").first();
    this.undoButton = this.frame.locator(".app-toolbar:visible").getByRole("button", { name: "Undo" }).first();
    this.redoButton = this.frame.locator(".app-toolbar:visible").getByRole("button", { name: "Redo" }).first();

    this.writingPane = this.frame.locator(".writing-pane");
    this.writingEditor = this.writingPane.locator(".milkdown .editor");
    const writingToolbar = this.writingPane.locator(".pane-toolbar");
    this.writingH1Button = writingToolbar.getByRole("button", { name: "H1" });
    this.writingH2Button = writingToolbar.getByRole("button", { name: "H2" });
    this.writingBulletButton = writingToolbar.getByRole("button", { name: "Bullet" });
    this.writingTaskButton = writingToolbar.getByRole("button", { name: "Task", exact: true });
    this.writingQuoteButton = writingToolbar.getByRole("button", { name: "Quote" });
    this.writingCodeButton = writingToolbar.getByRole("button", { name: "Code" });
    this.writingTableButton = writingToolbar.getByRole("button", { name: "Table" });
    this.writingLinkButton = writingToolbar.getByRole("button", { name: "Link" });
    this.writingDividerButton = writingToolbar.getByRole("button", { name: "Divider" });

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
    this.sidebarToggleBtn = this.frame.locator(".sidebar-toggle-btn:visible").first();
    this.sidebarCloseBtn = this.frame.locator(".sidebar-close-btn");
    this.sidebarBackdrop = this.frame.locator(".sidebar-backdrop");

    this.tasksPanel = this.frame.locator(".tasks-panel");
    this.completedCountHeading = this.tasksPanel.locator(".panel-heading h2");
    this.tasksCollapseButton = this.tasksPanel.locator(".panel-heading button");
    this.completedTaskList = this.tasksPanel.locator("ul li");
    this.uncheckAllButton = this.tasksPanel.getByRole("button", { name: "Uncheck all" });
    this.deleteCompletedButton = this.tasksPanel.getByRole("button", { name: "Delete completed" });

    this.outlinePanel = this.frame.locator(".outline-panel");
    this.outlineHeadings = this.outlinePanel.locator("ol li .outline-heading-btn");

    this.footerMeta = this.frame.locator("footer.note-meta");
  }

  get writingModeButton(): Locator {
    return this.frame.locator(".mode-buttons:visible").getByRole("button", { name: "Writing" }).first();
  }
  get splitModeButton(): Locator {
    return this.frame.locator(".mode-buttons:visible").getByRole("button", { name: "Split" }).first();
  }
  get sourceModeButton(): Locator {
    return this.frame.locator(".mode-buttons:visible").getByRole("button", { name: "Source" }).first();
  }
  get mindmapModeButton(): Locator {
    return this.frame.locator(".mode-buttons:visible").getByRole("button", { name: "Mindmap" }).first();
  }

  async switchMode(mode: EditorMode): Promise<void> {
    await this.frame.locator(".mode-buttons:visible").getByRole("button", { name: mode }).first().click();
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
