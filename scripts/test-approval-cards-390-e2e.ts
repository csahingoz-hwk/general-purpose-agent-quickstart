import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { HYDROGEN } from "../lib/ai/routing/catalog";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 3136;
const origin = `http://127.0.0.1:${port}`;
const owner = "csahingoz@gmail.com";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";

async function waitForServer(url: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/login`, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) {
        return;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function buildSseBody(chunks: Record<string, unknown>[]): string {
  return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
}

test("390x844 iPhone E2E: Gmail draft & Calendar approval cards show human-readable Turkish preview (no JSON/braces), collapsed Teknik ayrıntı, inline Düzenle -> Kaydet, and Vazgeç", async () => {
  const scratchDir =
    process.env.VERIFY_SCREENSHOT_DIR ||
    "/Users/caglar/.gemini/antigravity-cli/brain/dd9cadeb-6946-44ae-87cb-364a999ae07b/scratch";
  mkdirSync(scratchDir, { recursive: true });

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });

  const server = spawn(
    "npx",
    ["next", "dev", "--turbo", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        AUTH_SECRET: secret,
        APP_OWNER_EMAIL: owner,
        PLAYWRIGHT: "True",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    }
  );
  server.unref();

  try {
    await waitForServer(origin);

    const authCookie = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
    });
    await context.addCookies([
      { name: "authjs.session-token", value: authCookie, url: origin },
    ]);
    const page = await context.newPage();

    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C = window.V_C || []; window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/models*", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: HYDROGEN,
          models: [
            {
              id: HYDROGEN,
              name: "Gemini 4 Hydrogen",
              provider: "google",
              description: "Default · fast ~1s responses via Vertex AI",
            },
          ],
        },
      })
    );
    await page.route("**/api/voice/readiness*", (route) =>
      route.fulfill({ json: { liveReady: true, sttReady: true } })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/vote*", (route) => route.fulfill({ json: [] }));

    const captured: { edited: Record<string, unknown> | null } = {
      edited: null,
    };
    let requestIndex = 0;

    await page.route("**/api/chat", async (route) => {
      requestIndex += 1;
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<
        string,
        unknown
      >;

      if (requestIndex === 1) {
        const sse = buildSseBody([
          { type: "start", messageId: "msg-gmail-draft-1" },
          {
            type: "tool-input-start",
            toolCallId: "tc-gm-draft-1",
            toolName: "gmailCreateDraft",
          },
          {
            type: "tool-input-available",
            toolCallId: "tc-gm-draft-1",
            toolName: "gmailCreateDraft",
            input: {
              recipient: "ahmet.yilmaz@example.com",
              subject: "Perşembe Londra Kahve Buluşması",
              body: "Merhaba Ahmet,\n\nPerşembe günü 14:30'da Soho'da kahve içmeye ne dersin?\n\nSelamlar,\nÇağlar",
            },
          },
          {
            type: "tool-approval-request",
            approvalId: "appr-gm-1",
            toolCallId: "tc-gm-draft-1",
          },
          { type: "finish", finishReason: "stop" },
        ]);
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          body: sse,
        });
        return;
      }

      if (requestIndex === 2) {
        captured.edited =
          (body.editedDraftApproval as Record<string, unknown>) ?? null;
        const sse = buildSseBody([
          { type: "start", messageId: "msg-gmail-draft-1" },
          {
            type: "tool-output-available",
            toolCallId: "tc-gm-draft-1",
            output: {
              status: "draft_created_unsent",
              deliveryMode: "draft_only_never_send",
              draftId: "r-987654",
              recipient:
                captured.edited?.recipient ?? "ahmet.yilmaz@example.com",
              subject:
                captured.edited?.subject ?? "Perşembe Londra Kahve Buluşması",
              body:
                captured.edited?.body ??
                "Merhaba Ahmet,\n\nPerşembe günü 14:30'da Soho'da kahve içmeye ne dersin?\n\nSelamlar,\nÇağlar",
              digest: "abcdef1234567890",
              riskLevel: "high",
            },
          },
          { type: "finish", finishReason: "stop" },
        ]);
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          body: sse,
        });
        return;
      }

      // Request 3: Calendar draft approval card!
      const sse = buildSseBody([
        { type: "start", messageId: "msg-cal-draft-1" },
        {
          type: "tool-input-start",
          toolCallId: "tc-cal-1",
          toolName: "calendarCreateDraftEvent",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-cal-1",
          toolName: "calendarCreateDraftEvent",
          input: {
            title: "[DRAFT] Londra Soho Kahve Buluşması",
            startIso: "2026-11-19T14:30:00Z",
            endIso: "2026-11-19T15:15:00Z",
            description: "Ahmet ile buluşma.\nAdres: Monmouth Coffee, Soho",
          },
        },
        {
          type: "tool-approval-request",
          approvalId: "appr-cal-1",
          toolCallId: "tc-cal-1",
        },
        { type: "finish", finishReason: "stop" },
      ]);
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: sse,
      });
    });

    await page.goto(origin, { waitUntil: "networkidle" });
    await page
      .getByTestId("multimodal-input")
      .fill("Draft an email to Ahmet for Thursday coffee");
    await page.getByTestId("send-button").click();

    const gmailCard = page.getByTestId("approval-card-gmailCreateDraft");
    await expect(gmailCard).toBeVisible({ timeout: 10_000 });

    // 1) Verify Turkish labels, "Asla göndermez" badge, line breaks preserved, ZERO JSON or braces visible!
    await expect(
      gmailCard.getByTestId("approval-never-sends-badge")
    ).toHaveText("Asla göndermez");
    await expect(gmailCard.getByTestId("email-preview-to")).toContainText(
      "Kime"
    );
    await expect(gmailCard.getByTestId("email-preview-to")).toContainText(
      "ahmet.yilmaz@example.com"
    );
    await expect(gmailCard.getByTestId("email-preview-subject")).toContainText(
      "Konu"
    );
    await expect(gmailCard.getByTestId("email-preview-subject")).toContainText(
      "Perşembe Londra Kahve Buluşması"
    );
    const bodyText = await gmailCard
      .getByTestId("email-preview-body")
      .innerText();
    assert.ok(
      bodyText.includes("Merhaba Ahmet,\n\nPerşembe günü"),
      "Line breaks must be preserved in email body preview"
    );

    const visibleCardText = await gmailCard.innerText();
    assert.equal(
      visibleCardText.includes("{") || visibleCardText.includes("}"),
      false,
      `Visible approval card must NEVER render JSON braces; got:\n${visibleCardText}`
    );
    assert.equal(visibleCardText.includes("İşlem ayrıntıları"), false);

    // 2) Verify "Teknik ayrıntı" exists and is collapsed by default
    const techDetails = gmailCard.getByTestId("approval-technical-details");
    await expect(techDetails).toBeVisible();
    assert.equal(await techDetails.getAttribute("open"), null);
    await expect(techDetails.locator("summary")).toHaveText("Teknik ayrıntı");

    // 3) Verify buttons: Düzenle, Kaydet, Vazgeç >= 44px tap targets and 390px layout fit
    const editBtn = gmailCard.getByTestId("approval-edit-button");
    const denyBtn = gmailCard.getByTestId("approval-deny-button");
    const saveBtn = gmailCard.getByTestId("approval-allow-button");
    await expect(editBtn).toContainText("Düzenle");
    await expect(denyBtn).toHaveText("Vazgeç");
    await expect(saveBtn).toHaveText("Kaydet");
    for (const btn of [editBtn, denyBtn, saveBtn]) {
      const box = await btn.boundingBox();
      assert.ok(box && box.height >= 44, "Tap target must be >= 44px");
    }
    const editBox = await editBtn.boundingBox();
    const saveBox = await saveBtn.boundingBox();
    assert.ok(
      editBox && saveBox && Math.abs(editBox.y - saveBox.y) < 4,
      "Düzenle, Vazgeç, and Kaydet must align on one clean row at 390px"
    );
    const scrollW1 = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(scrollW1 <= 390, `Expected scrollWidth <= 390, got ${scrollW1}`);

    await gmailCard.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await page.screenshot({
      path: join(scratchDir, "verify-gmail-draft-approval-390.png"),
      fullPage: false,
    });

    // 4) Tap "Düzenle", edit Kime / Konu / İleti inline, verify 16px inputs (no iOS zoom), then tap "Kaydet"
    await editBtn.click();
    const toInput = gmailCard.getByTestId("email-edit-to");
    const subjectInput = gmailCard.getByTestId("email-edit-subject");
    const bodyInput = gmailCard.getByTestId("email-edit-body");
    await expect(toInput).toBeVisible();
    const inputFontSize = await toInput.evaluate(
      (el) => window.getComputedStyle(el).fontSize
    );
    assert.equal(inputFontSize, "16px");

    await toInput.fill("ahmet.yeni@example.com");
    await subjectInput.fill("Cuma Londra Öğle Yemeği");
    await bodyInput.fill(
      "Merhaba Ahmet,\n\nCuma 13:00 Soho uygun mu?\n\nSelamlar,\nÇağlar"
    );

    await page.screenshot({
      path: join(scratchDir, "verify-gmail-draft-edit-390.png"),
      fullPage: false,
    });

    await saveBtn.click();

    await expect(gmailCard.getByTestId("approval-saved-receipt")).toContainText(
      "Gmail taslağı kaydedildi (gönderilmedi)."
    );
    assert.ok(captured.edited, "Expected editedDraftApproval in POST");
    assert.equal(captured.edited.recipient, "ahmet.yeni@example.com");
    assert.equal(captured.edited.subject, "Cuma Londra Öğle Yemeği");
    await expect(gmailCard.getByTestId("email-preview-to")).toContainText(
      "ahmet.yeni@example.com"
    );
    await expect(gmailCard.getByTestId("email-preview-subject")).toContainText(
      "Cuma Londra Öğle Yemeği"
    );

    // 5) Test Calendar approval card — human-readable Turkish fields, collapsed Teknik ayrıntı, zero JSON/braces!
    await page
      .getByTestId("multimodal-input")
      .fill("Takvime de taslak etkinlik ekle");
    await page.getByTestId("send-button").click();

    const calCard = page.getByTestId("approval-card-calendarCreateDraftEvent");
    await expect(calCard).toBeVisible({ timeout: 10_000 });
    const calVisibleText = await calCard.innerText();
    assert.equal(
      calVisibleText.includes("{") || calVisibleText.includes("}"),
      false,
      `Calendar approval card must NEVER render JSON braces; got:\n${calVisibleText}`
    );
    await expect(calCard).toContainText("Başlık");
    await expect(calCard).toContainText("Başlangıç");
    await expect(calCard).toContainText("Bitiş");
    await expect(calCard).toContainText("Davet göndermez");
    assert.equal(
      await calCard
        .getByTestId("approval-technical-details")
        .getAttribute("open"),
      null
    );

    await calCard.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(150);
    await page.screenshot({
      path: join(scratchDir, "verify-calendar-approval-390.png"),
      fullPage: false,
    });
  } finally {
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
    await browser.close();
  }
});
