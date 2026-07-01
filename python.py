"""Lookup / register personal ID on voucher.rda.gov.ge (Playwright)."""

from __future__ import annotations

import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from playwright.sync_api import sync_playwright

URL = os.environ.get("PERSONAL_ID_LOOKUP_URL", "https://voucher.rda.gov.ge/")
COMPANY_CODE = os.environ.get("PERSONAL_ID_LOOKUP_COMPANY_CODE", "424615394")
PASSWORD = os.environ.get("PERSONAL_ID_LOOKUP_PASSWORD", "123456")
SEARCH_WAIT_MS = int(os.environ.get("PERSONAL_ID_LOOKUP_SEARCH_WAIT_MS", "2500"))
REGISTER_WAIT_MS = int(os.environ.get("PERSONAL_ID_LOOKUP_REGISTER_WAIT_MS", "4000"))

ALREADY_USED_MESSAGE = "ამ მომხმარებელმა უკვე ისარგებლა  სუბსიდირების პროგრამით"
REGISTER_SUCCESS_MESSAGE = "ბენეფიციარი წარმატებით დარეგისტრირდა."
ELIGIBLE_MESSAGE = "ბენეფიციარი სისტემაშია."
CAN_USE_MESSAGE = (
    "მომხმარებელს სუბსიდირების პროგრამით ჯერ არ უსარგებლია შეგიძლიათ განაცხადის გაგრძელება."
)


def normalize_personal_id(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").strip())


def _page_text(page) -> str:
    return (page.inner_text("body") or "").strip()


def _login(page) -> None:
    page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_selector("#cadcode", state="visible", timeout=15_000)
    page.fill("#cadcode", COMPANY_CODE)
    page.fill("#password", PASSWORD)
    page.click('button[type="submit"]')
    page.wait_for_selector("text=ბენეფიციარის შემოწმება", timeout=30_000)


def _search_personal_id(page, personal_id: str) -> str:
    page.locator('input[type="text"]').first.fill(personal_id)
    page.keyboard.press("Enter")
    page.wait_for_timeout(SEARCH_WAIT_MS)
    return _page_text(page)


def _register_beneficiary(
    page,
    personal_id: str,
    first_name: str,
    last_name: str,
) -> tuple[bool, str]:
    reg_btn = page.get_by_role("button", name="ბენეფიციარის რეგისტრაცია")
    if reg_btn.count() == 0:
        return False, "ბენეფიციარის რეგისტრაციის ღილაკი ვერ მოიძებნა"

    reg_btn.first.click()
    page.wait_for_timeout(1500)
    page.locator('input[name="firstName"]').fill(first_name)
    page.locator('input[name="lastName"]').fill(last_name)
    page.locator('input[name="personalId"]').fill(personal_id)
    page.get_by_role("button", name="გაგზავნა").click()
    page.wait_for_timeout(REGISTER_WAIT_MS)

    text = _page_text(page)
    if "გაგზავნა" in text and "სახელი" in text:
        return False, "ბენეფიციარის რეგისტრაცია ვერ დასრულდა"
    return True, text


def _parse_search_result(
    text: str,
    *,
    personal_id: str,
    first_name: str,
    last_name: str,
    page,
    register: bool,
) -> dict:
    lowered = text.lower()

    if "ისარგებლა" in lowered:
        return {
            "success": False,
            "status": "already_used",
            "message": ALREADY_USED_MESSAGE,
            "portalMessage": text,
            "personalId": personal_id,
        }

    if "არ მოიძებნა" in lowered:
        if not register:
            return {
                "success": True,
                "status": "not_found",
                "message": CAN_USE_MESSAGE,
                "portalMessage": text,
                "personalId": personal_id,
            }
        ok, portal_text = _register_beneficiary(page, personal_id, first_name, last_name)
        if not ok:
            return {
                "success": False,
                "status": "error",
                "message": portal_text,
                "portalMessage": text,
                "personalId": personal_id,
            }
        return {
            "success": True,
            "status": "added",
            "message": REGISTER_SUCCESS_MESSAGE,
            "portalMessage": portal_text,
            "personalId": personal_id,
        }

    if "ნაპოვნ" in lowered:
        return {
            "success": True,
            "status": "eligible",
            "message": ELIGIBLE_MESSAGE if register else CAN_USE_MESSAGE,
            "portalMessage": text,
            "personalId": personal_id,
        }

    return {
        "success": False,
        "status": "error",
        "message": text or "შედეგი ვერ მოიძებნა",
        "personalId": personal_id,
    }


def lookup_personal_id(
    personal_id: str,
    *,
    first_name: str = "",
    last_name: str = "",
    mode: str = "check",
    headless: bool = True,
) -> dict:
    register = str(mode or "check").strip().lower() == "register"
    personal_id = normalize_personal_id(personal_id)
    first_name = str(first_name or "").strip() or "—"
    last_name = str(last_name or "").strip() or "—"

    if not personal_id:
        return {
            "success": False,
            "message": "პირადი ნომერი არ არის მითითებული",
            "personalId": personal_id,
        }
    if not re.fullmatch(r"\d{11}", personal_id):
        return {
            "success": False,
            "message": "პირადი ნომერი უნდა იყოს 11 ციფრი",
            "personalId": personal_id,
        }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page()
        try:
            _login(page)
            search_text = _search_personal_id(page, personal_id)
            return _parse_search_result(
                search_text,
                personal_id=personal_id,
                first_name=first_name,
                last_name=last_name,
                page=page,
                register=register,
            )
        except Exception as exc:
            return {
                "success": False,
                "message": f"შემოწმება ვერ მოხერხდა: {exc}",
                "personalId": personal_id,
            }
        finally:
            browser.close()


def main() -> None:
    personal_id = sys.argv[1] if len(sys.argv) > 1 else ""
    first_name = sys.argv[2] if len(sys.argv) > 2 else ""
    last_name = sys.argv[3] if len(sys.argv) > 3 else ""
    mode = sys.argv[4] if len(sys.argv) > 4 else os.environ.get("PERSONAL_ID_LOOKUP_MODE", "check")
    headless = os.environ.get("PERSONAL_ID_LOOKUP_HEADLESS", "1") != "0"
    result = lookup_personal_id(
        personal_id,
        first_name=first_name,
        last_name=last_name,
        mode=mode,
        headless=headless,
    )
    payload = json.dumps(result, ensure_ascii=False)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.stdout.write(payload + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
