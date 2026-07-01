import { prepareFileForStorage } from "@/lib/imageUpload";

export const PASSPORT_N8N_WEBHOOK_URL =
  "https://n8n.srv1020074.hstgr.cloud/webhook/pasporti";

const OCR_TIMEOUT_MS = 120_000;

export type PassportExtractedData = {
  firstName?: string;
  lastName?: string;
  idNumber?: string;
  gender?: string;
  expiryDate?: string;
};

function unwrapN8nRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") return null;

  let current: unknown = raw;
  if (Array.isArray(current)) {
    current = current[0];
  }
  if (!current || typeof current !== "object") return null;

  const record = current as Record<string, unknown>;
  if (record.success === false) return null;

  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }

  return record;
}

export function mapPassportExtracted(raw: unknown): PassportExtractedData | null {
  const extracted = unwrapN8nRecord(raw);
  if (!extracted) return null;

  const firstName =
    typeof extracted.firstName === "string"
      ? extracted.firstName
      : typeof extracted.name === "string"
        ? extracted.name
        : undefined;

  const lastName =
    typeof extracted.lastName === "string"
      ? extracted.lastName
      : typeof extracted.surname === "string"
        ? extracted.surname
        : undefined;

  const idNumber =
    typeof extracted.personalId === "string"
      ? extracted.personalId
      : typeof extracted.idNumber === "string"
        ? extracted.idNumber
        : undefined;

  const gender = typeof extracted.gender === "string" ? extracted.gender : undefined;
  const expiryDate =
    typeof extracted.expiryDate === "string"
      ? extracted.expiryDate
      : typeof extracted.expiry_date === "string"
        ? extracted.expiry_date
        : undefined;

  if (!firstName && !lastName && !idNumber) return null;

  return { firstName, lastName, idNumber, gender, expiryDate };
}

async function postPassportFormData(formData: FormData, signal: AbortSignal): Promise<unknown> {
  try {
    const directRes = await fetch(PASSPORT_N8N_WEBHOOK_URL, {
      method: "POST",
      body: formData,
      signal,
    });

    if (!directRes.ok) {
      const errText = await directRes.text().catch(() => "");
      throw new Error(errText || `n8n OCR failed (${directRes.status})`);
    }

    return directRes.json();
  } catch (directError) {
    console.warn("[Passport OCR] Direct n8n webhook failed, using server proxy:", directError);

    const proxyForm = new FormData();
    const file = formData.get("data") ?? formData.get("file");
    if (!(file instanceof File)) {
      throw directError instanceof Error
        ? directError
        : new Error("Passport file missing for OCR proxy");
    }
    proxyForm.append("data", file, file.name || "passport.jpg");

    const proxyRes = await fetch("/api/vision/extract-passport-file", {
      method: "POST",
      body: proxyForm,
      credentials: "include",
      signal,
    });

    if (!proxyRes.ok) {
      let message = `OCR proxy failed (${proxyRes.status})`;
      try {
        const errJson = await proxyRes.json();
        message = errJson.message || errJson.error || message;
      } catch {
        const errText = await proxyRes.text().catch(() => "");
        if (errText) message = errText;
      }
      throw new Error(message);
    }

    return proxyRes.json();
  }
}

/** Sends passport image to n8n OCR immediately after capture. Non-blocking for UI thread. */
export async function extractPassportOcr(
  file: File,
  signal?: AbortSignal,
): Promise<PassportExtractedData> {
  const prepared = await prepareFileForStorage(file);
  const formData = new FormData();
  formData.append("data", prepared, prepared.name || "passport.jpg");
  formData.append("file", prepared, prepared.name || "passport.jpg");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const raw = await postPassportFormData(formData, controller.signal);
    const mapped = mapPassportExtracted(raw);
    if (!mapped?.firstName || !mapped?.lastName) {
      throw new Error("მონაცემების ამოკითხვა ვერ მოხერხდა. გთხოვთ, ატვირთოთ უფრო მკაფიო ფოტო");
    }
    return mapped;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("მონაცემების ამოკითხვას დრო გაუვიდა");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
