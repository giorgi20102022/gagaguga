import { useState, useEffect, useRef, memo } from "react";
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
interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onNext: () => void;
  onBack: () => void;
  dealerKey?: string;
  dealerName?: string;
  active?: boolean;
}

export function Step3ProductInner({ data, updateData, onNext, onBack, dealerKey: dealerKeyProp, dealerName, active }: Props) {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
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
  const [ovenVerificationResult, setOvenVerificationResult] = useState<{ success: boolean; message: string } | null>(() => {
    if (data?.ovenVerified) {
      return { success: true, message: data?.ovenVerificationMessage || "კოდი ვალიდურია" };
    }
    return null;
  });
  const [verifiedProductName, setVerifiedProductName] = useState<string | null>(() => data?.verifiedProductName || null);
  const [ovenCode, setOvenCode] = useState(() => data?.ovenCode || (isGorgiaUser ? String(data?.supplierId || "") : ""));

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
    if (dealerName && !data.supplierName) {
      updateData({ supplierName: dealerName });
    }
  }, [dealerName, data.supplierName]);

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

    if (active !== false) {
      fetchProducts();
    }
  }, [resolvedDealerKey, active]);

  const handleVerifyOvenCode = async () => {
    const code = isGorgiaUser ? ovenCode : data.supplierId;
    if (!code || code.length < 3) return;

    const dealerNameToSend = String(dealerName || data.supplierName || "").trim();

    if (!dealerNameToSend) {
      setOvenVerificationResult({
        success: false,
        message: "❌ დილერი ვერ მოიძებნა",
      });
      updateData({
        ovenVerified: false,
        ovenVerificationMessage: "❌ დილერი ვერ მოიძებნა",
        verifiedProductName: undefined,
        ovenCodeRow: undefined,
      });
      toast({
        title: "შემოწმება ვერ მოხერხდა",
        description: "დილერი ვერ მოიძებნა",
        variant: "destructive",
      });
      return;
    }

    setIsVerifyingOven(true);
    setOvenVerificationResult(null);

    try {
      const res = await axios.post("/api/check-stove-code", {
        action: "verify",
        code: code,
        dealer_name: dealerNameToSend,
        branch_name: dealerNameToSend,
      });

      const result = res.data;
      if (result?.status === "success") {
        const message = result.message || "კოდი ვალიდურია";
        const parsedCodeRow = result.code_row != null && result.code_row !== ""
          ? Number(result.code_row)
          : undefined;
        const codeRow = parsedCodeRow != null && !Number.isNaN(parsedCodeRow) ? parsedCodeRow : undefined;
        setOvenVerificationResult({
          success: true,
          message,
        });
        if (result.product_name) {
          setVerifiedProductName(result.product_name);
          const matched = products.find((p) =>
            p.name === result.product_name ||
            p.name.includes(result.product_name) ||
            result.product_name.includes(p.name)
          );
          if (matched) {
            updateData({ 
              model: matched.name, 
              deliveryFee: 0,
              ovenVerified: true,
              ovenVerificationMessage: message,
              verifiedProductName: result.product_name,
              ovenCodeRow: codeRow,
            });
          } else {
            updateData({
              ovenVerified: true,
              ovenVerificationMessage: message,
              verifiedProductName: result.product_name,
              ovenCodeRow: codeRow,
            });
          }
        } else {
          updateData({
            ovenVerified: true,
            ovenVerificationMessage: message,
            ovenCodeRow: codeRow,
          });
        }
        toast({
          title: "შემოწმება წარმატებულია",
          description: message,
        });
      } else {
        const errorMsg = result?.message || result?.error || "კოდის შემოწმება ვერ მოხერხდა";
        setOvenVerificationResult({
          success: false,
          message: errorMsg,
        });
        updateData({
          ovenVerified: false,
          ovenVerificationMessage: errorMsg,
          verifiedProductName: undefined,
          ovenCodeRow: undefined,
        });
        toast({
          title: "შემოწმება ვერ მოხერხდა",
          description: errorMsg,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("[Oven Verification] Error:", err);
      let rawError = "შემოწმება ვერ მოხერხდა";
      
      if (axios.isAxiosError(err)) {
        const serverData = err.response?.data;
        rawError = typeof serverData === 'string' 
          ? serverData 
          : (serverData?.message || serverData?.error || err.message);
      } else {
        rawError = (err as Error).message;
      }

      setOvenVerificationResult({
        success: false,
        message: rawError,
      });
      updateData({
        ovenVerified: false,
        ovenVerificationMessage: rawError,
        verifiedProductName: undefined,
        ovenCodeRow: undefined,
      });
      toast({
        title: "კოდის შეცდომა",
        description: rawError,
        variant: "destructive",
      });
    } finally {
      setIsVerifyingOven(false);
    }
  };

  const isNextDisabled =
    !data.supplierName ||
    (isGorgiaUser ? !ovenCode : !data.supplierId) ||
    !data.model ||
    !data.ovenVerified;

  // Log validation dependency state to console for tracing
  useEffect(() => {
    console.log("[Step3Product Validation]:", {
      supplierName: data.supplierName,
      supplierId: isGorgiaUser ? ovenCode : data.supplierId,
      model: data.model,
      ovenVerified: data.ovenVerified,
      isGorgiaUser,
      isNextDisabled
    });
  }, [data.supplierName, data.supplierId, ovenCode, data.model, data.ovenVerified, isGorgiaUser, isNextDisabled]);

  const handleNext = () => {
    const newErrors: Record<string, boolean> = {};
    if (!data.supplierName) newErrors.supplierName = true;
    if (isGorgiaUser) {
      if (!ovenCode) newErrors.supplierId = true;
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

    if (!data.ovenVerified) {
      toast({
        title: "შემოწმება ვერ მოხერხდა",
        description: data.ovenVerificationMessage || "გთხოვთ, ჯერ გადაამოწმოთ ღუმელის კოდი",
        variant: "destructive",
      });
      return;
    }

    if (isGorgiaUser && ovenCode) {
      updateData({ supplierId: ovenCode });
    }

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
        </div>

        <div className="space-y-2" ref={fieldRefs.supplierId}>
          <Label htmlFor="supplierId" className={cn(errors.supplierId && "text-destructive")}>ღუმელის კოდი *</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input 
              id="supplierId" 
              placeholder="შეიყვანეთ ღუმელის კოდი" 
              value={isGorgiaUser ? ovenCode : (data.supplierId || "")} 
              onChange={(e) => {
                const newVal = e.target.value;
                if (isGorgiaUser) {
                  setOvenCode(newVal);
                  updateData({ ovenCode: newVal });
                } else {
                  updateData({ supplierId: newVal, ovenCode: newVal });
                }
                setErrors(prev => ({ ...prev, supplierId: false }));
                setOvenVerificationResult(null);
                setVerifiedProductName(null);
                updateData({ 
                  model: undefined,
                  deliveryFee: 0,
                  ovenVerified: false,
                  ovenVerificationMessage: undefined,
                  verifiedProductName: undefined,
                  ovenCodeRow: undefined,
                  // Clear stale pricing so Step 5 summary doesn't show old values
                  price: undefined,
                  subsidyRate: undefined,
                  subsidyAmount: undefined,
                  finalPayable: undefined,
                  ironPlusFee: undefined,
                });
              }}
              className={cn(
                "h-12 rounded-xl flex-1 w-full", 
                errors.supplierId && "border-destructive bg-destructive/5",
                ovenVerificationResult && !ovenVerificationResult.success && "border-red-500 bg-red-50",
                ovenVerificationResult && ovenVerificationResult.success && "border-green-500 bg-green-50"
              )}
            />
            <Button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleVerifyOvenCode(); }}
              disabled={isVerifyingOven || (isGorgiaUser ? !ovenCode || ovenCode.length < 3 : !data.supplierId || (data.supplierId as string).length < 3)}
              className="w-full sm:w-auto h-12 px-6 rounded-xl shrink-0 gap-2"
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
            {products
              .filter(model => {
                if (!verifiedProductName) return true;
                // Filter by name match (case insensitive)
                const verified = verifiedProductName.toLowerCase();
                const current = model.name.toLowerCase();
                return current.includes(verified) || verified.includes(current);
              })
              .map((model) => {
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

      {data.model && data.price != null && data.subsidyRate != null && data.finalPayable != null && (
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
              <Percent className="w-3.5 h-3.5" /> {((data.subsidyRate ?? 0) * 100).toFixed(0)}%
              {data.subsidyAmount != null && ` (−${(data.subsidyAmount).toFixed(0)} GEL)`}
            </div>
            {data.subsidyAmount != null && data.subsidyAmount >= MAX_SUBSIDY_GEL && (
              <p className="text-xs text-background/60 mt-1">მაქს. სუბსიდია: {MAX_SUBSIDY_GEL} GEL</p>
            )}
          </div>

          <div className="h-px w-full sm:w-px sm:h-12 bg-background/20 hidden sm:block"></div>

          {isIronPlusDealer && data.deliveryFee != null && data.deliveryFee > 0 ? (
            <>
              <div className="text-center sm:text-left">
                <h4 className="text-background/80 font-medium mb-1">მიტანის საფასური</h4>
                <div className="text-3xl font-extrabold text-primary-foreground">{(data.deliveryFee ?? 0).toFixed(2)} GEL</div>
              </div>
              <div className="h-px w-full sm:w-px sm:h-12 bg-background/20 hidden sm:block"></div>
            </>
          ) : null}

          <div className="text-center sm:text-right">
            <h4 className="text-background/80 font-medium mb-1">საბოლოო ფასი</h4>
            <div className="text-3xl font-extrabold text-primary-foreground">{(data.finalPayable ?? 0).toFixed(2)} GEL</div>
          </div>
        </motion.div>
      )}

      <div className="pt-6 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
        <Button type="button" variant="outline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBack(); }} className="w-full sm:w-auto px-8 h-12 rounded-xl text-base">უკან</Button>
        <Button 
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNext(); }}
          disabled={isNextDisabled}
          className="w-full sm:w-auto px-8 h-12 rounded-xl text-base shadow-md"
        >
          გაგრძელება
        </Button>
      </div>
    </motion.div>
  );
}

export const Step3Product = memo(Step3ProductInner);
