import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PersonalIdLookupResult = {
  success: boolean;
  status?: string;
  message: string;
  personalId: string;
  portalMessage?: string;
};

const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath((import.meta as any).url));
const PYTHON_SCRIPT = path.resolve(_dirname, "..", "python.py");
const LOOKUP_TIMEOUT_MS = Number(process.env.PERSONAL_ID_LOOKUP_TIMEOUT_MS ?? 120_000);

function pythonCommands(): string[][] {
  const configured = (process.env.PYTHON_CMD || process.env.PYTHON_EXECUTABLE)?.trim();
  if (configured) {
    return [[configured]];
  }
  return [[process.platform === "win32" ? "python" : "python3"]];
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

    const child = spawn(command[0], [
      ...command.slice(1),
      PYTHON_SCRIPT,
      personalId,
      firstName,
      lastName,
      mode,
    ], {
      cwd: path.dirname(PYTHON_SCRIPT),
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });

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
          const parsed = JSON.parse(line) as Partial<PersonalIdLookupResult>;
          finish({
            success: Boolean(parsed.success),
            status: parsed.status,
            message: String(parsed.message ?? ""),
            personalId: String(parsed.personalId ?? personalId),
            portalMessage: parsed.portalMessage,
          });
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

export async function runPersonalIdLookup(
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

  let lastSpawnError: string | null = null;

  for (const command of pythonCommands()) {
    const result = await runPythonLookup(command, normalized, firstName, lastName, mode);
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
    personalId: normalized,
  };
}
