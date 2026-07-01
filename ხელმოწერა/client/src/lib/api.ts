import axios from "axios";

const CHECK_STOVE_CODE_URL = "/api/check-stove-code";

export type N8NAction = "verify" | "cancel";

export interface SendN8NRequestParams {
  action: N8NAction;
  code?: string;
  orderId?: string;
  dealer_name?: string;
  branch_name?: string;
}

export interface N8NResponse {
  status?: string;
  message?: string;
  product_name?: string;
  [key: string]: any;
}

export async function sendN8NRequest(
  params: SendN8NRequestParams
): Promise<N8NResponse> {
  try {
    const res = await axios.post<N8NResponse>(CHECK_STOVE_CODE_URL, {
      action: params.action,
      code: params.code,
      orderId: params.orderId,
      dealer_name: params.dealer_name,
      branch_name: params.branch_name,
    });
    return res.data;
  } catch (err) {
    console.error("[sendN8NRequest] Error:", err);
    throw err;
  }
}
