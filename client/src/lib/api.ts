export type N8NAction = "verify" | "cancel" | "addcode";

export interface SendN8NRequestParams {
  action: N8NAction;
  code?: string;
  code_row?: number;
  orderId?: string;
  dealer_name?: string;
  branch_name?: string;
}

export interface N8NResponse {
  status?: string;
  message?: string;
  product_name?: string;
  code_row?: number;
  [key: string]: any;
}

const CHECK_STOVE_CODE_URL = "/api/check-stove-code";

/**
 * Fetch wrapper with AbortController timeout & retry protection for iOS Safari.
 */
async function fetchWithRetry(url: string, body: any, timeoutMs = 15000, maxRetries = 1): Promise<any> {
  let attempt = 0;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        mode: "cors",
        credentials: "include",
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        let errData: any;
        try {
          errData = await response.json();
        } catch {
          errData = await response.text();
        }
        const msg = typeof errData === "string" ? errData : (errData?.message || errData?.error || `HTTP ${response.status}`);
        const err = new Error(msg);
        (err as any).status = response.status;
        (err as any).response = { data: errData, status: response.status };
        throw err;
      }

      return await response.json();
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
      console.error(`[fetchWithRetry] Attempt ${attempt + 1} failed:`, {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        stack: err?.stack,
        url,
      });

      // If aborted by timeout or network failure on iOS, retry once
      if (attempt < maxRetries) {
        attempt++;
        console.warn(`[fetchWithRetry] Retrying request (attempt ${attempt + 1})...`);
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        break;
      }
    }
  }

  throw lastError;
}

export async function sendN8NRequest(
  params: SendN8NRequestParams
): Promise<N8NResponse> {
  try {
    const data = await fetchWithRetry(CHECK_STOVE_CODE_URL, {
      action: params.action,
      code: params.code,
      code_row: params.code_row,
      orderId: params.orderId,
      dealer_name: params.dealer_name,
      branch_name: params.branch_name,
    }, 15000, 1);
    return data;
  } catch (err: any) {
    console.error("[sendN8NRequest] Native Error Details:", {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      response: err?.response?.data,
    });
    throw err;
  }
}
