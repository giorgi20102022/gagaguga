import { useState, useRef, useEffect, useCallback } from "react";
import {
  createPreviewUrl,
  getImagePreviewSrc,
  prepareFileForStorage,
  revokeObjectUrl,
} from "@/lib/imageUpload";
import { fileToBase64 } from "@/lib/utils";

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
    if (!file) return;

    onFileReadyRef.current?.(file);

    try {
      const instantUrl = await createPreviewUrl(file);
      revokeObjectUrl(objectUrlRef.current);
      objectUrlRef.current = instantUrl.startsWith("blob:") ? instantUrl : null;
      setPreviewUrl(instantUrl);
    } catch {
      onErrorRef.current?.("ფაილის გადახედვა ვერ მოხერხდა");
      return;
    }

    setIsPersisting(true);
    void (async () => {
      try {
        const prepared = await prepareFileForStorage(file);
        const base64 = await fileToBase64(prepared);
        onPersistRef.current(base64);
      } catch {
        onErrorRef.current?.("ფაილის ატვირთვა ვერ მოხერხდა. სცადეთ თავიდან.");
      } finally {
        setIsPersisting(false);
      }
    })();
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
