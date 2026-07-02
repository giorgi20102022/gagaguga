declare module "../dist/index.cjs" {
  import type { Express } from "express";

  export function getApp(): Promise<Express>;
}

declare module "*/dist/index.cjs" {
  import type { Express } from "express";

  export function getApp(): Promise<Express>;
}
