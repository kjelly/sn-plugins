import type { Page } from "@playwright/test";

export interface MockSaveItem {
  timestamp: number;
  items: Array<{
    uuid: string;
    content?: {
      text?: string;
      preview_plain?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  raw: unknown;
}

export class MockHost {
  constructor(private readonly page: Page) {}

  async goto(initialText?: string, uuid = "default-note-uuid", locked = false): Promise<void> {
    await this.page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // Ignore in restricted environments
      }
    });
    await this.page.goto("/test-host.html");
    await this.page.waitForFunction(() => typeof (window as unknown as { __SN_MOCK_HOST__?: unknown }).__SN_MOCK_HOST__ !== "undefined");
    if (initialText !== undefined) {
      await this.setNote(initialText, uuid, locked);
    }
    // Wait for the iframe handshake to finish
    await this.page.evaluate(async () => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { waitForHandshake: () => Promise<void> } }).__SN_MOCK_HOST__;
      await host.waitForHandshake();
    });
  }

  async setNote(text: string, uuid = "note-" + Date.now(), locked = false): Promise<void> {
    await this.page.evaluate(
      ({ text, uuid, locked }) => {
        const host = (window as unknown as { __SN_MOCK_HOST__: { setNote: (t: string, u: string, l: boolean) => void } }).__SN_MOCK_HOST__;
        host.setNote(text, uuid, locked);
      },
      { text, uuid, locked }
    );
  }

  async updateCurrentNote(text: string): Promise<void> {
    await this.page.evaluate((text) => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { updateCurrentNote: (t: string) => void } }).__SN_MOCK_HOST__;
      host.updateCurrentNote(text);
    }, text);
  }

  async setLocked(locked: boolean): Promise<void> {
    await this.page.evaluate((locked) => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { setLocked: (l: boolean) => void } }).__SN_MOCK_HOST__;
      host.setLocked(locked);
    }, locked);
  }

  async setThemes(themeUrls: string[]): Promise<void> {
    await this.page.evaluate((themeUrls) => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { setThemes: (urls: string[]) => void } }).__SN_MOCK_HOST__;
      host.setThemes(themeUrls);
    }, themeUrls);
  }

  async getSaves(): Promise<MockSaveItem[]> {
    return await this.page.evaluate(() => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { getSaves: () => MockSaveItem[] } }).__SN_MOCK_HOST__;
      return host.getSaves();
    });
  }

  async getLatestSavedText(): Promise<string | undefined> {
    return await this.page.evaluate(() => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { getLatestSavedText: () => string | undefined } }).__SN_MOCK_HOST__;
      return host.getLatestSavedText();
    });
  }

  async clearSaves(): Promise<void> {
    await this.page.evaluate(() => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { clearSaves: () => void } }).__SN_MOCK_HOST__;
      host.clearSaves();
    });
  }

  async waitForNextSave(timeoutMs = 5000): Promise<unknown> {
    return await this.page.evaluate((timeoutMs) => {
      const host = (window as unknown as { __SN_MOCK_HOST__: { waitForNextSave: (t: number) => Promise<unknown> } }).__SN_MOCK_HOST__;
      return host.waitForNextSave(timeoutMs);
    }, timeoutMs);
  }
}
