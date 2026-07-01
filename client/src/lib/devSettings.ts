const PHONE_BYPASS_KEY = "dev_phone_bypass";
const DEV_SETTINGS_EVENT = "dev-settings-change";

export function isPhoneBypassEnabled(): boolean {
  try {
    return localStorage.getItem(PHONE_BYPASS_KEY) === "true";
  } catch {
    return false;
  }
}

export function setPhoneBypassEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PHONE_BYPASS_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(DEV_SETTINGS_EVENT));
  } catch {
    // ignore storage errors
  }
}

export function subscribeDevSettings(onChange: () => void): () => void {
  window.addEventListener(DEV_SETTINGS_EVENT, onChange);
  return () => window.removeEventListener(DEV_SETTINGS_EVENT, onChange);
}
