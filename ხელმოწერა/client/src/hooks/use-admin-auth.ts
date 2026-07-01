import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export function useAdminAuth() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    fetch("/api/admin/me", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Unauthorized");
        setIsAdmin(true);
      })
      .catch(() => {
        setIsAdmin(false);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) throw new Error("Invalid credentials");

      const data = await res.json();
      if (data.role !== "admin") throw new Error("Admin access required");
      setIsAdmin(true);
      setLocation("/admin/dashboard");
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
        setIsAdmin(false);
        window.location.href = "/login";
      });
  };

  return { isAdmin, isLoading, login, logout };
}
