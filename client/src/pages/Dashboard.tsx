import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { type SubmissionInput } from "@shared/routes";
import { Navbar } from "@/components/layout/Navbar";
import { StepIndicator } from "@/components/wizard/StepIndicator";
import { Step1Identity } from "@/components/wizard/Step1Identity";
import { Step2DealerPersonalId } from "@/components/wizard/Step2DealerPersonalId";
import { Step2Profile } from "@/components/wizard/Step2Profile";
import { Step3Product } from "@/components/wizard/Step3Product";
import { Step4Finalize } from "@/components/wizard/Step4Finalize";
import { useSubmission } from "@/hooks/use-submission";
import { AnimatePresence } from "framer-motion";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  loadWizardStateWithFallback,
  saveWizardStateSync,
  clearWizardState,
} from "@/lib/wizardPersistence";
import { Loader2 } from "lucide-react";

const WIZARD_STORAGE_KEY = "dashboard_wizard_state";

export default function Dashboard() {
  const [step, setStep] = useState<number>(1);
  const [formData, setFormData] = useState<Partial<SubmissionInput>>({});
  const [isRehydrating, setIsRehydrating] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function rehydrate() {
      try {
        const saved = await loadWizardStateWithFallback(WIZARD_STORAGE_KEY);
        if (saved) {
          if (typeof saved.step === "number") setStep(saved.step);
          if (saved.formData && typeof saved.formData === "object") setFormData(saved.formData);
        }
      } catch (e) {
        console.error("Error rehydrating wizard state:", e);
      } finally {
        setIsRehydrating(false);
      }
    }
    rehydrate();
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

  const { mutateAsync: submitApplication, isPending } = useSubmission();
  const [, setLocation] = useLocation();

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
      if (!data.supplierName || !data.supplierId || !data.model) return false;
      if (!data.ovenVerified) return false;
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
    try {
      await submitApplication(formData as SubmissionInput);
      await clearWizardState(WIZARD_STORAGE_KEY);
      setFormData({});
      setStep(1);
    } catch {
      // Toast already handles error display
    }
  };

  const cancelSale = async () => {
    await clearWizardState(WIZARD_STORAGE_KEY);
    setFormData({});
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (isRehydrating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-4xl mx-auto px-3 sm:px-6 py-6 md:py-12">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground mb-2">ახალი განაცხადი</h1>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg">მიჰყევით ნაბიჯებს მომხმარებლის შეკვეთის დასამუშავებლად</p>
        </div>

        <div className="glass-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -z-10 pointer-events-none" />

          <StepIndicator currentStep={step} />

          <div className="mt-8 relative min-h-[400px]">
            <ErrorBoundary
              fallbackMessage="An error occurred while loading this step"
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
                  <Step3Product key="step3" data={formData} updateData={updateData} onNext={nextStep} onBack={prevStep} active={step === 4} />
                )}
                {step === 5 && (
                  <Step4Finalize key="step4" data={formData} updateData={updateData} onSubmit={handleSubmit} onBack={prevStep} isSubmitting={isPending} onCancelSale={cancelSale} active={step === 5} />
                )}
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}
