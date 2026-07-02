import express from "express";
import type { Request, Response } from "express";
import { createServer } from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import { configureSecurityMiddleware } from "../server/middleware/security";
import { ensureDbBasics } from "../server/db-init";
import { registerRoutes } from "../server/routes";

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const CLIENT_URL = process.env.CLIENT_URL;
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

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Set-Cookie"],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

let isInitialized = false;

// Vercel Serverless Function Handler
export default async function handler(req: Request, res: Response) {
  if (!isInitialized) {
    try {
      console.log("[Vercel] Initializing Express app...");
      
      configureSecurityMiddleware(app);
      await ensureDbBasics();
      await registerRoutes(httpServer, app);

      isInitialized = true;
      console.log("[Vercel] Express app initialized successfully");
    } catch (e) {
      console.error("[Vercel] Bootstrap failed:", e);
      return res.status(500).json({ error: "Initialization failed" });
    }
  }

  // Delegate the request to the Express app
  return app(req, res);
}
