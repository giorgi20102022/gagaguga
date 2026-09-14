import type { Page } from "playwright-core";
import type { PersonalIdLookupResult } from "./personalIdLookup";

const PORTAL_URL = process.env.PERSONAL_ID_LOOKUP_URL || "https://voucher.rda.gov.ge/";
const COMPANY_CODE = process.env.PERSONAL_ID_LOOKUP_COMPANY_CODE || "424615394";
const PASSWORD = process.env.PERSONAL_ID_LOOKUP_PASSWORD || "123456";
const SEARCH_WAIT_MS = Number(process.env.PERSONAL_ID_LOOKUP_SEARCH_WAIT_MS ?? 15000);
const REGISTER_WAIT_MS = Number(process.env.PERSONAL_ID_LOOKUP_REGISTER_WAIT_MS ?? 15000);
const POLL_INTERVAL_MS = Number(process.env.PERSONAL_ID_LOOKUP_POLL_INTERVAL_MS ?? 300);
const MAX_ATTEMPTS = Number(process.env.PERSONAL_ID_LOOKUP_MAX_ATTEMPTS ?? 3);
const RETRY_DELAY_MS = Number(process.env.PERSONAL_ID_LOOKUP_RETRY_DELAY_MS ?? 1000);

const ALREADY_USED_MESSAGE =
  "ამ მომხმარებელმა უკვე ისარგებლა  სუბსიდირების პროგრამით";
const REGISTER_SUCCESS_MESSAGE = "ბენეფიციარი წარმატებით დარეგისტრირდა.";
const ELIGIBLE_MESSAGE = "ბენეფიციარი სისტემაშია.";
const CAN_USE_MESSAGE =
  "მომხმარებელს სუბსიდირების პროგრამით ჯერ არ უსარგებლია შეგიძლიათ განაცხადის გაგრძელება.";

// Result text appears asynchronously after the search; these are the substrings
// parseSearchResult looks for once the portal has actually responded.
const RESULT_KEYWORDS = ["ისარგებლა", "არ მოიძებნა", "ნაპოვნ"];

function normalizePersonalId(value: string): string {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

async function launchBrowser() {
  const { chromium } = await import("playwright-core");

  if (process.env.VERCEL) {
    const chromiumPack = await import("@sparticuz/chromium-min");
    const chromiumLib = chromiumPack.default ?? chromiumPack;
    return chromium.launch({
      args: chromiumLib.args,
      executablePath: await chromiumLib.executablePath(),
      headless: true,
    });
  }

  return chromium.launch({ headless: true });
}

async function pageText(page: Page): Promise<string> {
  return ((await page.innerText("body")) || "").trim();
}

async function login(page: Page): Promise<void> {
  await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("#cadcode", { state: "visible", timeout: 30_000 });
  await page.fill("#cadcode", COMPANY_CODE);
  await page.fill("#password", PASSWORD);
  // A real click, not a synthetic dispatchEvent — the search form on this same
  // site turned out to ignore non-click submissions (see searchPersonalId), so
  // this uses the same verified-working interaction for consistency.
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector("text=ბენეფიციარის შემოწმება", { timeout: 90_000 });
}

// Polls the page text until a recognizable result appears, instead of guessing
// a fixed sleep. The portal's response time is variable, so a fixed wait either
// reads a stale (pre-response) page too early or wastes time waiting longer
// than necessary.
async function waitForResultText(
  page: Page,
  maxWaitMs: number,
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  let text = await pageText(page);
  while (Date.now() < deadline) {
    const lowered = text.toLowerCase();
    if (RESULT_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
      return text;
    }
    await page.waitForTimeout(pollIntervalMs);
    text = await pageText(page);
  }
  return text;
}

// Polls until the registration form disappears (submitted) instead of
// guessing a fixed sleep, for the same reason as waitForResultText.
async function waitForRegisterResult(
  page: Page,
  maxWaitMs: number,
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  let text = await pageText(page);
  while (Date.now() < deadline) {
    if (!(text.includes("გაგზავნა") && text.includes("სახელი"))) {
      return text;
    }
    await page.waitForTimeout(pollIntervalMs);
    text = await pageText(page);
  }
  return text;
}

async function searchPersonalId(page: Page, personalId: string): Promise<string> {
  // Pressing Enter does NOT submit this form (verified against the live portal —
  // it fires zero network requests). The site wires submission to the button's
  // click handler specifically, so it must be clicked, not triggered via keyboard.
  //
  // fill() sets the value in one bulk operation, and on production this was
  // observed leaving the "ძებნა" button permanently disabled (30s timeout,
  // confirmed via server logs) — the site's enable-check doesn't reliably
  // react to it. pressSequentially() dispatches a real keydown/input/keyup
  // per character, like an actual user typing, which the button responds to.
  const field = page.locator('input[type="text"]').first();
  await field.click();
  await field.fill("");
  await field.pressSequentially(personalId, { delay: 30 });
  await page.getByRole("button", { name: "ძებნა" }).click();
  return waitForResultText(page, SEARCH_WAIT_MS);
}

async function registerBeneficiary(
  page: Page,
  personalId: string,
  firstName: string,
  lastName: string,
): Promise<{ ok: boolean; text: string }> {
  const regBtn = page.getByRole("button", { name: "ბენეფიციარის რეგისტრაცია" });
  if ((await regBtn.count()) === 0) {
    return { ok: false, text: "ბენეფიციარის რეგისტრაციის ღილაკი ვერ მოიძებნა" };
  }

  await regBtn.first().click();
  await page.waitForSelector('input[name="firstName"]', { state: "visible", timeout: 10_000 });
  await page.locator('input[name="firstName"]').fill(firstName);
  await page.locator('input[name="lastName"]').fill(lastName);
  await page.locator('input[name="personalId"]').fill(personalId);
  await page.getByRole("button", { name: "გაგზავნა" }).click();

  const text = await waitForRegisterResult(page, REGISTER_WAIT_MS);
  if (text.includes("გაგზავნა") && text.includes("სახელი")) {
    return { ok: false, text: "ბენეფიციარის რეგისტრაცია ვერ დასრულდა" };
  }
  return { ok: true, text };
}

async function parseSearchResult(
  page: Page,
  text: string,
  personalId: string,
  firstName: string,
  lastName: string,
  register: boolean,
): Promise<PersonalIdLookupResult> {
  const lowered = text.toLowerCase();

  if (lowered.includes("ისარგებლა")) {
    return {
      success: false,
      status: "already_used",
      message: ALREADY_USED_MESSAGE,
      portalMessage: text,
      personalId,
    };
  }

  if (lowered.includes("არ მოიძებნა")) {
    if (!register) {
      return {
        success: true,
        status: "not_found",
        message: CAN_USE_MESSAGE,
        portalMessage: text,
        personalId,
      };
    }

    const registration = await registerBeneficiary(page, personalId, firstName, lastName);
    if (!registration.ok) {
      return {
        success: false,
        status: "error",
        message: registration.text,
        portalMessage: text,
        personalId,
      };
    }

    return {
      success: true,
      status: "added",
      message: REGISTER_SUCCESS_MESSAGE,
      portalMessage: registration.text,
      personalId,
    };
  }

  if (lowered.includes("ნაპოვნ")) {
    return {
      success: true,
      status: "eligible",
      message: register ? ELIGIBLE_MESSAGE : CAN_USE_MESSAGE,
      portalMessage: text,
      personalId,
    };
  }

  return {
    success: false,
    status: "error",
    message: text || "შედეგი ვერ მოიძებნა",
    personalId,
  };
}

// A result is worth retrying only when it's an inconclusive technical failure
// (portal timeout, unexpected page state). Definitive answers (already_used,
// not_found, eligible, added) and invalid input must never be retried —
// retrying them either can't change the outcome or would resubmit a
// registration that already went through.
function isRetryable(result: PersonalIdLookupResult): boolean {
  return !result.success && result.status !== "already_used" && result.status !== "invalid_input";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptLookup(
  personalId: string,
  firstName: string,
  lastName: string,
  register: boolean,
): Promise<PersonalIdLookupResult> {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await login(page);
    const searchText = await searchPersonalId(page, personalId);
    return await parseSearchResult(
      page,
      searchText,
      personalId,
      firstName,
      lastName,
      register,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: "error",
      message: `შემოწმება ვერ მოხერხდა: ${message}`,
      personalId,
    };
  } finally {
    await browser.close();
  }
}

export async function lookupPersonalIdOnPortal(
  personalId: string,
  options?: { firstName?: string; lastName?: string; mode?: "check" | "register" },
): Promise<PersonalIdLookupResult> {
  const register = options?.mode === "register";
  const normalized = normalizePersonalId(personalId);
  const firstName = String(options?.firstName ?? "").trim() || "—";
  const lastName = String(options?.lastName ?? "").trim() || "—";

  if (!normalized) {
    return {
      success: false,
      status: "invalid_input",
      message: "პირადი ნომერი არ არის მითითებული",
      personalId: normalized,
    };
  }

  if (!/^\d{11}$/.test(normalized)) {
    return {
      success: false,
      status: "invalid_input",
      message: "პირადი ნომერი უნდა იყოს 11 ციფრი",
      personalId: normalized,
    };
  }

  let result: PersonalIdLookupResult | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await attemptLookup(normalized, firstName, lastName, register);
    if (!isRetryable(result)) {
      return result;
    }
    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS);
    }
  }
  return result!;
}
