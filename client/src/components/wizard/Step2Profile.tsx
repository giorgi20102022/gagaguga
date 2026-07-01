import { useState, useRef, useEffect, memo, useCallback } from "react";
import { type SubmissionInput } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn, fileToBase64 } from "@/lib/utils";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { MediaUploadZone } from "@/components/ui/MediaUploadZone";
import { generateSignatureBase64 } from "./signatureUtils";

interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onNext: () => void;
  onBack: () => void;
}

const GEORGIAN_ERRORS: Record<string, string> = {
  "Document is older than 6 days.": "დოკუმენტი ვადაგასულია (6 დღეზე მეტია გასული ამონაწერის მომზადებიდან). გთხოვთ, ატვირთოთ ახალი ამონაწერი.",
};

function extractVisionApiError(payload: unknown): string | null {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  for (const [key, georgian] of Object.entries(GEORGIAN_ERRORS)) {
    if (raw.includes(key)) return georgian;
  }
  return null;
}

function getErrorMessage(payload: unknown): string | null {
  // Direct string payload
  if (typeof payload === "string") return payload;
  // If payload is an object, look for known error keys recursively
  const search = (obj: any, visited = new Set<any>()): string | null => {
    if (!obj || typeof obj !== "object" || visited.has(obj)) return null;
    visited.add(obj);
    const keys = ["verificationError", "error", "message", "msg"];
    for (const key of keys) {
      if (typeof obj[key] === "string" && obj[key]) return obj[key];
    }
    // Also check nested "data" object for error
    if (obj.data && typeof obj.data === "object") {
      const nested = search(obj.data);
      if (nested) return nested;
    }
    // Recursive search in all object values
    for (const val of Object.values(obj)) {
      const res = search(val);
      if (res) return res;
    }
    return null;
  };
  return search(payload);
}

function unwrapVerificationPayload(payload: unknown): Record<string, unknown> | null {
  let current = payload;

  while (Array.isArray(current) && current.length > 0) {
    current = current[0];
  }

  if (!current || typeof current !== "object") {
    return null;
  }

  const record = current as Record<string, unknown>;
  const nestedKeys = ["data", "result", "response", "body"];

  for (const key of nestedKeys) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const unwrapped = unwrapVerificationPayload(nested);
      if (unwrapped) {
        return { ...record, ...unwrapped };
      }
    }
  }

  return record;
}

function extractVerificationSuccess(payload: unknown): boolean | null {
  if (typeof payload === "boolean") {
    return payload;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const extracted = extractVerificationSuccess(item);
      if (extracted !== null) return extracted;
    }
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directKeys = ["success", "isValid", "matched", "verified", "valid"];
  for (const key of directKeys) {
    if (typeof record[key] === "boolean") {
      return record[key] as boolean;
    }
  }

  const nestedKeys = ["data", "result", "response", "body"];
  for (const key of nestedKeys) {
    const extracted = extractVerificationSuccess(record[key]);
    if (extracted !== null) return extracted;
  }

  return null;
}

export function Step2ProfileInner({ data, updateData, onNext, onBack }: Props) {
  const [isPensionerVerified, setIsPensionerVerified] = useState(() => !!data.pensionerVerified);
  const [isVerifyingPensioner, setIsVerifyingPensioner] = useState(false);
  const [pensionerVerifyError, setPensionerVerifyError] = useState<string | null>(null);
  const [pendingPensionerFile, setPendingPensionerFile] = useState<File | null>(null);

  const [isSocialVerified, setIsSocialVerified] = useState(() => !!data.socialVerified);
  const [isVerifyingSocial, setIsVerifyingSocial] = useState(false);
  const [socialVerifyError, setSocialVerifyError] = useState<string | null>(null);
  const [pendingSocialFile, setPendingSocialFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const persistSocial = useCallback((base64: string) => {
    updateData({ socialExtract: base64 });
    setErrors((prev) => ({ ...prev, socialExtract: false }));
  }, [updateData]);

  const persistPensioner = useCallback((base64: string) => {
    updateData({ pensionerCertificate: base64 });
    setErrors((prev) => ({ ...prev, pensionerCertificate: false }));
  }, [updateData]);

  const onSocialFileReady = useCallback((file: File) => {
    setPendingSocialFile(file);
    setIsVerifyingSocial(false);
    setSocialVerifyError(null);
    setIsSocialVerified(false);
  }, []);

  const onPensionerFileReady = useCallback((file: File) => {
    setPendingPensionerFile(file);
    setIsVerifyingPensioner(false);
    setPensionerVerifyError(null);
    setIsPensionerVerified(false);
  }, []);

  useEffect(() => {
    updateData({ socialVerified: isSocialVerified });
  }, [isSocialVerified]);

  useEffect(() => {
    updateData({ pensionerVerified: isPensionerVerified });
  }, [isPensionerVerified]);

  const fieldRefs = {
    firstName: useRef<HTMLDivElement>(null),
    lastName: useRef<HTMLDivElement>(null),
    idNumber: useRef<HTMLDivElement>(null),
    socialExtract: useRef<HTMLDivElement>(null),
    pensionerCertificate: useRef<HTMLDivElement>(null),
  };

  const handleSendPensionerVerification = async () => {
    if (!pendingPensionerFile || isVerifyingPensioner) return;

    setIsVerifyingPensioner(true);
    setPensionerVerifyError(null);
    setIsPensionerVerified(false);

    try {
      const base64 = await fileToBase64(pendingPensionerFile);

      const res = await axios.post("/api/vision/verify-pensioner", {
        image: base64,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        personalId: data.idNumber || "",
        idNumber: data.idNumber || "",
      }, {
        withCredentials: true,
      });

      const verified = res.data;

      // Safety: if the response is empty or not an object, treat as failure
      if (!verified || typeof verified !== "object") {
        setIsPensionerVerified(false);
        setPensionerVerifyError("პასუხი ცარიელია ან არასწორი ფორმატით მოვიდა");
        return;
      }

      const embeddedError = extractVisionApiError(verified);
      if (embeddedError) {
        setIsPensionerVerified(false);
        setPensionerVerifyError(embeddedError);
        return;
      }

      const verificationSuccess = extractVerificationSuccess(verified);

      if (verificationSuccess === false) {
        setIsPensionerVerified(false);
        setPensionerVerifyError("დოკუმენტის გადამოწმება ვერ მოხერხდა");
        return;
      }

      if (verificationSuccess !== true) {
        console.error("[Pensioner Verification] Unexpected backend response shape", verified);
        setIsPensionerVerified(false);
        setPensionerVerifyError("ვერიფიკაციის პასუხის დამუშავება ვერ მოხერხდა");
        return;
      }

      setIsPensionerVerified(true);
      setPensionerVerifyError(null);
      if (!data.pensioner) {
        updateData({ pensioner: true });
      }
    } catch (err: unknown) {
      const errData = (err as any)?.response?.data;
      const georgianMsg = extractVisionApiError(errData);
      const msg = georgianMsg
        ?? (typeof errData?.message === "string" ? errData.message : null)
        ?? ((err as any)?.code === "ECONNABORTED" ? "ვერიფიკაციის მოთხოვნას დრო გაუვიდა" : null)
        ?? "დადასტურება ვერ მოხერხდა";
      setIsPensionerVerified(false);
      setPensionerVerifyError(msg);
    } finally {
      setIsVerifyingPensioner(false);
    }
  };

  const handleSendSocialVerification = async () => {
    if (!pendingSocialFile || isVerifyingSocial) return;

    setIsVerifyingSocial(true);
    setSocialVerifyError(null);
    setIsSocialVerified(false);

    try {
      const formData = new FormData();
      formData.append("image", pendingSocialFile);
      if (data.idNumber) {
        formData.append("personalId", data.idNumber);
        formData.append("idNumber", data.idNumber);
      }

      const res = await axios.post("/api/vision/verify-social-card", formData, {
        withCredentials: true,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const verified = res.data;

      if (!verified || typeof verified !== "object") {
        setIsSocialVerified(false);
        setSocialVerifyError("პასუხი ცარიელია ან არასწორი ფორმატით მოვიდა");
        return;
      }

      // First, try explicit verificationError field
      const explicitError = (verified as Record<string, any>).verificationError;
      if (typeof explicitError === "string") {
        setIsSocialVerified(false);
        setSocialVerifyError(explicitError);
        return;
      }

      // Then attempt generic error extraction
      const genericError = getErrorMessage(verified);
      if (genericError) {
        setIsSocialVerified(false);
        setSocialVerifyError(genericError);
        return;
      }

      const embeddedErr = extractVisionApiError(verified);
      if (embeddedErr) {
        setIsSocialVerified(false);
        setSocialVerifyError(embeddedErr);
        return;
      }



      const extracted = unwrapVerificationPayload(verified);

      if (!extracted) {
        console.error("[Social Verification] Unexpected OCR response shape", verified);
        setIsSocialVerified(false);
        setSocialVerifyError("ვერიფიკაციის პასუხის დამუშავება ვერ მოხერხდა");
        return;
      }

      const normalizeName = (value: unknown) =>
        String(value ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();

      const normalizeCompact = (value: unknown) => normalizeName(value).replace(/\s+/g, "");
      const normalizeId = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, "");

      const nameMatch = (ocrValue: unknown, formValue: unknown) => {
        const a = normalizeName(ocrValue);
        const b = normalizeName(formValue);
        if (!a || !b) return false;
        if (a === b) return true;
        if (a.includes(b) || b.includes(a)) return true;
        if (normalizeCompact(a) === normalizeCompact(b)) return true;
        return false;
      };

      const ocrFirstName = extracted.firstName ?? extracted.name ?? extracted.first_name;
      const ocrLastName = extracted.lastName ?? extracted.surname ?? extracted.last_name;
      const ocrPersonalId = extracted.personalId ?? extracted.idNumber ?? extracted.personal_id;

      const firstNameMatches = nameMatch(ocrFirstName, data.firstName || "");
      const lastNameMatches = nameMatch(ocrLastName, data.lastName || "");
      const personalIdMatches = normalizeId(ocrPersonalId) === normalizeId(data.idNumber || "");

      if (!firstNameMatches || !lastNameMatches || !personalIdMatches) {
        console.warn("[Social Verification] OCR data did not match ID card form data", {
          ocrFirstName,
          ocrLastName,
          ocrPersonalId,
          formFirstName: data.firstName,
          formLastName: data.lastName,
          formPersonalId: data.idNumber,
        });
        setIsSocialVerified(false);
        setSocialVerifyError("სოციალური ბარათის მონაცემები არ ემთხვევა პირადობის მონაცემებს");
        return;
      }

      const verificationSuccess = extractVerificationSuccess(verified);
      if (verificationSuccess === false) {
        setIsSocialVerified(false);
        setSocialVerifyError("შესაბამისობა ვერ მოხერხდა");
        return;
      }

      setIsSocialVerified(true);
      setSocialVerifyError(null);
    } catch (err: unknown) {
      const errData = (err as any)?.response?.data;
      const genericError = getErrorMessage(errData);
      const georgianMsg = genericError ?? extractVisionApiError(errData);
      const msg = georgianMsg
        ?? (typeof errData?.message === "string" ? errData.message : null)
        ?? ((err as any)?.code === "ECONNABORTED" ? "ვერიფიკაციის მოთხოვნის დრო გასულა" : null)
        ?? "დადასტურება ვერ მოხერხდა";
      setIsSocialVerified(false);
      setSocialVerifyError(msg);
    } finally {
      setIsVerifyingSocial(false);
    }
  };

  const isSocialStatusChecked = !!data.sociallyVulnerable;
  const isPensionerChecked = !!data.pensioner;
  const isSocialPhotoUploaded = !!data.socialExtract;
  const isPensionerPhotoUploaded = !!data.pensionerCertificate;

  const isNextDisabled =
    !data.firstName ||
    !data.lastName ||
    !data.idNumber ||
    (isSocialStatusChecked && (!isSocialPhotoUploaded || !isSocialVerified)) ||
    (isPensionerChecked && (!isPensionerPhotoUploaded || !isPensionerVerified));

  const handleNext = async () => {
    const newErrors: Record<string, boolean> = {};
    if (!data.firstName) newErrors.firstName = true;
    if (!data.lastName) newErrors.lastName = true;
    if (!data.idNumber) newErrors.idNumber = true;
    if (data.sociallyVulnerable && (!data.socialExtract || !isSocialVerified)) newErrors.socialExtract = true;
    if (data.pensioner && (!data.pensionerCertificate || !isPensionerVerified)) newErrors.pensionerCertificate = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Find the first field with an error and scroll to it
      const firstErrorField = (Object.keys(newErrors) as Array<keyof typeof fieldRefs>).find(
        (field) => newErrors[field]
      );
      if (firstErrorField && fieldRefs[firstErrorField].current) {
        fieldRefs[firstErrorField].current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    // Auto-generate signature from firstName and lastName before moving to next step
    try {
      const signatureBase64 = await generateSignatureBase64(data.firstName, data.lastName);
      if (signatureBase64) {
        updateData({ signature: signatureBase64 } as any);
      }
    } catch (err) {
      console.error("[Step2Profile] Failed to generate signature:", err);
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
        <h2 className="text-2xl font-bold tracking-tight">პროფილი</h2>
        <p className="text-muted-foreground">შეავსეთ საკონტაქტო ინფორმაცია და განსაზღვრეთ შესაბამისობის კრიტერიუმები.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2 md:col-span-2">
          <h3 className="text-lg font-semibold border-b pb-2">პირადი მონაცემები</h3>
        </div>

        <div className="space-y-2" ref={fieldRefs.firstName}>
          <Label htmlFor="firstName" className={cn(errors.firstName && "text-destructive")}>სახელი *</Label>
          <Input
            id="firstName"
            placeholder="შეიყვანეთ სახელი"
            value={data.firstName || ""}
            onChange={(e) => {
              updateData({ firstName: e.target.value });
              setErrors((prev) => ({ ...prev, firstName: false }));
            }}
            className={cn("h-12 rounded-xl", errors.firstName && "border-destructive bg-destructive/5")}
          />
        </div>

        <div className="space-y-2" ref={fieldRefs.lastName}>
          <Label htmlFor="lastName" className={cn(errors.lastName && "text-destructive")}>გვარი *</Label>
          <Input
            id="lastName"
            placeholder="შეიყვანეთ გვარი"
            value={data.lastName || ""}
            onChange={(e) => {
              updateData({ lastName: e.target.value });
              setErrors((prev) => ({ ...prev, lastName: false }));
            }}
            className={cn("h-12 rounded-xl", errors.lastName && "border-destructive bg-destructive/5")}
          />
        </div>

        <div className="space-y-2" ref={fieldRefs.idNumber}>
          <Label htmlFor="idNumber" className={cn(errors.idNumber && "text-destructive")}>პირადი ნომერი *</Label>
          <Input
            id="idNumber"
            placeholder="შეიყვანეთ 11-ნიშნა პირადი ნომერი"
            value={data.idNumber || ""}
            onChange={(e) => {
              updateData({ idNumber: e.target.value });
              setErrors((prev) => ({ ...prev, idNumber: false }));
            }}
            className={cn("h-12 rounded-xl", errors.idNumber && "border-destructive bg-destructive/5")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="gender">სქესი</Label>
          <Input
            id="gender"
            placeholder="მაგ: ქალი / კაცი"
            value={data.gender || ""}
            onChange={(e) => updateData({ gender: e.target.value })}
            className="h-12 rounded-xl"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="expiryDate">პირადობის ვადა</Label>
          <Input
            id="expiryDate"
            placeholder="მაგ: 2030-12-31"
            value={data.expiryDate || ""}
            onChange={(e) => updateData({ expiryDate: e.target.value })}
            className="h-12 rounded-xl"
          />
        </div>


      </div>

      <div className="pt-4 space-y-6">
        <h3 className="text-lg font-semibold border-b pb-2">სტატუსი</h3>

        {/* Socially Vulnerable */}
        <div className="bg-muted/40 p-5 rounded-2xl border border-border/50 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold">სოციალურად დაუცველი</Label>
              <p className="text-sm text-muted-foreground">აქვს თუ არა განმცხადებელს სოციალურად დაუცველის სტატუსი?</p>
            </div>
            <Switch 
              checked={data.sociallyVulnerable || false} 
              onCheckedChange={(c) => {
                updateData({ 
                  sociallyVulnerable: c,
                  socialExtract: c ? data.socialExtract : undefined,
                  socialVerified: c ? isSocialVerified : false
                });
                if (!c) {
                  setIsSocialVerified(false);
                  setSocialVerifyError(null);
                  setPendingSocialFile(null);
                }
              }}
            />
          </div>
          <AnimatePresence>
            {data.sociallyVulnerable && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-2" ref={fieldRefs.socialExtract}>
                  <Label className={cn("block mb-2 text-sm", errors.socialExtract && "text-destructive")}>სოციალური ამონაწერის ატვირთვა *</Label>
                  <MediaUploadZone
                    key="socialExtract"
                    label="სოციალური ამონაწერი"
                    pickerTitle="სოციალური ამონაწერი"
                    variant="row"
                    storedValue={data.socialExtract}
                    onPersist={persistSocial}
                    onFileReady={onSocialFileReady}
                    hasError={errors.socialExtract}
                    disabled={isVerifyingSocial}
                    emptyHint="დააჭირეთ ფაილის ასარჩევად"
                    uploadedHint={isVerifyingSocial ? "მოწმდება..." : "დოკუმენტი აიტვირთა"}
                    onClear={() => {
                      setPendingSocialFile(null);
                      setIsSocialVerified(false);
                      setSocialVerifyError(null);
                    }}
                  />
                  {pendingSocialFile && (
                    <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        className="w-full sm:w-auto px-4 h-11 rounded-lg"
                        disabled={isVerifyingSocial}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSendSocialVerification(); }}
                      >
                        {isVerifyingSocial ? "იგზავნება..." : "გაგზავნა და შემოწმება"}
                      </Button>
                    </div>
                  )}
                  {isSocialVerified && !isVerifyingSocial && (
                    <div className="mt-3 p-3 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-2 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      <span className="text-sm font-medium">მონაცემები დაემთხვა</span>
                    </div>
                  )}
                  {socialVerifyError && !isVerifyingSocial && (
                    <div className="mt-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <span className="text-sm font-medium">{socialVerifyError}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>


        {/* Pensioner */}
        <div className="bg-muted/40 p-5 rounded-2xl border border-border/50 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold">პენსიონერი</Label>
              <p className="text-sm text-muted-foreground">არის თუ არა განმცხადებელი პენსიონერი?</p>
            </div>
            <Switch 
              checked={data.pensioner || false} 
              onCheckedChange={(c) => {
                updateData({ 
                  pensioner: c,
                  pensionerCertificate: c ? data.pensionerCertificate : undefined,
                  pensionerVerified: c ? isPensionerVerified : false
                });
                if (!c) {
                  setIsPensionerVerified(false);
                  setPensionerVerifyError(null);
                  setPendingPensionerFile(null);
                }
              }}
            />
          </div>
          <AnimatePresence>
            {data.pensioner && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-2" ref={fieldRefs.pensionerCertificate}>
                  <Label className={cn("block mb-2 text-sm", errors.pensionerCertificate && "text-destructive")}>პენსიონერის ცნობის ატვირთვა *</Label>
                  <MediaUploadZone
                    key="pensionerCertificate"
                    label="პენსიონერის ცნობა"
                    pickerTitle="პენსიონერის ცნობა"
                    variant="row"
                    storedValue={data.pensionerCertificate}
                    onPersist={persistPensioner}
                    onFileReady={onPensionerFileReady}
                    hasError={errors.pensionerCertificate}
                    disabled={isVerifyingPensioner}
                    emptyHint="დააჭირეთ ფაილის ასარჩევად"
                    uploadedHint={isVerifyingPensioner ? "მოწმდება..." : "ცნობა აიტვირთა"}
                    onClear={() => {
                      setPendingPensionerFile(null);
                      setIsPensionerVerified(false);
                      setPensionerVerifyError(null);
                    }}
                  />
                  {pendingPensionerFile && (
                    <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        className="w-full sm:w-auto px-4 h-11 rounded-lg"
                        disabled={isVerifyingPensioner}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSendPensionerVerification(); }}
                      >
                        {isVerifyingPensioner ? "იგზავნება..." : "გაგზავნა და შემოწმება"}
                      </Button>
                    </div>
                  )}
                  {isPensionerVerified && !isVerifyingPensioner && (
                    <div className="mt-3 p-3 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-2 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      <span className="text-sm font-medium">მონაცემები დაემთხვა</span>
                    </div>
                  )}
                  {pensionerVerifyError && !isVerifyingPensioner && (
                    <div className="mt-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <span className="text-sm font-medium">{pensionerVerifyError}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="pt-6 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
        <Button type="button" variant="outline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBack(); }} className="w-full sm:w-auto px-8 h-12 rounded-xl text-base">უკან</Button>
        <Button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNext(); }} disabled={isNextDisabled} className="w-full sm:w-auto px-8 h-12 rounded-xl text-base shadow-md">გაგრძელება</Button>
      </div>

    </motion.div>
  );
}

export const Step2Profile = memo(Step2ProfileInner);








