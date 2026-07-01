import { useMutation } from "@tanstack/react-query";
import { type SubmissionInput } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";
import { registerDealerPersonalIdOnPortal } from "@/lib/dealerPersonalId";

// Duplicate N8N_WEBHOOK_URL removed; using exported constant later

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

export const N8N_WEBHOOK_URL = "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f";

export async function submitToN8N(payload: any): Promise<any> {
  try {
    const res = await axios.post(N8N_WEBHOOK_URL, payload);
    return res.data;
  } catch (err) {
    console.error("[submitToN8N] Error:", err);
    throw err;
  }
}

export async function cancelSubmission(params: { ovenCode?: string; dealerName?: string; }): Promise<any> {
  const payload = {
    action: "cancel",
    code: params.ovenCode || "",
    dealer_name: params.dealerName || "",
    branch_name: params.dealerName || "",
  } as any;
  return await submitToN8N(payload);
}

export function useSubmission() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: SubmissionInput) => {
      await registerDealerPersonalIdOnPortal(data);

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
      const signatureText = makeSignatureText(data.firstName, data.lastName);
      let signatureBase64 = data.signature || "";

      if ((data as any).signatureFile) {
        signatureBase64 = await fileToBase64((data as any).signatureFile);
      } else if (!signatureBase64 && signatureText) {
        signatureBase64 = await renderSignaturePngDataUrl(signatureText);
      }

      // Get active dealer details dynamically
      let dealerName = "";
      let identificationCode = "";
      let dealerEmail = "";
      try {
        const dealerRes = await axios.get("/api/dealer/me");
        if (dealerRes.data) {
          const dName = dealerRes.data.name || "";
          dealerName = dName === "Gorgia" ? "გორგია" : dName;
          identificationCode = dealerRes.data.identificationCode || "";
          dealerEmail = dealerRes.data.email || "";
        }
      } catch (e) {
        console.warn("Failed to fetch active dealer profile in useSubmission:", e);
      }

      if (!dealerEmail) {
        toast({
          title: "ავტორიზაციის შეცდომა",
          description: "დილერის ელ-ფოსტა ვერ მოიძებნა. გთხოვთ გაიაროთ ავტორიზაცია თავიდან.",
          variant: "destructive",
        });
        throw new Error("Dealer email is missing");
      }

      const supplierProfile = dealerName
        ? ((identificationCode.includes("ს/კ") || identificationCode.includes("შპს"))
          ? identificationCode
          : `შპს "${dealerName}" ს/კ ${identificationCode}`)
        : undefined;

      // Build JSON payload conforming to submissionSchema
      const payload = {
        documentType: data.documentType || "id_card",
        idFront: data.idFront,
        idBack: data.idBack,
        passportPhoto: data.passportPhoto,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        idNumber: data.idNumber || "",
        gender: data.gender || "",
        expiryDate: data.expiryDate || "",
        phone: data.phone || "",
        legalAddress: data.legalAddress || "",
        region: data.region || "",
        municipality: data.municipality || "",
        city: data.city || "",
        cityDistrict: (data as any).cityDistrict || "",
        addressVillage: (data as any).addressVillage || "",
        sociallyVulnerable: Boolean(data.sociallyVulnerable),
        socialExtract: data.socialExtract,
        nomadic: Boolean(data.nomadic),
        pensioner: Boolean(data.pensioner),
        pensionerCertificate: data.pensionerCertificate,
        supplierName: data.supplierName || "",
        supplierId: data.supplierId || "",
        supplierProfile,
        model: data.model || "",
        price: Number(data.price || 0),
        subsidyRate: Number(data.subsidyRate || 0),
        subsidyAmount: Number(data.subsidyAmount || 0),
        deliveryFee: Number(data.deliveryFee || 0),
        ironPlus: Boolean(data.ironPlus),
        ironPlusFee: Number(data.ironPlusFee || 0),
        finalPayable: Number(data.finalPayable || 0),
        installationAddress: data.installationAddress || "",
        receiptPhoto: data.receiptPhoto || "",
        signature: signatureBase64,
        digitalConsent: data.digitalConsent !== false,
        dealerEmail,

        // Extra parameters
        branch_email: data.branch_email,
        whatsapp_number: data.whatsapp_number,
        send_to_rda: data.send_to_rda,
        ovenCode: data.ovenCode,
        dealerPersonalId: data.dealerPersonalId,
        dealerPersonalIdVerified: data.dealerPersonalIdVerified,
        dealerPersonalIdLookupMessage: data.dealerPersonalIdLookupMessage,
        ovenVerified: data.ovenVerified,
        ovenVerificationMessage: data.ovenVerificationMessage,
        ovenCodeRow: data.ovenCodeRow,
        verifiedProductName: data.verifiedProductName,
        smsVerified: data.smsVerified,
        receiptVerified: data.receiptVerified,
        receiptVerificationMessage: data.receiptVerificationMessage,
      };

      const res = await axios.post("/api/submission/submit", payload, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      return res.data;
    },
    onSuccess: () => {
      toast({
        title: "განაცხადი გაიგზავნა",
        description: "დილერის განაცხადი წარმატებით დამუშავდა.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "გაგზავნის შეცდომა",
        description: error.message || "განაცხადის გაგზავნა ვერ მოხერხდა",
        variant: "destructive",
      });
    }
  });
}
