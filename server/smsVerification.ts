import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { isSmsBypassActive, type SmsBypassSettings } from "../shared/smsBypass";

export function normalizeSmsPhone(phone: unknown): string {
  const digits = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
  return digits.length === 9 ? `995${digits}` : digits;
}

export function issueSmsProof(dealerId: number, phone: string, secret: string): string {
  return jwt.sign({ purpose: "sms-verification", dealerId, phone: normalizeSmsPhone(phone) }, secret, { expiresIn: "2h" });
}

export function hasSmsProof(proof: unknown, dealerId: number, phone: unknown, secret: string): boolean {
  try {
    if (typeof proof !== "string") return false;
    const data = jwt.verify(proof, secret) as jwt.JwtPayload;
    return data.purpose === "sms-verification" && data.dealerId === dealerId &&
      /^995\d{9}$/.test(normalizeSmsPhone(phone)) && data.phone === normalizeSmsPhone(phone);
  } catch { return false; }
}

// Always fetch current settings for each final submission; client flags are irrelevant.
export async function enforceSubmissionSms(
  req: Request, res: Response, dealerId: number,
  getDealer: (id: number) => Promise<SmsBypassSettings | undefined>, secret: string,
): Promise<boolean> {
  const dealer = await getDealer(dealerId);
  if (dealer && (isSmsBypassActive(dealer) || hasSmsProof(req.cookies?.sms_verification, dealerId, req.body?.phone, secret))) return true;
  res.status(403).json({ code: "SMS_VERIFICATION_REQUIRED", field: "phone", message: "გთხოვთ, დაადასტუროთ ტელეფონის ნომერი SMS კოდით." });
  return false;
}
