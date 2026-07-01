import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, Lock, Store } from "lucide-react";
import { Link } from "wouter";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { useDealerAuth } from "@/hooks/use-dealer-auth";

export function Navbar() {
  const { user, logout } = useAuth();
  const { isAdmin } = useAdminAuth();
  const { isDealer } = useDealerAuth();

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/20 bg-background/60 backdrop-blur-xl transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3 cursor-pointer">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                დილერის პორტალი
              </span>
            </Link>
          </div>
          
          <div className="flex items-center gap-2">
            <Link href={isDealer ? "/workspace" : "/login"}>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-muted-foreground hover:text-emerald-600 gap-2 h-9 rounded-lg"
              >
                <Store className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Dealer</span>
              </Button>
            </Link>

            <Link href={isAdmin ? "/admin/dashboard" : "/admin/login"}>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-muted-foreground hover:text-blue-600 gap-2 h-9 rounded-lg"
              >
                <Lock className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Admin</span>
              </Button>
            </Link>

            {user && (
              <>
                <div className="h-8 w-px bg-border hidden md:block"></div>
                <div className="hidden md:flex flex-col items-end">
                  <span className="text-sm font-semibold">{user.username}</span>
                  <span className="text-xs text-muted-foreground">ავტორიზებული დილერი</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => logout()}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
