import { Request, Response, NextFunction, type RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { securityConfig } from "./security";

// Read lazily so the secret always matches the one routes.ts signs with (same env vars,
// same fallback), even when env is populated after this module loads.
function jwtSecret(): string {
  return process.env.JWT_SECRET || process.env.AUTH_SECRET || "fallback-secret-change-in-production";
}

export interface AuthRequest extends Request {
  user?: {
    email: string;
    role: "admin" | "dealer";
    dealerId?: number;
    dealerKey?: string;
  };
}

// ── Dealer session ──
// The dealer session is the signed dealer_token cookie. It is rolling: every authenticated
// dealer request that is more than DEALER_SESSION_REFRESH_AFTER_MS old re-issues it with a
// fresh 12-hour lifetime, so a dealer who is actively working is never logged out mid-form.
export const DEALER_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const DEALER_SESSION_REFRESH_AFTER_MS = 5 * 60 * 1000;
export const DEALER_SESSION_EXPIRED_CODE = "DEALER_SESSION_EXPIRED";

export function dealerSessionCookieOptions() {
  return { ...securityConfig.cookieOptions, maxAge: DEALER_SESSION_MAX_AGE_MS };
}

export function signDealerSession(dealer: { id: number; key: string; email?: string | null }): string {
  return jwt.sign(
    { dealerId: dealer.id, dealerKey: dealer.key, email: dealer.email, role: "dealer" },
    jwtSecret(),
    { expiresIn: Math.floor(DEALER_SESSION_MAX_AGE_MS / 1000) },
  );
}

export function issueDealerSession(
  res: Response,
  dealer: { id: number; key: string; email?: string | null },
  options: { setAuthToken?: boolean } = {},
): string {
  const token = signDealerSession(dealer);
  const cookieOptions = dealerSessionCookieOptions();
  res.cookie("dealer_token", token, cookieOptions);
  if (options.setAuthToken !== false) res.cookie("auth_token", token, cookieOptions);
  return token;
}

function unauthorized(res: Response, message = "Authentication required") {
  return res.status(401).json({ code: DEALER_SESSION_EXPIRED_CODE, message });
}

/**
 * Requires a logged-in dealer. The dealer identity comes only from the signed session
 * cookie (req.user), never from query params or the request body.
 *
 * `dealerExists` is consulted whenever the session is about to be extended, so a deleted
 * dealer cannot keep a rolling session alive indefinitely.
 */
export function createRequireDealer(dealerExists: (dealerId: number) => Promise<boolean>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const dealerCookie: string | undefined = req.cookies?.dealer_token;
    const authCookie: string | undefined = req.cookies?.auth_token;
    const token = dealerCookie || authCookie;
    if (!token) return unauthorized(res);

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    } catch {
      return unauthorized(res, "Invalid or expired token");
    }
    if (decoded?.role !== "dealer") {
      return res.status(403).json({ message: "Dealer access required" });
    }
    const dealerId = Number(decoded.dealerId);
    if (!Number.isInteger(dealerId) || dealerId <= 0) return unauthorized(res);

    (req as AuthRequest).user = {
      email: decoded.email,
      role: "dealer",
      dealerId,
      dealerKey: decoded.dealerKey,
    };

    const issuedAtMs = typeof decoded.iat === "number" ? decoded.iat * 1000 : 0;
    if (Date.now() - issuedAtMs > DEALER_SESSION_REFRESH_AFTER_MS) {
      try {
        if (!(await dealerExists(dealerId))) return unauthorized(res);
      } catch {
        // A transient DB error must not log the dealer out; skip this refresh only.
        return next();
      }
      // auth_token is shared with admin logins; only roll it if it holds this same session.
      issueDealerSession(
        res,
        { id: dealerId, key: decoded.dealerKey, email: decoded.email },
        { setAuthToken: !authCookie || authCookie === token },
      );
    }
    next();
  };
}

export function withAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.auth_token || req.cookies?.admin_token || req.cookies?.dealer_token;

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const decoded = jwt.verify(token, jwtSecret()) as any;

    req.user = {
      email: decoded.email,
      role: decoded.role,
      dealerId: decoded.dealerId,
      dealerKey: decoded.dealerKey,
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function withRole(allowedRoles: Array<"admin" | "dealer">) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
}

export function withAdminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export function withDealerOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "dealer") {
    return res.status(403).json({ message: "Dealer access required" });
  }
  next();
}

export function withDealerScope(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "dealer" || !req.user.dealerId) {
    return res.status(403).json({ message: "Dealer authentication required" });
  }
  next();
}
