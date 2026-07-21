import axios from "axios";
import { type SubmissionInput } from "@shared/routes";

export async function registerDealerPersonalIdOnPortal(
  _data: Partial<SubmissionInput>,
): Promise<void> {
  // Disabled portal registration at the end of submission as requested
  return Promise.resolve();
}
