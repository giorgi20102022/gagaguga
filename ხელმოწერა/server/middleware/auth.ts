import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || "fallback-secret";
const ADMIN_EMAIL = "zurabbabulaidze@gmail.com";

export interface AuthRequest extends Request {
  user?: {
    email: string;
    role: "admin" | "dealer";
    dealerId?: number;
    dealerKey?: string;
  };
}

export function withAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.auth_token || req.cookies?.admin_token || req.cookies?.dealer_token;
    
    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
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
