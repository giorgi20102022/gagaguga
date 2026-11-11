// Classifies the text voucher.rda.gov.ge shows after a beneficiary search.
// Fail-safe: only an explicit "not found" lets an application continue; anything
// unrecognised is needs_review. python.py mirrors these rules — keep them in sync.

// \s+ throughout: the portal text is page innerText and contains newlines.
const ALREADY_USED_PATTERN = /ისარგებლა/;
const FOUND_PATTERN = /ბენეფიციარი\s+ნაპოვნია/;
// Any "found" wording, even if the exact phrase above changes. Never eligible.
const FOUND_STEM_PATTERN = /ნაპოვნ/;
const NOT_FOUND_PATTERN = /არ\s+მოიძებნა/;
const STATUS_PATTERN = /სტატუსი\s*-\s*(.+)/;

export const NEEDS_REVIEW_MESSAGE =
  "პორტალის პასუხის ამოცნობა ვერ მოხერხდა. განაცხადის გაგრძელება შეუძლებელია — სცადეთ თავიდან ან დაუკავშირდით ადმინისტრატორს.";

export type PortalSearchOutcome =
  | { kind: "already_used" }
  | { kind: "already_applied"; portalStatus?: string }
  | { kind: "not_found" }
  | { kind: "needs_review" };

export function classifyPortalSearchText(text: string): PortalSearchOutcome {
  const value = String(text ?? "");
  if (ALREADY_USED_PATTERN.test(value)) return { kind: "already_used" };
  if (FOUND_PATTERN.test(value)) {
    const portalStatus = value.match(STATUS_PATTERN)?.[1]?.trim().slice(0, 100) || undefined;
    return { kind: "already_applied", portalStatus };
  }
  if (FOUND_STEM_PATTERN.test(value)) return { kind: "needs_review" };
  if (NOT_FOUND_PATTERN.test(value)) return { kind: "not_found" };
  return { kind: "needs_review" };
}

export function alreadyAppliedMessage(portalStatus?: string): string {
  const status = portalStatus ? ` (სტატუსი: ${portalStatus})` : "";
  return `ამ პირად ნომერზე განაცხადი უკვე არსებობს${status}. განაცხადის გაგრძელება შეუძლებელია.`;
}

/** 01234567890 → 012****7890. Never log a personal ID in full. */
export function maskPersonalId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (id.length <= 7) return "*".repeat(id.length);
  return `${id.slice(0, 3)}${"*".repeat(id.length - 7)}${id.slice(-4)}`;
}

/** Masks every 11-digit personal number inside a string (e.g. portal page text). */
export function maskPersonalIdsInText(value: unknown): string {
  return String(value ?? "").replace(/\d{11}/g, (id) => maskPersonalId(id));
}
