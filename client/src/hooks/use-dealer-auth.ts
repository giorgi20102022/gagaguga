import { useState, useEffect } from "react";
import { useLocation } from "wouter";

interface DealerInfo {
  id: number;
  key: string;
  name: string;
  email: string;
  identificationCode?: string;
}

export function useDealerAuth() {
  const [dealer, setDealer] = useState<DealerInfo | null>(null);
  const [isDealer, setIsDealer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    fetch("/api/dealer/me", {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("Unauthorized");
        return res.json();
      })
      .then((data) => {
        setDealer(data);
        setIsDealer(true);
      })
      .catch(() => {
        setIsDealer(false);
        setDealer(null);
      })
      .finally(() => setIsLoading(false));
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
