import { useState, useEffect } from "react";
import { useLocation } from "wouter";

interface DealerInfo {
  id: number;
  key: string;
  name: string;
  email: string;
  identificationCode?: string;
  requireSmsVerification?: boolean;
  smsBypassExpiresAt?: string | null;
  serverNow?: string;
}

export function useDealerAuth() {
  const [dealer, setDealer] = useState<DealerInfo | null>(null);
  const [isDealer, setIsDealer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let disposed = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let request = 0;
    const refresh = async () => {
      const generation = ++request;
      try {
        const res = await fetch("/api/dealer/me", { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error("Unauthorized");
        const data: DealerInfo = await res.json();
        if (disposed || generation !== request) return;
        clearTimeout(deadlineTimer);
        const remaining = Date.parse(data.smsBypassExpiresAt || "") - Date.parse(data.serverNow || "");
        if (data.requireSmsVerification === false && Number.isFinite(remaining) && remaining > 0) {
          deadlineTimer = setTimeout(() => {
            setDealer(current => current ? { ...current, requireSmsVerification: true } : current);
            void refresh();
          }, remaining);
        } else data.requireSmsVerification = true;
        setDealer(data);
        setIsDealer(true);
      } catch {
        if (!disposed && generation === request) {
          setDealer(current => current ? { ...current, requireSmsVerification: true } : current);
        }
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    const interval = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("sms-settings-refresh", refresh);
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(deadlineTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("sms-settings-refresh", refresh);
    };
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/dealer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) throw new Error("Invalid credentials");

      const data = await res.json();
      if (data.role !== "dealer") throw new Error("Dealer access required");
      const dealerData = data.dealer as DealerInfo | undefined;

      if (!dealerData) {
        const meRes = await fetch("/api/dealer/me", { credentials: "include" });
        if (!meRes.ok) throw new Error("Failed to load dealer profile");
        const me = (await meRes.json()) as DealerInfo;
        setDealer(me);
      } else {
        setDealer(dealerData);
      }

      setIsDealer(true);
      setLocation("/workspace");
    } catch (err) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    fetch("/api/logout", { method: "POST", credentials: "include" })
      .catch(() => undefined)
      .finally(() => {
        setIsDealer(false);
        setDealer(null);
        window.location.href = "/login";
      });
  };

  return { dealer, isDealer, isLoading, login, logout };
}
