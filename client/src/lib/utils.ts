import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function isValidBlob(file: any): boolean {
  return Boolean(
    file &&
    typeof file === "object" &&
    typeof file.size === "number" &&
    typeof file.slice === "function"
  );
}

export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!isValidBlob(file)) {
      reject(new Error("Invalid file object passed to fileToBase64"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader result is not a string"));
      }
    };
    reader.onerror = (error) => reject(error || new Error("FileReader error"));
    try {
      reader.readAsDataURL(file);
    } catch (err) {
      reject(err);
    }
  });
