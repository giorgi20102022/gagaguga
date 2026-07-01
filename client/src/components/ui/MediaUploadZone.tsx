import React, { memo, useState, useRef, useId, useEffect, useCallback } from "react";
import { useMediaUpload } from "@/hooks/use-media-upload";
import { cn } from "@/lib/utils";
import { Camera, Image as ImageIcon, X, UploadCloud } from "lucide-react";

export type MediaUploadVariant = "card" | "receipt" | "id" | "compact" | "row" | "portrait";

export interface MediaUploadZoneProps {
  label: string;
  pickerTitle: string;
  storedValue?: string;
  onPersist: (base64: string) => void;
  onFileReady?: (file: File) => void;
  onError?: (message: string) => void;
  hasError?: boolean;
  disabled?: boolean;
  variant?: MediaUploadVariant;
  emptyHint?: string;
  uploadedHint?: string;
  className?: string;
  /** External OCR/processing overlay (e.g. n8n webhook in flight) */
  ocrLoading?: boolean;
  ocrLoadingMessage?: string;
  /** Stable id prefix for native file inputs (receipt variant) */
  inputId?: string;
  /** Unique field key — forces React to fully remount this component when it changes */
  fieldKey?: string;
  onClear?: () => void;
}

function MediaUploadZoneInner({
  label,
  pickerTitle,
  storedValue,
  onPersist,
  onFileReady,
  onError,
  hasError = false,
  disabled = false,
  variant = "card",
  emptyHint,
  uploadedHint,
  className,
  ocrLoading = false,
  ocrLoadingMessage = "მიმდინარეობს მონაცემების ამოკითხვა...",
  inputId,
  onClear,
}: MediaUploadZoneProps): React.ReactElement {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  // Store the live stream in state so a re-render fires once it is ready
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const baseInputId = inputId ?? `upload-${autoId}`;
  const [forceFreshForm, setForceFreshForm] = useState(true);
  const { previewUrl, isPersisting, hasPreview, handleFile, clearPreview } = useMediaUpload({
    storedValue: forceFreshForm ? undefined : storedValue,
    onPersist,
    onFileReady,
    onError,
  });
  const isBusy = isPersisting || ocrLoading;


  // Rehydrate preview from persisted data after first render
  useEffect(() => {
    setForceFreshForm(false);
  }, []);

  const activeStreamRef = useRef<MediaStream | null>(null);

  const cleanUpStream = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
      activeStreamRef.current = null;
    }
    setCameraStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Clean up camera stream when the component unmounts
  useEffect(() => {
    return () => {
      cleanUpStream();
    };
  }, [cleanUpStream]);

  // Handle camera stream acquisition
  useEffect(() => {
    let isCancelled = false;

    if (isCameraOpen) {
      cleanUpStream();
      setTimeout(() => {
        if (isCancelled) return;
        navigator.mediaDevices
          .getUserMedia({
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          })
          .then((s) => {
            if (isCancelled) {
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            activeStreamRef.current = s;
            setCameraStream(s); // triggers re-render → video element gets wired below
            if (s.getVideoTracks().length === 0) {
              console.warn("No video tracks found on this device.");
            }
          })
          .catch((err) => {
            if (isCancelled) return;
            console.error("CAMERA_ERROR_LOG:", err.name, err.message);
            if (err.name === "NotAllowedError") {
              alert("გთხოვთ ჩართოთ კამერის ნებართვა ბრაუზერის პარამეტრებიდან");
            } else if (window.isSecureContext === false) {
              alert("კამერა ბლოკავს არასაიმედო (HTTP) კავშირს. გთხოვთ გადახვიდეთ HTTPS-ზე!");
            } else {
              alert(`კამერის შეცდომა: ${err.name}. შეამოწმეთ ბრაუზერის ნებართვები.`);
            }
            setIsCameraOpen(false);
          });
      }, 150);
    }

    return () => {
      isCancelled = true;
    };
  }, [isCameraOpen, cleanUpStream]);

  // Wire the stream to the <video> element whenever either becomes available
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraStream) return;

    // Force inline playback and muting at the DOM level for iOS/Safari/WebViews
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("muted", "true");
    video.setAttribute("autoplay", "true");
    
    // Explicitly set properties on the HTMLVideoElement object
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;

    video.srcObject = cameraStream;

    // Trigger play immediately and also on loaded metadata
    const startPlayback = () => {
      video.play().catch((err) => {
        console.error("Failed to play video stream:", err);
      });
    };

    video.onloadedmetadata = () => {
      startPlayback();
    };

    // Trigger play immediately (helps if metadata is already loaded or loadedmetadata event fires before listener is bound)
    startPlayback();

    // Workaround for iOS WebKit GPU Layer rendering bug:
    // Periodically tweak the opacity slightly to force WebKit to repaint the canvas/layer
    let tick = 0;
    const repaintInterval = setInterval(() => {
      if (videoRef.current) {
        videoRef.current.style.opacity = tick % 2 === 0 ? "0.999" : "1.0";
        tick++;
      }
    }, 50);

    return () => {
      clearInterval(repaintInterval);
      if (video) {
        video.onloadedmetadata = null;
      }
    };
  }, [cameraStream, isCameraOpen]); // isCameraOpen included so effect re-runs after overlay mounts

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    
    let width = video.videoWidth;
    let height = video.videoHeight;
    const maxDim = 2000;
    
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
      handleFile(file);
      cleanUpStream();
      setIsCameraOpen(false);
    }, "image/jpeg", 0.85);
  }, [handleFile, cleanUpStream]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    // reset so the same file can be reselected
    e.target.value = "";
  }, [handleFile]);

  const cameraOverlay = isCameraOpen ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 sm:p-8">
      <div 
        className={cn(
          "relative w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden bg-black shadow-2xl flex flex-col items-center justify-center aspect-[3/4]", 
          className
        )}
        style={{
          WebkitTransform: 'translate3d(0,0,0)',
          transform: 'translate3d(0,0,0)',
          isolation: 'isolate' // ensures video rendering doesn't get merged or hidden under background layers
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          {...{ "webkit-playsinline": "true" }}
          muted
          controls={false}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover',
            WebkitTransform: 'translate3d(0,0,0)',
            transform: 'translate3d(0,0,0)',
            willChange: 'transform'
          }}
        />
        
        {/* Safe Area controls overlay */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-center items-center z-10 px-6">
          <button
            type="button"
            onClick={capturePhoto}
            className="w-16 h-16 rounded-full bg-white/20 p-1 backdrop-blur-sm shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
          >
            <div className="w-full h-full rounded-full bg-white border-2 border-transparent flex items-center justify-center">
               <span className="w-11 h-11 rounded-full bg-primary block shadow-inner" />
            </div>
          </button>
          <button
            type="button"
            onClick={() => { cleanUpStream(); setIsCameraOpen(false); }}
            className="absolute right-6 w-12 h-12 rounded-full bg-black/40 text-white border border-white/20 flex items-center justify-center hover:bg-black/60 transition-colors backdrop-blur-md"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const previewSrc = previewUrl ?? (storedValue && storedValue.startsWith("data:") ? storedValue : null);

  return (
    <>
      {cameraOverlay}
      <div className={cn("relative w-full", className)}>
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        id={`${baseInputId}-camera`}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
        disabled={disabled || isBusy}
      />
      <input
        ref={galleryInputRef}
        id={`${baseInputId}-gallery`}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
        disabled={disabled || isBusy}
      />

      <div
        className={cn(
          "relative w-full rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden",
          hasError
            ? "border-destructive bg-destructive/5"
            : hasPreview
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-muted/20",
          disabled && "opacity-50 pointer-events-none",
          variant === "compact" || variant === "row" ? "min-h-[120px]" : "min-h-[200px]"
        )}
      >
        {isBusy && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm gap-3">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground text-center px-4">
              {ocrLoading ? ocrLoadingMessage : "ფაილი მუშავდება..."}
            </p>
          </div>
        )}

        {previewSrc ? (
          <div
            className="relative w-full h-full flex flex-col cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              clearPreview();
              onClear?.();
            }}
          >
            <div className={cn(
               "relative w-full overflow-hidden bg-black/5 flex items-center justify-center",
               variant === "compact" || variant === "row" ? "aspect-video" : "aspect-[4/3]"
            )}>
              <img
                src={previewSrc}
                alt={label}
                className="w-full h-full object-contain"
              />
            </div>
            {uploadedHint && (
              <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md text-white text-xs px-2.5 py-1.5 rounded-lg border border-white/10 shadow-sm flex items-center gap-1.5">
                 <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                 {uploadedHint}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4 gap-4 text-center h-full min-h-[200px]">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
              <Camera className="w-7 h-7" />
            </div>
            <div className="space-y-1 max-w-[250px]">
              <p className="font-semibold text-base text-foreground leading-tight">{pickerTitle}</p>
              {emptyHint && <p className="text-xs text-muted-foreground leading-relaxed">{emptyHint}</p>}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2 w-full max-w-[320px]">
              <button
                type="button"
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 py-2.5 px-4 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2 min-w-[120px]"
                onClick={() => setIsCameraOpen(true)}
              >
                <Camera className="w-5 h-5" /> გადაღება
              </button>
              <button
                type="button"
                className="flex-1 bg-background text-foreground border-2 border-border hover:bg-muted py-2.5 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 min-w-[120px]"
                onClick={() => galleryInputRef.current?.click()}
              >
                <UploadCloud className="w-5 h-5" /> ატვირთვა
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export const MediaUploadZone = memo(MediaUploadZoneInner);
