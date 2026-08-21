/** Max long-edge for the instant blob preview shown in the UI */
const PREVIEW_MAX_DIMENSION = 1024;
const PREVIEW_JPEG_QUALITY = 0.70;

/** Hard limits for base64 storage — enforced on EVERY image upload (safely capped for mobile Chrome/WebKit) */
const STORAGE_MAX_DIMENSION = 1024;
const STORAGE_JPEG_QUALITY = 0.70;

export function getImagePreviewSrc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;
  return `data:image/jpeg;base64,${s}`;
}

function isValidBlob(file: any): boolean {
  return Boolean(
    file &&
    typeof file === "object" &&
    typeof file.size === "number" &&
    typeof file.slice === "function"
  );
}

let heic2anyModule: any = null;
async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isValidBlob(file)) return file;
  const isHeic = file.type === "image/heic" || 
                 file.type === "image/heif" || 
                 /\.(heic|heif)$/i.test(file.name || "");
  if (!isHeic) return file;

  try {
    if (!heic2anyModule) {
      const module = await import("heic2any");
      heic2anyModule = module.default || module;
    }
    const result = await heic2anyModule({
      blob: file,
      toType: "image/jpeg",
      quality: STORAGE_JPEG_QUALITY
    });
    const blob = Array.isArray(result) ? result[0] : result;
    const baseName = file.name ? file.name.replace(/\.[^.]+$/, "") : "upload";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch (err) {
    console.error("HEIC conversion failed, using original file:", err);
    return file;
  }
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let url = "";
    try {
      url = URL.createObjectURL(file);
    } catch (err) {
      reject(err);
      return;
    }

    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e || new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
        type,
        quality,
      );
    } catch (err) {
      reject(err);
    }
  });
}

/** Downscale large images for instant preview — keeps main thread responsive on mobile. */
export async function createPreviewUrl(file: File): Promise<string> {
  try {
    const processedFile = await convertHeicToJpeg(file);
    const img = await loadImageFromFile(processedFile);
    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;
    const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      try {
        return URL.createObjectURL(processedFile);
      } catch {
        return "";
      }
    }

    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", PREVIEW_JPEG_QUALITY);
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn("createPreviewUrl fallback due to error:", err);
    try {
      return URL.createObjectURL(file);
    } catch {
      return "";
    }
  }
}

/**
 * Resize and compress every image to a maximum of 1600px on its longest edge
 * at JPEG quality 0.75 before base64 persistence.
 */
export async function prepareFileForStorage(file: File): Promise<File> {
  try {
    const processedFile = await convertHeicToJpeg(file);
    const img = await loadImageFromFile(processedFile);
    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;
    const scale = Math.min(1, STORAGE_MAX_DIMENSION / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return processedFile;

    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", STORAGE_JPEG_QUALITY);
    const baseName = processedFile.name ? processedFile.name.replace(/\.[^.]+$/, "") : "upload";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch (err) {
    console.warn("prepareFileForStorage failed, returning original file:", err);
    return file;
  }
}

export function revokeObjectUrl(url: string | null | undefined) {
  if (url?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore revoke error
    }
  }
}

/**
 * Downscale and compress a base64 data URL to a maximum dimension (default 1200px)
 * and JPEG quality (default 0.65) to keep payloads lean and fast.
 */
export async function compressBase64Image(
  base64?: string,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.65
): Promise<string> {
  if (!base64 || typeof base64 !== "string") return "";
  const trimmed = base64.trim();
  if (!trimmed || !trimmed.startsWith("data:image")) return trimmed;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        resolve(trimmed);
        return;
      }

      const scale = Math.min(1, maxWidth / Math.max(w, h));
      const targetW = Math.max(1, Math.round(w * scale));
      const targetH = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(trimmed);
        return;
      }

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      try {
        const compressed = canvas.toDataURL("image/jpeg", quality);
        resolve(compressed);
      } catch {
        resolve(trimmed);
      }
    };
    img.onerror = () => resolve(trimmed);
    img.src = trimmed;
  });
}
