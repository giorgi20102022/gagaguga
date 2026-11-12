import axios from "axios";
import { clearRecoverySnapshots } from "@/lib/wizardPersistence";

export interface DealerInfo {
  id: number;
  key: string;
  name: string;
  email: string;
  identificationCode?: string;
  requireSmsVerification?: boolean;
  smsBypassExpiresAt?: string | null;
  serverNow?: string;
}

export interface DealerSessionState {
  dealer: DealerInfo | null;
  isDealer: boolean;
  isLoading: boolean;
  /** The session died while the dealer was working. The re-login modal is shown. */
  expired: boolean;
}

// One store for the whole page. Every useDealerAuth() reads it, so there is exactly one
// /api/dealer/me poller no matter how many components ask for the dealer.
let state: DealerSessionState = { dealer: null, isDealer: false, isLoading: true, expired: false };
const listeners = new Set<() => void>();
const expirySavers = new Set<() => void>();

const POLL_INTERVAL_MS = 15_000;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
let requestGeneration = 0;

function setState(patch: Partial<DealerSessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getDealerSession(): DealerSessionState {
  return state;
}

export function subscribeDealerSession(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

/** Called synchronously on the first 401, before the modal opens. Returns an unregister fn. */
export function registerSessionExpirySaver(saver: () => void): () => void {
  expirySavers.add(saver);
  return () => expirySavers.delete(saver);
}

export function markDealerSessionExpired() {
  if (!state.isDealer || state.expired) return;
  expirySavers.forEach((save) => {
    try { save(); } catch (e) { console.error("[dealer-session] saving wizard state failed:", e); }
  });
  clearTimeout(deadlineTimer);
  setState({ expired: true });
}

export async function refreshDealerSession(): Promise<void> {
  if (state.expired) return;
  const generation = ++requestGeneration;
  try {
    const res = await fetch("/api/dealer/me", { credentials: "include", cache: "no-store" });
    if (generation !== requestGeneration) return;
    if (res.status === 401) {
      if (state.isDealer) markDealerSessionExpired();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: DealerInfo = await res.json();
    if (generation !== requestGeneration || state.expired) return;
    clearTimeout(deadlineTimer);
    const remaining = Date.parse(data.smsBypassExpiresAt || "") - Date.parse(data.serverNow || "");
    if (data.requireSmsVerification === false && Number.isFinite(remaining) && remaining > 0) {
      deadlineTimer = setTimeout(() => {
        if (state.dealer) setState({ dealer: { ...state.dealer, requireSmsVerification: true } });
        void refreshDealerSession();
      }, remaining);
    } else data.requireSmsVerification = true;
    setState({ dealer: data, isDealer: true });
  } catch {
    // Network/5xx: keep the session, but never keep a stale SMS bypass.
    if (generation === requestGeneration && state.dealer) {
      setState({ dealer: { ...state.dealer, requireSmsVerification: true } });
    }
  } finally {
    if (state.isLoading) setState({ isLoading: false });
  }
}

const onVisible = () => { if (document.visibilityState === "visible") void refreshDealerSession(); };
const onRefreshEvent = () => { void refreshDealerSession(); };

function startPolling() {
  if (pollTimer) return;
  void refreshDealerSession();
  pollTimer = setInterval(refreshDealerSession, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onRefreshEvent);
  window.addEventListener("sms-settings-refresh", onRefreshEvent);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = undefined;
  clearTimeout(deadlineTimer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onRefreshEvent);
  window.removeEventListener("sms-settings-refresh", onRefreshEvent);
  // Nobody is watching. If no dealer is known, the next subscriber (e.g. /workspace after a
  // login on AuthPage) must wait for a fresh check instead of seeing a stale "logged out".
  if (!state.isDealer) state = { ...state, isLoading: true };
}

async function postDealerLogin(email: string, password: string): Promise<DealerInfo> {
  const res = await fetch("/api/dealer/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  const data = await res.json();
  if (data.role !== "dealer") throw new Error("Dealer access required");
  if (data.dealer) return data.dealer as DealerInfo;
  const meRes = await fetch("/api/dealer/me", { credentials: "include" });
  if (!meRes.ok) throw new Error("Failed to load dealer profile");
  return (await meRes.json()) as DealerInfo;
}

export async function loginDealer(email: string, password: string): Promise<DealerInfo> {
  setState({ isLoading: true });
  try {
    const dealer = await postDealerLogin(email, password);
    setState({ dealer, isDealer: true, expired: false });
    return dealer;
  } finally {
    setState({ isLoading: false });
  }
}

/**
 * Re-login from the session-expired modal. The wizard is still mounted with its state, so
 * the dealer continues at the same step. A different dealer account must not inherit the
 * previous dealer's draft, so that case reloads into a clean workspace.
 */
export async function reloginDealer(email: string, password: string): Promise<void> {
  const previous = state.dealer;
  const dealer = await postDealerLogin(email, password);
  if (previous && dealer.id !== previous.id) {
    await clearRecoverySnapshots();
    window.location.href = "/workspace";
    return;
  }
  await clearRecoverySnapshots();
  setState({ dealer: { ...dealer, requireSmsVerification: true }, isDealer: true, expired: false });
  void refreshDealerSession();
}

export async function logoutDealer(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
  await clearRecoverySnapshots();
  setState({ dealer: null, isDealer: false, expired: false });
}

// ── 401 detection for every dealer API call (fetch and axios) ──
const AUTH_EXEMPT = [
  /^\/api\/login$/,
  /^\/api\/dealer\/login$/,
  /^\/api\/logout$/,
  /^\/api\/me$/,
  /^\/api\/session\//,
  /^\/api\/admin\//,
];

function isDealerApi(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin !== window.location.origin) return false;
    return parsed.pathname.startsWith("/api/") && !AUTH_EXEMPT.some((re) => re.test(parsed.pathname));
  } catch {
    return false;
  }
}

let interceptorsInstalled = false;
export function installDealerSessionInterceptors() {
  if (interceptorsInstalled || typeof window === "undefined") return;
  interceptorsInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    if (response.status === 401) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isDealerApi(url)) markDealerSessionExpired();
    }
    return response;
  };

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401 && error.config && isDealerApi(axios.getUri(error.config))) {
        markDealerSessionExpired();
      }
      return Promise.reject(error);
    },
  );
}
