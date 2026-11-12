import { useEffect, useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDealerAuth } from "@/hooks/use-dealer-auth";

export const SESSION_EXPIRED_MESSAGE =
  "სესიას ვადა გაუვიდა. გთხოვთ, თავიდან შეხვიდეთ — შევსებული მონაცემები შენახულია.";

/**
 * Blocking re-login modal. Opens on the first 401 from any dealer API call. It cannot be
 * dismissed: the wizard behind it is inert until the dealer logs in again, after which the
 * wizard continues at the same step with the same data.
 */
export function SessionExpiredModal() {
  const { sessionExpired, dealer, relogin } = useDealerAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sessionExpired) {
      setEmail(dealer?.email ?? "");
      setPassword("");
      setError("");
    }
  }, [sessionExpired]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      await relogin(email.trim(), password);
    } catch {
      setError("ელ-ფოსტა ან პაროლი არასწორია");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={sessionExpired} onOpenChange={() => { /* not dismissable */ }}>
      <AlertDialogContent
        className="z-[300] max-w-md rounded-2xl"
        overlayClassName="z-[300] bg-black/70 backdrop-blur-sm"
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="session-expired-modal"
      >
        <AlertDialogHeader>
          <div className="mx-auto sm:mx-0 mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <AlertDialogTitle>სესიას ვადა გაუვიდა</AlertDialogTitle>
          <AlertDialogDescription>{SESSION_EXPIRED_MESSAGE}</AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="session-relogin-email">ელ-ფოსტა</Label>
            <Input
              id="session-relogin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="session-relogin-password">პაროლი</Label>
            <Input
              id="session-relogin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" disabled={isSubmitting || !email || !password} className="w-full">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "შესვლა"}
          </Button>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
