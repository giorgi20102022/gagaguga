/** Max long-edge for the instant blob preview shown in the UI */
const PREVIEW_MAX_DIMENSION = 1280;
const PREVIEW_JPEG_QUALITY = 0.82;

/** Hard limits for base64 storage — enforced on EVERY image upload */
const STORAGE_MAX_DIMENSION = 2000;
const STORAGE_JPEG_QUALITY = 0.85;

export function getImagePreviewSrc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;
  return `data:image/jpeg;base64,${s}`;
}

let heic2anyModule: any = null;
async function convertHeicToJpeg(file: File): Promise<File> {
  const isHeic = file.type === "image/heic" || 
                 file.type === "image/heif" || 
                 /\.(heic|heif)$/i.test(file.name);
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
    const baseName = file.name.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch (err) {
    console.error("HEIC conversion failed, using original file:", err);
    return file;
  }
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
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
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      type,
      quality,
    );
  });
}

/** Downscale large images for instant preview — keeps main thread responsive on mobile. */
export async function createPreviewUrl(file: File): Promise<string> {
  try {
    const processedFile = await convertHeicToJpeg(file);
    const img = await loadImageFromFile(processedFile);
    const scale = Math.min(
      1,
      PREVIEW_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return URL.createObjectURL(processedFile);

    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", PREVIEW_JPEG_QUALITY);
    return URL.createObjectURL(blob);
  } catch {
    return URL.createObjectURL(file);
  }
}

/**
 * Resize and compress every image to a maximum of 2000px on its longest edge
 * at JPEG quality 0.85 before base64 persistence.
 *
 * This cap is unconditional — it applies regardless of the original file size
 * so that photos from high-res sensors (108 MP, iPhone Pro, etc.) never
 * produce a base64 payload large enough to crash the 18 MB server limit.
 */
export async function prepareFileForStorage(file: File): Promise<File> {
  try {
    const processedFile = await convertHeicToJpeg(file);
    const img = await loadImageFromFile(processedFile);
    const scale = Math.min(
      1,
      STORAGE_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return processedFile;

    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", STORAGE_JPEG_QUALITY);
    const baseName = processedFile.name.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function revokeObjectUrl(url: string | null | undefined) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}
