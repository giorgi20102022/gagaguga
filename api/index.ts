/// <reference path="./dist-index.d.ts" />
import type { Request, Response } from "express";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const bundlePath = join(process.cwd(), "dist", "index.cjs");

type ExpressApp = (req: Request, res: Response) => void;

let appPromise: Promise<ExpressApp> | null = null;

export default async function handler(req: Request, res: Response) {
  try {
    if (!appPromise) {
      const { getApp } = require(bundlePath) as {
        getApp: () => Promise<ExpressApp>;
      };
      appPromise = getApp();
    }
    const app = await appPromise;
    return app(req, res);
  } catch (err) {
    console.error("[Vercel] Error loading bundled server:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
