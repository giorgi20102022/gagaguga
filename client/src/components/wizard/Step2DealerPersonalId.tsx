import { useEffect, useState } from "react";
import { type SubmissionInput } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, RotateCcw, Search, ShieldAlert, Ban } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onNext: () => void;
  onBack: () => void;
  onRestart: () => void;
}

const ALREADY_USED_MESSAGE =
  "ეს მომხმარებელი უკვე სარგებლობს სუბსიდირების პროგრამით";

export function Step2DealerPersonalId({ data, updateData, onNext, onBack, onRestart }: Props) {
  const personalId = String(data.idNumber ?? "").trim();
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAlreadyUsed, setIsAlreadyUsed] = useState(false);
  const verified = Boolean(data.dealerPersonalIdVerified);

  const runLookup = async () => {
    if (!personalId || isChecking) return;

    setIsChecking(true);
    setError(null);
    setIsAlreadyUsed(false);
    updateData({
      dealerPersonalId: personalId,
      dealerPersonalIdVerified: false,
      dealerPersonalIdLookupMessage: undefined,
    });

    try {
      const res = await axios.post(
        "/api/verification/dealer-personal-id",
        {
          personalId,
          firstName: String(data.firstName ?? "").trim(),
          lastName: String(data.lastName ?? "").trim(),
          mode: "check",
        },
        { withCredentials: true, timeout: 130_000 },
      );

      const result = res.data as {
        success?: boolean;
        status?: string;
        message?: string;
        personalId?: string;
      };

      const success = Boolean(result.success);
      const message = String(result.message ?? "").trim();
      const isAlreadyUsed = result.status === "already_used";

      updateData({
        dealerPersonalId: result.personalId || personalId,
        dealerPersonalIdVerified: success,
        dealerPersonalIdLookupMessage: message || undefined,
      });

      if (!success) {
        if (isAlreadyUsed) {
          setIsAlreadyUsed(true);
          setError(ALREADY_USED_MESSAGE);
        } else {
          setError(message || "პირადი ნომრის შემოწმება ვერ მოხერხდა");
        }
      }
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { message?: string } } })?.response?.data;
      const msg =
        typeof errData?.message === "string" && errData.message
          ? errData.message
          : "შემოწმება ვერ მოხერხდა";
      setError(msg);
      updateData({
        dealerPersonalId: personalId,
        dealerPersonalIdVerified: false,
        dealerPersonalIdLookupMessage: msg,
      });
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (!personalId) return;
    if (verified && data.dealerPersonalId === personalId) return;
    if (isChecking) return;
    void runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalId]);

  const handleContinue = () => {
    if (isAlreadyUsed) return;
    if (!verified) {
      setError("გთხოვთ, დაელოდოთ პირადი ნომრის შემოწმების დასრულებას");
      return;
    }
    onNext();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">პირადი ნომრის შემოწმება</h2>
        <p className="text-muted-foreground">
          პირველი ეტაპიდან ამოღებული პირადი ნომერი ავტომატურად შემოწმდება. რეგისტრაცია პორტალზე მოხდება მხოლოდ ბოლო ეტაპზე გაგზავნისას.
        </p>
      </div>

      {!personalId ? (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <h4 className="font-semibold text-destructive">პირადი ნომერი არ მოიძებნა</h4>
            <p className="text-sm text-destructive/80">
              გთხოვთ, დაბრუნდით წინა ეტაპზე და ხელახლა დაადასტუროთ პირადობა.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-6 bg-muted/30 rounded-2xl border border-border">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
              მომხმარებლის პირადი ნომერი (ეტაპი 1)
            </Label>
            <Input readOnly value={personalId} className="h-12 rounded-xl bg-background font-medium" />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void runLookup(); }}
            disabled={isChecking}
            className="rounded-xl"
          >
            {isChecking ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                მიმდინარეობს შემოწმება...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                ხელახლა შემოწმება
              </>
            )}
          </Button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {isChecking && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center gap-3"
          >
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <div>
              <h4 className="font-semibold text-foreground">შემოწმება მიმდინარეობს</h4>
              <p className="text-sm text-muted-foreground">
                პირადი ნომერი ავტომატურად შეიყვანება სისტემაში — გთხოვთ, დაელოდოთ.
              </p>
            </div>
          </motion.div>
        )}

        {verified && !isChecking && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="font-semibold text-emerald-700 dark:text-emerald-400">შემოწმება წარმატებით დასრულდა</h4>
              {data.dealerPersonalIdLookupMessage && (
                <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80 mt-1">
                  {data.dealerPersonalIdLookupMessage}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {isAlreadyUsed && !isChecking && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-6 rounded-2xl bg-destructive/15 border-2 border-destructive flex items-start gap-4 shadow-lg shadow-destructive/10 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
              <Ban className="w-6 h-6" />
            </div>
            <div className="space-y-1 flex-1 self-center">
              <h4 className="text-lg font-bold text-destructive">
                {ALREADY_USED_MESSAGE}
              </h4>
            </div>
          </motion.div>
        )}

        {error && !isChecking && !isAlreadyUsed && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3"
          >
            <ShieldAlert className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <h4 className="font-semibold text-destructive">შემოწმება ვერ მოხერხდა</h4>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-6 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
        {!isAlreadyUsed && (
          <Button type="button" variant="outline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBack(); }} className="w-full sm:w-auto px-8 h-12 rounded-xl">
            უკან
          </Button>
        )}
        {isAlreadyUsed ? (
          <Button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRestart(); }}
            variant="destructive"
            className={cn("w-full sm:w-auto px-8 h-12 rounded-xl text-base shadow-md sm:ml-auto")}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            თავიდან დაწყება
          </Button>
        ) : (
          <Button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleContinue(); }}
            disabled={!personalId || isChecking || !verified}
            className={cn("w-full sm:w-auto px-8 h-12 rounded-xl text-base shadow-md", !isAlreadyUsed && "sm:ml-auto")}
          >
            გაგრძელება
          </Button>
        )}
      </div>
    </motion.div>
  );
}
