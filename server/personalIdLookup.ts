import { spawn } from "node:child_process";
import path from "node:path";
import axios from "axios";

export type PersonalIdLookupResult = {
  success: boolean;
  status?: string;
  message: string;
  personalId: string;
  portalMessage?: string;
  error?: string;
};

const PYTHON_SCRIPT = path.resolve(process.cwd(), "python.py");
// python.py now retries internally (up to PERSONAL_ID_LOOKUP_MAX_ATTEMPTS, default 3)
// on inconclusive portal failures, so this needs enough headroom for several
// full login+search attempts, not just one.
const LOOKUP_TIMEOUT_MS = Number(process.env.PERSONAL_ID_LOOKUP_TIMEOUT_MS ?? 240_000);

function pythonCommands(): string[][] {
  const configured = (process.env.PYTHON_CMD || process.env.PYTHON_EXECUTABLE)?.trim();
  if (configured) {
    return [[configured]];
  }
  return [[process.platform === "win32" ? "python" : "python3"]];
}

function normalizeLookupResult(
  parsed: Partial<PersonalIdLookupResult>,
  fallbackPersonalId: string,
): PersonalIdLookupResult {
  return {
    success: Boolean(parsed.success),
    status: parsed.status,
    message: String(parsed.message ?? ""),
    personalId: String(parsed.personalId ?? fallbackPersonalId),
    portalMessage: parsed.portalMessage,
  };
}

async function runWebhookLookup(
  personalId: string,
  firstName: string,
  lastName: string,
  mode: "check" | "register",
): Promise<PersonalIdLookupResult> {
  const webhookUrl = process.env.PERSONAL_ID_LOOKUP_WEBHOOK?.trim();
  if (!webhookUrl) {
    throw new Error("PERSONAL_ID_LOOKUP_WEBHOOK is not configured");
  }

  const response = await axios.post(
    webhookUrl,
    { personalId, firstName, lastName, mode },
    { timeout: LOOKUP_TIMEOUT_MS, headers: { "Content-Type": "application/json" } },
  );

  const data = response.data;
  if (typeof data === "string") {
    return normalizeLookupResult(JSON.parse(data), personalId);
  }
  if (Array.isArray(data) && data.length > 0) {
    return normalizeLookupResult(data[0], personalId);
  }
  return normalizeLookupResult(data, personalId);
}

function runPythonLookup(
  command: string[],
  personalId: string,
  firstName: string,
  lastName: string,
  mode: "check" | "register",
): Promise<PersonalIdLookupResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PersonalIdLookupResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(
      command[0],
      [...command.slice(1), PYTHON_SCRIPT, personalId, firstName, lastName, mode],
      {
        cwd: path.dirname(PYTHON_SCRIPT),
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        success: false,
        message: "შემოწმებას დრო გაუვიდა",
        personalId,
      });
    }, LOOKUP_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      finish({
        success: false,
        message: `__SPAWN_ERROR__:${err.message}`,
        personalId,
      });
    });

    child.on("close", (code) => {
      const line = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .pop();

      if (line) {
        try {
          finish(normalizeLookupResult(JSON.parse(line), personalId));
          return;
        } catch {
          // fall through
        }
      }

      const detail = stderr.trim() || stdout.trim();
      finish({
        success: false,
        message:
          detail ||
          (code === 0
            ? "შედეგი ვერ მოიძებნა"
            : `შემოწმება ვერ მოხერხდა (კოდი ${code ?? "unknown"})`),
        personalId,
      });
    });
  });
}

async function runPythonLookupChain(
  personalId: string,
  firstName: string,
  lastName: string,
  mode: "check" | "register",
): Promise<PersonalIdLookupResult> {
  let lastSpawnError: string | null = null;

  for (const command of pythonCommands()) {
    const result = await runPythonLookup(command, personalId, firstName, lastName, mode);
    if (result.message.startsWith("__SPAWN_ERROR__:")) {
      lastSpawnError = result.message.replace("__SPAWN_ERROR__:", "");
      continue;
    }
    return result;
  }

  return {
    success: false,
    message: lastSpawnError
      ? `Python ვერ გაეშვა: ${lastSpawnError}`
      : "Python ვერ მოიძებნა. დააყენეთ Python და Playwright (pip install playwright && playwright install chromium).",
    personalId,
  };
}

async function runPrimaryPersonalIdLookup(
  personalId: string,
  options?: { firstName?: string; lastName?: string; mode?: "check" | "register" },
): Promise<PersonalIdLookupResult> {
  const normalized = String(personalId ?? "").trim().replace(/\s+/g, "");
  const firstName = String(options?.firstName ?? "").trim();
  const lastName = String(options?.lastName ?? "").trim();
  const mode = options?.mode === "register" ? "register" : "check";

  if (!normalized) {
    return {
      success: false,
      message: "პირადი ნომერი არ არის მითითებული",
      personalId: normalized,
    };
  }

  if (process.env.PERSONAL_ID_LOOKUP_WEBHOOK) {
    try {
      return await runWebhookLookup(normalized, firstName, lastName, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `პორტალის webhook ვერ გაეშვა: ${message}`,
        personalId: normalized,
      };
    }
  }

  if (process.env.VERCEL) {
    try {
      const { lookupPersonalIdOnPortal } = await import("./personalIdPortal");
      return await lookupPersonalIdOnPortal(normalized, { firstName, lastName, mode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `შემოწმება ვერ მოხერხდა: ${message}`,
        personalId: normalized,
      };
    }
  }

  return runPythonLookupChain(normalized, firstName, lastName, mode);
}

// Keep the existing beneficiary lookup authoritative. Only a confirmed miss in
// check mode needs the additional registry validation; registration is unchanged.
export async function runPersonalIdLookup(
  personalId: string,
  options?: { firstName?: string; lastName?: string; mode?: "check" | "register" },
): Promise<PersonalIdLookupResult> {
  const result = await runPrimaryPersonalIdLookup(personalId, options);
  if (options?.mode === "register" || !result.success || result.status !== "not_found") {
    return result;
  }

  const checkedPersonalId = String(personalId).trim().replace(/\s+/g, "");
  const technicalError: PersonalIdLookupResult = {
    success: false,
    status: "error",
    message: "პირადი ნომრის შემოწმება ვერ მოხერხდა. სცადეთ თავიდან.",
    personalId: checkedPersonalId,
  };

  try {
    const response = await axios.post(
      "https://n8n.srv1020074.hstgr.cloud/webhook/meorenabiji",
      { personalNumber: checkedPersonalId },
      {
        timeout: 15_000,
        headers: { "Content-Type": "application/json" },
        // Inspect business-validation payloads before interpreting HTTP errors.
        validateStatus: () => true,
      },
    );
    // Temporary diagnostics for the actual n8n response.
    console.log('[Dealer Personal ID Lookup] n8n HTTP status:', response.status);
    const payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    console.log('[Dealer Personal ID Lookup] n8n response:', payload);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return technicalError;

    if (payload.error === "PERSONAL_NUMBER_EXISTS" &&
        typeof payload.message === "string" && payload.message.trim()) {
      return { ...technicalError, error: payload.error, message: payload.message };
    }
    if (payload.success === true && payload.status === "success" && !payload.error) {
      return {
        success: true,
        status: "success",
        message: typeof payload.message === "string" ? payload.message : result.message,
        personalId: checkedPersonalId,
      };
    }
    return technicalError;
  } catch {
    return technicalError;
  }
}
