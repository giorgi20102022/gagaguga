import { useMutation } from "@tanstack/react-query";
import { type SubmissionInput } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";

export const N8N_WEBHOOK_URL = "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f";

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

export async function submitToN8N(data: SubmissionInput) {
  const fd = new FormData();

  // Text fields
  const rawGender = String(data.gender ?? "").trim().toLowerCase();
  const isFemale = rawGender === "f" || rawGender.startsWith("f ") || rawGender.includes("ქალ") || rawGender.includes("female") || rawGender.includes("მდედრობითი");
  const isMale = rawGender === "m" || rawGender.startsWith("m ") || rawGender.includes("კაც") || rawGender.includes("male") || rawGender.includes("მამრობითი");

  const textFields: Record<string, string | number | boolean | undefined> = {
    firstName: data.firstName,
    lastName: data.lastName,
    idNumber: data.idNumber,
    gender: data.gender,
    famale: Boolean(isFemale && !isMale),
    male: Boolean(isMale && !isFemale),
    expiryDate: data.expiryDate,
    phone: data.phone,
    legalAddress: data.legalAddress,
    region: data.region,
    municipality: data.municipality,
    city: data.city,
    cityDistrict: (data as any).cityDistrict,
    addressVillage: (data as any).addressVillage,
    sociallyVulnerable: data.sociallyVulnerable,
    nomadic: data.nomadic,
    pensioner: data.pensioner,
    supplierName: data.supplierName,
    supplierId: data.supplierId,
    model: data.model,
    price: data.price,
    subsidyRate: data.subsidyRate,
    subsidyAmount: data.subsidyAmount,
    deliveryFee: data.deliveryFee,
    ironPlus: data.ironPlus,
    ironPlusFee: data.ironPlusFee,
    finalPayable: data.finalPayable,
    installationAddress: data.installationAddress,
    digitalConsent: data.digitalConsent,
  };
  for (const [key, val] of Object.entries(textFields)) {
    if (val !== undefined && val !== null && val !== "") fd.append(key, String(val));
  }

  // Binary images
  appendImageIfPresent(fd, "idFront", data.idFront, "id_front.jpg");
  appendImageIfPresent(fd, "idBack", data.idBack, "id_back.jpg");
  appendImageIfPresent(fd, "socialExtract", data.socialExtract, "social_extract.jpg");
  appendImageIfPresent(fd, "pensionerCertificate", data.pensionerCertificate, "pensioner_cert.jpg");
  appendImageIfPresent(fd, "receiptPhoto", data.receiptPhoto, "receipt.jpg");

  const signatureText = makeSignatureText(data.firstName, data.lastName);
  if (signatureText) {
    fd.append("signatureText", signatureText);
    const signaturePng = await renderSignaturePngDataUrl(signatureText);
    appendImageIfPresent(fd, "signature", signaturePng, "signature.png");
  }

  const res = await axios.post(N8N_WEBHOOK_URL, fd, {
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return res.data;
}

export async function cancelSubmission(id: string) {
  const fd = new FormData();
  fd.append("action", "cancel");
  fd.append("id", id);
  return await axios.post(N8N_WEBHOOK_URL, fd);
}

export function useSubmission() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: submitToN8N,
    onError: (error: Error) => {
      toast({
        title: "გაგზავნის შეცდომა",
        description: error.message || "განაცხადის გაგზავნა ვერ ვერ მოხერხდა",
        variant: "destructive",
      });
    },
  });
}
