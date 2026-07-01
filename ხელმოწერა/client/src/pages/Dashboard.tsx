import { useState } from "react";
import { useLocation } from "wouter";
import { type SubmissionInput } from "@shared/routes";
import { Navbar } from "@/components/layout/Navbar";
import { StepIndicator } from "@/components/wizard/StepIndicator";
import { Step1Identity } from "@/components/wizard/Step1Identity";
import { Step2Profile } from "@/components/wizard/Step2Profile";
import { Step3Product } from "@/components/wizard/Step3Product";
import { Step4Finalize } from "@/components/wizard/Step4Finalize";
import { useSubmission } from "@/hooks/use-submission";
import { AnimatePresence } from "framer-motion";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function Dashboard() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<SubmissionInput>>({});
  const { mutateAsync: submitApplication, isPending } = useSubmission();
  const [, setLocation] = useLocation();

  const updateData = (newData: Partial<SubmissionInput>) => {
    setFormData(prev => ({ ...prev, ...newData }));
  };

  const nextStep = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setStep(s => Math.min(4, s + 1));
  };
  
  const prevStep = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setStep(s => Math.max(1, s - 1));
  };

  const handleSubmit = async () => {
    try {
      await submitApplication(formData as SubmissionInput);
    } catch (error) {
      // Toast already handles error display
    }
  };

  const cancelSale = () => {
    setFormData({});
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground mb-2">ახალი განაცხადი</h1>
          <p className="text-muted-foreground text-lg">მიჰყევით ნაბიჯებს მომხმარებლის შეკვეთის დასამუშავებლად</p>
        </div>

        <div className="glass-card rounded-3xl p-6 md:p-10 relative overflow-hidden">
          {/* Decorative background glows inside the card */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -z-10 pointer-events-none" />
          
          <StepIndicator currentStep={step} />
          
          <div className="mt-8 relative min-h-[400px]">
            <ErrorBoundary
              fallbackMessage="An error occurred while loading this step"
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
                  <Step3Product key="step3" data={formData} updateData={updateData} onNext={nextStep} onBack={prevStep} active={step === 3} />
                )}
                {step === 4 && (
                  <Step4Finalize key="step4" data={formData} updateData={updateData} onSubmit={handleSubmit} onBack={prevStep} isSubmitting={isPending} onCancelSale={cancelSale} active={step === 4} />
                )}
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}
