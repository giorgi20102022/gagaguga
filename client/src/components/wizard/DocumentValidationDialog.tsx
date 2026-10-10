import { useRef } from "react";
import { ShieldAlert } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export function DocumentValidationDialog({ message, onDismiss }: {
  message: string | null;
  onDismiss: () => void;
}) {
  const acknowledgeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  return (
    <AlertDialog open={Boolean(message)}>
      <AlertDialogContent
        overlayClassName="bg-black/60 backdrop-blur-sm z-[100]"
        className="z-[101] w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl p-6 sm:p-8"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          previousFocusRef.current = document.activeElement as HTMLElement | null;
          acknowledgeRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          previousFocusRef.current?.focus();
        }}
      >
        <ShieldAlert aria-hidden="true" className="mx-auto h-10 w-10 text-destructive" />
        <AlertDialogTitle className="min-w-0 text-center text-xl sm:text-2xl leading-relaxed text-destructive whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message}
        </AlertDialogTitle>
        <AlertDialogDescription className="sr-only">
          შეტყობინების დახურვის შემდეგ შეგიძლიათ დოკუმენტის ხელახლა ატვირთვა.
        </AlertDialogDescription>
        <AlertDialogAction ref={acknowledgeRef} type="button" onClick={onDismiss} className="mt-2 h-12 w-full rounded-xl text-base">
          გასაგებია
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );
}
