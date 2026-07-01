import { useState, useRef, useCallback, memo } from "react";
import { type SubmissionInput } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ShieldAlert, ScanLine, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MediaUploadZone } from "@/components/ui/MediaUploadZone";
import { extractPassportOcr } from "@/lib/passportOcr";

interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onNext: () => void;
}

function Step1IdentityInner({ data, updateData, onNext }: Props) {
  const [isScanning, setIsScanning] = useState(false);
  const [isPassportScanning, setIsPassportScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrorBanner, setFieldErrorBanner] = useState<string | null>(null);
  const passportOcrAbortRef = useRef<AbortController | null>(null);

  const [docType, setDocType] = useState<"id_card" | "passport" | null>(data.documentType as any || null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const passportRef = useRef<HTMLDivElement>(null);

  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg);
    setFieldErrorBanner(null);
    setError(null);
    setTimeout(() => setSuccessMessage(null), 3000);
  }, []);

  const persistField = useCallback(
    (field: "idFront" | "idBack" | "passportPhoto", label: string) => (base64: string) => {
      updateData({ [field]: base64 });
      setErrors((prev) => ({ ...prev, [field]: false }));
      if (base64) {
        showSuccess(label + " წარმატებით აიტვირთა");
      }
    },
    [updateData, showSuccess],
  );

  const applyExtractedIdentity = useCallback(
    (extracted: Partial<SubmissionInput>) => {
      updateData({
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        idNumber: extracted.idNumber,
        gender: extracted.gender,
        expiryDate: extracted.expiryDate,
      });
    },
    [updateData],
  );

  const runPassportOcr = useCallback(
    async (file: File) => {
      passportOcrAbortRef.current?.abort();
      const controller = new AbortController();
      passportOcrAbortRef.current = controller;

      setIsPassportScanning(true);
      setError(null);

      try {
        console.log("[Passport OCR] Dispatching to n8n webhook immediately...");
        const extracted = await extractPassportOcr(file, controller.signal);

        applyExtractedIdentity({
          firstName: extracted.firstName,
          lastName: extracted.lastName,
          idNumber: extracted.idNumber,
          gender: extracted.gender,
          expiryDate: extracted.expiryDate,
        });

        showSuccess("პასპორტიდან მონაცემები წარმატებით ამოიკითხა");
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : "მონაცემების ამოკითხვა ვერ მოხერხდა";
        console.error("[Passport OCR] Webhook failed:", err);
        setError(msg + ". შეგიძლიათ შეავსოთ ველები ხელით.");
      } finally {
        if (passportOcrAbortRef.current === controller) {
          setIsPassportScanning(false);
          passportOcrAbortRef.current = null;
        }
      }
    },
    [applyExtractedIdentity, showSuccess],
  );

  const onPassportFileReady = useCallback(
    (file: File) => {
      void runPassportOcr(file);
    },
    [runPassportOcr],
  );

  const handleContinue = async () => {
    if (isScanning || isPassportScanning) return;

    if (!docType) {
      setFieldErrorBanner("გთხოვთ, აირჩიოთ დოკუმენტის ტიპი (ID ბარათი ან პასპორტი)");
      setSuccessMessage(null);
      return;
    }

    const newErrors: Record<string, boolean> = {};
    if (docType === "id_card") {
      if (!data.idFront) newErrors.idFront = true;
      if (!data.idBack) newErrors.idBack = true;
    } else if (docType === "passport") {
      if (!data.passportPhoto) newErrors.passportPhoto = true;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setSuccessMessage(null);
      const missingLabels: string[] = [];
      if (newErrors.idFront) missingLabels.push("წინა მხარე");
      if (newErrors.idBack) missingLabels.push("უკანა მხარე");
      if (newErrors.passportPhoto) missingLabels.push("პასპორტის ფოტო");
      setFieldErrorBanner("გთხოვთ ატვირთოთ: " + missingLabels.join(", "));
      if (newErrors.idFront) {
        frontRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (newErrors.idBack) {
        backRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (newErrors.passportPhoto) {
        passportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setFieldErrorBanner(null);

    if (data.firstName && data.lastName && data.idNumber) {
      onNext();
      return;
    }

    if (docType === "passport") {
      if (!data.firstName || !data.lastName) {
        setError("მონაცემები ვერ ამოიკითხა. გთხოვთ, შეავსოთ ველები ხელით ან ხელახლა ატვირთოთ პასპორტი.");
        return;
      }
      onNext();
      return;
    }

    if (!data.idFront || !data.idBack) {
      setError("გთხოვთ, ატვირთოთ პირადობის მოწმობის ორივე მხარე");
      return;
    }

    setError(null);
    setIsScanning(true);

    try {
      const res = await fetch("/api/vision/extract-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ frontImage: data.idFront, backImage: data.idBack }),
      });

      let dataRes: any = null;
      try {
        dataRes = await res.json();
      } catch {
        // non-JSON response
      }

      if (!res.ok) {
        const msg = dataRes?.error || dataRes?.message || (await res.text().catch(() => ""));
        throw new Error(typeof msg === "string" && msg ? msg : "მონაცემების ამოკითხვა ვერ მოხერხდა");
      }

      if (dataRes && dataRes.error) {
        setError(dataRes.error);
        return;
      }

      const extracted: Partial<SubmissionInput> = {
        firstName:
          typeof dataRes?.firstName === "string"
            ? dataRes.firstName
            : typeof dataRes?.name === "string"
            ? dataRes.name
            : undefined,
        lastName:
          typeof dataRes?.lastName === "string"
            ? dataRes.lastName
            : typeof dataRes?.surname === "string"
            ? dataRes.surname
            : undefined,
        idNumber: typeof dataRes?.personalId === "string" ? dataRes.personalId : undefined,
        gender: typeof dataRes?.gender === "string" ? dataRes.gender : undefined,
        expiryDate: typeof dataRes?.expiryDate === "string" ? dataRes.expiryDate : undefined,
      };

      if (!extracted.firstName || !extracted.lastName) {
        setError("მონაცემების ამოკითხვა ვერ მოხერხდა. გთხოვთ, ატვირთოთ უფრო მკაფიო ფოტოები");
        return;
      }

      applyExtractedIdentity(extracted);
      onNext();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "მონაცემების ამოკითხვა ვერ მოხერხდა";
      setError(msg);
    } finally {
      setIsScanning(false);
    }
  };

  const hasExtractedFields = Boolean(data.firstName || data.lastName || data.idNumber);

  const canProceed =
    docType === "id_card"
      ? !!data.idFront && !!data.idBack && !isScanning && !isPassportScanning
      : docType === "passport"
      ? !!data.passportPhoto && !isScanning && !isPassportScanning
      : false;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">პირადობის დადასტურება</h2>
        <p className="text-muted-foreground">ატვირთეთ მომხმარებლის პირადობის მოწმობის ორივე მხარე</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Button
          type="button"
          variant={docType === "id_card" ? "default" : "outline"}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDocType("id_card"); updateData({ documentType: "id_card" }); setError(null); }}
          className="h-16 text-lg rounded-2xl"
        >
          ID ბარათი
        </Button>
        <Button
          type="button"
          variant={docType === "passport" ? "default" : "outline"}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDocType("passport"); updateData({ documentType: "passport" }); setError(null); }}
          className="h-16 text-lg rounded-2xl"
        >
          პასპორტი
        </Button>
      </div>

      {docType && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {docType === "id_card" ? (
            <>
              <div ref={frontRef}>
                <Label className={cn("block mb-2 font-semibold", errors.idFront && "text-destructive")}>წინა მხარე</Label>
                <MediaUploadZone
                  key="idFront"
                  label="წინა მხარე"
                  pickerTitle="პირადობის წინა მხარე"
                  storedValue={data.idFront}
                  onPersist={persistField("idFront", "წინა მხარე")}
                  onError={setError}
                  hasError={errors.idFront}
                  emptyHint="დააჭირეთ წინა მხარის ასატვირთად"
                  uploadedHint="წინა მხარე აიტვირთა (შეცვლა)"
                />
              </div>

              <div ref={backRef}>
                <Label className={cn("block mb-2 font-semibold", errors.idBack && "text-destructive")}>უკანა მხარე</Label>
                <MediaUploadZone
                  key="idBack"
                  label="უკანა მხარე"
                  pickerTitle="პირადობის უკანა მხარე"
                  storedValue={data.idBack}
                  onPersist={persistField("idBack", "უკანა მხარე")}
                  onError={setError}
                  hasError={errors.idBack}
                  emptyHint="დააჭირეთ უკანა მხარის ასატვირთად"
                  uploadedHint="უკანა მხარე აიტვირთა (შეცვლა)"
                />
              </div>
            </>
          ) : (
            <div className="sm:col-span-2 space-y-4" ref={passportRef}>
              <Label className={cn("block mb-2 font-semibold", errors.passportPhoto && "text-destructive")}>პასპორტის ფოტო</Label>
              <MediaUploadZone
                key="passportPhoto"
                label="პასპორტის ფოტო"
                pickerTitle="პასპორტის ფოტო"
                storedValue={data.passportPhoto}
                onPersist={persistField("passportPhoto", "პასპორტის ფოტო")}
                onFileReady={onPassportFileReady}
                onError={setError}
                hasError={errors.passportPhoto}
                ocrLoading={isPassportScanning}
                ocrLoadingMessage="მიმდინარეობს მონაცემების ამოკითხვა..."
                emptyHint="დააჭირეთ პასპორტის ასატვირთად"
                uploadedHint="პასპორტი აიტვირთა (შეცვლა)"
              />

              {(hasExtractedFields || docType === "passport") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50">
                  <div className="space-y-2 sm:col-span-2">
                    <h3 className="text-sm font-semibold text-foreground">ამომკითხავი მონაცემები</h3>
                    <p className="text-xs text-muted-foreground">
                      {isPassportScanning
                        ? "მიმდინარეობს მონაცემების ამოკითხვა..."
                        : "შეამოწმეთ ან შეასწორეთ ამომკითხვის შედეგი"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="step1-firstName">სახელი</Label>
                    <Input
                      id="step1-firstName"
                      value={data.firstName || ""}
                      onChange={(e) => updateData({ firstName: e.target.value })}
                      className="h-11 rounded-xl"
                      placeholder="სახელი"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="step1-lastName">გვარი</Label>
                    <Input
                      id="step1-lastName"
                      value={data.lastName || ""}
                      onChange={(e) => updateData({ lastName: e.target.value })}
                      className="h-11 rounded-xl"
                      placeholder="გვარი"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="step1-idNumber">პირადი ნომერი</Label>
                    <Input
                      id="step1-idNumber"
                      value={data.idNumber || ""}
                      onChange={(e) => updateData({ idNumber: e.target.value })}
                      className="h-11 rounded-xl"
                      placeholder="11-ნიშნა ნომერი"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="step1-gender">სქესი</Label>
                    <Input
                      id="step1-gender"
                      value={data.gender || ""}
                      onChange={(e) => updateData({ gender: e.target.value })}
                      className="h-11 rounded-xl"
                      placeholder="ქალი / კაცი"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="step1-expiryDate">ვადის გასვლის თარიღი</Label>
                    <Input
                      id="step1-expiryDate"
                      value={data.expiryDate || ""}
                      onChange={(e) => updateData({ expiryDate: e.target.value })}
                      className="h-11 rounded-xl"
                      placeholder="მაგ: 2030-12-31"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {fieldErrorBanner && (
          <motion.div
            key="field-error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-3"
          >
            <ShieldAlert className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <h4 className="font-semibold text-destructive">საჭირო ფაილები არ არის ატვირთული</h4>
              <p className="text-sm text-destructive/80">{fieldErrorBanner}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(isScanning || isPassportScanning) && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center gap-3"
          >
            <ScanLine className="w-5 h-5 text-primary animate-pulse" />
            <div>
              <h4 className="font-semibold text-foreground">მონაცემები მუშავდება...</h4>
              <p className="text-sm text-muted-foreground">მიმდინარეობს მონაცემების ამოკითხვა. გთხოვთ, დაელოდოთ.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            key="ocr-error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3"
          >
            <ShieldAlert className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <h4 className="font-semibold text-destructive">დადასტურება ვერ მოხერხდა</h4>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {successMessage && (
          <motion.div
            key="upload-success"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3"
          >
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <h4 className="font-semibold text-emerald-700 dark:text-emerald-400">ატვირთვა წარმატებით</h4>
              <p className="text-sm text-emerald-600/80 dark:text-emerald-500/80">{successMessage}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-6 flex flex-col sm:flex-row sm:justify-end">
        <Button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleContinue(); }}
          disabled={!canProceed}
          className="w-full sm:w-auto px-8 h-12 rounded-xl text-base shadow-md"
        >
          {isScanning || isPassportScanning ? "მონაცემები მუშავდება..." : "გაგრძელება"}
        </Button>
      </div>
    </motion.div>
  );
}

export const Step1Identity = memo(Step1IdentityInner);
