import { test, expect } from "@playwright/test";
import { EditorPage } from "../pages/EditorPage.ts";

type LedgerEntry = {
  sequence: number;
  kind: string;
  dataType?: string;
  action?: string;
  sessionKey?: string;
  parser?: string;
  decision?: string;
  reason?: string;
  origin?: string;
  boundary?: string;
  listener?: string;
  delayMs?: number;
  generation?: number;
  terminalMilestone?: string;
  settledAt?: number;
};

type ProtocolHarness = {
  getLedger: () => LedgerEntry[];
  getOutbound: () => Array<{ raw: unknown; action?: string; sessionKey?: string; origin?: string }>;
  getContextReplies: () => unknown[];
  getSaves: () => Array<{ raw: unknown; parsed: { action?: string; sessionKey?: string; data?: unknown } }>;
  getConfig: () => { registrationTiming: string; parser: string };
  triggerRegistration: () => void;
  waitForSettle: (timeoutMs: number) => Promise<void>;
  waitForSave: (timeoutMs: number) => Promise<{ raw: unknown; parsed: { action?: string; sessionKey?: string; data?: unknown } }>;
  getSettlement: () => LedgerEntry | undefined;
};

function readHarness(page: import("@playwright/test").Page): ProtocolHarness {
  return {
    getLedger: () => page.evaluate(() => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.getLedger()),
    getOutbound: () => page.evaluate(() => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.getOutbound()),
    getContextReplies: () => page.evaluate(() => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.getContextReplies()),
    getSaves: () => page.evaluate(() => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.getSaves()),
    getConfig: () => page.evaluate(() => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.getConfig()),
    triggerRegistration: () => page.evaluate(() => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.triggerRegistration()),
    waitForSettle: (timeoutMs: number) => page.evaluate((timeout) => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.waitForSettle(timeout), timeoutMs),
    waitForSave: (timeoutMs: number) => page.evaluate((timeout) => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.waitForSave(timeout), timeoutMs),
    getSettlement: () => page.evaluate(() => (window as unknown as { __SN_MOBILE_PROTOCOL__: ProtocolHarness }).__SN_MOBILE_PROTOCOL__.getSettlement()),
  };
}

async function openHarness(
  page: import("@playwright/test").Page,
  registration: string,
  parser: string,
  options: { bridgeReadyDelayMs?: number; registrationDelayMs?: number } = {},
): Promise<ProtocolHarness> {
  const query = new URLSearchParams({ registration, parser });
  if (options.bridgeReadyDelayMs !== undefined) query.set("bridge-ready-delay-ms", String(options.bridgeReadyDelayMs));
  if (options.registrationDelayMs !== undefined) query.set("registration-delay-ms", String(options.registrationDelayMs));
  await page.goto(`/mobile-protocol-host.html?${query.toString()}`);
  await page.waitForFunction(() => typeof (window as unknown as { __SN_MOBILE_PROTOCOL__?: unknown }).__SN_MOBILE_PROTOCOL__ !== "undefined");
  const host = readHarness(page);
  if (registration === "after-app-mount") {
    const editorFrame = page.frames().find((frame) => frame !== page.mainFrame());
    if (!editorFrame) throw new Error("Mobile protocol editor frame was not created");
    await editorFrame.locator('html[data-sn-bridge-ready="true"]').waitFor({ state: "attached" });
    await host.triggerRegistration();
  }
  return host;
}

function kinds(ledger: LedgerEntry[]): string[] {
  return ledger.map((entry) => entry.kind);
}

test.describe("deterministic mobile protocol harness", () => {
  test("one-shot registration before relay is lost even with the string parser", async ({ page }) => {
    const host = await openHarness(page, "before-relay", "string-oracle");

    await host.waitForSettle(3000);
    const ledger = await host.getLedger();

    expect(kinds(ledger)).toEqual([
      "iframe-load",
      "bridge-start-pending",
      "registration-boundary",
      "registration-send",
      "registration-delivery",
      "bridge-start-dispatch",
      "bridge-started-ack",
      "settled",
    ]);
    const registrationDeliveryIndex = ledger.findIndex((entry) => entry.kind === "registration-delivery");
    const startDispatchIndex = ledger.findIndex((entry) => entry.kind === "bridge-start-dispatch");
    const startedAckIndex = ledger.findIndex((entry) => entry.kind === "bridge-started-ack");
    const settledIndex = ledger.findIndex((entry) => entry.kind === "settled");
    expect(registrationDeliveryIndex).toBeLessThan(startDispatchIndex);
    expect(startDispatchIndex).toBeLessThan(startedAckIndex);
    expect(startedAckIndex).toBeLessThan(settledIndex);
    expect(await host.getSettlement()).toMatchObject({ generation: 1, terminalMilestone: "bridge-started-ack", settledAt: expect.any(Number) });
    expect(await host.getOutbound()).toEqual([]);
    expect(await host.getConfig()).toEqual({ registrationTiming: "before-relay", parser: "string-oracle" });
  });

  test("registration after observed editor app mount is dropped by the exact 3.202.1 direct-property parser", async ({ page }) => {
    const host = await openHarness(page, "after-app-mount", "direct-property");

    await host.waitForSettle(3000);
    const ledger = await host.getLedger();
    const firstOutbound = ledger.find((entry) => entry.kind === "first-outbound");
    const routing = ledger.filter((entry) => entry.kind === "host-routing");

    expect(kinds(ledger).slice(0, 5)).toEqual([
      "iframe-load",
      "registration-boundary",
      "registration-send",
      "registration-delivery",
      "outbound",
    ]);
    expect(ledger.findIndex((entry) => entry.kind === "iframe-load")).toBeLessThan(ledger.findIndex((entry) => entry.kind === "first-outbound"));
    expect(firstOutbound?.origin).toBe("null");
    expect(firstOutbound?.dataType).toBe("string");
    expect(firstOutbound?.action).toBe("stream-context-item");
    expect(firstOutbound?.sessionKey).toBeTruthy();
    expect(routing[0]).toMatchObject({ parser: "direct-property", decision: "drop", origin: "null" });
    expect(await host.getSettlement()).toMatchObject({ generation: 1, terminalMilestone: "direct-property-drop", settledAt: expect.any(Number) });
    expect(ledger.filter((entry) => entry.kind === "settled")).toHaveLength(1);
    expect(await host.getContextReplies()).toEqual([]);
    for (const entry of ledger.filter((candidate) => candidate.kind === "outbound")) {
      expect(entry).toMatchObject({ dataType: "string", action: expect.any(String), sessionKey: expect.any(String), origin: "null" });
    }
  });

  test("registration after observed editor app mount reaches initial context through the string parser", async ({ page }) => {
    const host = await openHarness(page, "after-app-mount", "string-oracle");

    await host.waitForSettle(3000);
    const ledger = await host.getLedger();
    const outbound = await host.getOutbound();
    const firstOutboundIndex = ledger.findIndex((entry) => entry.kind === "first-outbound");
    const firstReplyIndex = ledger.findIndex((entry) => entry.kind === "first-context-reply");

    expect(kinds(ledger).slice(0, 5)).toEqual([
      "iframe-load",
      "registration-boundary",
      "registration-send",
      "registration-delivery",
      "outbound",
    ]);
    expect(ledger.findIndex((entry) => entry.kind === "iframe-load")).toBeLessThan(firstOutboundIndex);
    expect(firstOutboundIndex).toBeGreaterThanOrEqual(0);
    expect(firstReplyIndex).toBeGreaterThan(firstOutboundIndex);
    expect(outbound[0]).toMatchObject({ action: "stream-context-item", sessionKey: expect.any(String), origin: "null" });
    expect(typeof outbound[0].raw).toBe("string");
    for (const entry of ledger.filter((candidate) => candidate.kind === "outbound")) {
      expect(entry).toMatchObject({ dataType: "string", action: expect.any(String), sessionKey: expect.any(String), origin: "null" });
    }
    expect(ledger.find((entry) => entry.kind === "host-routing")).toMatchObject({
      parser: "string-oracle",
      decision: "route",
      action: "stream-context-item",
      origin: "null",
    });
    expect(ledger.find((entry) => entry.kind === "first-context-reply")).toMatchObject({
      dataType: "string",
      action: "reply",
    });
    expect(await host.getSettlement()).toMatchObject({ generation: 1, terminalMilestone: "reply-dispatch", settledAt: expect.any(Number) });
    expect(ledger.filter((entry) => entry.kind === "settled")).toHaveLength(1);
  });

  test("renders mobile context, sends a string save, and accepts the host acknowledgement", async ({ page }) => {
    const host = await openHarness(page, "after-app-mount", "string-oracle");
    const editor = new EditorPage(page);

    await host.waitForSettle(3000);
    await expect(editor.status).toHaveText("Ready");
    await expect(editor.outlineHeadings.first()).toHaveText("Deterministic mobile protocol");
    expect(await host.getSaves()).toEqual([]);

    await editor.switchMode("Source");
    await editor.sourceEditor.click();
    await editor.sourceEditor.press("ControlOrMeta+End");
    await editor.sourceEditor.press("Enter");
    await editor.sourceEditor.type("Saved through protocol harness.");

    const save = await host.waitForSave(4000);
    expect(typeof save.raw).toBe("string");
    expect(JSON.parse(save.raw as string)).toMatchObject({
      action: "save-items",
      sessionKey: expect.any(String),
    });
    expect(save.parsed).toMatchObject({
      action: "save-items",
      sessionKey: expect.any(String),
    });
    expect(JSON.stringify(save.parsed.data)).toContain("Saved through protocol harness.");

    const ledger = await host.getLedger();
    expect(ledger.find((entry) => entry.kind === "save-received")).toMatchObject({
      dataType: "string",
      action: "save-items",
      origin: "null",
    });
    expect(ledger.find((entry) => entry.kind === "save-reply-dispatch")).toMatchObject({
      dataType: "string",
      action: "reply",
    });
  });

  test("pre-start registration remains a one-shot no-handshake case", async ({ page }) => {
    const host = await openHarness(page, "pre-start", "string-oracle");

    await host.waitForSettle(3000);
    const ledger = await host.getLedger();
    expect(kinds(ledger)).toEqual(["pre-start-boundary", "registration-send", "registration-delivery", "iframe-load", "settled"]);
    expect(await host.getSettlement()).toMatchObject({ generation: 1, terminalMilestone: "iframe-load", settledAt: expect.any(Number) });
    expect(await host.getOutbound()).toEqual([]);
    expect(await host.getContextReplies()).toEqual([]);
  });

  test("waitForSettle remains pending while app readiness and registration exceed 250ms", async ({ page }) => {
    const host = await openHarness(page, "after-app-mount", "string-oracle", {
      bridgeReadyDelayMs: 300,
      registrationDelayMs: 600,
    });

    const settlePromise = host.waitForSettle(3000);
    const settledEarly = await Promise.race([
      settlePromise.then(() => true),
      page.waitForTimeout(350).then(() => false),
    ]);
    expect(settledEarly).toBe(false);
    expect(await host.getSettlement()).toBeUndefined();
    expect(kinds(await host.getLedger())).not.toContain("settled");

    await settlePromise;
    const ledger = await host.getLedger();
    expect(await host.getSettlement()).toMatchObject({ generation: 1, terminalMilestone: "reply-dispatch", settledAt: expect.any(Number) });
    expect(ledger.filter((entry) => entry.kind === "settled")).toHaveLength(1);
  });
});
