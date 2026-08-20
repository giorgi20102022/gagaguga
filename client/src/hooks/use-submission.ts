import { useMutation } from "@tanstack/react-query";
import { type SubmissionInput } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";
import { registerDealerPersonalIdOnPortal } from "@/lib/dealerPersonalId";

// Duplicate N8N_WEBHOOK_URL removed; using exported constant later



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

export const N8N_WEBHOOK_URL = "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f";

export async function submitToN8N(payload: any): Promise<any> {
  try {
    const res = await axios.post(N8N_WEBHOOK_URL, payload);
    return res.data;
  } catch (err) {
    console.error("[submitToN8N] Error:", err);
    throw err;
  }
}

export async function cancelSubmission(params: { ovenCode?: string; dealerName?: string; }): Promise<any> {
  const payload = {
    action: "cancel",
    code: params.ovenCode || "",
    dealer_name: params.dealerName || "",
    branch_name: params.dealerName || "",
  } as any;
  return await submitToN8N(payload);
}

/**
 * iOS Safari-safe submission using native fetch() with keepalive:true.
 *
 * WHY fetch() instead of axios:
 *   - axios uses XHR internally on iOS WebKit which throws "Network Error"
 *     (NSURLErrorNetworkConnectionLost) when uploading large bodies.
 *   - Native fetch() is more reliable on iOS Safari for JSON POST requests.
 *
 * WHY keepalive is NOT used:
 *   - iOS Safari enforces a hard 64KB body size limit on keepalive requests.
 *   - Our payload (receiptPhoto + signature base64) is 200–400KB, so
 *     keepalive would cause an instant silent block before the request leaves.
 *   - Instead, the UI button is disabled (isSubmitting=true) during upload
 *     which prevents the user from navigating away mid-request.
 *
 * WHY we strip idFront/idBack/passportPhoto:
 *   - These images were already sent to n8n in Step 1 for OCR verification.
 *   - Removing them reduces the body from 2–5 MB to ~200–400 KB.
 *   - receiptPhoto and signature are kept because n8n needs them here.
 */
async function submitWithFetch(url: string, payload: object): Promise<any> {
  const bodyStr = JSON.stringify(payload);
  const sizeKb = Math.round(new Blob([bodyStr]).size / 1024);
  console.log(`[useSubmission] Payload size: ${sizeKb} KB — sending via fetch(keepalive)`);

  const controller = new AbortController();
  // 2-minute hard timeout — mirrors server timeout
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      credentials: "include",
      // NOTE: keepalive is intentionally NOT set here.
      // iOS Safari enforces a hard 64KB body limit for keepalive requests.
      // Our payload (receiptPhoto + signature) is 200–400KB so keepalive
      // would instantly block the request before it leaves the device.
      // The UI loading state (isSubmitting → button disabled) prevents the
      // user from navigating away, making keepalive unnecessary.
      body: bodyStr,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      let errData: any;
      try { errData = await response.json(); } catch { errData = await response.text(); }
      const msg = typeof errData === "string"
        ? errData
        : (errData?.message || errData?.error || errData?.field
          ? `${errData.field ? errData.field + ": " : ""}${errData.message || errData.error}`
          : `HTTP ${response.status}`);
      const e = new Error(msg);
      (e as any).status = response.status;
      throw e;
    }

    return await response.json();
  } catch (err: any) {
    clearTimeout(timer);
    console.error("[useSubmission] fetch() error:", {
      name: err?.name,
      message: err?.message,
      status: (err as any)?.status,
    });
    throw err;
  }
}

export function useSubmission() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: SubmissionInput) => {
      await registerDealerPersonalIdOnPortal(data);

      // Signature must already be pre-generated into data.signature by Step4Finalize
      // BEFORE the user taps submit. Running canvas work here violates iOS Safari Rule 2
      // (heavy main-thread blocking during a Touch event kills the network request on WebKit).
      let signatureBase64 = data.signature || "";
      if (!signatureBase64) {
        console.warn(
          "[useSubmission] data.signature is empty — signature was not pre-generated by " +
          "SignaturePreview before submit. Proceeding without signature image."
        );
      }

      // Get active dealer details dynamically
      let dealerName = "";
      let identificationCode = "";
      let dealerEmail = "";
      let dealerKey = "";
      try {
        const dealerRes = await axios.get("/api/dealer/me");
        if (dealerRes.data) {
          const dName = dealerRes.data.name || "";
          dealerName = dName === "Gorgia" ? "გორგია" : dName;
          identificationCode = dealerRes.data.identificationCode || "";
          dealerEmail = dealerRes.data.email || "";
          dealerKey = dealerRes.data.key || "";
        }
      } catch (e) {
        console.warn("Failed to fetch active dealer profile in useSubmission:", e);
      }

      if (!dealerEmail) {
        toast({
          title: "ავტორიზაციის შეცდომა",
          description: "დილერის ელ-ფოსტა ვერ მოიძებნა. გთხოვთ გაიაროთ ავტორიზაცია თავიდან.",
          variant: "destructive",
        });
        throw new Error("Dealer email is missing");
      }

      const supplierProfile = dealerName
        ? ((identificationCode.includes("ს/კ") || identificationCode.includes("შპს"))
          ? identificationCode
          : `შპს "${dealerName}" ს/კ ${identificationCode}`)
        : undefined;

      const finalPayableValue = Number(Number(data.finalPayable || 0).toFixed(2));

      const itemPrice = Number(data.price || 0);
      const deliveryFeeVal = Number(data.deliveryFee || 0);
      const isIronPlus = dealerKey === "iron" || dealerKey === "iron_plus" || (data as any).dealerType === "iron_plus";
      const isDeliverySelected = deliveryFeeVal > 0;
      const totalPrice = isIronPlus && isDeliverySelected ? itemPrice + deliveryFeeVal : itemPrice;

      // Build JSON payload conforming to submissionSchema.
      // IMPORTANT — idFront / idBack / passportPhoto are intentionally OMITTED here.
      // Those images were already processed by n8n during Step 1 OCR verification.
      // Re-sending them inflates the body to 2–5 MB which reliably causes
      // NSURLErrorNetworkConnectionLost ("Network Error") on iPhone Safari.
      // The server/n8n submission webhook does not need them a second time.
      const payload = {
        documentType: data.documentType || "id_card",
        // ID images stripped — already verified in Step 1, keeping body small for iOS
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        idNumber: data.idNumber || "",
        gender: data.gender || "",
        expiryDate: data.expiryDate || "",
        phone: data.phone || "",
        legalAddress: data.legalAddress || "",
        region: data.region || "",
        municipality: data.municipality || "",
        city: data.city || "",
        cityDistrict: (data as any).cityDistrict || "",
        addressVillage: (data as any).addressVillage || "",
        sociallyVulnerable: Boolean(data.sociallyVulnerable),
        // socialExtract stripped — already verified in Step 3
        nomadic: Boolean(data.nomadic),
        pensioner: Boolean(data.pensioner),
        // pensionerCertificate stripped — already verified in Step 3
        supplierName: data.supplierName || "",
        supplierId: data.supplierId || "",
        supplierProfile,
        model: data.model || "",
        price: itemPrice,
        subsidyRate: Number(data.subsidyRate || 0),
        subsidyAmount: Number(data.subsidyAmount || 0),
        deliveryFee: isDeliverySelected ? deliveryFeeVal : 0,
        ironPlus: Boolean(data.ironPlus),
        ironPlusFee: Number(data.ironPlusFee || 0),
        finalPayable: finalPayableValue,
        user_copayment: finalPayableValue,
        "საბოლოო_გადასახდელი": finalPayableValue,
        installationAddress: data.installationAddress || "",
        receiptPhoto: data.receiptPhoto || "",   // kept — n8n needs receipt at this stage
        signature: signatureBase64,              // kept — n8n needs signature at this stage
        digitalConsent: data.digitalConsent !== false,
        dealerEmail,

        // Webhook calculations
        itemPrice,
        totalPrice,
        isIronPlusDealer: isIronPlus,
        isDeliverySelected,
        dealerType: (data as any).dealerType || (isIronPlus ? "iron_plus" : undefined),

        // Extra parameters
        branch_email: data.branch_email,
        whatsapp_number: data.whatsapp_number,
        send_to_rda: data.send_to_rda,
        ovenCode: data.ovenCode,
        dealerPersonalId: data.dealerPersonalId,
        dealerPersonalIdVerified: data.dealerPersonalIdVerified,
        dealerPersonalIdLookupMessage: data.dealerPersonalIdLookupMessage,
        ovenVerified: data.ovenVerified,
        ovenVerificationMessage: data.ovenVerificationMessage,
        ovenCodeRow: data.ovenCodeRow,
        verifiedProductName: data.verifiedProductName,
        smsVerified: data.smsVerified,
        receiptVerified: data.receiptVerified,
        receiptVerificationMessage: data.receiptVerificationMessage,
      };


      // Debug logging for iOS issues
      console.log("[useSubmission] dealerKey:", dealerKey);

      // Use iOS-safe fetch() with keepalive instead of axios
      try {
        return await submitWithFetch("/api/submission/submit", payload);
      } catch (err: any) {
        let detailedMsg = err?.message || "განაცხადის გაგზავნა ვერ მოხერხდა";
        if (err?.name === "AbortError") {
          detailedMsg = "მოთხოვნის დრო ამოიწურა (Timeout). შეამოწმეთ ინტერნეტის კავშირი.";
        }
        throw new Error(detailedMsg);
      }

    },
    onSuccess: () => {
      toast({
        title: "განაცხადი გაიგზავნა",
        description: "დილერის განაცხადი წარმატებით დამუშავდა.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "გაგზავნის შეცდომა",
        description: error.message || "განაცხადის გაგზავნა ვერ მოხერხდა",
        variant: "destructive",
      });
    }
  });
}
