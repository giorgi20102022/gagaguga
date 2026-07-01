import { useState, useRef } from "react";
import { type SubmissionInput } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fileToBase64, cn } from "@/lib/utils";
import { Upload, FileText, CheckCircle2, AlertCircle, Camera } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

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

export function Step2Profile({ data, updateData, onNext, onBack }: Props) {
  const [isPensionerVerified, setIsPensionerVerified] = useState(false);
  const [isVerifyingPensioner, setIsVerifyingPensioner] = useState(false);
  const [pensionerVerifyError, setPensionerVerifyError] = useState<string | null>(null);
  const [pendingPensionerFile, setPendingPensionerFile] = useState<File | null>(null);

  const [isSocialVerified, setIsSocialVerified] = useState(false);
  const [isVerifyingSocial, setIsVerifyingSocial] = useState(false);
  const [socialVerifyError, setSocialVerifyError] = useState<string | null>(null);
  const [pendingSocialFile, setPendingSocialFile] = useState<File | null>(null);
  
  const [isSmsSent, setIsSmsSent] = useState(false);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [isVerifyingSms, setIsVerifyingSms] = useState(false);
  const [isSmsVerified, setIsSmsVerified] = useState(false);
  const [smsCode, setSmsCode] = useState("");
  const [smsError, setSmsError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const fieldRefs = {
    firstName: useRef<HTMLDivElement>(null),
    lastName: useRef<HTMLDivElement>(null),
    idNumber: useRef<HTMLDivElement>(null),
    phone: useRef<HTMLDivElement>(null),
    socialExtract: useRef<HTMLDivElement>(null),
    pensionerCertificate: useRef<HTMLDivElement>(null),
  };

  const [showSocialOptions, setShowSocialOptions] = useState(false);
  const [showPensionerOptions, setShowPensionerOptions] = useState(false);

  const socialCameraInputRef = useRef<HTMLInputElement>(null);
  const socialGalleryInputRef = useRef<HTMLInputElement>(null);
  const pensionerCameraInputRef = useRef<HTMLInputElement>(null);
  const pensionerGalleryInputRef = useRef<HTMLInputElement>(null);

  const handleNativeFileChange = async (field: "socialExtract" | "pensionerCertificate", e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleFilePicked(field, file);
    }
    try {
      e.target.value = "";
    } catch {}
    if (field === "socialExtract") {
      setShowSocialOptions(false);
    } else {
      setShowPensionerOptions(false);
    }
  };

  const handleFilePicked = async (field: "socialExtract" | "pensionerCertificate", file: File) => {
    if (!file) return;

    const base64 = await fileToBase64(file);
    updateData({ [field]: base64 });
    setErrors((prev) => ({ ...prev, [field]: false }));

    if (field === "pensionerCertificate") {
      setPendingPensionerFile(file);
      setIsVerifyingPensioner(false);
      setPensionerVerifyError(null);
      setIsPensionerVerified(false);
    } else if (field === "socialExtract") {
      setPendingSocialFile(file);
      setIsVerifyingSocial(false);
      setSocialVerifyError(null);
      setIsSocialVerified(false);
    }
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

      if (typeof (verified as Record<string, unknown>).verificationError === "string") {
        setIsSocialVerified(false);
        setSocialVerifyError((verified as Record<string, string>).verificationError);
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
      const georgianMsg = extractVisionApiError(errData);
      const msg = georgianMsg
        ?? (typeof errData?.message === "string" ? errData.message : null)
        ?? ((err as any)?.code === "ECONNABORTED" ? "ვერიფიკაციის მოთხოვნას დრო გაუვიდა" : null)
        ?? "დადასტურება ვერ მოხერხდა";
      setIsSocialVerified(false);
      setSocialVerifyError(msg);
    } finally {
      setIsVerifyingSocial(false);
    }
  };

  const handleSendSms = async () => {
    if (!data.phone || isSendingSms) return;
    setIsSendingSms(true);
    setSmsError(null);
    try {
      await axios.post("/api/sms/send", { phone: data.phone });
      setIsSmsSent(true);
    } catch (err: any) {
      setSmsError(err.response?.data?.message || "SMS-ის გაგზავნა ვერ მოხერხდა");
    } finally {
      setIsSendingSms(false);
    }
  };

  const handleVerifySms = async () => {
    if (!smsCode || isVerifyingSms) return;
    setIsVerifyingSms(true);
    setSmsError(null);
    try {
      await axios.post("/api/sms/verify", { phone: data.phone, code: smsCode });
      setIsSmsVerified(true);
      setErrors(prev => ({ ...prev, phone: false }));
    } catch (err: any) {
      setSmsError(err.response?.data?.message || "არასწორი კოდი");
    } finally {
      setIsVerifyingSms(false);
    }
  };

  const handleNext = () => {
    const newErrors: Record<string, boolean> = {};
    if (!data.firstName) newErrors.firstName = true;
    if (!data.lastName) newErrors.lastName = true;
    if (!data.idNumber) newErrors.idNumber = true;
    if (!data.phone || !isSmsVerified) newErrors.phone = true;
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

        <div className="space-y-2 md:col-span-2">
          <h3 className="text-lg font-semibold border-b pb-2 pt-2">კონტაქტი და მდებარეობა</h3>
        </div>

        <div className="space-y-2 md:col-span-2" ref={fieldRefs.phone}>
          <Label htmlFor="phone" className={cn(errors.phone && "text-destructive")}>ტელეფონი *</Label>
          <div className="flex gap-2">
            <Input 
              id="phone" 
              placeholder="მაგ: 599 12 34 56" 
              value={data.phone || ""} 
              disabled={isSmsVerified}
              onChange={(e) => {
                updateData({ phone: e.target.value });
                setErrors((prev) => ({ ...prev, phone: false }));
                setIsSmsSent(false);
                setIsSmsVerified(false);
                setSmsError(null);
              }}
              className={cn("h-12 rounded-xl flex-1", errors.phone && "border-destructive bg-destructive/5", isSmsVerified && "border-green-500 bg-green-50")}
            />
            {!isSmsVerified && (
              <Button
                type="button"
                onClick={handleSendSms}
                disabled={isSendingSms || !data.phone || data.phone.length < 9}
                className="h-12 px-6 rounded-xl shrink-0"
              >
                {isSendingSms ? "იგზავნება..." : isSmsSent ? "თავიდან გაგზავნა" : "კოდის გაგზავნა"}
              </Button>
            )}
          </div>
          
          <AnimatePresence>
            {isSmsSent && !isSmsVerified && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2 mt-2"
              >
                <div className="flex gap-2">
                  <Input
                    placeholder="შეიყვანეთ 4-ნიშნა კოდი"
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value)}
                    className="h-12 rounded-xl flex-1"
                    maxLength={4}
                  />
                  <Button
                    type="button"
                    onClick={handleVerifySms}
                    disabled={isVerifyingSms || smsCode.length !== 4}
                    className="h-12 px-6 rounded-xl shrink-0"
                  >
                    {isVerifyingSms ? "მოწმდება..." : "დადასტურება"}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {isSmsVerified && (
            <div className="mt-2 text-sm text-green-600 flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              ტელეფონის ნომერი დადასტურებულია ✅
            </div>
          )}

          {smsError && (
            <div className="mt-2 text-sm text-red-600 flex items-center gap-1.5 font-medium">
              <AlertCircle className="w-4 h-4" />
              {smsError}
            </div>
          )}
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
                updateData({ sociallyVulnerable: c });
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
                  {showSocialOptions ? (
                    <div className="relative border border-dashed rounded-xl p-4 bg-muted/20 flex flex-col gap-2.5">
                      <input
                        ref={socialCameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleNativeFileChange("socialExtract", e)}
                      />
                      <input
                        ref={socialGalleryInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleNativeFileChange("socialExtract", e)}
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">სოციალური ამონაწერი</p>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowSocialOptions(false); }}
                          className="text-xs text-muted-foreground hover:underline cursor-pointer"
                        >
                          გაუქმება
                        </button>
                      </div>
                      <div className="flex gap-2 w-full">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); socialCameraInputRef.current?.click(); }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground h-9 px-3 rounded-lg text-xs font-medium hover:bg-primary/90 transition-all active:scale-[0.98]"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          კამერა
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); socialGalleryInputRef.current?.click(); }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-muted text-foreground border border-border h-9 px-3 rounded-lg text-xs font-medium hover:bg-muted/80 transition-all active:scale-[0.98]"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          გალერია
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isVerifyingSocial) {
                          setShowSocialOptions(true);
                        }
                      }}
                      className={cn(
                        "relative flex items-center gap-4 p-4 border border-dashed rounded-xl transition-colors cursor-pointer",
                        isVerifyingSocial ? "cursor-wait opacity-70" : "hover:bg-muted/50",
                        errors.socialExtract && "border-destructive bg-destructive/5"
                      )}
                    >
                      <div className="p-3 bg-primary/10 text-primary rounded-lg z-0">
                        {isVerifyingSocial ? (
                          <span className="text-xs animate-pulse">მოწმდება...</span>
                        ) : data.socialExtract ? (
                          <FileText className="w-5 h-5" />
                        ) : (
                          <Upload className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 z-0">
                        <p className="text-sm font-medium">
                          {isVerifyingSocial
                            ? "მოწმდება..."
                            : data.socialExtract
                              ? "დოკუმენტი აიტვირთა (შეცვლა)"
                              : "დააჭირეთ ფაილის ასარჩევად"}
                        </p>
                        {pendingSocialFile && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            არჩეული ფაილი: {pendingSocialFile.name}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {pendingSocialFile && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        className="px-4 h-9 rounded-lg"
                        disabled={isVerifyingSocial}
                        onClick={handleSendSocialVerification}
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
                updateData({ pensioner: c });
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
                  {showPensionerOptions ? (
                    <div className="relative border border-dashed rounded-xl p-4 bg-muted/20 flex flex-col gap-2.5">
                      <input
                        ref={pensionerCameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleNativeFileChange("pensionerCertificate", e)}
                      />
                      <input
                        ref={pensionerGalleryInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleNativeFileChange("pensionerCertificate", e)}
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">პენსიონერის ცნობა</p>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPensionerOptions(false); }}
                          className="text-xs text-muted-foreground hover:underline cursor-pointer"
                        >
                          გაუქმება
                        </button>
                      </div>
                      <div className="flex gap-2 w-full">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); pensionerCameraInputRef.current?.click(); }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground h-9 px-3 rounded-lg text-xs font-medium hover:bg-primary/90 transition-all active:scale-[0.98]"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          კამერა
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); pensionerGalleryInputRef.current?.click(); }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-muted text-foreground border border-border h-9 px-3 rounded-lg text-xs font-medium hover:bg-muted/80 transition-all active:scale-[0.98]"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          გალერია
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isVerifyingPensioner) {
                          setShowPensionerOptions(true);
                        }
                      }}
                      className={cn(
                        "relative flex items-center gap-4 p-4 border border-dashed rounded-xl transition-colors cursor-pointer",
                        isVerifyingPensioner ? "cursor-wait opacity-70" : "hover:bg-muted/50",
                        errors.pensionerCertificate && "border-destructive bg-destructive/5"
                      )}
                    >
                      <div className="p-3 bg-primary/10 text-primary rounded-lg z-0">
                        {isVerifyingPensioner ? (
                          <span className="text-xs animate-pulse">მოწმდება...</span>
                        ) : data.pensionerCertificate ? (
                          <FileText className="w-5 h-5" />
                        ) : (
                          <Upload className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 z-0">
                        <p className="text-sm font-medium">
                          {isVerifyingPensioner
                            ? "მოწმდება..."
                            : data.pensionerCertificate
                              ? "ცნობა აიტვირთა (შეცვლა)"
                              : "დააჭირეთ ფაილის ასარჩევად"}
                        </p>
                        {pendingPensionerFile && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            არჩეული ფაილი: {pendingPensionerFile.name}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {pendingPensionerFile && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        className="px-4 h-9 rounded-lg"
                        disabled={isVerifyingPensioner}
                        onClick={handleSendPensionerVerification}
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

      <div className="pt-6 flex justify-between">
        <Button variant="outline" onClick={onBack} className="px-8 h-12 rounded-xl text-base">უკან</Button>
        <Button onClick={handleNext} className="px-8 h-12 rounded-xl text-base shadow-md">გაგრძელება</Button>
      </div>


    </motion.div>
  );
}
