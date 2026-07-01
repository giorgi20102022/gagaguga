import { useState, useEffect, useRef } from "react";
import { type SubmissionInput } from "@shared/routes";
import { api } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fileToBase64, cn } from "@/lib/utils";
import { UploadCloud, CheckCircle2, ShieldAlert, ScanLine, Camera, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  data: Partial<SubmissionInput>;
  updateData: (data: Partial<SubmissionInput>) => void;
  onNext: () => void;
}

export function Step1Identity({ data, updateData, onNext }: Props) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(!!data.firstName);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  const [showFrontOptions, setShowFrontOptions] = useState(false);
  const [showBackOptions, setShowBackOptions] = useState(false);

  const frontCameraInputRef = useRef<HTMLInputElement>(null);
  const frontGalleryInputRef = useRef<HTMLInputElement>(null);
  const backCameraInputRef = useRef<HTMLInputElement>(null);
  const backGalleryInputRef = useRef<HTMLInputElement>(null);

  const handleFilePicked = async (field: "idFront" | "idBack", file: File) => {
    if (file) {
      const base64 = await fileToBase64(file);
      updateData({ [field]: base64 });
      setErrors(prev => ({ ...prev, [field]: false }));
      setError(null);
    }
  };

  const handleNativeFileChange = async (field: "idFront" | "idBack", e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleFilePicked(field, file);
    }
    try {
      e.target.value = "";
    } catch {}
    if (field === "idFront") {
      setShowFrontOptions(false);
    } else {
      setShowBackOptions(false);
    }
  };


  const handleContinue = async () => {
    if (isScanning) return;

    // Validate
    const newErrors: Record<string, boolean> = {};
    if (!data.idFront) newErrors.idFront = true;
    if (!data.idBack) newErrors.idBack = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Scroll to first error
      if (newErrors.idFront) {
        frontRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (newErrors.idBack) {
        backRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    // If we already have extracted identity fields, just proceed.
    if (scanComplete && data.firstName && data.lastName) {
      onNext();
      return;
    }

    if (!data.idFront || !data.idBack) {
      setError("გთხოვთ, ატვირთოთ პირადობის მოწმობის ორივე მხარე");
      return;
    }

    setError(null);
    setIsScanning(true);

    try {
      const res = await fetch("/api/vision/extract-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ frontImage: data.idFront, backImage: data.idBack }),
      });

      let dataRes: any = null;
      try {
        dataRes = await res.json();
      } catch (err) {
        // Fallback for non-JSON responses
      }

      if (!res.ok) {
        const msg = dataRes?.error || dataRes?.message || (await res.text().catch(() => ""));
        throw new Error(typeof msg === "string" && msg ? msg : "მონაცემების ამოკითხვა ვერ მოხერხდა");
      }

      console.log("Extraction Success:", dataRes);

      if (dataRes && dataRes.error) {
        setError(dataRes.error);
        return;
      }

      const extracted: Partial<SubmissionInput> = {
        firstName:
          typeof dataRes?.firstName === "string"
            ? dataRes.firstName
            : typeof dataRes?.name === "string"
            ? dataRes.name
            : undefined,
        lastName:
          typeof dataRes?.lastName === "string"
            ? dataRes.lastName
            : typeof dataRes?.surname === "string"
            ? dataRes.surname
            : undefined,
        // Crucial mapping: data.personalId -> idNumber
        idNumber: typeof dataRes?.personalId === "string" ? dataRes.personalId : undefined,
        gender: typeof dataRes?.gender === "string" ? dataRes.gender : undefined,
        expiryDate: typeof dataRes?.expiryDate === "string" ? dataRes.expiryDate : undefined,
      };

      if (!extracted.firstName || !extracted.lastName) {
        setError("მონაცემების ამოკითხვა ვერ მოხერხდა. გთხოვთ, ატვირთოთ უფრო მკაფიო ფოტოები");
        return;
      }

      updateData({
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        idNumber: extracted.idNumber,
        gender: extracted.gender,
        expiryDate: extracted.expiryDate,
      });

      setScanComplete(true);
      onNext(); // Only after successful response + mapping
    } catch (e) {
      const msg = e instanceof Error ? e.message : "მონაცემების ამოკითხვა ვერ მოხერხდა";
      setError(msg);
    } finally {
      setIsScanning(false);
    }
  };

  const canProceed = !!data.idFront && !!data.idBack && !isScanning;

  const getPreviewSrc = (v: unknown) => {
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    if (!s) return undefined;
    // If fileToBase64 returned a data URL, keep it; otherwise assume it's base64 and add a jpeg header.
    if (s.startsWith("data:")) return s;
    return `data:image/jpeg;base64,${s}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">პირადობის დადასტურება</h2>
        <p className="text-muted-foreground">ატვირთეთ მომხმარებლის პირადობის მოწმობის ორივე მხარე</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Upload Front */}
        <div className="relative group" ref={frontRef}>
          <Label className={cn("block mb-2 font-semibold", errors.idFront && "text-destructive")}>წინა მხარე</Label>
          {showFrontOptions ? (
            <div className="relative flex flex-col items-center justify-center w-full h-40 border-2 border-primary bg-primary/5 rounded-2xl p-4 gap-3">
              <input
                ref={frontCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleNativeFileChange("idFront", e)}
              />
              <input
                ref={frontGalleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleNativeFileChange("idFront", e)}
              />
              <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider">აირჩიეთ წყარო</p>
              <div className="flex gap-2 w-full">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    frontCameraInputRef.current?.click();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground h-11 px-4 rounded-xl text-sm font-medium hover:bg-primary/90 shadow-sm transition-all active:scale-[0.98]"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  კამერა
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    frontGalleryInputRef.current?.click();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-muted text-foreground border border-border h-11 px-4 rounded-xl text-sm font-medium hover:bg-muted/80 shadow-sm transition-all active:scale-[0.98]"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  გალერია
                </button>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowFrontOptions(false);
                }}
                className="text-xs text-muted-foreground hover:underline cursor-pointer"
              >
                გაუქმება
              </button>
            </div>
          ) : (
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (data.idFront) {
                  updateData({ idFront: undefined });
                } else {
                  setShowFrontOptions(true);
                }
              }}
              className={cn(
                "relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200",
                data.idFront ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50",
                errors.idFront && "border-destructive bg-destructive/5"
              )}
            >
              {data.idFront ? (
                <div className="w-full h-full relative overflow-hidden rounded-2xl z-0">
                  <img
                    src={getPreviewSrc(data.idFront)}
                    alt="ID Front"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-white" />
                      <p className="text-sm font-medium text-white">წინა მხარე აიტვირთა (შეცვლა)</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center pt-5 pb-6 z-0">
                  <UploadCloud className="w-10 h-10 text-muted-foreground mb-3 group-hover:text-primary transition-colors" />
                  <p className="text-sm font-medium text-foreground">დააჭირეთ წინა მხარის ასატვირთად</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Upload Back */}
        <div className="relative group" ref={backRef}>
          <Label className={cn("block mb-2 font-semibold", errors.idBack && "text-destructive")}>უკანა მხარე</Label>
          {showBackOptions ? (
            <div className="relative flex flex-col items-center justify-center w-full h-40 border-2 border-primary bg-primary/5 rounded-2xl p-4 gap-3">
              <input
                ref={backCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleNativeFileChange("idBack", e)}
              />
              <input
                ref={backGalleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleNativeFileChange("idBack", e)}
              />
              <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider">აირჩიეთ წყარო</p>
              <div className="flex gap-2 w-full">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    backCameraInputRef.current?.click();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground h-11 px-4 rounded-xl text-sm font-medium hover:bg-primary/90 shadow-sm transition-all active:scale-[0.98]"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  კამერა
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    backGalleryInputRef.current?.click();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-muted text-foreground border border-border h-11 px-4 rounded-xl text-sm font-medium hover:bg-muted/80 shadow-sm transition-all active:scale-[0.98]"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  გალერია
                </button>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowBackOptions(false);
                }}
                className="text-xs text-muted-foreground hover:underline cursor-pointer"
              >
                გაუქმება
              </button>
            </div>
          ) : (
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (data.idBack) {
                  updateData({ idBack: undefined });
                } else {
                  setShowBackOptions(true);
                }
              }}
              className={cn(
                "relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200",
                data.idBack ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50",
                errors.idBack && "border-destructive bg-destructive/5"
              )}
            >
              {data.idBack ? (
                <div className="w-full h-full relative overflow-hidden rounded-2xl z-0">
                  <img
                    src={getPreviewSrc(data.idBack)}
                    alt="ID Back"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-white" />
                      <p className="text-sm font-medium text-white">უკანა მხარე აიტვირთა (შეცვლა)</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center pt-5 pb-6 z-0">
                  <UploadCloud className="w-10 h-10 text-muted-foreground mb-3 group-hover:text-primary transition-colors" />
                  <p className="text-sm font-medium text-foreground">დააჭირეთ უკანა მხარის ასატვირთად</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {isScanning && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center gap-3"
          >
            <ScanLine className="w-5 h-5 text-primary" />
            <div>
              <h4 className="font-semibold text-foreground">მონაცემები მუშავდება...</h4>
              <p className="text-sm text-muted-foreground">
                მონაცემების ამოკითხვა მიმდინარეობს. გთხოვთ, დაელოდოთ.
              </p>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3"
          >
            <ShieldAlert className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <h4 className="font-semibold text-destructive">დადასტურება ვერ მოხერხდა</h4>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </motion.div>
        )}

        {scanComplete && !error && data.firstName && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-6 bg-muted/30 rounded-2xl border border-border"
          >
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">სახელი</Label>
              <Input readOnly value={data.firstName || ""} className="bg-background font-medium" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">გვარი</Label>
              <Input readOnly value={data.lastName || ""} className="bg-background font-medium" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">პირადი ნომერი</Label>
              <Input readOnly value={data.idNumber || ""} className="bg-background font-medium" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">სქესი</Label>
              <Input readOnly value={data.gender || ""} className="bg-background font-medium" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">ვადა</Label>
              <Input readOnly value={data.expiryDate || ""} className="bg-background font-medium" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-6 flex justify-end">
        <Button 
          onClick={handleContinue} 
          disabled={!canProceed}
          className="px-8 h-12 rounded-xl text-base shadow-md"
        >
          {isScanning ? "მონაცემები მუშავდება..." : "გაგრძელება"}
        </Button>
      </div>


    </motion.div>
  );
}



