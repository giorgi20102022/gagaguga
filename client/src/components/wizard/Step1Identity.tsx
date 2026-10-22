import { useState, useRef, useCallback, useEffect, memo } from "react";
import { type SubmissionInput } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ShieldAlert, ScanLine, CheckCircle } from "lucide-react";
import { motion, AnimatePresence, useIsPresent } from "framer-motion";
import { MediaUploadZone } from "@/components/ui/MediaUploadZone";
import { DocumentValidationDialog } from "./DocumentValidationDialog";
import { extractPassportOcr } from "@/lib/passportOcr";

interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onNext: (verifiedIdentity?: Partial<SubmissionInput>) => void;
}

function Step1IdentityInner({ data, updateData, onNext }: Props) {
  const [isScanning, setIsScanning] = useState(false);
  const isPassportScanning = isScanning && data.documentType === "passport";
  const isPresent = useIsPresent();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrorBanner, setFieldErrorBanner] = useState<string | null>(null);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const scanInFlightRef = useRef(false);
  const navigatedRef = useRef(false);
  const uploadPendingRef = useRef(new Set<string>());
  const [pendingUploads, setPendingUploads] = useState(0);
  const latestRef = useRef({ data, isPresent });
  latestRef.current = { data, isPresent };
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards every async state update so nothing re-renders this subtree after the
  // parent <AnimatePresence> has started detaching it.
  const isMountedRef = useRef(true);

  const [docType, setDocType] = useState<"id_card" | "passport" | null>(data.documentType as any || null);
  const [photoReset, setPhotoReset] = useState(0);
  const photoResetRef = useRef(0);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const passportRef = useRef<HTMLDivElement>(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const showSuccess = useCallback((msg: string) => {
    clearSuccessTimer();
    setSuccessMessage(msg);
    setFieldErrorBanner(null);
    setError(null);
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null;
      if (!isMountedRef.current) return;
      setSuccessMessage(null);
    }, 3000);
  }, [clearSuccessTimer]);

  // Cancel in-flight work and pending timers before this step is torn down, so no
  // late setState can mutate a subtree the parent <AnimatePresence> is animating out.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearSuccessTimer();
      ocrAbortRef.current?.abort();
      ocrAbortRef.current = null;
    };
  }, [clearSuccessTimer]);

  const persistField = useCallback(
    (field: "idFront" | "idBack" | "passportPhoto", label: string) => (base64: string) => {
      if (photoResetRef.current !== photoReset) return;
      uploadPendingRef.current.delete(field);
      if (!isMountedRef.current || !latestRef.current.isPresent) return;
      setPendingUploads(uploadPendingRef.current.size);
      ocrAbortRef.current?.abort();
      updateData({ [field]: base64, firstName: "", lastName: "", idNumber: "", gender: "", expiryDate: "" });
      setErrors((prev) => ({ ...prev, [field]: false }));
      if (base64) {
        showSuccess(label + " წარმატებით აიტვირთა");
      }
    },
    [updateData, showSuccess, photoReset],
  );

  // Invalidate immediately when a replacement is selected, before async upload preparation.
  const invalidateVerification = useCallback(() => {
    ocrAbortRef.current?.abort();
    ocrAbortRef.current = null;
    scanInFlightRef.current = false;
    navigatedRef.current = false;
    setIsScanning(false);
    updateData({ firstName: "", lastName: "", idNumber: "", gender: "", expiryDate: "" });
  }, [updateData]);

  const onFileReady = (field: string) => () => {
    invalidateVerification();
    uploadPendingRef.current.add(field);
    setPendingUploads(uploadPendingRef.current.size);
  };

  useEffect(() => {
    if (!isPresent) ocrAbortRef.current?.abort();
  }, [isPresent]);

  const failPhotoVerification = (message: string) => {
    invalidateVerification();
    uploadPendingRef.current.clear();
    setPendingUploads(0);
    clearSuccessTimer();
    setSuccessMessage(null);
    setFieldErrorBanner(null);
    setErrors({});
    updateData({
      ...(docType === "id_card" ? { idFront: undefined, idBack: undefined } : { passportPhoto: undefined }),
      signature: undefined, socialVerified: false, pensionerVerified: false,
    });
    setPhotoReset(++photoResetRef.current);
    setError(message);
  };

  const handleContinue = async () => {
    if (error || scanInFlightRef.current || navigatedRef.current || uploadPendingRef.current.size || !isPresent || isScanning) return;

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
      // Settle animated/conditional UI before navigating away (see handleContinue's
      // OCR branch below for the race this prevents).
      clearSuccessTimer();
      navigatedRef.current = true;
      onNext();
      return;
    }

    setError(null);
    scanInFlightRef.current = true;
    setIsScanning(true);
    const controller = new AbortController();
    ocrAbortRef.current = controller;
    const snapshot = data;
    const isCurrent = () => isMountedRef.current && latestRef.current.isPresent &&
      ocrAbortRef.current === controller && !controller.signal.aborted &&
      latestRef.current.data.documentType === snapshot.documentType &&
      latestRef.current.data.idFront === snapshot.idFront &&
      latestRef.current.data.idBack === snapshot.idBack &&
      latestRef.current.data.passportPhoto === snapshot.passportPhoto;
    const timeout = setTimeout(() => {
      if (!isCurrent()) return;
      controller.abort();
      failPhotoVerification("მონაცემების ამოკითხვას დრო გაუვიდა");
    }, 120_000);

    // Helper to compress image Blob to max 1200px dimension and 0.7 quality
    const compressBlob = async (blob: Blob): Promise<Blob> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1024;
          const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * ratio);
          canvas.height = Math.round(img.naturalHeight * ratio);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(blob);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((compressed) => {
            if (compressed) resolve(compressed);
            else resolve(blob);
          }, 'image/jpeg', 0.70);
        };
        img.onerror = (err) => reject(err);
        img.src = URL.createObjectURL(blob);
      });
    };

    try {
      // iOS Safari silently drops fetch() with large JSON bodies (base64 images > ~2MB).
      // Fix: send as multipart FormData — iOS handles this reliably at any size.
      const base64ToBlob = (b64: string, mime = "image/jpeg"): Blob => {
        const parts = b64.split(",");
        const raw = atob(parts.length > 1 ? parts[1] : parts[0]);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        return new Blob([buf], { type: mime });
      };

      let extracted: Partial<SubmissionInput>;
      if (docType === "passport") {
        const blob = base64ToBlob(data.passportPhoto!);
        extracted = await extractPassportOcr(new File([blob], "passport.jpg", { type: blob.type }), controller.signal);
      } else {
        const formData = new FormData();
        // Compress images before appending to FormData
        const frontBlob = await compressBlob(base64ToBlob(data.idFront!));
        const backBlob = await compressBlob(base64ToBlob(data.idBack!));
        formData.append("frontImage", frontBlob, "front.jpg");
        formData.append("backImage", backBlob, "back.jpg");

        if (!isCurrent()) return;
        const res = await fetch("/api/vision/extract-id", {
          signal: controller.signal,
          method: "POST",
          // Do NOT set Content-Type header — browser must set it with multipart boundary
          credentials: "include",
          body: formData,
        });

        let dataRes: any = null;
        try {
          dataRes = await res.json();
        } catch {
          // non-JSON response
        }

        if (!isCurrent()) return;
        if (!res.ok || dataRes?.success === false) {
          const msg = dataRes?.message || dataRes?.error || (await res.text().catch(() => ""));
          throw new Error(typeof msg === "string" && msg ? msg : "მონაცემების ამოკითხვა ვერ მოხერხდა");
        }

        if (dataRes && dataRes.error) {
          failPhotoVerification(dataRes.message || dataRes.error);
          return;
        }

        extracted = {
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

      }
      if (!isCurrent()) return;
      if (!extracted.firstName || !extracted.lastName || !extracted.idNumber) {
        failPhotoVerification("მონაცემების ამოკითხვა ვერ მოხერხდა. გთხოვთ, ატვირთოთ უფრო მკაფიო ფოტოები");
        return;
      }

      // Parent validates and commits this exact result before advancing.
      // Do not call onNext against the previous render's formData.
      // Settle every piece of local state that drives an animated/conditional child
      // BEFORE navigating. Calling onNext() first would start the parent
      // <AnimatePresence mode="wait"> exit for this whole subtree while isScanning is
      // still true; the later setIsScanning(false) would then make this component's own
      // nested <AnimatePresence> unmount the "მონაცემები მუშავდება..." indicator via a
      // second, independent DOM-mutation pass over nodes the parent is already
      // detaching → "Failed to execute 'insertBefore' on 'Node'".
      setIsScanning(false);
      clearSuccessTimer();
      navigatedRef.current = true;
      onNext(extracted);
      return;
    } catch (e) {
        if (!isCurrent()) return; // Ignore failures for replaced photos or abandoned requests.
        console.error("Client side failure:", e);
        failPhotoVerification(e instanceof Error ? e.message : "მონაცემების ამოკითხვა ვერ მოხერხდა");
    } finally {
      // Still required for the error/early-return paths; idempotent after the
      // success path above, and guarded so it can never fire post-unmount.
      clearTimeout(timeout);
      if (ocrAbortRef.current === controller) {
        ocrAbortRef.current = null;
        scanInFlightRef.current = false;
        if (isMountedRef.current && latestRef.current.isPresent) setIsScanning(false);
      }
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
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); invalidateVerification(); setDocType("id_card"); updateData({ documentType: "id_card" }); setError(null); }}
          className="h-16 text-lg rounded-2xl"
        >
          ID ბარათი
        </Button>
        <Button
          type="button"
          variant={docType === "passport" ? "default" : "outline"}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); invalidateVerification(); setDocType("passport"); updateData({ documentType: "passport" }); setError(null); }}
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
                  key={`idFront-${photoReset}`}
                  disabled={isScanning}
                  onFileReady={onFileReady("idFront")}
                  label="წინა მხარე"
                  pickerTitle="პირადობის წინა მხარე"
                  storedValue={data.idFront}
                  onPersist={persistField("idFront", "წინა მხარე")}
                  onError={(message) => { uploadPendingRef.current.clear(); setPendingUploads(0); setError(message); }}
                  hasError={errors.idFront}
                  emptyHint="დააჭირეთ წინა მხარის ასატვირთად"
                  uploadedHint="წინა მხარე აიტვირთა (შეცვლა)"
                />
              </div>

              <div ref={backRef}>
                <Label className={cn("block mb-2 font-semibold", errors.idBack && "text-destructive")}>უკანა მხარე</Label>
                <MediaUploadZone
                  key={`idBack-${photoReset}`}
                  disabled={isScanning}
                  onFileReady={onFileReady("idBack")}
                  label="უკანა მხარე"
                  pickerTitle="პირადობის უკანა მხარე"
                  storedValue={data.idBack}
                  onPersist={persistField("idBack", "უკანა მხარე")}
                  onError={(message) => { uploadPendingRef.current.clear(); setPendingUploads(0); setError(message); }}
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
                key={`passportPhoto-${photoReset}`}
                disabled={isScanning}
                label="პასპორტის ფოტო"
                pickerTitle="პასპორტის ფოტო"
                storedValue={data.passportPhoto}
                onPersist={persistField("passportPhoto", "პასპორტის ფოტო")}
                onFileReady={onFileReady("passportPhoto")}
                onError={(message) => { uploadPendingRef.current.clear(); setPendingUploads(0); setError(message); }}
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

      <DocumentValidationDialog message={error} onDismiss={() => setError(null)} />

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
          disabled={!canProceed || pendingUploads > 0 || Boolean(error)}
          className="w-full sm:w-auto px-8 h-12 rounded-xl text-base shadow-md"
        >
          {isScanning || isPassportScanning ? "მონაცემები მუშავდება..." : "გაგრძელება"}
        </Button>
      </div>
    </motion.div>
  );
}

export const Step1Identity = memo(Step1IdentityInner);
