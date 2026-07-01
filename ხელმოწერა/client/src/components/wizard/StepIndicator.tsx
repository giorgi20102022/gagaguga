import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  currentStep: number;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const steps = [
    { num: 1, title: "იდენტიფიკაცია" },
    { num: 2, title: "პროფილი" },
    { num: 3, title: "პროდუქტი" },
    { num: 4, title: "დასრულება" },
  ];

  return (
    <div className="w-full py-6 mb-8">
      <div className="flex items-center justify-between relative">
        {/* Background Line */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-muted rounded-full z-0" />
        
        {/* Active Line */}
        <div 
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full z-0 transition-all duration-500 ease-out"
          style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
        />

        {steps.map((step) => {
          const isActive = currentStep === step.num;
          const isCompleted = currentStep > step.num;

          return (
            <div key={step.num} className="relative z-10 flex flex-col items-center gap-3">
              <div 
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 shadow-sm",
                  isActive && "bg-primary text-primary-foreground shadow-md shadow-primary/30 ring-4 ring-primary/20 scale-110",
                  isCompleted && "bg-primary text-primary-foreground",
                  !isActive && !isCompleted && "bg-card text-muted-foreground border-2 border-border"
                )}
              >
                {isCompleted ? <Check className="w-5 h-5" /> : step.num}
              </div>
              <span 
                className={cn(
                  "text-xs font-semibold absolute -bottom-6 w-20 text-center transition-colors duration-300",
                  (isActive || isCompleted) ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
