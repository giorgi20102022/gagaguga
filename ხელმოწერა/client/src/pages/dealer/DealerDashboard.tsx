import { useState, useEffect } from "react";
import { useDealerAuth } from "@/hooks/use-dealer-auth";
import { type SubmissionInput } from "@shared/routes";
import { StepIndicator } from "@/components/wizard/StepIndicator";
import { Step1Identity } from "@/components/wizard/Step1Identity";
import { Step2Profile } from "@/components/wizard/Step2Profile";
import { Step3Product } from "@/components/wizard/Step3Product";
import { Step4Finalize } from "@/components/wizard/Step4Finalize";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AnimatePresence } from "framer-motion";
import { LogOut, LayoutDashboard, Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import axios from "axios";

const N8N_WEBHOOK_URL = "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f";

const SIGNATURE_INK_COLOR = "#0B2E6B";

function makeSignatureText(firstName: string | undefined, lastName: string | undefined): string {
  const fn = String(firstName ?? "").trim();
  const ln = String(lastName ?? "").trim();
  if (!fn && !ln) return "";
  if (!ln) return fn;
  if (!fn) return ln;
  return `${fn.charAt(0)}. ${ln}`;
}

async function renderSignaturePngDataUrl(text: string): Promise<string> {
  const fontSizePx = 72;
  const padding = 40;

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) throw new Error("Canvas 2D context not available");

  const fontString = `italic 600 ${fontSizePx}px "DM Ambrosi UNI", "Caveat", "Dancing Script", "Brush Script MT", "Segoe Print", cursive`;
  measureCtx.font = fontString;
  measureCtx.textBaseline = "alphabetic";
  const metrics = measureCtx.measureText(text);

  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? metrics.actualBoundingBoxAscent
    : fontSizePx * 0.8;
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : fontSizePx * 0.3;
  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(ascent + descent);

  const canvasWidth = textWidth + padding * 3;
  const canvasHeight = textHeight + padding * 3;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, canvasWidth);
  canvas.height = Math.max(1, canvasHeight);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = fontString;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = SIGNATURE_INK_COLOR;

  // Add natural flow (slight tilt)
  ctx.translate(padding, padding + ascent);
  ctx.rotate(-0.08); // Slight upward tilt
  ctx.fillText(text, 0, 0);

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
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<SubmissionInput>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    localStorage.clear();
    sessionStorage.clear();
    setFormData({});
    setStep(1);
  }, []);

  const updateData = (newData: Partial<SubmissionInput>) => {
    setFormData((prev) => ({ ...prev, ...newData }));
  };

  const nextStep = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStep((s) => Math.min(4, s + 1));
  };

  const prevStep = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSubmit = async () => {
    if (!dealer) return;
    setIsSubmitting(true);
    console.log("[Submit] Full form payload:", formData);
    try {
      const fd = new FormData();

      // Text fields
      // Derive famale/male booleans from gender string
      const rawGender = String(formData.gender ?? "").trim().toLowerCase();
      const isFemale = rawGender === "f" || rawGender.startsWith("f ") || rawGender.includes("ქალ") || rawGender.includes("female") || rawGender.includes("მდედრობითი");
      const isMale = rawGender === "m" || rawGender.startsWith("m ") || rawGender.includes("კაც") || rawGender.includes("male") || rawGender.includes("მამრობითი");

      const textFields: Record<string, string | number | boolean | undefined> = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        idNumber: formData.idNumber,
        gender: formData.gender,
        famale: Boolean(isFemale && !isMale),
        male: Boolean(isMale && !isFemale),
        expiryDate: formData.expiryDate,
        phone: formData.phone,
        legalAddress: formData.legalAddress,
        region: formData.region,
        municipality: formData.municipality,
        city: formData.city,
        cityDistrict: (formData as any).cityDistrict,
        addressVillage: (formData as any).addressVillage,
        sociallyVulnerable: formData.sociallyVulnerable,
        nomadic: formData.nomadic,
        pensioner: formData.pensioner,
        supplierName: dealer.key === "gorgia" ? formData.supplierName : dealer.name,
        supplierId: formData.supplierId,
        model: formData.model,
        price: formData.price,
        subsidyRate: formData.subsidyRate,
        subsidyAmount: formData.subsidyAmount,
        deliveryFee: formData.deliveryFee,
        ironPlus: formData.ironPlus,
        ironPlusFee: formData.ironPlusFee,
        finalPayable: formData.finalPayable,
        installationAddress: formData.installationAddress,
        digitalConsent: formData.digitalConsent,
        dealer_name: dealer.name,
        dealer_key: dealer.key,
        dealer_id: dealer.id,
      };
      for (const [key, val] of Object.entries(textFields)) {
        if (val !== undefined && val !== null && val !== "") fd.append(key, String(val));
      }

      // Binary images
      appendImageIfPresent(fd, "idFront", formData.idFront, "id_front.jpg");
      appendImageIfPresent(fd, "idBack", formData.idBack, "id_back.jpg");
      appendImageIfPresent(fd, "socialExtract", formData.socialExtract, "social_extract.jpg");
      appendImageIfPresent(fd, "pensionerCertificate", formData.pensionerCertificate, "pensioner_cert.jpg");
      appendImageIfPresent(fd, "receiptPhoto", formData.receiptPhoto, "receipt.jpg");

      const signatureText = makeSignatureText(formData.firstName, formData.lastName);
      if (signatureText) {
        const signaturePng = await renderSignaturePngDataUrl(signatureText);
        appendImageIfPresent(fd, "signature", signaturePng, "signature.png");
      }

      await axios.post(N8N_WEBHOOK_URL, fd, {
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      toast({
        title: "განაცხადი გაიგზავნა",
        description: "მომხმარებლის განაცხადი წარმატებით დამუშავდა.",
      });
      localStorage.clear();
      sessionStorage.clear();
      setFormData({});
      setStep(1);
    } catch (error) {
      toast({
        title: "გაგზავნის შეცდომა",
        description: (error as Error).message || "განაცხადის გაგზავნა ვერ მოხერხდა",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelSale = () => {
    localStorage.clear();
    sessionStorage.clear();
    setFormData({});
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (authLoading || !dealer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Workspace Navbar — no admin links, only dealer info + logout */}
      <nav className="sticky top-0 z-50 w-full border-b border-white/20 bg-background/60 backdrop-blur-xl transition-all">
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

      {/* Wizard — the operational sales flow */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground mb-2">ახალი განაცხადი</h1>
          <p className="text-muted-foreground text-lg">მიჰყევით ნაბიჯებს მომხმარებლის შეკვეთის დასამუშავებლად</p>
        </div>

        <div className="glass-card rounded-3xl p-6 md:p-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -z-10 pointer-events-none" />

          <StepIndicator currentStep={step} />

          <div className="mt-8 relative min-h-[400px]">
            <ErrorBoundary
              fallbackMessage="ნაბიჯის ჩატვირთვა ვერ მოხერხდა"
              onReset={() => { setStep(1); setFormData({}); }}
            >
              <AnimatePresence mode="wait">
                {step === 1 && (
                  <Step1Identity key="step1" data={formData} updateData={updateData} onNext={nextStep} />
                )}
                {step === 2 && (
                  <Step2Profile key="step2" data={formData} updateData={updateData} onNext={nextStep} onBack={prevStep} />
                )}
                {step === 3 && (
                  <Step3Product key="step3" data={formData} updateData={updateData} onNext={nextStep} onBack={prevStep} dealerKey={dealer.key} dealerName={dealer.name} active={step === 3} />
                )}
                {step === 4 && (
                  <Step4Finalize key="step4" data={formData} updateData={updateData} onSubmit={handleSubmit} onBack={prevStep} isSubmitting={isSubmitting} onCancelSale={cancelSale} dealerKey={dealer.key} active={step === 4} />
                )}
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}
