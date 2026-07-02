import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  try {
    // Import the esbuild-bundled commonjs file generated during build
    const { getApp } = await import("../dist/index.cjs");
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error("[Vercel] Error loading bundled server:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

