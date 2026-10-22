export const SMS_BYPASS_DURATION_MS = 30 * 60 * 1000;

export interface SmsBypassSettings {
  requireSmsVerification?: boolean | null;
  smsBypassExpiresAt?: Date | string | null;
}

export function isSmsBypassActive(settings: SmsBypassSettings | undefined, now = Date.now()): boolean {
  const expires = settings?.smsBypassExpiresAt;
  const deadline = expires instanceof Date ? expires.getTime() : typeof expires === "string" ? Date.parse(expires) : NaN;
  return settings?.requireSmsVerification === false && Number.isFinite(deadline) && deadline > now;
}

// Called under a dealer row lock. An unchanged ON setting never renews its deadline.
export function smsBypassUpdate(current: SmsBypassSettings, required: boolean | undefined, now = Date.now()) {
  if (required === undefined) return {};
  if (required) return { requireSmsVerification: true, smsBypassExpiresAt: null };
  if (current.requireSmsVerification === false) return {};
  return { requireSmsVerification: false, smsBypassExpiresAt: new Date(now + SMS_BYPASS_DURATION_MS) };
}
