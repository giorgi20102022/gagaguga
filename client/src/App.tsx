import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import Dashboard from "@/pages/Dashboard";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import { useAdminAuth } from "@/hooks/use-admin-auth";

import DealerDashboard from "@/pages/dealer/DealerDashboard";
import { useDealerAuth } from "@/hooks/use-dealer-auth";

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAdminAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      setLocation("/login");
    }
  }, [isAdmin, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) return null;
  return <>{children}</>;
}

function DealerGuard({ children }: { children: React.ReactNode }) {
  const { isDealer, isLoading } = useDealerAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isDealer) {
      setLocation("/login");
    }
  }, [isDealer, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isDealer) return null;
  return <>{children}</>;
}

// Redirect /dealer/dashboard → /workspace for backwards compat
function WorkspaceRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/workspace"); }, []);
  return null;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (!user && location !== "/login") {
        setLocation("/login");
      } else if (user && location === "/login") {
        setLocation("/");
      }
    }
  }, [user, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground font-medium">სესია იტვირთება...</p>
      </div>
    );
  }

  // Prevent rendering children if redirecting
  if (!user && location !== "/login") return null;
  if (user && location === "/login") return null;

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <AuthPage />
      </Route>
      <Route path="/admin/dashboard">
        <AdminGuard>
          <AdminDashboard />
        </AdminGuard>
      </Route>
      <Route path="/workspace">
        <DealerGuard>
          <DealerDashboard />
        </DealerGuard>
      </Route>
      <Route path="/dealer/dashboard">
        <WorkspaceRedirect />
      </Route>
      <Route path="/">
        <AuthGuard>
          <Dashboard />
        </AuthGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
