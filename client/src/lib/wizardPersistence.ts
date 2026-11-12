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

// ── Session-expiry recovery ──
// Written only when the dealer session dies mid-application, so the draft survives a
// re-login, a reload, or a closed tab. localStorage first; IndexedDB when the draft (with
// its photos) is over the localStorage quota.
const RECOVERY_KEY_PREFIX = "wizard_recovery:";
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RecoverySnapshot extends WizardPersistedState {
  dealerId: number;
}

export function saveRecoverySnapshot(storageKey: string, dealerId: number, state: WizardPersistedState): void {
  const key = `${RECOVERY_KEY_PREFIX}${storageKey}`;
  const payload: RecoverySnapshot = { step: state.step, formData: state.formData, dealerId, savedAt: Date.now() };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    return;
  } catch (e) {
    console.warn("localStorage recovery write failed, falling back to IndexedDB:", e);
  }
  try {
    void setDBItem(key, payload);
  } catch (e) {
    console.error("IndexedDB recovery write failed:", e);
  }
}

/** Returns the snapshot for this dealer (and removes it), or null. */
export async function takeRecoverySnapshot(storageKey: string, dealerId: number): Promise<WizardPersistedState | null> {
  const key = `${RECOVERY_KEY_PREFIX}${storageKey}`;
  let snapshot: RecoverySnapshot | null = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) snapshot = JSON.parse(raw) as RecoverySnapshot;
  } catch (e) {
    console.error("localStorage recovery read failed:", e);
  }
  if (!snapshot) {
    try {
      snapshot = await getDBItem<RecoverySnapshot>(key);
    } catch (e) {
      console.error("IndexedDB recovery read failed:", e);
    }
  }
  await clearRecoverySnapshot(storageKey);
  if (!snapshot || snapshot.dealerId !== dealerId || typeof snapshot.step !== "number") return null;
  if (!snapshot.formData || typeof snapshot.formData !== "object") return null;
  if (Date.now() - (snapshot.savedAt ?? 0) > RECOVERY_MAX_AGE_MS) return null;
  return { step: snapshot.step, formData: snapshot.formData, savedAt: snapshot.savedAt };
}

async function clearRecoverySnapshot(storageKey: string): Promise<void> {
  const key = `${RECOVERY_KEY_PREFIX}${storageKey}`;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  try { await removeDBItem(key); } catch { /* ignore */ }
}

const RECOVERY_STORAGE_KEYS = ["dealer_wizard_state", "dashboard_wizard_state"];

export async function clearRecoverySnapshots(): Promise<void> {
  await Promise.all(RECOVERY_STORAGE_KEYS.map(clearRecoverySnapshot));
}

export async function clearWizardState(storageKey: string): Promise<void> {
  try {
    sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${storageKey}`);
  } catch {
    // ignore
  }
  await removeDBItem(storageKey);
}
