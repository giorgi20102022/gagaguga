import { useState, useRef, useEffect, useCallback } from "react";
import { type SubmissionInput } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { fileToBase64, cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, CheckCircle2, ShieldCheck, MapPin, ScanLine, AlertCircle, XCircle, Check, ChevronsUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sendN8NRequest } from "@/lib/api";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const GEORGIAN_CITIES = [
  "აბაშა", "ადიგენი", "ამბროლაური", "ასპინძა", "ახალქალაქი", "ახალციხე", "ახმეტა", "ბაღდათი", "ბათუმი", "ბოლნისი", "ბორჯომი", "გარდაბანი", "გორი", "გურჯაანი", "დედოფლისწყარო", "დიდუბე", "დმანისი", "დუშეთი", "ვანი", "ზესტაფონი", "ზუგდიდი", "თეთრიწყარო", "თელავი", "თერჯოლა", "თბილისი", "თიანეთი", "კასპი", "ლაგოდეხი", "ლანჩხუთი", "ლენტეხი", "მარნეული", "მარტვილი", "მესტია", "მცხეთა", "ნინოწმინდა", "ოზურგეთი", "ონი", "რუსთავი", "საგარეჯო", "სამტრედია", "საჩხერე", "სენაკი", "სიღნაღი", "სტეფანწმინდა", "ტყიბული", "ფოთი", "ქარელი", "ქედა", "ქობულეთი", "ქუთაისი", "ყვარელი", "შუახევი", "ჩოხატაური", "ჩხოროწყუ", "ცაგერი", "ცხინვალი", "წალენჯიხა", "წალკა", "წყალტუბო", "ჭიათურა", "ხარაგაული", "ხაშური", "ხელვაჩაური", "ხობი", "ხონი", "ხულო"
].sort((a, b) => a.localeCompare(b, "ka"));

function SignaturePreview({ firstName, lastName, onGenerate }: { 
  firstName?: string; 
  lastName?: string; 
  onGenerate: (base64: string) => void 
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generate = useCallback(async () => {
    if (!firstName || !lastName) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      let fontLoaded = false;
      document.fonts.forEach((f) => {
        if (f.family === 'DM Ambrosi UNI') {
          fontLoaded = true;
        }
      });

      if (!fontLoaded) {
        const font = new FontFace('DM Ambrosi UNI', 'url(/fonts/DM-Ambrosi-UNI-93891068126.ttf)');
        await font.load();
        document.fonts.add(font);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const firstInitial = firstName.trim().charAt(0).toUpperCase();
      const formattedLastName = lastName.trim();
      const signatureText = `${firstInitial}. ${formattedLastName}`;

      ctx.font = 'italic normal 48px "DM Ambrosi UNI"';
      ctx.fillStyle = "#0B2E6B";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.fillText(signatureText, 0, 0);
      ctx.restore();

      onGenerate(canvas.toDataURL("image/png"));
    } catch (err) {
      console.error('Font load failed:', err);
      // fallback drawing
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const firstInitial = firstName.trim().charAt(0).toUpperCase();
      const formattedLastName = lastName.trim();
      const signatureText = `${firstInitial}. ${formattedLastName}`;

      ctx.font = 'italic 40px cursive';
      ctx.fillStyle = "#0B2E6B";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.fillText(signatureText, 0, 0);
      ctx.restore();

      onGenerate(canvas.toDataURL("image/png"));
    }
  }, [firstName, lastName, onGenerate]);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="space-y-2 mt-2 bg-primary/5 p-4 rounded-2xl border border-primary/10">
      <Label className="text-sm font-semibold flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-primary" /> ციფრული ხელმოწერა
      </Label>
      <div className="bg-white/80 backdrop-blur-sm border-2 border-dashed border-primary/20 rounded-xl p-4 flex items-center justify-center min-h-[100px] shadow-inner">
        <canvas ref={canvasRef} width={400} height={80} className="hidden" />
        {firstName && lastName && (
          <div className="force-signature text-4xl text-[#0B2E6B] select-none text-center">
            {`${firstName.trim().charAt(0)}. ${lastName.trim()}`}
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">ხელმოწერა გენერირებულია ავტომატურად მომხმარებლის სახელის საფუძველზე</p>
    </div>
  );
}

interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
  onCancelSale: () => void;
  dealerKey?: string;
  active?: boolean;
}

export function Step4Finalize({ data, updateData, onSubmit, onBack, isSubmitting, onCancelSale, dealerKey, active }: Props) {
  const { toast } = useToast();
  const [hasCaptured, setHasCaptured] = useState(!!data.receiptPhoto);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [verificationResult, setVerificationResult] = useState<{ success: boolean; amount?: number; message?: string } | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [isCityOpen, setIsCityOpen] = useState(false);

  const handleNativeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleCaptureFile(file);
    }
    try {
      e.target.value = "";
    } catch {}
  };

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const fieldRefs = {
    cityDistrict: useRef<HTMLDivElement>(null),
    addressVillage: useRef<HTMLDivElement>(null),
    receiptPhoto: useRef<HTMLDivElement>(null),
  };
  
  const resolvedDealerKey = dealerKey || "iron";

  useEffect(() => {
    const fetchData = async () => {
      if (active === false) return;
      
      setIsLoading(true);
      try {
        const res = await fetch(`/api/products?dealer=${resolvedDealerKey}`);
        if (!res.ok) throw new Error("Failed to fetch products");
        const data = await res.json();
        setProducts(data);
      } catch (err) {
        console.error("Error fetching products in Step 4:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    
    if (active) {
      setIsVerifying(false);
      setVerificationResult(null);
    }
  }, [resolvedDealerKey, active]);

  const handleCaptureFile = async (file: File) => {
    if (file) {
      const base64 = await fileToBase64(file);
      updateData({ receiptPhoto: base64 });
      setHasCaptured(true);
      setErrors(prev => ({ ...prev, receiptPhoto: false }));
      setVerificationResult(null);
    }
  };

  const handleVerifyReceipt = async () => {
    if (!data.receiptPhoto) {
      toast({
        title: "შეცდომა",
        description: "გთხოვთ, ჯერ ატვირთოთ ქვითრის ფოტო",
        variant: "destructive",
      });
      return;
    }
    if (isVerifying) return;

    setIsVerifying(true);
    setVerificationResult(null);

    try {
      const res = await fetch("/api/vision/verify-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: data.receiptPhoto }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Verification failed: ${errorText}`);
      }

      const result = await res.json();
      const rawAmount = result?.total_amount;

      if (rawAmount === null || rawAmount === undefined) {
        throw new Error("Could not extract amount from response");
      }

      const cleanNumber = (val: any) => {
        if (typeof val === 'number') return val;
        return Number(String(val).replace(/,/g, ".").replace(/[^0-9.]/g, "").trim());
      };

      const receiptPrice = cleanNumber(rawAmount);
      const finalPrice = cleanNumber(data.finalPayable ?? 0);

      if (isNaN(receiptPrice)) {
        throw new Error("Could not parse receipt amount: " + String(rawAmount));
      }

      const isMatch = Math.abs(receiptPrice - finalPrice) < 0.01;
      setVerificationResult({
        success: isMatch,
        amount: receiptPrice,
        message: isMatch
          ? "ქვითარი დადასტურებულია ✅"
          : "ქვითრის თანხა არ ემთხვევა ❌",
      });
    } catch (err) {
      console.error("[Receipt Verification] Catch Block:", err);
      setVerificationResult({
        success: false,
        message: "ქვითრის გადამოწმება ვერ მოხერხდა ❌",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCancelSale = async () => {
    setIsCancelling(true);
    try {
      toast({
        title: "შეკვეთა გაუქმდა",
        description: "შეკვეთა გაუქმდა და კოდი ისევ ხელმისაწვდომია.",
      });
      onCancelSale();
    } catch (err) {
      console.error("[Cancel Sale] Error:", err);
      toast({
        title: "შეცდომა",
        description: "შეკვეთის გაუქმება ვერ მოხერხდა",
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleFinish = () => {
    const newErrors: Record<string, boolean> = {};
    if (!(data as any).cityDistrict) newErrors.cityDistrict = true;
    if (!data.receiptPhoto) newErrors.receiptPhoto = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstErrorField = (Object.keys(newErrors) as Array<keyof typeof fieldRefs>).find(
        field => newErrors[field]
      );
      if (firstErrorField && fieldRefs[firstErrorField].current) {
        fieldRefs[firstErrorField].current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    onSubmit();
  };

  const addressesComplete = Boolean(
    (data as any).cityDistrict
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">დასრულება</h2>
        <p className="text-muted-foreground">დაადასტურეთ მონაცემები, მიუთითეთ მონტაჟის მისამართი და ატვირთეთ ქვითრის ფოტო.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column */}
        <div className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" /> ღუმელის მონტაჟის მისამართი
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2" ref={fieldRefs.cityDistrict}>
                <Label className={cn("text-sm font-semibold", errors.cityDistrict && "text-destructive")}>
                  მონტაჟის ქალაქი / რაიონი *
                </Label>
                <Popover open={isCityOpen} onOpenChange={setIsCityOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={isCityOpen}
                      className={cn(
                        "w-full h-11 justify-between rounded-xl px-3 font-normal",
                        !(data as any).cityDistrict && "text-muted-foreground",
                        errors.cityDistrict && "border-destructive bg-destructive/5"
                      )}
                    >
                      {(data as any).cityDistrict
                        ? GEORGIAN_CITIES.find((city) => city === (data as any).cityDistrict)
                        : "აირჩიეთ ქალაქი"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="მოძებნეთ..." className="h-9" />
                      <CommandList>
                        <CommandEmpty>ქალაქი ვერ მოიძებნა.</CommandEmpty>
                        <CommandGroup>
                          {GEORGIAN_CITIES.map((city) => (
                            <CommandItem
                              key={city}
                              value={city}
                              onSelect={(currentValue) => {
                                updateData({ cityDistrict: currentValue } as any);
                                setErrors((prev) => ({ ...prev, cityDistrict: false }));
                                setIsCityOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  (data as any).cityDistrict === city ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {city}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2" ref={fieldRefs.addressVillage}>
                <Label className={cn("text-sm font-semibold", errors.addressVillage && "text-destructive")}>
                  მონტაჟის მისამართი / სოფელი
                </Label>
                <Input
                  placeholder="მიუთითეთ მისამართი"
                  value={(data as any).addressVillage || ""}
                  onChange={(e) => {
                    updateData({ addressVillage: e.target.value } as any);
                    setErrors(prev => ({ ...prev, addressVillage: false }));
                  }}
                  className={cn("h-11 rounded-xl", errors.addressVillage && "border-destructive bg-destructive/5")}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3" ref={fieldRefs.receiptPhoto}>
            <Label className={cn("text-base font-semibold flex items-center gap-2", errors.receiptPhoto && "text-destructive")}>
              <Camera className="w-4 h-4 text-primary" /> ქვითრის ფოტო *
            </Label>
            <div className={cn(
              errors.receiptPhoto && "border-destructive bg-destructive/5"
            )}>
              {hasCaptured ? (
                <div className="relative bg-muted/40 border border-border/50 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-4">
                  <div className="w-full space-y-4">
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-2">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                      <p className="font-semibold text-foreground">ქვითრის ფოტო წარმატებით აიტვირთა.</p>
                    </div>

                    <div className="flex flex-col gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-12 rounded-xl gap-2 border-primary/20 hover:bg-primary/5 text-primary font-bold relative z-20"
                        onClick={handleVerifyReceipt}
                        disabled={isVerifying}
                      >
                        {isVerifying ? (
                          <>
                            <ScanLine className="w-5 h-5 animate-pulse" />
                            მოწმდება...
                          </>
                        ) : (
                          <>
                            <ScanLine className="w-5 h-5" />
                            შემოწმება
                          </>
                        )}
                      </Button>

                      <AnimatePresence>
                        {verificationResult && (
                          <div className={cn(
                            "p-4 rounded-xl border flex items-center gap-3 text-left shadow-sm transition-all animate-in fade-in slide-in-from-top-2",
                            verificationResult.success
                              ? "bg-green-500/10 border-green-500/20 text-green-700"
                              : "bg-red-500/10 border-red-500/20 text-red-600 font-bold"
                          )}>
                            {verificationResult.success ? (
                              <CheckCircle2 className="w-5 h-5 shrink-0" />
                            ) : (
                              <AlertCircle className="w-5 h-5 shrink-0" />
                            )}
                            <span className="text-base">{verificationResult.message}</span>
                          </div>
                        )}
                      </AnimatePresence>

                      <div className="relative aspect-[4/3] rounded-xl overflow-hidden border border-border bg-black/5 mt-2">
                        <img
                          src={data.receiptPhoto}
                          alt="Receipt"
                          className="w-full h-full object-contain"
                        />
                      </div>

                      <div className="relative w-full text-center mt-2">
                        <input
                          type="file"
                          accept="image/*"
                          className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer"
                          onChange={handleNativeFileChange}
                        />
                        <span className="text-sm text-primary hover:underline cursor-pointer font-medium block w-full text-center z-0">
                          ხელახლა ატვირთვა
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative bg-muted/40 border border-border/50 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-4">
                  <input
                    type="file"
                    accept="image/*"
                    className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer"
                    onChange={handleNativeFileChange}
                  />
                  <div className="w-16 h-16 bg-background border shadow-sm text-muted-foreground rounded-full flex items-center justify-center mb-2 z-0">
                    <Camera className="w-8 h-8" />
                  </div>
                  <p className="text-sm text-muted-foreground max-w-[250px] z-0">გადაუღეთ მკაფიო ფოტო დაბეჭდილ ქვითარს.</p>
                  <div className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-medium shadow-md hover:bg-primary/90 transition-colors inline-block z-0">
                    ქვითრის ატვირთვა
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-lg text-foreground flex items-center gap-2 border-b border-primary/10 pb-3">
              შეკვეთის შეჯამება
            </h3>
            
            <div className="space-y-3 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">მომხმარებელი:</span>
                <span className="font-medium text-foreground">{data.firstName || '-'} {data.lastName || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">პირადი ნომერი:</span>
                <span className="font-medium text-foreground">{data.idNumber || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">მდებარეობა:</span>
                <span className="font-medium text-foreground">{data.city || '-'}</span>
              </div>
              
              <div className="h-px bg-primary/10 w-full my-2"></div>
              
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">მოდელი:</span>
                <span className="font-medium text-foreground">{data.model || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">საწყისი ფასი:</span>
                <span className="font-medium text-foreground">{data.price != null ? `${data.price} GEL` : '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">სუბსიდია:</span>
                <span className="font-medium text-foreground">{data.subsidyRate != null ? `${(data.subsidyRate * 100)}%` : '-'}</span>
              </div>
              
              <div className="h-px bg-primary/10 w-full my-2"></div>
              
              <div className="flex justify-between items-center">
                <span className="font-bold text-foreground">საბოლოო გადასახდელი:</span>
                <span className="text-2xl font-extrabold text-primary">{data.finalPayable != null ? `${data.finalPayable.toFixed(2)} GEL` : '-'}</span>
              </div>
            </div>
          </div>

          <SignaturePreview 
            firstName={data.firstName} 
            lastName={data.lastName} 
            onGenerate={(base64) => {
              if (data.signature !== base64) {
                updateData({ signature: base64 } as any);
              }
            }} 
          />
        </div>
      </div>

      <div className="pt-6 flex justify-between items-center border-t border-border mt-8">
        <Button
          variant="outline"
          className="px-6 h-12 rounded-xl text-base border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 hover:text-red-700 gap-2"
          onClick={handleCancelSale}
          disabled={isSubmitting || isCancelling}
        >
          {isCancelling ? (
            <>
              <XCircle className="w-4 h-4 animate-pulse" />
              იტვირთება...
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4" />
              შეკვეთის გაუქმება
            </>
          )}
        </Button>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onBack} disabled={isSubmitting || isCancelling} className="px-8 h-12 rounded-xl text-base">უკან</Button>
          <Button
            onClick={handleFinish}
            disabled={isSubmitting || isCancelling || !(data.model && data.price !== undefined && data.receiptPhoto)}
            className="px-10 h-12 rounded-xl text-base font-bold shadow-lg shadow-primary/25 hover:-translate-y-0.5 transition-all"
          >
            {isSubmitting ? "განაცხადი მუშავდება..." : "განაცხადის გაგზავნა"}
          </Button>
        </div>
      </div>


    </motion.div>
  );
}
