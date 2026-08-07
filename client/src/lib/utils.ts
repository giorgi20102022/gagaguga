import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file || !(file instanceof Blob)) {
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
