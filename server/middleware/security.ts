import helmet from "helmet";
import cors from "cors";
import { Express } from "express";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const CLIENT_URL = process.env.CLIENT_URL;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const DEV_LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const DEV_LAN_ORIGIN = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

const allowedOrigins = new Set(
  [
    FRONTEND_URL,
    CLIENT_URL,
    ...(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ].filter(Boolean) as string[]
);

export function configureSecurityMiddleware(app: Express) {
  // Helmet.js for secure HTTP headers (only in production to avoid blocking HMR and dev tunnels)
  if (IS_PRODUCTION) {
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:", "https://n8n.srv1020074.hstgr.cloud", "https://blablabla233.app.n8n.cloud"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "blob:"],
            frameSrc: ["'none'"],
          },
        },
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        },
        noSniff: true,
        xssFilter: true,
        hidePoweredBy: true,
        frameguard: { action: "deny" },
      })
    );
  }

  // CORS configuration - restrict to frontend URL only
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no Origin header (server-to-server, curl, same-origin non-browser flows)
        if (!origin) {
          return callback(null, true);
        }

        // In development, allow all origins (localtunnel, local IPs, etc.)
        if (!IS_PRODUCTION) {
          return callback(null, true);
        }

        // Always allow explicitly configured frontend origins.
        if (allowedOrigins.has(origin)) {
          return callback(null, true);
        }

        return callback(new Error(`Not allowed by CORS: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization"],
      exposedHeaders: ["Set-Cookie"],
      maxAge: 86400, // 24 hours
    })
  );

  // Additional security headers
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=()");
    
    // Force HTTPS in production
    if (IS_PRODUCTION && req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    
    next();
  });
}

export const securityConfig = {
  jwtExpiration: "2h", // 2 hours for enhanced security
  cookieOptions: {
    httpOnly: true,
    secure: IS_PRODUCTION, // HTTPS only in production
    sameSite: (IS_PRODUCTION ? "strict" : "lax") as "strict" | "lax",
    maxAge: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
    path: "/",
  },
};
