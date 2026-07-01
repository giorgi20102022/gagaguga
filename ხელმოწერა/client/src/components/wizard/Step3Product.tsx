import { useState, useEffect, useRef } from "react";
import { type SubmissionInput } from "@shared/routes";
import { type Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Receipt, Percent, Loader2, CheckCircle2, AlertCircle, Search } from "lucide-react";
import axios from "axios";
import { sendN8NRequest } from "@/lib/api";
interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onNext: () => void;
  onBack: () => void;
  dealerKey?: string;
  dealerName?: string;
  active?: boolean;
}

export function Step3Product({ data, updateData, onNext, onBack, dealerKey: dealerKeyProp, dealerName, active }: Props) {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const fieldRefs = {
    supplierName: useRef<HTMLDivElement>(null),
    supplierId: useRef<HTMLDivElement>(null),
    model: useRef<HTMLDivElement>(null),
  };

  // Derive dealer key from explicit prop
  const resolvedDealerKey = dealerKeyProp || "iron";
  const isGorgiaUser = resolvedDealerKey === "gorgia";
  const isIronPlusDealer = resolvedDealerKey === "iron";

  const [isVerifyingOven, setIsVerifyingOven] = useState(false);
  const ovenVerificationResult = data.ovenVerificationResult as { success: boolean; message: string } | null;
  const ovenCode = data.ovenCode || (isGorgiaUser ? "" : (data.supplierId || ""));
  const selectedBranchId = data.branchId || "";
  const validatedProductName = data.validatedProductName || null;

  const DELIVERY_FEE_BY_MODEL: Record<string, number> = {
    "A1-MZ-08": 100,
    "B1-MZ-18": 70,
    "F1-MZ-25": 70,
    "G1-MZ-26": 100,
    "L1-MZ-27": 100,
    "C1 ბუხარი": 200,
  };

  // Auto-fill supplierName from dealer session name (read-only source of truth)
  useEffect(() => {
    if (dealerName && !isGorgiaUser && !data.supplierName) {
      updateData({ supplierName: dealerName });
    }
  }, [dealerName, isGorgiaUser]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch(`/api/products?dealer=${resolvedDealerKey}`);
        if (!res.ok) throw new Error("Failed to fetch products");
        const data = await res.json();
        setProducts(data);
      } catch (err) {
        console.error("Error fetching products:", err);
      } finally {
        setIsLoading(false);
      }
    };

    const fetchBranches = async () => {
      if (!isGorgiaUser) return;
      try {
        const res = await fetch(`/api/branches?dealer=${resolvedDealerKey}`);
        if (!res.ok) throw new Error("Failed to fetch branches");
        const branchesData = await res.json();
      setBranches(branchesData);
      // Default to first branch if nothing is selected yet
      if (branchesData.length > 0 && !data.branchId) {
        updateData({ 
          branchId: String(branchesData[0].id),
          supplierName: branchesData[0].name 
        });
      }
      } catch (err) {
        console.error("Error fetching branches:", err);
      }
    };

    if (active !== false) {
      fetchProducts();
      fetchBranches();
    }
  }, [resolvedDealerKey, isGorgiaUser, active]);

  const handleVerifyOvenCode = async () => {
    const code = isGorgiaUser ? ovenCode : data.supplierId;
    if (!code || code.length < 3) return;

    const dealerNameToSend = String(dealerName || data.supplierName || "").trim();

    if (!dealerNameToSend) {
      updateData({
        ovenVerificationResult: {
          success: false,
          message: "❌ დილერი ვერ მოიძებნა",
        },
        isOvenVerified: false
      });
      toast({
        title: "შემოწმება ვერ მოხერხდა",
        description: "დილერი ვერ მოიძებნა",
        variant: "destructive",
      });
      return;
    }

    setIsVerifyingOven(true);
    updateData({ ovenVerificationResult: null, isOvenVerified: false });

    try {
      const result = await sendN8NRequest({
        action: "verify",
        code: code,
        dealer_name: dealerNameToSend,
        branch_name: dealerNameToSend,
      });
      
      if (result?.status === "success") {
        const message = result.message || "კოდი ვალიდურია";
        const productName = result.product_name || null;
        updateData({
          ovenVerificationResult: {
            success: true,
            message,
          },
          isOvenVerified: true,
          validatedProductName: productName
        });

        // Auto-select the matching product if product_name was returned
        if (productName) {
          const matched = products.find((p) =>
            p.name === productName ||
            p.name.includes(productName) ||
            productName.includes(p.name)
          );
          if (matched) {
            updateData({ model: matched.name, deliveryFee: 0 });
          }
        }

        toast({
          title: "შემოწმება წარმატებულია",
          description: message,
        });
      } else {
        // Strict error reporting
        const errorMsg = result?.message || result?.error || "კოდის შემოწმება ვერ მოხერხდა";
        updateData({
          ovenVerificationResult: {
            success: false,
            message: errorMsg,
          },
          isOvenVerified: false,
          validatedProductName: null
        });
        toast({
          title: "შემოწმება ვერ მოხერხდა",
          description: errorMsg,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error("[Oven Verification] Error:", err);
      const rawError = err.message || "შემოწმება ვერ მოხერხდა";
      updateData({
        ovenVerificationResult: {
          success: false,
          message: rawError,
        },
        isOvenVerified: false,
        validatedProductName: null
      });
      toast({
        title: "შემოწმება ვერ მოხერხდა",
        description: rawError,
        variant: "destructive",
      });
    } finally {
      setIsVerifyingOven(false);
    }
  };

  const handleNext = () => {
    const newErrors: Record<string, boolean> = {};
    if (!data.supplierName) newErrors.supplierName = true;
    // For Gorgia: supplierId = branch ID (from dropdown), ovenCode is separate
    // For others: supplierId = oven code (from input)
    if (isGorgiaUser) {
      if (!selectedBranchId) newErrors.supplierId = true; // branch not selected
      if (!ovenCode) newErrors.supplierId = true; // oven code not entered
    } else {
      if (!data.supplierId) newErrors.supplierId = true;
    }
    if (!data.model) newErrors.model = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstErrorField = (Object.keys(newErrors) as Array<keyof typeof fieldRefs>).find(
        (field) => newErrors[field]
      );
      if (firstErrorField && fieldRefs[firstErrorField].current) {
        fieldRefs[firstErrorField].current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    if (!ovenVerificationResult || !ovenVerificationResult.success) {
      toast({
        title: "შემოწმება ვერ მოხერხდა",
        description: ovenVerificationResult?.message || "გთხოვთ, ჯერ გადაამოწმოთ ღუმელის კოდი",
        variant: "destructive",
      });
      return;
    }

    // Sync ovenCode into formData for Gorgia users before proceeding
    if (isGorgiaUser && ovenCode) {
      updateData({ supplierId: ovenCode, ovenCode: ovenCode });
    } else if (!isGorgiaUser && data.supplierId) {
      updateData({ ovenCode: data.supplierId });
    }
    // For non-Gorgia, supplierId already holds the oven code

    onNext();
  };

  const MAX_SUBSIDY_GEL = 300;

  // Calculate pricing whenever model or status changes
  useEffect(() => {
    if (!data.model || products.length === 0) return;
    setErrors({}); // Clear error when model is selected

    const selected = products.find((m) => m.id.toString() === data.model || m.name === data.model);
    if (!selected) return;

    const price = selected.price / 100; // Convert cents to GEL
    const hasPriorityStatus = Boolean(data.sociallyVulnerable || data.pensioner);

    // 75% (or admin-configured value) when either toggle is ON; otherwise 50%
    let subsidyRate = 0.5;
    if (hasPriorityStatus) {
      const adminPct = selected.discountPercentage;
      subsidyRate = (adminPct && adminPct > 0) ? adminPct / 100 : 0.75;
    }

    // Apply 300 GEL subsidy cap
    let subsidyAmount = price * subsidyRate;
    if (subsidyAmount > MAX_SUBSIDY_GEL) {
      subsidyAmount = MAX_SUBSIDY_GEL;
      subsidyRate = price > 0 ? subsidyAmount / price : 0;
    }

    let finalPayable = Math.max(0, price - subsidyAmount);

    const rawDeliveryFee = Number(data.deliveryFee ?? 0);
    const deliveryFee = isIronPlusDealer ? Math.max(0, rawDeliveryFee) : 0;
    const ironPlusFee = (data.model && data.model.includes("L1-MZ-27") && data.ironPlus && isIronPlusDealer) ? 100 : 0;
    finalPayable = Math.max(0, finalPayable + deliveryFee + ironPlusFee);

    updateData({
      price,
      subsidyRate,
      subsidyAmount,
      deliveryFee,
      finalPayable,
      ironPlusFee,
    });
  }, [data.model, data.deliveryFee, data.ironPlus, data.sociallyVulnerable, data.pensioner, products, isIronPlusDealer]);

  const isComplete = () => {
    return !!data.supplierName && !!data.supplierId && !!data.model;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">პროდუქტი და ფასები</h2>
        <p className="text-muted-foreground">აირჩიეთ გამყიდველი კომპანია და მოწყობილობის მოდელი საბოლოო გადასახდელის გამოსათვლელად.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2" ref={fieldRefs.supplierName}>
          <Label htmlFor="supplierName" className={cn(errors.supplierName && "text-destructive")}>გამყიდველი კომპანიის სახელი *</Label>
          <Input
            id="supplierName"
            value={dealerName || data.supplierName || ""}
            readOnly
            disabled
            className={cn("h-12 rounded-xl bg-muted cursor-not-allowed", errors.supplierName && "border-destructive bg-destructive/5")}
          />
          {isGorgiaUser && (
            <div className="mt-2">
              <Label htmlFor="branchSelect" className={cn(errors.supplierId && "text-destructive")}>ფილიალი *</Label>
              <select
                id="branchSelect"
                value={selectedBranchId}
                onChange={(e) => {
                  const branchId = e.target.value;
                  const branch = branches.find((b) => String(b.id) === branchId);
                  updateData({
                    branchId,
                    supplierName: branch?.name || dealerName || "",
                  });
                  setErrors((prev) => ({ ...prev, supplierName: false, supplierId: false }));
                }}
                className={cn(
                  "h-12 rounded-xl w-full mt-1 border border-input bg-background px-3",
                  errors.supplierId && "border-destructive bg-destructive/5",
                )}
              >
                <option value="">აირჩიეთ ფილიალი</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="space-y-2" ref={fieldRefs.supplierId}>
          <Label htmlFor="supplierId" className={cn(errors.supplierId && "text-destructive")}>ღუმელის კოდი *</Label>
          <div className="flex gap-2">
            <Input 
              id="supplierId" 
              placeholder="შეიყვანეთ ღუმელის კოდი" 
              value={ovenCode} 
              onChange={(e) => {
                const val = e.target.value;
                const update: any = { 
                  ovenCode: val, 
                  ovenVerificationResult: null, 
                  isOvenVerified: false 
                };
                if (!isGorgiaUser) {
                  update.supplierId = val;
                }
                updateData(update);
                setErrors(prev => ({ ...prev, supplierId: false }));
                updateData({ validatedProductName: null, model: undefined, deliveryFee: 0 });
              }}
              className={cn(
                "h-12 rounded-xl flex-1", 
                errors.supplierId && "border-destructive bg-destructive/5",
                ovenVerificationResult && !ovenVerificationResult.success && "border-red-500 bg-red-50",
                ovenVerificationResult && ovenVerificationResult.success && "border-green-500 bg-green-50"
              )}
            />
            <Button
              type="button"
              onClick={handleVerifyOvenCode}
              disabled={isVerifyingOven || !ovenCode || ovenCode.length < 3}
              className="h-12 px-6 rounded-xl shrink-0 gap-2"
            >
              {isVerifyingOven ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  იტვირთება...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  შემოწმება
                </>
              )}
            </Button>
          </div>
          
          <AnimatePresence>
            {ovenVerificationResult && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={cn(
                  "text-sm font-medium mt-1 flex items-center gap-1.5",
                  ovenVerificationResult.success ? "text-green-600" : "text-red-600"
                )}
              >
                {ovenVerificationResult.success ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                {ovenVerificationResult.message}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="pt-4 space-y-4" ref={fieldRefs.model}>
        <Label className={cn("text-lg font-semibold", errors.model && "text-destructive")}>აირჩიეთ მოწყობილობის მოდელი *</Label>
        
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-4 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p>პროდუქტები იტვირთება...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="py-12 text-center bg-muted/30 rounded-2xl border-2 border-dashed border-border">
            <p className="text-muted-foreground">პროდუქტები ვერ მოიძებნა</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((model) => {
              // When a product_name was validated, only show the matching product
              const isAllowedByValidation = !validatedProductName ||
                model.name === validatedProductName ||
                model.name.includes(validatedProductName) ||
                validatedProductName.includes(model.name);
              if (!isAllowedByValidation) return null;

              const isSelected = data.model === model.id.toString() || data.model === model.name;
              const basePrice = model.price / 100;
              const hasPriority = Boolean(data.sociallyVulnerable || data.pensioner);
              let cardRate = 0.5;
              if (hasPriority) {
                const adminPct = model.discountPercentage;
                cardRate = (adminPct && adminPct > 0) ? adminPct / 100 : 0.75;
              }
              let cardSubsidy = basePrice * cardRate;
              const isCapped = cardSubsidy > MAX_SUBSIDY_GEL;
              if (isCapped) {
                cardSubsidy = MAX_SUBSIDY_GEL;
                cardRate = basePrice > 0 ? cardSubsidy / basePrice : 0;
              }
              const displayPrice = Math.max(0, basePrice - cardSubsidy);
              const hasDiscount = cardRate > 0;

              let deliveryFeeForModel = isIronPlusDealer ? DELIVERY_FEE_BY_MODEL[model.name] ?? 0 : 0;
              if (isIronPlusDealer && model.name.includes('L1-MZ-27')) {
                deliveryFeeForModel = 100;
              }
              const isDeliverySelected = isSelected && deliveryFeeForModel > 0 && Number(data.deliveryFee ?? 0) === deliveryFeeForModel;

              return (
                <div 
                  key={model.id}
                  onClick={() => updateData({ model: model.name, deliveryFee: 0 })}
                  className={cn(
                    "relative p-0 rounded-2xl border-2 cursor-pointer transition-all duration-300 overflow-hidden group",
                    isSelected 
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/10 scale-[1.02]" 
                      : "border-border hover:border-primary/40 hover:bg-muted/30 hover:shadow-md"
                  )}
                >
                  {model.imageUrl ? (
                    <div className="aspect-[4/3] w-full overflow-hidden bg-white/50 relative">
                      <img 
                        src={model.imageUrl} 
                        alt={model.name}
                        className="w-full h-full object-contain p-4 transition-transform duration-500 group-hover:scale-110"
                      />
                      <div className={cn(
                        "absolute inset-0 transition-opacity duration-300",
                        isSelected ? "bg-primary/5 opacity-100" : "bg-black/0 group-hover:bg-black/5 opacity-0 group-hover:opacity-100"
                      )} />
                    </div>
                  ) : (
                    <div className="aspect-[4/3] w-full bg-muted flex items-center justify-center">
                      <Receipt className="w-12 h-12 text-muted-foreground/20" />
                    </div>
                  )}

                  <div className="p-5">
                    <div className="font-semibold text-foreground mb-1 group-hover:text-primary transition-colors">{model.name}</div>
                    <div className="text-2xl font-bold text-primary">{displayPrice.toFixed(0)} <span className="text-sm font-normal text-muted-foreground">GEL</span></div>
                    <div className="text-xs text-muted-foreground line-through">{basePrice} GEL</div>

                    {isIronPlusDealer && deliveryFeeForModel > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isDeliverySelected}
                              disabled={!isSelected}
                              onChange={(e) => {
                                if (!isSelected) return;
                                updateData({ deliveryFee: e.target.checked ? deliveryFeeForModel : 0 });
                              }}
                              className="h-4 w-4 rounded border-muted-foreground"
                            />
                            მიტანის სერვისი
                          </label>
                          <span className="font-semibold text-foreground">{deliveryFeeForModel} GEL</span>
                        </div>
                        
                      </div>
                    )}
                  </div>
                  
                  {hasDiscount && (
                    <div className="absolute top-3 right-3 z-10 bg-accent text-accent-foreground text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-sm">
                      <Percent className="w-3 h-3" />
                      {isCapped ? `${cardSubsidy.toFixed(0)} GEL` : `${(cardRate * 100).toFixed(0)}%`}
                    </div>
                  )}
                  
                  {isSelected && (
                    <motion.div 
                      layoutId="active-check"
                      className="absolute bottom-3 right-3 bg-primary text-primary-foreground rounded-full p-1 shadow-sm"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {data.model && data.price !== undefined && data.subsidyRate !== undefined && data.finalPayable !== undefined && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 bg-foreground text-background p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-6"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-background/20 rounded-xl">
              <Receipt className="w-8 h-8 text-background" />
            </div>
            <div>
              <h4 className="text-background/80 font-medium">ფასების შეჯამება</h4>
              <p className="text-sm">
                <span className="text-background/80">საწყისი ფასი: </span>
                <span className="line-through decoration-background/60">
                  {data.price} GEL
                </span>
              </p>
            </div>
          </div>
          
          <div className="h-px w-full sm:w-px sm:h-12 bg-background/20 hidden sm:block"></div>
          
          <div className="text-center sm:text-left">
            <h4 className="text-background/80 font-medium mb-1">ფასდაკლება</h4>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 text-primary-foreground text-sm font-semibold">
              <Percent className="w-3.5 h-3.5" /> {(data.subsidyRate * 100).toFixed(0)}%
              {data.subsidyAmount !== undefined && ` (−${data.subsidyAmount.toFixed(0)} GEL)`}
            </div>
            {data.subsidyAmount !== undefined && data.subsidyAmount >= MAX_SUBSIDY_GEL && (
              <p className="text-xs text-background/60 mt-1">მაქს. სუბსიდია: {MAX_SUBSIDY_GEL} GEL</p>
            )}
          </div>

          <div className="h-px w-full sm:w-px sm:h-12 bg-background/20 hidden sm:block"></div>

          {isIronPlusDealer && data.deliveryFee && data.deliveryFee > 0 ? (
            <>
              <div className="text-center sm:text-left">
                <h4 className="text-background/80 font-medium mb-1">მიტანის საფასური</h4>
                <div className="text-3xl font-extrabold text-primary-foreground">{data.deliveryFee.toFixed(2)} GEL</div>
              </div>
              <div className="h-px w-full sm:w-px sm:h-12 bg-background/20 hidden sm:block"></div>
            </>
          ) : null}

          <div className="text-center sm:text-right">
            <h4 className="text-background/80 font-medium mb-1">საბოლოო ფასი</h4>
            <div className="text-3xl font-extrabold text-primary-foreground">{data.finalPayable.toFixed(2)} GEL</div>
          </div>
        </motion.div>
      )}

      <div className="pt-6 flex justify-between">
        <Button variant="outline" onClick={onBack} className="px-8 h-12 rounded-xl text-base">უკან</Button>
        <Button 
          onClick={onNext} 
          disabled={data.finalPayable === undefined && data.price === undefined}
          className="px-8 h-12 rounded-xl text-base shadow-md"
        >
          გაგრძელება
        </Button>
      </div>
    </motion.div>
  );
}
