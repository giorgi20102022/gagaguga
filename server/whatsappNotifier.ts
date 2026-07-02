import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStorage } from "./storage";

const _dirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const PYTHON_SCRIPT = path.resolve(_dirname, "..", "whatsapp", "pythone3.py");

function pythonCommands(): string[][] {
  const configured = (process.env.PYTHON_CMD || process.env.PYTHON_EXECUTABLE)?.trim();
  if (configured) {
    return [[configured]];
  }
  return [[process.platform === "win32" ? "python" : "python3"]];
}

function cleanWhatsAppNumber(phone: string): string {
  if (!phone) return "";
  let cleaned = phone.replace(/[^0-9]/g, "");
  // If it's a standard Georgian number of 9 digits starting with 5 (e.g. 568921496), prepend 995
  if (cleaned.length === 9 && cleaned.startsWith("5")) {
    cleaned = "995" + cleaned;
  }
  return cleaned;
}

export async function triggerWhatsappNotification(
  dealerId: number,
  cityDistrict: string,
  input: any
): Promise<void> {
  try {
    const storage = getStorage();
    const dealer = await storage.getDealerById(dealerId);

    if (!dealer) {
      console.log(`[WhatsApp Notifier] Dealer not found for ID: ${dealerId}`);
      return;
    }

    const rawNumber = dealer.whatsappNumber;
    if (!rawNumber || !rawNumber.trim()) {
      console.log(`[WhatsApp Notifier] Dealer "${dealer.name}" has no WhatsApp number configured`);
      return;
    }

    const cleanNumber = cleanWhatsAppNumber(rawNumber.trim());
    if (!cleanNumber) {
      console.log(`[WhatsApp Notifier] Cleaned WhatsApp number is empty for dealer "${dealer.name}"`);
      return;
    }

    // Format the message
    const customerName = `${input.firstName || ""} ${input.lastName || ""}`.trim();
    const modelName = input.model || "";
    const price = input.finalPayable !== undefined ? `${input.finalPayable} GEL` : "N/A";
    const address = `${cityDistrict || ""}, ${input.addressVillage || ""}`.trim();

    const whatsappMessage = `🔔 ახალი შეკვეთა წარმატებით გაფორმდა!\n\n` +
      `👤 მომხმარებელი: ${customerName}\n` +
      `🆔 პირადი ნომერი: ${input.idNumber || "N/A"}\n` +
      `📱 ტელეფონი: ${input.phone || "N/A"}\n` +
      `📍 მისამართი: ${address || "N/A"}\n` +
      `🔥 მოდელი: ${modelName}\n` +
      `💰 გადასახდელი: ${price}`;

    console.log(`[WhatsApp Notifier] Triggering WhatsApp script for dealer: "${dealer.name}" (Number: ${cleanNumber})`);

    const cmds = pythonCommands();
    let spawned = false;

    for (const cmd of cmds) {
      try {
        const child = spawn(cmd[0], [
          ...cmd.slice(1),
          PYTHON_SCRIPT,
          cleanNumber,
          whatsappMessage
        ], {
          cwd: path.dirname(PYTHON_SCRIPT),
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
          windowsHide: true,
        });

        child.stdout.on("data", (data) => {
          console.log(`[WhatsApp Script STDOUT]: ${data}`);
        });

        child.stderr.on("data", (data) => {
          console.error(`[WhatsApp Script STDERR]: ${data}`);
        });

        child.on("close", (code) => {
          console.log(`[WhatsApp Script] Process exited with code ${code}`);
        });

        spawned = true;
        break;
      } catch (err: any) {
        console.error(`[WhatsApp Notifier] Failed to spawn python with command ${cmd.join(" ")}:`, err.message);
      }
    }

    if (!spawned) {
      console.error(`[WhatsApp Notifier] Could not spawn Python. Ensure python is installed.`);
    }

  } catch (err: any) {
    console.error(`[WhatsApp Notifier] Error during notification trigger:`, err);
  }
}
