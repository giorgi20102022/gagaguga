import { useState, useRef, useEffect, useCallback } from "react";
import {
  createPreviewUrl,
  getImagePreviewSrc,
  prepareFileForStorage,
  revokeObjectUrl,
} from "@/lib/imageUpload";
import { fileToBase64 } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface UseMediaUploadOptions {
  /** Persisted base64 value from parent formData */
  storedValue?: string;
  /** Called when base64 is ready — must not block preview */
  onPersist: (base64: string) => void;
  /** Optional — raw file for downstream verification APIs */
  onFileReady?: (file: File) => void;
  onError?: (message: string) => void;
}

export function useMediaUpload({ storedValue, onPersist, onFileReady, onError }: UseMediaUploadOptions) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const onPersistRef = useRef(onPersist);
  const onFileReadyRef = useRef(onFileReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onPersistRef.current = onPersist;
  }, [onPersist]);

  useEffect(() => {
    onFileReadyRef.current = onFileReady;
  }, [onFileReady]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Rehydrate preview from stored base64 after tab reload
  useEffect(() => {
    if (!storedValue) return;
    const src = getImagePreviewSrc(storedValue);
    if (!src || src.startsWith("blob:")) return;
    setPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) return prev;
      return src;
    });
  }, [storedValue]);

  useEffect(() => {
    return () => revokeObjectUrl(objectUrlRef.current);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!file || !(file instanceof Blob)) {
      const msg = "ფოტოს წაკითხვა ვერ მოხერხდა, სცადეთ თავიდან";
      console.warn("Invalid file object provided to handleFile:", file);
      onErrorRef.current?.(msg);
      toast({ title: "შეცდომა", description: msg, variant: "destructive" });
      return;
    }

    try {
      onFileReadyRef.current?.(file);
    } catch (e) {
      console.error("onFileReady callback error:", e);
    }

    setIsPersisting(true);

    try {
      // 1. Create preview URL safely
      let instantUrl: string | null = null;
      try {
        instantUrl = await createPreviewUrl(file);
      } catch (err) {
        console.warn("createPreviewUrl failed:", err);
      }

      if (instantUrl) {
        revokeObjectUrl(objectUrlRef.current);
        objectUrlRef.current = instantUrl.startsWith("blob:") ? instantUrl : null;
        setPreviewUrl(instantUrl);
      }

      // 2. Prepare file & convert to base64 safely
      const prepared = await prepareFileForStorage(file);
      const base64 = await fileToBase64(prepared);

      if (!base64) {
        throw new Error("Base64 conversion produced empty string");
      }

      onPersistRef.current(base64);
    } catch (err) {
      console.error("File processing error in handleFile:", err);
      const msg = "ფოტოს წაკითხვა ვერ მოხერხდა, სცადეთ თავიდან";
      onErrorRef.current?.(msg);
      toast({ title: "შეცდომა", description: msg, variant: "destructive" });
    } finally {
      setIsPersisting(false);
    }
  }, []);

  const clearPreview = useCallback(() => {
    revokeObjectUrl(objectUrlRef.current);
    objectUrlRef.current = null;
    setPreviewUrl(null);
    onPersistRef.current("");
  }, []);

  const hasPreview = Boolean(previewUrl || storedValue);

  return {
    previewUrl: previewUrl ?? getImagePreviewSrc(storedValue) ?? null,
    isPersisting,
    hasPreview,
    handleFile,
    clearPreview,
  };
}
