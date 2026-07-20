import type { Page } from "playwright-core";
import type { PersonalIdLookupResult } from "./personalIdLookup";

const PORTAL_URL = process.env.PERSONAL_ID_LOOKUP_URL || "https://voucher.rda.gov.ge/";
const COMPANY_CODE = process.env.PERSONAL_ID_LOOKUP_COMPANY_CODE || "424615394";
const PASSWORD = process.env.PERSONAL_ID_LOOKUP_PASSWORD || "123456";
const SEARCH_WAIT_MS = Number(process.env.PERSONAL_ID_LOOKUP_SEARCH_WAIT_MS ?? 2500);
const REGISTER_WAIT_MS = Number(process.env.PERSONAL_ID_LOOKUP_REGISTER_WAIT_MS ?? 4000);

const ALREADY_USED_MESSAGE =
  "ამ მომხმარებელმა უკვე ისარგებლა  სუბსიდირების პროგრამით";
const REGISTER_SUCCESS_MESSAGE = "ბენეფიციარი წარმატებით დარეგისტრირდა.";
const ELIGIBLE_MESSAGE = "ბენეფიციარი სისტემაშია.";
const CAN_USE_MESSAGE =
  "მომხმარებელს სუბსიდირების პროგრამით ჯერ არ უსარგებლია შეგიძლიათ განაცხადის გაგრძელება.";

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
  await page.waitForSelector("#cadcode", { state: "visible", timeout: 15_000 });
  await page.fill("#cadcode", COMPANY_CODE);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=ბენეფიციარის შემოწმება", { timeout: 30_000 });
}

async function searchPersonalId(page: Page, personalId: string): Promise<string> {
  await page.locator('input[type="text"]').first().fill(personalId);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(SEARCH_WAIT_MS);
  return pageText(page);
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
  await page.waitForTimeout(1500);
  await page.locator('input[name="firstName"]').fill(firstName);
  await page.locator('input[name="lastName"]').fill(lastName);
  await page.locator('input[name="personalId"]').fill(personalId);
  await page.getByRole("button", { name: "გაგზავნა" }).click();
  await page.waitForTimeout(REGISTER_WAIT_MS);

  const text = await pageText(page);
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
      message: "პირადი ნომერი არ არის მითითებული",
      personalId: normalized,
    };
  }

  if (!/^\d{11}$/.test(normalized)) {
    return {
      success: false,
      message: "პირადი ნომერი უნდა იყოს 11 ციფრი",
      personalId: normalized,
    };
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await login(page);
    const searchText = await searchPersonalId(page, normalized);
    return await parseSearchResult(
      page,
      searchText,
      normalized,
      firstName,
      lastName,
      register,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `შემოწმება ვერ მოხერხდა: ${message}`,
      personalId: normalized,
    };
  } finally {
    await browser.close();
  }
}
