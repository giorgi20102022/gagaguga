import { useState, useRef, useEffect, useCallback, memo } from "react";
import { type SubmissionInput } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, CheckCircle2, ShieldCheck, MapPin, ScanLine, AlertCircle, XCircle, Check, ChevronsUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sendN8NRequest } from "@/lib/api";
import axios from "axios";
import { MediaUploadZone } from "@/components/ui/MediaUploadZone";




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
import { GEO_ELGUJA_FONT_BASE64 } from "./geoElgujaBase64";

const convertToAscii = (text: string): string => {
  const map: Record<string, string> = {
    'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z',
    'თ': 'T', 'ი': 'i', 'კ': 'k', 'ლ': 'l', 'მ': 'm', 'ნ': 'n', 'ო': 'o',
    'პ': 'p', 'ჟ': 'J', 'რ': 'r', 'ს': 's', 'ტ': 't', 'უ': 'u', 'ფ': 'f',
    'ქ': 'q', 'ღ': 'R', 'ყ': 'y', 'შ': 'S', 'ჩ': 'C', 'ც': 'c', 'ძ': 'Z',
    'წ': 'W', 'ჭ': 'w', 'ხ': 'x', 'ჯ': 'j', 'ჰ': 'h'
  };
  return text.split('').map(ch => map[ch] || ch).join('');
};

const cleanBase64 = GEO_ELGUJA_FONT_BASE64.replace(/[\r\n\s]/g, '');
const GEORGIAN_CITIES = [
  "აბაშა", "ადიგენი", "ამბროლაური", "ასპინძა", "ახალქალაქი", "ახალციხე", "ახმეტა", "ბაღდათი", "ბათუმი", "ბოლნისი", "ბორჯომი", "გარდაბანი", "გორი", "გურჯაანი", "დედოფლისწყარო", "დიდუბე", "დმანისი", "დუშეთი", "ვანი", "ზესტაფონი", "ზუგდიდი", "თეთრიწყარო", "თელავი", "თერჯოლა", "თბილისი", "თიანეთი", "კასპი", "ლაგოდეხი", "ლანჩხუთი", "ლენტეხი", "მარნეული", "მარტვილი", "მესტია", "მცხეთა", "ნინოწმინდა", "ოზურგეთი", "ონი", "რუსთავი", "საგარეჯო", "სამტრედია", "საჩხერე", "სენაკი", "სიღნაღი", "სტეფანწმინდა", "ტყიბული", "ფოთი", "ქარელი", "ქედა", "ქობულეთი", "ქუთაისი", "ყვარელი", "შუახევი", "ჩოხატაური", "ჩხოროწყუ", "ცაგერი", "ცხინვალი", "წალენჯიხა", "წალკა", "წყალტუბო", "ჭიათურა", "ხარაგაული", "ხაშური", "ხელვაჩაური", "ხობი", "ხონი", "ხულო"
].sort((a, b) => {
  try {
    return a.localeCompare(b, "ka");
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
});

function SignaturePreview({ firstName, lastName, onGenerate, canvasRef }: {
  firstName?: string;
  lastName?: string;
  onGenerate: (base64: string) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}) {



  const firstNameVal = firstName?.trim() || "";
  const lastNameVal = lastName?.trim() || "";
  const firstInitial = firstNameVal.charAt(0);
  const signatureText = firstNameVal && lastNameVal ? `${firstInitial}. ${lastNameVal}` : "";
  const renderedSignature = signatureText; // Use raw Georgian Unicode text

  const onGenerateRef = useRef(onGenerate);
  useEffect(() => {
    onGenerateRef.current = onGenerate;
  }, [onGenerate]);

  const generate = useCallback(async () => {
    if (!signatureText) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      // Ensure the GeoElguja font is loaded before drawing
      await document.fonts.load('48px "GeoElgujaBase64"');

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '48px "GeoElgujaBase64"';
      (ctx as any).letterSpacing = "0px";
      (ctx as any).wordSpacing = "0px";
      ctx.fillStyle = '#0038A8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(convertToAscii(signatureText), canvas.width / 2, canvas.height / 2);

      onGenerateRef.current(canvas.toDataURL('image/png'));
    } catch (err) {
      console.error('Font load failed:', err);
      // Fallback to system sans‑serif if custom font fails
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = 'italic normal 48px sans-serif';
      ctx.fillStyle = '#0038A8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(renderedSignature, canvas.width / 2, canvas.height / 2);
      onGenerateRef.current(canvas.toDataURL('image/png'));
    }
  }, [signatureText]);

  useEffect(() => {
    let style = document.getElementById('geo-elguja-base64-font');
    if (!style) {
      style = document.createElement('style');
      style.id = 'geo-elguja-base64-font';
      style.innerHTML = `@font-face { font-family: 'GeoElgujaBase64'; src: url('data:font/truetype;charset=utf-8;base64,${cleanBase64}') format('truetype'); }`;
      document.head.appendChild(style);
    }
    generate();
  }, [generate]);

  useEffect(() => {
    return () => {
      const el = document.getElementById('geo-elguja-base64-font');
      if (el) el.remove();
    };
  }, []);

  return (<>
    {/* Font face injected via useEffect */}
    <Label className="text-sm font-semibold flex items-center gap-2">
      <ShieldCheck className="w-4 h-4 text-primary" /> ციფრული ხელმოწერა
    </Label>
    <div className="bg-white/80 backdrop-blur-sm border-2 border-dashed border-primary/20 rounded-xl p-4 flex items-center justify-center min-h-[100px] shadow-inner">
      <canvas ref={canvasRef} width={400} height={80} className="hidden" />
      {signatureText && (
        <div style={{
          fontFamily: "'GeoElgujaBase64', sans-serif",
          letterSpacing: '0px',
          whiteSpace: 'nowrap',
          fontSize: '36px',
          color: '#0038A8'
        }}>
          <span style={{ display: 'inline-block', marginRight: '5px' }}>
            {convertToAscii(`${firstInitial}.`)}
          </span>
          <span>
            {convertToAscii(lastNameVal)}
          </span>
        </div>
      )}
    </div>
    <p className="text-[10px] text-muted-foreground text-center">ხელმოწერა გენერირებულია ავტომატურად მომხმარებლის სახელის საფუძველზე</p>

  </>);
}

interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onSubmit: (signatureFile?: File) => void;
  onBack: () => void;
  isSubmitting: boolean;
  loadingMessage?: string;
  onCancelSale?: () => void;
  active?: boolean;
}

export function Step4FinalizeInner({ data, updateData, onSubmit, onBack, isSubmitting, loadingMessage, onCancelSale, active }: Props) {
  const { toast } = useToast();
  const [isVerifying, setIsVerifying] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  // State to hold error message from n8n backend
  const [apiError, setApiError] = useState<string | null>(null);
  const [isCityOpen, setIsCityOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isCompilingSignature, setIsCompilingSignature] = useState(false);

  // SMS Verification states — transient UI only; persistent state lives in formData
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [isSmsSent, setIsSmsSent] = useState(false);
  const [isVerifyingSms, setIsVerifyingSms] = useState(false);
  const [smsCode, setSmsCode] = useState("");
  const [smsError, setSmsError] = useState<string | null>(null);

  // ─── Derived from formData — survives component re-mounts on back/forward nav ───
  const hasCaptured = !!data.receiptPhoto;
  const isSmsVerified = !!data.smsVerified;
  const verificationResult: { success: boolean; message: string; amount?: number } | null =
    !isVerifying && data.receiptVerified !== undefined
      ? {
          success: !!data.receiptVerified,
          message:
            data.receiptVerificationMessage ||
            (data.receiptVerified ? "✅ მონაცემები დაემთხვა" : "❌ შეუმოწმებელი"),
          amount: data.price,
        }
      : null;

  const fieldRefs = {
    cityDistrict: useRef<HTMLDivElement>(null),
    addressVillage: useRef<HTMLDivElement>(null),
    receiptPhoto: useRef<HTMLDivElement>(null),
    phone: useRef<HTMLDivElement>(null),
  };

  // Stable ref so memoized callbacks always call the latest updateData
  const updateDataRef = useRef(updateData);
  useEffect(() => {
    updateDataRef.current = updateData;
  }, [updateData]);

  // Stable signature callback — prevents SignaturePreview from re-triggering
  // generate() on every parent re-render, which caused the white-out loop.
  const lastSignatureRef = useRef<string | undefined>(undefined);
  const handleSignatureGenerate = useCallback((base64: string) => {
    if (lastSignatureRef.current !== base64) {
      lastSignatureRef.current = base64;
      updateDataRef.current({ signature: base64 } as any);
    }
  }, []);

  const handleSendSms = async () => {
    if (!data.phone || isSendingSms) return;
    setIsSendingSms(true);
    setSmsError(null);
    try {
      await axios.post("/api/verification/send-sms", { phone: data.phone });
      setIsSmsSent(true);
      toast({
        title: "SMS გაიგზავნა",
        description: "გთხოვთ შეიყვანოთ მიღებული კოდი",
      });
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
      await axios.post("/api/verification/verify-sms", {
        phone: data.phone,
        code: smsCode
      });
      updateData({ smsVerified: true }); // isSmsVerified is now derived from data.smsVerified
      toast({
        title: "წარმატება",
        description: "ტელეფონის ნომერი დადასტურებულია",
      });
    } catch (err: any) {
      setSmsError(err.response?.data?.message || "არასწორი კოდი");
    } finally {
      setIsVerifyingSms(false);
    }
  };

  const persistReceipt = useCallback((base64: string) => {
    if (!base64) {
      // Clear receipt photo state (called by MediaUploadZone clearPreview)
      updateData({
        receiptPhoto: undefined,
        receiptVerified: undefined,
        receiptVerificationMessage: undefined,
      });
      setErrors((prev) => ({ ...prev, receiptPhoto: false }));
      return;
    }
    updateData({
      receiptPhoto: base64,
      receiptVerified: undefined,
      receiptVerificationMessage: undefined,
    });
    setErrors((prev) => ({ ...prev, receiptPhoto: false }));
  }, [updateData]);

  const handleVerifyReceipt = async () => {
    if (!data.receiptPhoto || isVerifying) return;

    setIsVerifying(true); // derived verificationResult is null while isVerifying=true

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

      const receiptPrice = Number(String(rawAmount).replace(/[^0-9.\-]/g, "").trim());
      const finalPrice = Number(Number(data.finalPayable ?? 0).toFixed(2));

      if (isNaN(receiptPrice)) {
        throw new Error("Could not parse receipt amount: " + String(rawAmount));
      }

      const isMatch = Math.abs(receiptPrice - finalPrice) < 0.01;
      const message = isMatch
        ? "✅ მონაცემები დაემთხვა"
        : `❌ მონაცემები არ ემთხვევა (ქვითარი: ${receiptPrice.toFixed(2)} GEL, სისტემა: ${finalPrice.toFixed(2)} GEL)`;
      updateData({
        receiptVerified: isMatch,
        receiptVerificationMessage: message,
      }); // verificationResult is derived from data after isVerifying flips false
    } catch (err) {
      console.error("[Receipt Verification] Error:", err);
      const message = "❌ ვერ მოხერხდა მონაცემების ამოკითხვა";
      updateData({
        receiptVerified: false,
        receiptVerificationMessage: message
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCancelSale = async () => {
    if (!onCancelSale) return;
    setIsCancelling(true);
    try {
      await sendN8NRequest({
        action: "cancel",
        code: data.ovenCode || data.supplierId || "",
        dealer_name: data.supplierName || "",
        branch_name: data.supplierName || "",
      });
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

  const handleFinish = async () => {
    const newErrors: Record<string, boolean> = {};
    if (!data.cityDistrict) newErrors.cityDistrict = true;
    if (!data.addressVillage || data.addressVillage.trim() === "") newErrors.addressVillage = true;
    if (!data.receiptPhoto) newErrors.receiptPhoto = true;
    const phoneRequired = true;
    const smsRequired = true;
    if (phoneRequired && !data.phone) newErrors.phone = true;
    else if (smsRequired && data.phone && !isSmsVerified) newErrors.phone = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstErrorField = (Object.keys(newErrors) as (keyof typeof fieldRefs)[]).find(
        field => newErrors[field]
      );
      if (firstErrorField && fieldRefs[firstErrorField].current) {
        fieldRefs[firstErrorField].current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setIsCompilingSignature(true);
    let signatureFile: File | undefined = undefined;
    try {
      const canvas = signatureCanvasRef.current;
      if (canvas) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          signatureFile = new File([blob], 'digital-signature.png', { type: 'image/png' });
          updateData({ signatureFile } as any);
        }
      }
    } catch (err) {
      console.error("Signature compilation failed:", err);
    } finally {
      setIsCompilingSignature(false);
    }

    onSubmit(signatureFile);
  };

  const addressesComplete = Boolean(
    data.cityDistrict && data.addressVillage && data.addressVillage.trim() !== ""
  );

  const isSubmitDisabled =
    isSubmitting ||
    isCancelling ||
    isCompilingSignature ||
    !(data.model && data.price !== undefined && data.receiptPhoto);

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
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={isCityOpen}
                      className={cn(
                        "w-full h-11 justify-between rounded-xl px-3 font-normal",
                        !(data as any).cityDistrict && "text-muted-foreground",
                        errors.cityDistrict && "border-destructive bg-destructive/5"
                      )}
                    >
                      {data.cityDistrict
                        ? GEORGIAN_CITIES.find((city) => city === data.cityDistrict)
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
                                updateData({ cityDistrict: currentValue });
                                setErrors((prev) => ({ ...prev, cityDistrict: false }));
                                setIsCityOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  data.cityDistrict === city ? "opacity-100" : "opacity-0"
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
                  მონტაჟის მისამართი / სოფელი *
                </Label>
                <Input
                  placeholder="მიუთითეთ მისამართი"
                  value={data.addressVillage || ""}
                  onChange={(e) => {
                    updateData({ addressVillage: e.target.value });
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
            <MediaUploadZone
              key="receiptPhoto"
              label="ქვითრის ფოტო"
              pickerTitle="ქვითრის ფოტო"
              variant="receipt"
              inputId="receipt-upload"
              storedValue={data.receiptPhoto}
              onPersist={persistReceipt}
              hasError={errors.receiptPhoto}
              emptyHint="გადაუღეთ მკაფიო ფოტო დაბეჭდილ ქვითარს — ფოტოს გადაღება ან გალერიიდან ატვირთვა"
            />

            {hasCaptured && (
              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  className="w-full h-12 rounded-xl gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleVerifyReceipt(); }}
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
                      შეამოწმე ქვითარი
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
              </div>
            )}
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
                <span className="font-medium text-foreground">{data.cityDistrict || '-'}</span>
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
                <span className="font-medium text-foreground">{data.subsidyRate != null ? `${(data.subsidyRate * 100).toFixed(0)}%` : '-'}</span>
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
            canvasRef={signatureCanvasRef}
            onGenerate={handleSignatureGenerate}
          />

          <div className="space-y-2" ref={fieldRefs.phone}>
            <Label className={cn("text-sm font-semibold", errors.phone && "text-destructive")}>
              განაცხადის დადასტურება sms კოდით*
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="5-- -- -- --"
                value={data.phone || ""}
                disabled={isSmsVerified}
                onChange={(e) => {
                  updateData({ phone: e.target.value, smsVerified: false });
                  setErrors((prev) => ({ ...prev, phone: false }));
                  setIsSmsSent(false);
                  setSmsError(null);
                  setSmsCode("");
                }}
                className={cn(
                  "h-11 rounded-xl flex-1",
                  errors.phone && "border-destructive bg-destructive/5",
                  isSmsVerified && "border-green-500 bg-green-50"
                )}
              />

              {!isSmsVerified && (
                <Button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSendSms(); }}
                  disabled={isSendingSms || !data.phone || String(data.phone).replace(/\s+/g, "").length < 9}
                  className="h-11 px-4 rounded-xl shrink-0"
                >
                  {isSendingSms ? "იგზავნება..." : isSmsSent ? "თავიდან" : "კოდი"}
                </Button>
              )}
            </div>

            <AnimatePresence>
              {isSmsSent && !isSmsVerified && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <div className="flex gap-2">
                    <Input
                      placeholder="4-ნიშნა კოდი"
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value)}
                      className="h-11 rounded-xl flex-1"
                      maxLength={4}
                    />
                    <Button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleVerifySms(); }}
                      disabled={isVerifyingSms || smsCode.length !== 4}
                      className="h-11 px-4 rounded-xl shrink-0"
                    >
                      {isVerifyingSms ? "მოწმდება..." : "OK"}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {isSmsVerified && (
              <div className="text-sm text-green-600 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                ნომერი დადასტურებულია
              </div>
            )}

            {smsError && (
              <div className="text-sm text-red-600 flex items-center gap-1.5 font-medium">
                <AlertCircle className="w-4 h-4" />
                {smsError}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 border-t border-border mt-8">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto px-6 h-12 rounded-xl text-base border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 hover:text-red-700 gap-2 justify-center order-last sm:order-none mt-auto"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCancelSale(); }}
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

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3">
          <Button type="button" variant="outline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBack(); }} disabled={isSubmitting || isCancelling || isCompilingSignature} className="w-full sm:w-auto px-8 h-12 rounded-xl text-base">უკან</Button>
          <Button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFinish(); }}
            disabled={isSubmitDisabled}
            className="w-full sm:w-auto px-10 h-12 rounded-xl text-base font-bold shadow-lg shadow-primary/25 hover:-translate-y-0.5 transition-all"
          >
            {isSubmitting || isCompilingSignature ? (loadingMessage || "მონაცემები მოწმდება...") : "განაცხადის გაგზავნა"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export const Step4Finalize = memo(Step4FinalizeInner);
