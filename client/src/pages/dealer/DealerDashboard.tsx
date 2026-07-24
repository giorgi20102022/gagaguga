import { useState, useEffect, useCallback, useRef } from "react";
import { useDealerAuth } from "@/hooks/use-dealer-auth";
import { type SubmissionInput } from "@shared/routes";
import { StepIndicator } from "@/components/wizard/StepIndicator";
import { Step1Identity } from "@/components/wizard/Step1Identity";
import { Step2DealerPersonalId } from "@/components/wizard/Step2DealerPersonalId";
import { Step2Profile } from "@/components/wizard/Step2Profile";
import { Step3Product } from "@/components/wizard/Step3Product";
import { Step4Finalize } from "@/components/wizard/Step4Finalize";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AnimatePresence } from "framer-motion";
import { LogOut, LayoutDashboard, Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import axios from "axios";
import { registerDealerPersonalIdOnPortal } from "@/lib/dealerPersonalId";
import { sendN8NRequest } from "@/lib/api";
import {
  loadWizardStateWithFallback,
  saveWizardStateSync,
  clearWizardState,
} from "@/lib/wizardPersistence";
const WIZARD_STORAGE_KEY = "dealer_wizard_state";

// N8N_WEBHOOK_URL constant removed; using sendN8NRequest from api.ts

const SIGNATURE_FONT_FAMILY = "DM Ambrosi UNI";
const SIGNATURE_INK_COLOR = "#0B2E6B";

function makeSignatureText(firstName: string | undefined, lastName: string | undefined): string {
  const fn = String(firstName ?? "").trim();
  const ln = String(lastName ?? "").trim();
  if (!fn && !ln) return "";
  if (!ln) return fn;
  if (!fn) return ln;
  const firstInitial = fn.charAt(0).toUpperCase();
  return `${firstInitial}. ${ln}`;
}

async function ensureSignatureFontLoaded(fontSizePx: number): Promise<void> {
  const anyDoc = document as any;
  if (!anyDoc?.fonts?.load) return;
  try {
    await anyDoc.fonts.load(`normal ${fontSizePx}px "${SIGNATURE_FONT_FAMILY}"`, "abcdefghijklmnopqrstuvwxyz");
    await anyDoc.fonts.ready;
  } catch {
    // ignore font load errors; canvas will fall back to default font
  }
}

async function renderSignaturePngDataUrl(text: string): Promise<string> {
  const fontSizePx = 72;
  const padding = 24;

  await ensureSignatureFontLoaded(fontSizePx);

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) throw new Error("Canvas 2D context not available");

  measureCtx.font = `normal ${fontSizePx}px "${SIGNATURE_FONT_FAMILY}"`;
  measureCtx.textBaseline = "alphabetic";
  const metrics = measureCtx.measureText(text);

  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? metrics.actualBoundingBoxAscent
    : fontSizePx * 0.8;
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : fontSizePx * 0.2;
  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(ascent + descent);

  const canvasWidth = textWidth + padding * 2;
  const canvasHeight = textHeight + padding * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, canvasWidth);
  canvas.height = Math.max(1, canvasHeight);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `normal ${fontSizePx}px "${SIGNATURE_FONT_FAMILY}"`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = SIGNATURE_INK_COLOR;

  const x = padding;
  const y = padding + ascent;
  ctx.fillText(text, x, y);

  return canvas.toDataURL("image/png");
}

function base64ToBlob(base64: string): Blob {
  const parts = base64.split(",");
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const raw = atob(parts.length > 1 ? parts[1] : base64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function appendImageIfPresent(fd: FormData, key: string, value: string | undefined, filename: string) {
  if (!value) return;
  try {
    const blob = base64ToBlob(value);
    fd.append(key, blob, filename);
  } catch {
    // not a valid base64 image — skip
  }
}



export default function DealerDashboard() {
  const { dealer, logout, isLoading: authLoading } = useDealerAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<number>(1);
  const [formData, setFormData] = useState<Partial<SubmissionInput>>({});
  const [isRehydrating, setIsRehydrating] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.clear();
    sessionStorage.clear();
    setFormData({});
    setStep(1);
    setErrorMessage('');
    setIsRehydrating(false);
  }, []);

  useEffect(() => {
    if (isRehydrating) return;

    saveWizardStateSync(WIZARD_STORAGE_KEY, { step, formData });

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveWizardStateSync(WIZARD_STORAGE_KEY, { step, formData });
    }, 400);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [step, formData, isRehydrating]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("მონაცემები მოწმდება...");
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    if (isStatusModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isStatusModalOpen]);



  const updateData = useCallback((newData: Partial<SubmissionInput>) => {
    setFormData((prev) => ({ ...prev, ...newData }));
  }, []);

  const validateStep = (currentStep: number, data: Partial<SubmissionInput>) => {
    if (currentStep === 1) {
      const docType = data.documentType || "id_card";
      if (docType === "id_card") {
        if (!data.idFront || !data.idBack) return false;
      } else {
        if (!data.passportPhoto) return false;
      }
      if (!data.firstName || !data.lastName || !data.idNumber) return false;
    }
    if (currentStep === 2) {
      if (!data.dealerPersonalIdVerified) return false;
    }
    if (currentStep === 3) {
      if (!data.firstName || !data.lastName || !data.idNumber) return false;
      if (data.sociallyVulnerable && (!data.socialExtract || !data.socialVerified)) return false;
      if (data.pensioner && (!data.pensionerCertificate || !data.pensionerVerified)) return false;
    }
    if (currentStep === 4) {
      if (data.finalPayable === undefined && data.price === undefined) return false;
    }
    return true;
  };

  const nextStep = () => {
    if (!validateStep(step, formData)) {
      console.warn(`Validation failed for step ${step}`);
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStep((s) => Math.min(5, s + 1));
  };

  const prevStep = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSubmit = async () => {
    if (!dealer || !dealer.email) {
      toast({
        title: "ავტორიზაციის შეცდომა",
        description: "დილერის ელ-ფოსტა ვერ მოიძებნა. გთხოვთ გაიაროთ ავტორიზაცია თავიდან.",
        variant: "destructive",
      });
      return;
    }
    // Detect Gorgia by both key and name to be resilient to case/DB variation
    const isGorgiaUser =
      dealer?.key?.toLowerCase() === "gorgia" ||
      dealer?.name?.toLowerCase() === "gorgia" ||
      dealer?.name === "გორგია";
    // Clear previous error before new submission
    setErrorMessage('');
    setIsSubmitting(true);
    console.log("[Submit] Full form payload:", formData);
    try {
      await registerDealerPersonalIdOnPortal(formData);

      // Helper to convert file to base64
      const fileToBase64 = (file: File | Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });
      };

      // Get signature as base64 string
      const signatureText = makeSignatureText(formData.firstName, formData.lastName);
      let signatureBase64 = formData.signature || "";

      const signatureFile = (formData as any).signatureFile;

      if (signatureFile) {
        signatureBase64 = await fileToBase64(signatureFile);
      } else if ((formData as any).signatureFile) {
        signatureBase64 = await fileToBase64((formData as any).signatureFile);
      } else if (!signatureBase64 && signatureText) {
        signatureBase64 = await renderSignaturePngDataUrl(signatureText);
      }

      // Build JSON payload conforming to submissionSchema
      const payload = {
        documentType: formData.documentType || "id_card",
        idFront: formData.idFront,
        idBack: formData.idBack,
        passportPhoto: formData.passportPhoto,
        firstName: formData.firstName || "",
        lastName: formData.lastName || "",
        idNumber: formData.idNumber || "",
        gender: formData.gender || "",
        expiryDate: formData.expiryDate || "",
        phone: formData.phone || "",
        legalAddress: formData.legalAddress || "",
        region: formData.region || "",
        municipality: formData.municipality || "",
        city: formData.city || "",
        cityDistrict: (formData as any).cityDistrict || "",
        addressVillage: (formData as any).addressVillage || "",
        sociallyVulnerable: Boolean(formData.sociallyVulnerable),
        socialExtract: formData.socialExtract,
        nomadic: Boolean(formData.nomadic),
        pensioner: Boolean(formData.pensioner),
        pensionerCertificate: formData.pensionerCertificate,
        // supplierName: for Gorgia, use the dealer session name; for others, also the dealer session name.
        supplierName: isGorgiaUser
          ? (formData.supplierName || "")
          : (dealer.name || ""),
        supplierId: formData.supplierId || "",
        supplierProfile: (dealer.identificationCode && (dealer.identificationCode.includes("ს/კ") || dealer.identificationCode.includes("შპს")))
          ? dealer.identificationCode
          : `შპს "${isGorgiaUser ? "გორგია" : dealer.name}" ს/კ ${dealer.identificationCode || ""}`,
        model: formData.model || "",
        price: Number(formData.price || 0),
        subsidyRate: Number(formData.subsidyRate || 0),
        subsidyAmount: Number(formData.subsidyAmount || 0),
        deliveryFee: Number(formData.deliveryFee || 0),
        ironPlus: Boolean(formData.ironPlus),
        ironPlusFee: Number(formData.ironPlusFee || 0),
        finalPayable: Number(formData.finalPayable || 0),
        installationAddress: formData.installationAddress || "",
        receiptPhoto: formData.receiptPhoto || "",
        signature: signatureBase64,
        digitalConsent: formData.digitalConsent !== false,
        dealerEmail: dealer.email,
        
        // Extra dealer-specific parameters fetched from the dealer account profile
        branch_email: formData.branch_email,
        whatsapp_number: formData.whatsapp_number,
        send_to_rda: formData.send_to_rda,
        ovenCode: formData.ovenCode,
        dealerPersonalId: formData.dealerPersonalId,
        dealerPersonalIdVerified: formData.dealerPersonalIdVerified,
        dealerPersonalIdLookupMessage: formData.dealerPersonalIdLookupMessage,
        ovenVerified: formData.ovenVerified,
        ovenVerificationMessage: formData.ovenVerificationMessage,
        ovenCodeRow: formData.ovenCodeRow,
        verifiedProductName: formData.verifiedProductName,
        smsVerified: formData.smsVerified,
        receiptVerified: formData.receiptVerified,
        receiptVerificationMessage: formData.receiptVerificationMessage,
      };

      console.log("[Submit] Supplier fields →", {
        isGorgiaUser,
        "formData.supplierName": formData.supplierName,
        "payload.supplierName": payload.supplierName,
        "payload.supplierProfile": payload.supplierProfile,
      });

      setLoadingMessage("მონაცემები მოწმდება...");
      const response = await axios.post("/api/workspace/submit", payload, {
        headers: {
          "Content-Type": "application/json",
        },
        validateStatus: (status) => status >= 200 && status < 300,
        onDownloadProgress: (progressEvent) => {
          const text = (progressEvent.event?.currentTarget as XMLHttpRequest)?.responseText;
          if (text && text.includes('"queued"')) {
            setLoadingMessage("თქვენი მოთხოვნა რიგშია. გთხოვთ, არ დახუროთ გვერდი, მიმდინარეობს დამუშავება...");
          }
        }
      });

      if (response.status === 202 || response.data?.status === "queued") {
        setLoadingMessage("თქვენი მოთხოვნა რიგშია. გთხოვთ, არ დახუროთ გვერდი, მიმდინარეობს დამუშავება...");
        
        const trackingId = response.data?.trackingId || response.data?.id;
        if (trackingId) {
          let isCompleted = false;
          while (!isCompleted) {
            await new Promise(r => setTimeout(r, 3000));
            const pollRes = await axios.get(`/api/workspace/status/${trackingId}`);
            if (pollRes.data?.status === "completed" || pollRes.data?.success) {
               isCompleted = true;
            } else if (pollRes.data?.status === "error" || pollRes.data?.success === false) {
               throw new Error(pollRes.data?.message || "დამუშავების შეცდომა");
            }
          }
        } else {
           // If backend just returned 202 but didn't provide a way to poll, we assume 
           // they might stream the response over the same connection, which would have resolved with 200.
           // Since it resolved with 202 and we have no tracking ID, we exit to keep UI loading
           // so the user knows it's queued.
           return;
        }
      }

      toast({
        title: "განაცხადი გაიგზავნა",
        description: "მომხმარებლის განაცხადი წარმატებით დამუშავდა.",
      });
      setSubmissionStatus('success');
      localStorage.clear();
      sessionStorage.clear();
      await clearWizardState(WIZARD_STORAGE_KEY);
      setFormData({});
      setStep(1);
      setErrorMessage('');
      setIsStatusModalOpen(true);
    } catch (error) {
      // Extract detailed error message from n8n response if available
      let detailedMsg = "განაცხადის გაგზავნა ვერ მოხერხდა";
      if (axios.isAxiosError(error) && error.response && typeof error.response.data === "object") {
        // @ts-ignore - dynamic shape
        detailedMsg = error.response.data.message || detailedMsg;
      } else if ((error as Error).message) {
        detailedMsg = (error as Error).message;
      }
      setErrorMessage(detailedMsg);
      toast({
        title: detailedMsg === "კოდი ვერ დაემატა" ? "კოდი ვერ დაემატა" : "გაგზავნის შეცდომა",
        description: detailedMsg,
        variant: "destructive",
      });
      setSubmissionStatus('error');
      setIsStatusModalOpen(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelSale = async () => {
    localStorage.clear();
    sessionStorage.clear();
    await clearWizardState(WIZARD_STORAGE_KEY);
    setFormData({});
    setStep(1);
    setErrorMessage('');
    window.scrollTo({ top: 0, behavior: "smooth" });
  };



  if (authLoading || !dealer || isRehydrating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }



  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-50 w-full">
      {/* Workspace Navbar — no admin links, only dealer info + logout */}
      <nav className="w-full border-b border-white/20 bg-background/60 backdrop-blur-xl transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => { setStep(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <LayoutDashboard className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                    {dealer.name}
                  </span>
                  <span className="block text-xs text-muted-foreground -mt-0.5">სამუშაო პორტალი</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-sm font-semibold">{dealer.email}</span>
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
            </div>
          </div>
        </div>
      </nav>
      </div>

      {/* Wizard — the operational sales flow */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-3 sm:px-6 py-6 md:py-12">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground mb-2">ახალი განაცხადი</h1>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg">მიჰყევით ნაბიჯებს მომხმარებლის შეკვეთის დასამუშავებლად</p>
        </div>

        <div className="glass-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -z-10 pointer-events-none" />

          {/* Error banner */}
          {errorMessage && (
            <div role="alert" className="mb-4 p-4 bg-red-50 text-red-800 border border-red-200 rounded-md flex items-start gap-2 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0V7zm0 6a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" clipRule="evenodd" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}

          <StepIndicator currentStep={step} />

          <div className="mt-8 relative min-h-[400px]">
            <ErrorBoundary
              fallbackMessage="ნაბიჯის ჩატვირთვა ვერ მოხერხდა"
              resetKey={step}
              onReset={() => { setStep(1); setFormData({}); }}
            >
              <AnimatePresence mode="wait">
                {step === 1 && (
                  <Step1Identity key="step1" data={formData} updateData={updateData} onNext={nextStep} />
                )}
                {step === 2 && (
                  <Step2DealerPersonalId key="step2-dealer-id" data={formData} updateData={updateData} onNext={nextStep} onBack={prevStep} onRestart={cancelSale} />
                )}
                {step === 3 && (
                  <Step2Profile key="step2" data={formData} updateData={updateData} onNext={nextStep} onBack={prevStep} />
                )}
                {step === 4 && (
                  <Step3Product key="step3" data={formData} updateData={updateData} onNext={nextStep} onBack={prevStep} dealerKey={dealer.key} dealerName={dealer.name} active={step === 4} />
                )}
                {step === 5 && (
                  <Step4Finalize key="step4" data={formData} updateData={updateData} onSubmit={handleSubmit} onBack={prevStep} isSubmitting={isSubmitting} onCancelSale={cancelSale} active={step === 5} />
                )}
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </div>
      </main>

      {/* Success/Error Post-Submission Status Modal */}
      {isStatusModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-card border border-white/10 rounded-3xl p-8 max-w-md w-full relative shadow-2xl animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => {
                setIsStatusModalOpen(false);
                if (submissionStatus === 'success') {
                  setFormData({});
                  setStep(1);
                }
                setSubmissionStatus(null);
              }}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex flex-col items-center text-center gap-6 mt-2">
              {submissionStatus === 'success' ? (
                <>
                  <div className="h-20 w-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center animate-bounce">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-foreground">გაიგზავნა წარმატებით</h3>
                    <p className="text-muted-foreground font-medium text-lg leading-relaxed">
                      შეგიძლიათ ღუმელი გადასცეთ კლიენტს
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-20 w-20 bg-destructive/10 text-destructive rounded-full flex items-center justify-center animate-pulse">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-destructive">შეცდომა</h3>
                    <p className="text-muted-foreground font-medium text-lg leading-relaxed">
                      {errorMessage === "კოდი ვერ დაემატა" ? "კოდი ვერ დაემატა" : "გაგზავნა ვერ მოხერხდა"}
                    </p>
                    {errorMessage && (
                      <p className="text-sm text-destructive bg-destructive/5 border border-destructive/10 rounded-xl p-3 mt-2 font-mono text-left max-h-32 overflow-y-auto w-full">
                        {errorMessage}
                      </p>
                    )}
                  </div>
                </>
              )}
              <Button 
                onClick={() => {
                  setIsStatusModalOpen(false);
                  if (submissionStatus === 'success') {
                    setFormData({});
                    setStep(1);
                  }
                  setSubmissionStatus(null);
                }}
                className="w-full h-12 rounded-xl text-base font-bold mt-4"
              >
                დახურვა
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
