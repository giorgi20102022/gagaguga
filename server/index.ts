import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import dotenv from "dotenv";
import { resolve } from "node:path";
import multer from "multer";
import axios from "axios";
import { Blob } from "node:buffer";  // added to construct real Blob objects
import cookieParser from "cookie-parser";
import cors from "cors";

dotenv.config({ path: resolve(process.cwd(), ".env") });

// Ensure env vars from .env are also set on process.env for downstream consumers.
if (!process.env.DATABASE_URL) {
  const parsed = dotenv.config({ path: resolve(process.cwd(), ".env") }).parsed;
  if (parsed) {
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

const app = express();
const httpServer = createServer(app);

// 1. ABSOLUTE TOP OF FILE (INITIALIZATION): CORS middleware configured immediately
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

// 2. SECOND LAYER (BODY PARSERS): Clean configurations without custom verify interceptors
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Cookie parser for secure cookie handling
app.use(cookieParser());

// Security headers (Helmet) configured synchronously
import { configureSecurityMiddleware } from "./middleware/security";
configureSecurityMiddleware(app);

const upload = multer({ storage: multer.memoryStorage() });

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

let appPromise: Promise<express.Express> | null = null;

export async function getApp() {
  if (appPromise) return appPromise;

  appPromise = (async () => {
    const { ensureDbBasics } = await import("./db-init");
    let bootstrapSucceeded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await ensureDbBasics();
        bootstrapSucceeded = true;
        break;
      } catch (e) {
        console.error(`[db] bootstrap attempt ${attempt} failed`, e);
        if (attempt === 3) {
          throw e;
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    if (!bootstrapSucceeded) {
      throw new Error("[db] PostgreSQL bootstrap did not complete successfully");
    }

    const { registerRoutes } = await import("./routes");
    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("Internal Server Error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message });
    });

    return app;
  })();

  return appPromise;
}

if (!process.env.VERCEL) {
  getApp().then(async () => {

  // Try preferred port first, fall back to next port if busy.
  const preferredPort = parseInt(process.env.PORT || "5000", 10);

  const tryListen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const opts = {
        port,
        host: "0.0.0.0",
        ...(process.platform === "win32" ? {} : { reusePort: true }),
      };
      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          httpServer.removeAllListeners("error");
          resolve(-1);
        } else {
          reject(err);
        }
      });
      httpServer.listen(opts, () => {
        httpServer.removeAllListeners("error");
        resolve(port);
      });
    });

  let activePort = await tryListen(preferredPort);
  if (activePort === -1) {
    const fallback = preferredPort + 1;
    log(`Port ${preferredPort} in use — trying ${fallback}`);
    activePort = await tryListen(fallback);
  }
  log(`serving on port ${activePort}`);

    // 4. HTTP SERVER TIMEOUTS: attached directly to the active server listener object
    httpServer.timeout = 120000; // 2 minutes
    httpServer.keepAliveTimeout = 65000;
    httpServer.headersTimeout = 66000;

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    //
    // In middleware mode, Vite's HMR may wait for the HTTP server
    // to be listening, so we start listening before setupVite.
    if (process.env.NODE_ENV === "production") {
      const { serveStatic } = await import("./static");
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }
  }).catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
  });
}
