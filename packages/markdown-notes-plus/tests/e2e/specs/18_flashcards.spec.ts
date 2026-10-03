import { expect, test } from "@playwright/test";
import { EditorPage } from "../pages/EditorPage.ts";
import { MockHost } from "../pages/MockHost.ts";

const studyNote = `# Study

## Q&A

### Basics

Q: First question?
A: A **bold** answer with \`inline code\`.

- item one
- item two

\`\`\`text
literal <script> text
\`\`\`

| Name | Value |
|---|---|
| safe | [Standard Notes](https://standardnotes.com) |

Q: Second question?
A: Second answer.

## Questions & Answers

Q: Third question?
A: Third answer.
`;

test.describe("Flashcards projection", () => {
  test("discovers Q&A cards, renders Markdown, filters sections, and never saves study state", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(studyNote, "flashcards-basic", false);
    await expect(editor.flashcardModeButton).toBeVisible();
    await host.clearSaves();

    await editor.switchMode("Flashcards");
    await expect(editor.flashcardQuestion).toHaveText("First question?");
    await expect(editor.flashcardAnswer).toHaveCount(0);
    await editor.flashcardRevealButton.click();
    await expect(editor.flashcardAnswer).toContainText("A bold answer");
    await expect(editor.flashcardAnswer.locator("strong")).toHaveText("bold");
    await expect(editor.flashcardAnswer.locator("li")).toHaveCount(2);
    await expect(editor.flashcardAnswer.locator("pre code")).toContainText("literal <script> text");
    await expect(editor.flashcardAnswer.locator("table")).toBeVisible();
    await expect(editor.flashcardAnswer.getByRole("link", { name: "Standard Notes" })).toBeVisible();

    await editor.flashcardNextButton.click();
    await expect(editor.flashcardQuestion).toHaveText("Second question?");
    await expect(editor.flashcardAnswer).toHaveCount(0);
    await editor.flashcardAgainButton.click();
    await expect(editor.flashcardQuestion).toHaveText("Third question?");
    await editor.flashcardKnownButton.click();
    await editor.flashcardShuffleButton.click();
    await editor.flashcardResetButton.click();

    await editor.flashcardSectionSelect.selectOption({ label: "Q&A / Basics" });
    await expect(editor.flashcardProgress).toContainText("1 / 2");
    await editor.flashcardSectionSelect.selectOption({ label: "Study / Questions & Answers" });
    await expect(editor.flashcardQuestion).toHaveText("Third question?");
    await expect(editor.flashcardProgress).toContainText("1 / 1");
    await expect.poll(async () => (await host.getSaves()).length).toBe(0);
  });

  test("supports keyboard controls, locked notes, and completion/reset", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(studyNote, "flashcards-locked", true);
    await host.clearSaves();
    await editor.switchMode("Flashcards");

    await page.keyboard.press("Space");
    await expect(editor.flashcardAnswer).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(editor.flashcardQuestion).toHaveText("Second question?");
    await page.keyboard.press("a");
    await expect(editor.flashcardQuestion).toHaveText("Third question?");
    await page.keyboard.press("k");
    await page.keyboard.press("k");
    await page.keyboard.press("k");
    await expect(editor.flashcardView.getByRole("status")).toContainText("Session complete");
    await editor.flashcardView.getByRole("button", { name: "Reset session" }).click();
    await expect(editor.flashcardQuestion).toBeVisible();
    await expect.poll(async () => (await host.getSaves()).length).toBe(0);
  });

  test("blocks active content and external images", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(`## Q&A
Q: Safe?
A:
<script>window.__flashcardPwned = true</script>

[bad](javascript:alert(1))

[obfuscated](<\u0001javascript:alert(1)>)

![tracker](https://example.invalid/tracker.png)
`, "flashcards-security", false);
    await editor.switchMode("Flashcards");
    await editor.flashcardRevealButton.click();
    await expect(editor.flashcardAnswer.locator("script")).toHaveCount(0);
    await expect(editor.flashcardAnswer.getByRole("link", { name: "bad" })).toHaveCount(0);
    await expect(editor.flashcardAnswer.getByRole("link", { name: "obfuscated" })).toHaveCount(0);
    await expect(editor.flashcardAnswer.locator("img")).toHaveCount(0);
    await expect(editor.flashcardAnswer).toContainText("Raw HTML omitted");
    expect(await editor.frame.locator("body").evaluate(() => (window as unknown as { __flashcardPwned?: boolean }).__flashcardPwned)).toBeUndefined();
    expect(requests.some((url) => url.includes("example.invalid/tracker.png"))).toBe(false);
  });

  test("resets on remote replacement and falls back when Q&A disappears", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(studyNote, "flashcards-remote", false);
    await editor.switchMode("Flashcards");
    await editor.flashcardNextButton.click();

    await host.updateCurrentNote("## QA\nQ: Replacement?\nA: New answer.\n");
    await expect(editor.flashcardQuestion).toHaveText("Replacement?");
    await expect(editor.flashcardProgress).toContainText("1 / 1");

    await host.updateCurrentNote("# No cards\n\nOrdinary note.\n");
    await expect(editor.flashcardPane).toHaveCount(0);
    await expect(editor.flashcardModeButton).toHaveCount(0);
    await expect(editor.sourcePane).toBeVisible();
  });

  test("filters repeated category headings independently", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto("## Q&A\n### Basics\nQ: first\nA: one\n### Basics\nQ: second\nA: two\n", "flashcards-repeated-categories", false);
    await editor.switchMode("Flashcards");

    const categories = editor.flashcardSectionSelect.locator("option", { hasText: "Q&A / Basics" });
    await expect(categories).toHaveCount(2);
    const values = await categories.evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(values[0]).not.toBe(values[1]);

    await editor.flashcardSectionSelect.selectOption(values[0]);
    await expect(editor.flashcardQuestion).toHaveText("first");
    await expect(editor.flashcardProgress).toContainText("1 / 1");

    await editor.flashcardSectionSelect.selectOption(values[1]);
    await expect(editor.flashcardQuestion).toHaveText("second");
    await expect(editor.flashcardProgress).toContainText("1 / 1");
  });
});

test.describe("Flashcards mobile layout", () => {
  test.use({ viewport: { width: 390, height: 700 }, hasTouch: true });

  test("keeps study controls reachable and long answers scrollable", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    const longAnswer = Array.from({ length: 35 }, (_, index) => `- answer line ${index + 1}`).join("\n");
    await host.goto(`## Q&A\nQ: Long answer?\nA:\n${longAnswer}\n`, "flashcards-mobile", false);
    await editor.switchMode("Flashcards");
    await editor.flashcardRevealButton.click();

    await expect(editor.flashcardSectionSelect).toBeVisible();
    for (const button of [editor.flashcardPreviousButton, editor.flashcardAgainButton, editor.flashcardKnownButton, editor.flashcardNextButton]) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(40);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.y + box!.height).toBeLessThanOrEqual(700);
    }
    const cardScroll = await editor.flashcardView.locator(".flashcard-card").evaluate((card) => ({
      clientHeight: card.clientHeight,
      scrollHeight: card.scrollHeight,
      overflowY: getComputedStyle(card).overflowY,
    }));
    expect(cardScroll.scrollHeight).toBeGreaterThan(cardScroll.clientHeight);
    expect(cardScroll.overflowY).toBe("auto");
  });
});
