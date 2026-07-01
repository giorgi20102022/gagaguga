import { type SubmissionInput } from "@shared/routes";
import { getDBItem, setDBItem, removeDBItem } from "@/lib/db";

export interface WizardPersistedState {
  step: number;
  formData: Partial<SubmissionInput>;
  savedAt?: number;
}

const SESSION_KEY_PREFIX = "wizard_session_state:";

export function loadWizardState(storageKey: string): WizardPersistedState | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${storageKey}`);
    if (raw) {
      const parsed = JSON.parse(raw) as WizardPersistedState;
      if (typeof parsed.step === "number" && parsed.formData && typeof parsed.formData === "object") {
        return parsed;
      }
    }
  } catch (e) {
    console.error("sessionStorage read failed:", e);
  }
  return null;
}

export async function loadWizardStateWithFallback(
  storageKey: string,
): Promise<WizardPersistedState | null> {
  const fromSession = loadWizardState(storageKey);
  if (fromSession) return fromSession;

  try {
    const fromDb = await getDBItem<WizardPersistedState>(storageKey);
    if (fromDb && typeof fromDb.step === "number") return fromDb;
  } catch (e) {
    console.error("IndexedDB read failed:", e);
  }
  return null;
}

export function saveWizardStateSync(storageKey: string, state: WizardPersistedState): void {
  const payload: WizardPersistedState = { ...state, savedAt: Date.now() };
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${storageKey}`, JSON.stringify(payload));
  } catch (e) {
    console.warn("sessionStorage write failed, falling back to IndexedDB:", e);
    void setDBItem(storageKey, payload);
  }
}

export async function clearWizardState(storageKey: string): Promise<void> {
  try {
    sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${storageKey}`);
  } catch {
    // ignore
  }
  await removeDBItem(storageKey);
}
