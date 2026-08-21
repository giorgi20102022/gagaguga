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
/**
 * Submission using Axios with absolute URL, credentials, and 40s timeout.
 */
async function submitWithAxios(path: string, payload: any): Promise<any> {
  const endpoint = `${window.location.origin}${path}`;
  const isFormData = payload instanceof FormData;

  try {
    const headers: Record<string, string> = {};
    if (!isFormData) {
      headers["Accept"] = "application/json";
      headers["Content-Type"] = "application/json";
    }

    alert(`[iOS DEBUG fetch] Calling fetch(${endpoint}) body isFormData=${isFormData}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: isFormData ? payload : JSON.stringify(payload),
      cache: "no-store",
      keepalive: false,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err: any = new Error(data.message || data.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.response = { data };
      throw err;
    }

    alert("[iOS DEBUG fetch-done] response.status=" + response.status + " data=" + JSON.stringify(data).slice(0, 100));

    return data;
  } catch (err: any) {
    alert(`RAW ERROR CAUSE: Name: ${err?.name}, Msg: ${err?.message}, Type: ${typeof err}`);
    const status = err?.response?.status || err?.status || "?";
    const serverMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || String(err);
    alert("[iOS DEBUG fetch-catch] status=" + status + " err=" + serverMsg);
    console.error("[useSubmission] fetch error:", {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      response: err?.response?.data,
    });
    const e = new Error(typeof serverMsg === "string" ? serverMsg : JSON.stringify(serverMsg));
    (e as any).status = status;
    (e as any).code = err?.name === 'AbortError' ? 'ECONNABORTED' : err?.code;
    throw e;
  }
}

export function useSubmission() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: SubmissionInput) => {
      // ── DIAGNOSTIC A: mutationFn entered ──────────────────────────────────
      alert("[iOS DEBUG A] mutationFn entered. firstName=" + (data.firstName || "?") + " receiptPhoto=" + (data.receiptPhoto ? "YES(" + Math.round((data.receiptPhoto.length)/1024) + "KB)" : "MISSING"));

      let payload: any;
      let dealerEmail = "";
      let formData: FormData = new FormData();

      try {
        await registerDealerPersonalIdOnPortal(data);

        // Signature must already be pre-generated into data.signature by Step4Finalize
        // BEFORE the user taps submit. Running canvas work here violates iOS Safari Rule 2
        // (heavy main-thread blocking during a Touch event kills the network request on WebKit).
        let signatureBase64 = data.signature || "";
        if (signatureBase64) {
          // Ensure signature base64 is compressed/trimmed
          signatureBase64 = signatureBase64.replace(/^data:image\/(png|jpeg);base64,/, '');
        } else {
          console.warn(
            "[useSubmission] data.signature is empty — signature was not pre-generated by " +
            "SignaturePreview before submit. Proceeding without signature image."
          );
        }

        // Get active dealer details dynamically
        let dealerName = "";
        let identificationCode = "";
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
        } catch (e: any) {
          // ── DIAGNOSTIC B-fail: dealer fetch threw ─────────────────────────
          alert("[iOS DEBUG B-fail] /api/dealer/me threw: " + (e?.message || String(e)));
          console.warn("Failed to fetch active dealer profile in useSubmission:", e);
        }

        // ── DIAGNOSTIC B: dealer fetch result ────────────────────────────────
        alert("[iOS DEBUG B] dealer/me done. email=" + (dealerEmail || "EMPTY") + " key=" + (dealerKey || "EMPTY"));

        if (!dealerEmail) {
          // ── DIAGNOSTIC C: auth failure ────────────────────────────────────
          alert("[iOS DEBUG C] BLOCKED: dealerEmail is empty — auth cookie may be missing on iPhone.");
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

        payload = {
          documentType: data.documentType || "id_card",
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
          nomadic: Boolean(data.nomadic),
          pensioner: Boolean(data.pensioner),
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
          receiptPhoto: data.receiptPhoto || "",
          signature: signatureBase64,
          digitalConsent: data.digitalConsent !== false,
          dealerEmail,

          itemPrice,
          totalPrice,
          isIronPlusDealer: isIronPlus,
          isDeliverySelected,
          dealerType: (data as any).dealerType || (isIronPlus ? "iron_plus" : undefined),

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

        formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
          }
        });

        console.log("[useSubmission] dealerKey:", dealerKey);

        alert("[iOS DEBUG D] Step 1 — About to post via Axios with FormData.");

        alert("Payload built successfully, about to send via Axios");
      } catch (prepErr: any) {
        alert("CRASH DURING PAYLOAD PREP: " + (prepErr?.message || JSON.stringify(prepErr)));
        console.error("Payload Prep Error:", prepErr);
        throw prepErr;
      }

      try {
        const _result = await submitWithAxios("/api/submission/submit", formData);
        // ── DIAGNOSTIC E: Axios returned ─────────────────────────────────
        alert("[iOS DEBUG E] Step 2 — submitWithAxios completed OK. Result=" + JSON.stringify(_result).slice(0, 120));
        return _result;
      } catch (err: any) {
        // ── DIAGNOSTIC F: Axios threw ────────────────────────────────────
        alert("[iOS DEBUG F] Step 3 — submitWithAxios threw:\nname=" + (err?.name || "?") + "\nmessage=" + (err?.message || "?") + "\nstatus=" + ((err as any)?.status || "?"));
        let detailedMsg = err?.message || "განაცხადის გაგზავნა ვერ მოხერხდა";
        if (err?.code === "ECONNABORTED" || err?.name === "AbortError") {
          detailedMsg = "მოთხოვნის დრო ამოიწურა (Timeout 40s). შეამოწმეთ ინტერნეტის კავშირი.";
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
      alert("UI CATCH EXPOSED (useSubmission): " + (error?.message || String(error)) + " | TYPE: " + typeof error);
      toast({
        title: "გაგზავნის შეცდომა",
        description: error.message || "განაცხადის გაგზავნა ვერ მოხერხდა",
        variant: "destructive",
      });
    }
  });
}
