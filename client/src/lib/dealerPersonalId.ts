import axios from "axios";
import { type SubmissionInput } from "@shared/routes";

export async function registerDealerPersonalIdOnPortal(
  data: Partial<SubmissionInput>,
): Promise<void> {
  const personalId = String(data.idNumber ?? data.dealerPersonalId ?? "").trim();
  if (!personalId) {
    throw new Error("პირადი ნომერი არ არის მითითებული");
  }
  if (!data.dealerPersonalIdVerified) {
    throw new Error("პირადი ნომრის შემოწმება ჯერ არ დასრულებულა");
  }

  const res = await axios.post(
    "/api/verification/dealer-personal-id",
    {
      personalId,
      firstName: String(data.firstName ?? "").trim(),
      lastName: String(data.lastName ?? "").trim(),
      mode: "register",
    },
    { withCredentials: true, timeout: 130_000 },
  );

  const result = res.data as { success?: boolean; message?: string };
  if (!result.success) {
    throw new Error(String(result.message ?? "ბენეფიციარის რეგისტრაცია ვერ მოხერხდა"));
  }
}
