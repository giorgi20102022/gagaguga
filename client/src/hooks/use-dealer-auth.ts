import { useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import {
  getDealerSession,
  subscribeDealerSession,
  loginDealer,
  reloginDealer,
  logoutDealer,
} from "@/lib/dealerSession";

export type { DealerInfo } from "@/lib/dealerSession";

// Reads the single page-wide dealer session store. Any number of components may call this;
// there is only ever one /api/dealer/me poller (see lib/dealerSession.ts).
export function useDealerAuth() {
  const session = useSyncExternalStore(subscribeDealerSession, getDealerSession, getDealerSession);
  const [, setLocation] = useLocation();

  const login = async (email: string, password: string) => {
    await loginDealer(email, password);
    setLocation("/workspace");
  };

  const logout = () => {
    void logoutDealer().finally(() => {
      window.location.href = "/login";
    });
  };

  return {
    dealer: session.dealer,
    isDealer: session.isDealer,
    isLoading: session.isLoading,
    sessionExpired: session.expired,
    login,
    relogin: reloginDealer,
    logout,
  };
}
