import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { z } from "zod";
import { api, submissionSchema } from "@shared/routes";
import { users, dealers, products, branches } from "@shared/schema";
import { getStorage } from "./storage";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import FormData from "form-data";
import multer from "multer";
import axios from "axios";
import type { User, Dealer, Product, Branch } from "@shared/schema";
import { withAuth, withAdminOnly, withDealerOnly, withDealerScope, type AuthRequest } from "./middleware/auth";
import { validateBody, loginSchema, productQuerySchema, branchQuerySchema } from "./middleware/validation";
import { securityConfig } from "./middleware/security";

const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || "fallback-secret-change-in-production";
const ADMIN_EMAIL = "zurabbabulaidze@gmail.com";
const ADMIN_PASSWORD_HASH = bcrypt.hashSync("iron123#", 12);
const upload = multer({ storage: multer.memoryStorage() });
const smsCodes = new Map<string, { code: string; expires: number }>();


// Default webhook configuration for new dealers/dashboards
const DEFAULT_WEBHOOKS = {
  identityCard: "https://n8n.srv1020074.hstgr.cloud/webhook/process-id-card",
  pensioner: "https://n8n.srv1020074.hstgr.cloud/webhook/process-document",
  socialCard: "https://n8n.srv1020074.hstgr.cloud/webhook/socialuri-id-card",
  receipt: "https://n8n.srv1020074.hstgr.cloud/webhook/qvitari",
  oven: "https://n8n.srv1020074.hstgr.cloud/webhook/kodiii",
  submission: "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f"
};

function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
  const bearerToken = req.headers.authorization?.split(" ")[1];
  const tokenFromHeader =
    bearerToken && bearerToken !== "null" && bearerToken !== "undefined" ? bearerToken : undefined;
  const token = tokenFromHeader || req.cookies?.admin_token || req.cookies?.auth_token;
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded?.role !== "admin") throw new Error();
    (req as any).adminEmail = String(decoded?.email ?? "");
    next();
  } catch (err) {
    res.status(401).json({ message: "Unauthorized" });
  }
}

async function resolveDealerId(req: Request, res: Response) {
  const dealerKeyRaw = req.query.dealer;
  const dealerKey = (Array.isArray(dealerKeyRaw) ? dealerKeyRaw[0] : dealerKeyRaw) as string | undefined;
  if (!dealerKey) {
    res.status(400).json({ message: "Missing dealer" });
    return undefined;
  }
  const storage = getStorage();
  const dealerId = await storage.getDealerIdByKey(dealerKey);
  if (!dealerId) {
    res.status(404).json({ message: "Dealer not found" });
    return undefined;
  }
  return dealerId;
}

const MAX_SUBSIDY_GEL = 300;

function calculateConditionalDiscountPricing(params: {
  product: Product;
  sociallyVulnerable: boolean;
  pensioner: boolean;
  deliveryFee: number;
  ironPlusFee: number;
}) {
  const basePrice = params.product.price / 100;
  const hasPriorityStatus = params.sociallyVulnerable || params.pensioner;

  // 75% (or admin-configured value) when either toggle is ON; otherwise 50%
  let subsidyRate = 0.5;
  if (hasPriorityStatus) {
    const adminPct = params.product.discountPercentage;
    subsidyRate = (adminPct && adminPct > 0) ? adminPct / 100 : 0.75;
  }

  // Calculate raw subsidy and apply 300 GEL cap
  let subsidyAmount = basePrice * subsidyRate;
  if (subsidyAmount > MAX_SUBSIDY_GEL) {
    subsidyAmount = MAX_SUBSIDY_GEL;
    subsidyRate = basePrice > 0 ? subsidyAmount / basePrice : 0;
  }

  const discountedPrice = Math.max(0, basePrice - subsidyAmount);
  const finalPayable = Math.max(0, discountedPrice + Math.max(0, params.deliveryFee) + Math.max(0, params.ironPlusFee));

  return {
    price: Number(basePrice.toFixed(2)),
    subsidyRate: Number(subsidyRate.toFixed(4)),
    subsidyAmount: Number(subsidyAmount.toFixed(2)),
    finalPayable: Number(finalPayable.toFixed(2)),
  };
}

export async function registerRoutes(
  httpServer: ReturnType<typeof createServer>,
  app: express.Application
): Promise<ReturnType<typeof createServer>> {
  const storage = getStorage();
  const demoUser = { id: 1, username: "demo@example.com" } as const;

  // ── Unified Login with Zod Validation and HttpOnly Cookies ──
  app.post("/api/login", validateBody(loginSchema), async (req: Request, res: Response) => {
    const { email, password } = req.body;

    // Step A: Super Admin check
    if (email === ADMIN_EMAIL) {
      if (!bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const token = jwt.sign({ email, role: "admin" }, JWT_SECRET, { expiresIn: "2h" });
      res.cookie("auth_token", token, securityConfig.cookieOptions);
      res.cookie("admin_token", token, securityConfig.cookieOptions);
      return res.json({ role: "admin", redirect: "/admin/dashboard" });
    }

    // Step B: users table check (admin accounts)
    try {
      const user = await storage.getUserByUsername(email);
      if (user?.password) {
        const isValid = user.password.startsWith("$2")
          ? bcrypt.compareSync(password, user.password)
          : user.password === password;

        if (isValid) {
          const token = jwt.sign({ email, role: "admin" }, JWT_SECRET, { expiresIn: "2h" });
          res.cookie("auth_token", token, securityConfig.cookieOptions);
          res.cookie("admin_token", token, securityConfig.cookieOptions);
          return res.json({ role: "admin", redirect: "/admin/dashboard" });
        }
      }
    } catch (err) {
      console.warn("[Unified Login] users lookup failed; continuing", err);
    }

    // Step C: Dealers table check
    try {
      const dealer = await storage.getDealerByEmail(email);
      console.log(`[Login] dealer lookup for "${email}":`, dealer ? `found id=${dealer.id} hasPassword=${!!dealer.password}` : "NOT FOUND");
      if (!dealer || !dealer.password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const passwordMatch = bcrypt.compareSync(password, dealer.password);
      console.log(`[Login] password match for "${email}":`, passwordMatch);
      if (!passwordMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const token = jwt.sign(
        { dealerId: dealer.id, dealerKey: dealer.key, email: dealer.email, role: "dealer" },
        JWT_SECRET,
        { expiresIn: "2h" }
      );
      res.cookie("auth_token", token, securityConfig.cookieOptions);
      res.cookie("dealer_token", token, securityConfig.cookieOptions);
      return res.json({
        role: "dealer",
        redirect: "/workspace",
        dealer: { id: dealer.id, key: dealer.key, name: dealer.name, email: dealer.email },
      });
    } catch (err) {
      console.error("[Unified Login] Error:", err);
      return res.status(500).json({ message: "Login failed" });
    }
  });

  // Auth setup
  app.set("trust proxy", 1);
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dealer-portal-secret",
      resave: false,
      saveUninitialized: false,
      store:
        process.env.NODE_ENV === "production"
          ? storage.sessionStore
          : new session.MemoryStore(),
      cookie: {
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username: string, password: string, done: any) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) {
          return done(null, false, { message: "Invalid username or password" });
        }
        // Support both bcrypt hashes and legacy plain-text passwords
        const isValid = user.password.startsWith("$2")
          ? bcrypt.compareSync(password, user.password)
          : user.password === password;
        if (!isValid) {
          return done(null, false, { message: "Invalid username or password" });
        }
        return done(null, { id: user.id, username: user.username });
      } catch (e) {
        return done(null, false, {
          message:
            (e as Error)?.message ??
            "Login failed (database unavailable). Try the demo credentials.",
        });
      }
    }),
  );

  passport.serializeUser((user: any, done: any) => {
    done(null, (user as any).id);
  });

  passport.deserializeUser(async (id: number, done: any) => {
    if (id === demoUser.id) return done(null, demoUser);
    try {
      const user = await storage.getUser(id);
      if (!user) return done(null, false);
      return done(null, { id: user.id, username: user.username });
    } catch {
      return done(null, false);
    }
  });

  app.post("/api/session/login", passport.authenticate("local", {
    failureRedirect: "/login",
    failureMessage: true,
  }), (req: Request, res: Response) => {
    res.redirect("/admin/dashboard");
  });

  app.post("/api/logout", (req: Request, res: Response, next: NextFunction) => {
    req.logout((err) => {
      if (err) return next(err);
      res.clearCookie("auth_token", securityConfig.cookieOptions);
      res.clearCookie("admin_token", securityConfig.cookieOptions);
      res.clearCookie("dealer_token", securityConfig.cookieOptions);
      res.sendStatus(200);
    });
  });

  app.get("/api/me", (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.status(200).json(req.user);
  });

  app.post("/api/vision/extract-id", async (req: Request, res: Response) => {
    console.log("Extraction started...");

    try {
      const input = z
        .object({
          frontImage: z.string().optional(),
          backImage: z.string().optional(),
          idFront: z.string().optional(),
          idBack: z.string().optional(),
        })
        .parse(req.body);

      const frontImage = input.frontImage ?? input.idFront;
      const backImage = input.backImage ?? input.idBack;

      if (!frontImage || !backImage) {
        return res.status(400).json({
          message: "Both frontImage and backImage (or idFront/idBack) are required",
        });
      }

      const n8nUrl = process.env.N8N_WEBHOOK_URL ||
        "https://n8n.srv1020074.hstgr.cloud/webhook/process-id-card";

      const formData = new FormData();

      const frontBase64 = frontImage.includes(',') ? frontImage.split(',')[1] : frontImage;
      const backBase64 = backImage.includes(',') ? backImage.split(',')[1] : backImage;

      const frontBuffer = Buffer.from(frontBase64, "base64");
      const backBuffer = Buffer.from(backBase64, "base64");

      formData.append('data', frontBuffer, {
        filename: 'front.jpg',
        contentType: 'image/jpeg',
      });
      formData.append('data', backBuffer, {
        filename: 'back.jpg',
        contentType: 'image/jpeg',
      });

      console.log("[ID Extraction] Sending to n8n via axios...", n8nUrl);

      const n8nRes = await axios.post(n8nUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 120000,
      });

      console.log("[ID Extraction] n8n response:", n8nRes.data);

      // Resilient parsing: n8n may return an array, an object, or a plain string.
      const raw = n8nRes.data;

      if (typeof raw === "string") {
        console.warn("[ID Extraction] n8n returned a plain string:", raw);
        return res.status(400).json({ message: "Could not extract ID data" });
      }

      // Normalise: unwrap array → first element
      const item = Array.isArray(raw) ? raw[0] : raw;
      if (!item || typeof item !== "object") {
        return res.status(400).json({ message: "Could not extract ID data" });
      }

      // The data may be nested under .data or at the top level
      const extracted = item.data && typeof item.data === "object" ? item.data : item;

      if (item.success === false) {
        return res.status(400).json({ message: extracted?.error || "Could not extract ID data" });
      }

      // Validate required fields in the extracted data
      // n8n returns: name, surname, personalId (not firstName, lastName)
      if (!extracted.name || !extracted.surname || !extracted.personalId) {
        return res.status(400).json({
          message: "Could not extract ID data - missing required fields",
        });
      }

      // Attempt to persist the extracted data, but never block the UI on failure.
      try {
        const storageAny = storage as any;
        if (typeof storageAny.createSubmission === "function") {
          await storageAny.createSubmission(extracted);
        }
      } catch (e) {
        console.warn("storage.createSubmission failed, returning data anyway:", e);
      }

      res.status(200).json(extracted);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.post("/api/vision/extract-receipt", async (req: Request, res: Response) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ message: "Image is required" });
      }

      console.log("[Receipt Verification] Sending to n8n via axios...");
      const n8nUrl = process.env.RECEIPT_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/qvitari";

      const base64String = image.includes(',') ? image.split(',')[1] : image;
      const buffer = Buffer.from(base64String, "base64");

      const formData = new FormData();
      formData.append('data', buffer, {
        filename: 'upload.jpg',
        contentType: 'image/jpeg',
      });

      console.log("[Receipt Verification] Sending to n8n via axios...", n8nUrl);

      const n8nRes = await axios.post(n8nUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 120000,
      });

      console.log("[Receipt Verification] n8n raw result:", JSON.stringify(n8nRes.data));

      if (typeof n8nRes.data === "string") {
        console.warn("[Receipt Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      // Unwrap: array → first element, then check .data nesting
      const raw = n8nRes.data;
      let item = Array.isArray(raw) ? raw[0] : raw;
      if (!item || typeof item !== "object") {
        return res.status(400).json({ message: "ქვითრის გადამოწმება ვერ მოხერხდა" });
      }
      // Some n8n nodes nest under .data
      if (item.data && typeof item.data === "object" && !item.total_amount && !item.amount) {
        item = item.data;
      }

      // Extract the amount — try common field names
      const totalAmount = item.total_amount ?? item.totalAmount ?? item.amount ?? item.price ?? null;
      console.log("[Receipt Verification] Extracted total_amount:", totalAmount, "from item keys:", Object.keys(item));

      res.json({
        total_amount: totalAmount !== null && totalAmount !== undefined ? Number(totalAmount) : null,
        currency: item.currency || "GEL",
      });
    } catch (err: any) {
      console.error("[Receipt Verification] Error:", err);
      const message = err.response?.data || err.message;
      res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  app.post("/api/vision/verify-receipt", async (req: Request, res: Response) => {

    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ message: "Image is required" });
      }

      console.log("[Receipt Verification] Sending to n8n via axios...");
      const n8nUrl = "https://n8n.srv1020074.hstgr.cloud/webhook/qvitari";

      const base64String = image.includes(',') ? image.split(',')[1] : image;
      const buffer = Buffer.from(base64String, "base64");

      const formData = new FormData();
      formData.append('data', buffer, {
        filename: 'upload.jpg',
        contentType: 'image/jpeg',
      });

      console.log("[Receipt Verification] Sending to n8n via axios...", n8nUrl);

      const n8nRes = await axios.post(n8nUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 120000,
      });

      console.log("[Receipt Verification] n8n raw result:", JSON.stringify(n8nRes.data));

      if (typeof n8nRes.data === "string") {
        console.warn("[Receipt Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      // Unwrap: array → first element, then check .data nesting
      const raw = n8nRes.data;
      let item = Array.isArray(raw) ? raw[0] : raw;
      if (!item || typeof item !== "object") {
        return res.status(400).json({ message: "ქვითრის გადამოწმება ვერ მოხერხდა" });
      }
      // Some n8n nodes nest under .data
      if (item.data && typeof item.data === "object" && !item.total_amount && !item.amount) {
        item = item.data;
      }

      // Extract the amount — try common field names
      const totalAmount = item.total_amount ?? item.totalAmount ?? item.amount ?? item.price ?? null;
      console.log("[Receipt Verification] Extracted total_amount:", totalAmount, "from item keys:", Object.keys(item));

      res.json({
        total_amount: totalAmount !== null && totalAmount !== undefined ? Number(totalAmount) : null,
        currency: item.currency || "GEL",
      });
    } catch (err: any) {
      console.error("[Receipt Verification] Error:", err);
      const message = err.response?.data || err.message;
      res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  // ── SMS Verification ──
  app.post("/api/verification/send-sms", async (req: Request, res: Response) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone number is required" });

    // Format phone: remove all non-digits, then handle 9 digits -> 995 prefix
    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.length === 9) {
      formattedPhone = "995" + formattedPhone;
    }

    if (formattedPhone.length !== 12 || !formattedPhone.startsWith("995")) {
      return res.status(400).json({ message: "არასწორი ტელეფონის ნომერი. გამოიყენეთ 9-ნიშნა ფორმატი (მაგ: 599...)" });
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

    smsCodes.set(formattedPhone, { code, expires });

    try {
      const apiKey = process.env.SMS_API_KEY;
      if (!apiKey) {
        console.warn("[SMS] SMS_API_KEY is missing. Code for", formattedPhone, "is", code);
        return res.json({ success: true, message: "SMS_API_KEY აკლია (დეველოპმენტის რეჟიმი). კოდი დალოგილია სერვერზე." });
      }

      const content = `კოდი: ${code}. კოდის წარდგენით ვეთანხმები განაცხადს, ვადასტურებ მონაცემებს და ვიღებ პასუხისმგებლობას, არ გავასხვისო ღუმელი 5 წელი.`;
      const url = `https://smsoffice.ge/api/v2/send/?key=${apiKey}&destination=${formattedPhone}&sender=iron%2B&content=${encodeURIComponent(content)}&urgent=true`;

      console.log("[SMS] Sending to", formattedPhone);
      const response = await axios.get(url);
      console.log("[SMS] smsoffice raw response:", response.data);

      const responseData = String(response.data).trim();
      if (responseData === "0" || responseData.toLowerCase() === "success") {
        console.log("[SMS] Delivery successful");
        return res.json({ success: true });
      } else {
        const errorCodes: Record<string, string> = {
          "1": "Invalid API Key",
          "2": "Insufficient Balance",
          "3": "Invalid Destination",
          "4": "Invalid Sender",
          "5": "Message is too long",
          "6": "Internal Error"
        };
        const errorMsg = errorCodes[responseData] || `Provider error: ${responseData}`;
        console.error("[SMS] Delivery failed:", errorMsg);
        return res.status(500).json({
          message: `SMS-ის გაგზავნა ვერ მოხერხდა: ${errorMsg}`,
          providerResponse: responseData
        });
      }
    } catch (err) {
      console.error("[SMS] Error sending SMS:", err);
      res.status(500).json({ message: "SMS-ის გაგზავნა ვერ მოხერხდა (Network/Server Error)" });
    }
  });

  // Alias for old endpoint
  app.post("/api/sms/send", (req, res) => res.redirect(307, "/api/verification/send-sms"));

  app.post("/api/verification/verify-sms", async (req: Request, res: Response) => {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ message: "Phone and code are required" });

    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.length === 9) {
      formattedPhone = "995" + formattedPhone;
    }

    const entry = smsCodes.get(formattedPhone);
    if (!entry) return res.status(400).json({ message: "კოდი არ მოიძებნა. გთხოვთ, თავიდან გაგზავნოთ." });

    if (Date.now() > entry.expires) {
      smsCodes.delete(formattedPhone);
      return res.status(400).json({ message: "კოდს ვადა გაუვიდა" });
    }

    if (entry.code !== code) {
      return res.status(400).json({ message: "არასწორი კოდი" });
    }

    smsCodes.delete(formattedPhone);
    res.json({ success: true });
  });

  // Alias for old endpoint
  app.post("/api/sms/verify", (req, res) => res.redirect(307, "/api/verification/verify-sms"));

  app.post("/api/check-stove-code", async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ message: "Code is required" });
      }

      console.log("[Oven Verification] Sending to n8n (gumeliskodi)...", code);
      const n8nUrl = process.env.STOVE_CODE_CHECK_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/kodiii";

      const n8nRes = await axios.post(n8nUrl, {
        action: req.body.action || "verify",
        code: code,
        dealer_name: req.body.dealer_name,
        branch_name: req.body.branch_name,
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 2 minute timeout
      });

      console.log("[n8n Response]", n8nRes.data);

      if (typeof n8nRes.data === "string") {
        console.warn("[Oven Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      const data = Array.isArray(n8nRes.data) ? n8nRes.data[0] : n8nRes.data;
      return res.json(data);
    } catch (err) {
      console.error("[Oven Verification] Detailed Error:", {
        message: (err as Error).message,
        response: (err as any).response?.data,
        status: (err as any).response?.status
      });
      const message = (err as any).response?.data || (err as Error).message;
      return res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  app.post("/api/vision/verify-oven", async (req: Request, res: Response) => {

    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ message: "Code is required" });
      }

      console.log("[Oven Verification] Sending to n8n (gumeliskodi)...", code);
      const n8nUrl = process.env.STOVE_CODE_CHECK_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/kodiii";

      const n8nRes = await axios.post(n8nUrl, {
        action: "verify",
        code: code,
        dealer_name: req.body.dealer_name,
        branch_name: req.body.branch_name,
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 2 minute timeout
      });

      console.log("[n8n Response]", n8nRes.data);

      if (typeof n8nRes.data === "string") {
        console.warn("[Oven Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      const data = Array.isArray(n8nRes.data) ? n8nRes.data[0] : n8nRes.data;
      return res.json(data);
    } catch (err) {
      console.error("[Oven Verification] Detailed Error:", {
        message: (err as Error).message,
        response: (err as any).response?.data,
        status: (err as any).response?.status
      });
      const message = (err as any).response?.data || (err as Error).message;
      return res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  app.post("/api/vision/extract-social", upload.single("image"), async (req: Request, res: Response) => {
    try {
      const imageFile = (req as Request & {
        file?: { buffer: Buffer; originalname?: string; mimetype?: string };
      }).file;
      if (!imageFile) {
        return res.status(400).json({ message: "Image is required" });
      }

      const n8nUrl = process.env.SOCIAL_ID_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/socialuri-id-card";
      const formData = new FormData();
      formData.append("data", imageFile.buffer, {
        filename: imageFile.originalname || "social-card.jpg",
        contentType: imageFile.mimetype || "image/jpeg",
      });

      console.log("[Social Card Verification] Sending to n8n via axios...", n8nUrl);

      const n8nRes = await axios.post(
        n8nUrl,
        formData,
        {
          timeout: 120000,
          headers: formData.getHeaders(),
        },
      );

      console.log("[Social OCR] Data returned from n8n:", n8nRes.data);
      console.log("[Social Card Verification] n8n result:", n8nRes.data);

      if (typeof n8nRes.data === "string") {
        console.warn("[Social Card Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      const unwrapObject = (value: unknown): Record<string, any> | null => {
        let current = value;

        while (Array.isArray(current) && current.length > 0) {
          current = current[0];
        }

        if (!current || typeof current !== "object") {
          return null;
        }

        const record = current as Record<string, any>;
        const nestedKeys = ["data", "result", "response", "body"];

        for (const key of nestedKeys) {
          const nested = record[key];
          if (nested && typeof nested === "object") {
            const unwrapped = unwrapObject(nested);
            if (unwrapped) {
              return { ...record, ...unwrapped };
            }
          }
        }

        return record;
      };

      const raw = n8nRes.data;
      const extracted = unwrapObject(raw);

      const explicitError = extracted?.error ?? extracted?.verificationError;
      if (typeof explicitError === "string" && explicitError.trim()) {
        return res.json({ verificationError: explicitError });
      }

      if (!extracted || typeof extracted !== "object") {
        console.error("[Social Card Verification] Unexpected n8n response format", { raw });
        return res.status(400).json({ message: "სოციალური ბარათის გადამოწმება ვერ მოხერხდა" });
      }

      if (!extracted.firstName && !extracted.lastName && !extracted.personalId) {
        console.error("[Social Card Verification] Could not determine OCR fields from n8n response", { raw });
        return res.status(502).json({ message: "სოციალური ბარათის ვერიფიკაციის პასუხის დამუშავება ვერ მოხერხდა" });
      }

      return res.json(extracted);
    } catch (err: any) {
      console.error("[Social Card Verification] Error:", err);
      const message = err.response?.data || err.message;
      return res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  // Social Card Verification
  app.post("/api/vision/verify-social-card", upload.single("image"), async (req: Request, res: Response) => {

    try {
      const imageFile = (req as Request & {
        file?: { buffer: Buffer; originalname?: string; mimetype?: string };
      }).file;
      if (!imageFile) {
        return res.status(400).json({ message: "Image is required" });
      }

      const n8nUrl = process.env.SOCIAL_ID_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/socialuri-id-card";
      const formData = new FormData();
      formData.append("data", imageFile.buffer, {
        filename: imageFile.originalname || "social-card.jpg",
        contentType: imageFile.mimetype || "image/jpeg",
      });

      console.log("[Social Card Verification] Sending to n8n via axios...", n8nUrl);

      const n8nRes = await axios.post(
        n8nUrl,
        formData,
        {
          timeout: 120000,
          headers: formData.getHeaders(),
        },
      );

      console.log("[Social OCR] Data returned from n8n:", n8nRes.data);
      console.log("[Social Card Verification] n8n result:", n8nRes.data);

      if (typeof n8nRes.data === "string") {
        console.warn("[Social Card Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      const mapSocialVerificationError = (value: unknown): string => {
        const rawError = String(value ?? "").toLowerCase();
        if (rawError.includes("older than 6 days")) {
          return "ამონაწერი 6 დღეზე ძველია. გთხოვთ, ატვირთოთ ახალი.";
        }
        if (rawError.includes("not found") || rawError.includes("could not read")) {
          return "დოკუმენტიდან მონაცემების წაკითხვა ვერ მოხერხდა.";
        }
        return "ვერიფიკაციისას დაფიქსირდა შეცდომა.";
      };

      const unwrapObject = (value: unknown): Record<string, any> | null => {
        let current = value;

        while (Array.isArray(current) && current.length > 0) {
          current = current[0];
        }

        if (!current || typeof current !== "object") {
          return null;
        }

        const record = current as Record<string, any>;
        const nestedKeys = ["data", "result", "response", "body"];

        for (const key of nestedKeys) {
          const nested = record[key];
          if (nested && typeof nested === "object") {
            const unwrapped = unwrapObject(nested);
            if (unwrapped) {
              return { ...record, ...unwrapped };
            }
          }
        }

        return record;
      };

      const raw = n8nRes.data;
      const extracted = unwrapObject(raw);

      const explicitError = extracted?.error ?? extracted?.verificationError;
      if (typeof explicitError === "string" && explicitError.trim()) {
        return res.json({ verificationError: mapSocialVerificationError(explicitError) });
      }

      if (!extracted || typeof extracted !== "object") {
        console.error("[Social Card Verification] Unexpected n8n response format", { raw });
        return res.status(400).json({ message: "სოციალური ბარათის გადამოწმება ვერ მოხერხდა" });
      }

      if (!extracted.firstName && !extracted.lastName && !extracted.personalId) {
        console.error("[Social Card Verification] Could not determine OCR fields from n8n response", { raw });
        return res.status(502).json({ message: "სოციალური ბარათის ვერიფიკაციის პასუხის დამუშავება ვერ მოხერხდა" });
      }

      return res.json(extracted);
    } catch (err: any) {
      console.error("[Social Card Verification] Error:", err);
      if (err.response?.status === 404) {
        console.error("[Social Card Verification] n8n Webhook is not Active:", {
          url: "https://n8n.srv1020074.hstgr.cloud/webhook/socialuri-id-card",
          status: err.response?.status,
          data: err.response?.data,
        });
      }
      if (err.code === "ECONNABORTED") {
        return res.status(504).json({ message: "n8n social verification request timed out after 120 seconds" });
      }
      const message = err.response?.data || err.message;
      return res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  app.post("/api/vision/extract-pension", async (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ message: "Request body is missing or not JSON" });
      }
      const { image, firstName, lastName, personalId, idNumber } = req.body;
      if (!image) {
        return res.status(400).json({ message: "Image is required" });
      }

      const n8nUrl = process.env.PENSION_DOCUMENT_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/process-document";

      const base64String = image.includes(',') ? image.split(',')[1] : image;
      const buffer = Buffer.from(base64String, "base64");

      const formData = new FormData();
      formData.append('data', buffer, {
        filename: 'upload.jpg',
        contentType: 'image/jpeg',
      });

      console.log("[Pensioner Document Verification] Sending to n8n...", n8nUrl);

      const n8nRes = await axios.post(n8nUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 120000,
      });

      console.log("[Pensioner Debug] n8n Raw Response:", n8nRes.data);

      if (typeof n8nRes.data === "string") {
        console.warn("[Pensioner Document Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      const raw = n8nRes.data;
      const item = Array.isArray(raw) ? raw[0] : raw;
      if (!item || typeof item !== "object") {
        return res.status(400).json({ message: "პენსიონერის დოკუმენტის გადამოწმება ვერ მოხერხდა" });
      }

      res.json({
        success: item.success ?? true,
        firstName: item.firstName || item.name || null,
        lastName: item.lastName || item.surname || null,
        personalId: item.personalId || item.personalNumber || item.idNumber || null,
      });
    } catch (err: any) {
      console.error("[Pensioner Document Verification] Error:", err);
      const message = err.response?.data || err.message;
      res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  // Pensioner Document Verification
  app.post("/api/vision/verify-pensioner", async (req: Request, res: Response) => {

    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ message: "Request body is missing or not JSON" });
      }
      const { image, firstName, lastName, personalId, idNumber } = req.body;
      if (!image) {
        return res.status(400).json({ message: "Image is required" });
      }

      const n8nUrl = process.env.PENSION_DOCUMENT_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/process-document";

      const base64String = image.includes(',') ? image.split(',')[1] : image;
      const buffer = Buffer.from(base64String, "base64");

      const formData = new FormData();
      formData.append('data', buffer, {
        filename: 'upload.jpg',
        contentType: 'image/jpeg',
      });

      console.log("[Pensioner Document Verification] Sending to n8n...", n8nUrl);

      const n8nRes = await axios.post(n8nUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 120000,
      });

      console.log("[Pensioner Debug] n8n Raw Response:", n8nRes.data);
      console.log("[Pensioner Document Verification] n8n result:", n8nRes.data);

      if (typeof n8nRes.data === "string") {
        console.warn("[Pensioner Document Verification] n8n returned a plain string:", n8nRes.data);
        return res.status(400).json({ message: "n8n returned a non-JSON response" });
      }

      const raw = n8nRes.data;

      const unwrapObject = (value: unknown): Record<string, any> | null => {
        let current = value;

        while (Array.isArray(current) && current.length > 0) {
          current = current[0];
        }

        if (!current || typeof current !== "object") {
          return null;
        }

        const record = current as Record<string, any>;
        const nestedKeys = ["data", "result", "response", "body"];

        for (const key of nestedKeys) {
          const nested = record[key];
          if (nested && typeof nested === "object") {
            const unwrapped = unwrapObject(nested);
            if (unwrapped) {
              return { ...record, ...unwrapped };
            }
          }
        }

        return record;
      };

      const extractSuccess = (value: unknown): boolean | null => {
        if (typeof value === "boolean") {
          return value;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            const extracted = extractSuccess(item);
            if (extracted !== null) {
              return extracted;
            }
          }
          return null;
        }

        if (!value || typeof value !== "object") {
          return null;
        }

        const record = value as Record<string, any>;
        const directKeys = ["success", "isValid", "matched", "verified", "valid"];
        for (const key of directKeys) {
          if (typeof record[key] === "boolean") {
            return record[key];
          }
        }

        const nestedKeys = ["data", "result", "response", "body"];
        for (const key of nestedKeys) {
          const extracted = extractSuccess(record[key]);
          if (extracted !== null) {
            return extracted;
          }
        }

        return null;
      };

      const item = unwrapObject(raw);

      if (!item || typeof item !== "object") {
        console.error("[Pensioner Verification] Unexpected n8n response format", { raw });
        return res.status(400).json({ message: "პენსიონერის დოკუმენტის გადამოწმება ვერ მოხერხდა" });
      }

      // Normalize n8n field names: n8n returns name/surname, not firstName/lastName
      const ocrFirstName = item.firstName || item.name || null;
      const ocrLastName = item.lastName || item.surname || null;
      const ocrPersonalId = item.personalId || item.personalNumber || item.idNumber || null;

      console.log("[Pensioner Verification] Incoming form data:", {
        formFirstName: firstName,
        formLastName: lastName,
        formPersonalId: personalId,
        formIdNumber: idNumber,
      });
      console.log("[Pensioner Verification] n8n OCR data (normalized):", {
        ocrFirstName,
        ocrLastName,
        ocrPersonalId,
        rawItemKeys: Object.keys(item),
      });

      const extractedSuccess = extractSuccess(raw);

      // If n8n already resolved success/failure, pass through.
      // But also apply our own loosened matching if form identity data was provided.
      if (firstName || lastName || personalId || idNumber) {
        const normName = (v: unknown) =>
          String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
        const normId = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, "");

        const nameMatch = (ocrVal: unknown, formVal: unknown) => {
          const a = normName(ocrVal);
          const b = normName(formVal);
          if (!b) return true;
          if (a === b) return true;
          if (a.includes(b) || b.includes(a)) return true;
          if (a.replace(/\s/g, "") === b.replace(/\s/g, "")) return true;
          return false;
        };

        const fMatch = !firstName || nameMatch(ocrFirstName, firstName);
        const lMatch = !lastName || nameMatch(ocrLastName, lastName);
        const idKey = personalId || idNumber;
        const ocrId = normId(ocrPersonalId);
        const formId = normId(idKey);
        const idMatch = !idKey || (ocrId.length > 0 && formId.length > 0 && ocrId === formId);

        console.log("[Pensioner Verification] Comparison result:", {
          fMatch,
          lMatch,
          idMatch,
          ocrFirstName_norm: normName(ocrFirstName),
          formFirstName_norm: normName(firstName),
          ocrLastName_norm: normName(ocrLastName),
          formLastName_norm: normName(lastName),
          ocrId,
          formId,
        });

        if (!fMatch || !lMatch || !idMatch) {
          const mismatches: string[] = [];
          if (!fMatch) mismatches.push("სახელი");
          if (!lMatch) mismatches.push("გვარი");
          if (!idMatch) mismatches.push("პირადი ნომერი");
          console.warn("[Pensioner Verification] Data mismatch:", mismatches.join(", "));
          return res.json({
            success: false,
            firstName: ocrFirstName,
            lastName: ocrLastName,
            personalId: ocrPersonalId,
            mismatch: mismatches,
            message: `მონაცემები არ ემთხვევა: ${mismatches.join(", ")}`,
          });
        }
      }

      if (extractedSuccess === false) {
        return res.json({
          success: false,
          firstName: ocrFirstName,
          lastName: ocrLastName,
          personalId: ocrPersonalId,
        });
      }

      if (extractedSuccess === null && !ocrFirstName && !ocrLastName && !ocrPersonalId) {
        console.error("[Pensioner Verification] Could not determine verification result from n8n response", { raw });
        return res.status(502).json({ message: "პენსიონერის ვერიფიკაციის პასუხის დამუშავება ვერ მოხერხდა" });
      }

      res.json({
        success: extractedSuccess ?? item.success ?? true,
        firstName: ocrFirstName,
        lastName: ocrLastName,
        personalId: ocrPersonalId,
      });
    } catch (err: any) {
      console.error("[Pensioner Document Verification] Error:", err);
      if (err.code === "ECONNABORTED") {
        return res.status(504).json({ message: "n8n verification request timed out after 120 seconds" });
      }
      const message = err.response?.data || err.message;
      res.status(500).json({ message: typeof message === "string" ? message : JSON.stringify(message) });
    }
  });

  app.post("/api/submit-order", async (req: Request, res: Response) => {
    try {
      const input = submissionSchema.parse(req.body);
      const finalWebhookUrl = process.env.SUBMIT_ALL_DATA_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f";
      const n8nRes = await axios.post(finalWebhookUrl, input, {
        headers: { "Content-Type": "application/json" },
        timeout: 120000,
      });
      console.log("[Submit Order] n8n responded:", n8nRes.status);
      res.status(200).json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // Proxy the submission to n8n webhook (JWT auth — works for both admin and dealer sessions)
  app.post("/api/submission/submit", async (req: Request, res: Response) => {
    const bearerToken = req.headers.authorization?.split(" ")[1];
    const token =
      (bearerToken && bearerToken !== "null" && bearerToken !== "undefined" ? bearerToken : undefined)
      || req.cookies?.auth_token
      || req.cookies?.admin_token
      || req.cookies?.dealer_token;
    if (!token) return res.status(401).json({ message: "Not authenticated" });
    let dealerId: number | undefined;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      dealerId = decoded.dealerId;
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    try {
      const input = submissionSchema.parse(req.body);

      // Normalize gender to Georgian + boolean flags
      const genderMap: Record<string, string> = { M: "მამრობითი", F: "მდედრობითი", m: "მამრობითი", f: "მდედრობითი" };
      const genderGeo = genderMap[input.gender] || input.gender || "NONE";
      const rawGender = String(input.gender ?? "").trim().toLowerCase();
      const isFemale = rawGender === "f" || rawGender.startsWith("f ") || rawGender.includes("ქალ") || rawGender.includes("female");
      const isMale = rawGender === "m" || rawGender.startsWith("m ") || rawGender.includes("კაც") || rawGender.includes("male");

      // Map model code/name to required full display string
      const modelDisplayMap: Record<string, string> = {
        "A1-MZ-08": "ენერგოეფექტური ღუმელი MZ-08 (A1)",
        "B1-MZ-18": "ენერგოეფექტური ღუმელი MZ-18 (B1)",
        "F1-MZ-25": "ენერგოეფექტური ღუმელი MZ-25 (F1)",
        "G1-MZ-26": "ენერგოეფექტური ღუმელი MZ-26 (G1)",
        "L1-MZ-27": "ენერგოეფექტური ღუმელი MZ-27 (L1)",
        "C1 ბუხარი": "ენერგოეფექტური ღუმელი - (C1)",
      };

      const rawModelName = input.model || "NONE";
      const ovenName = modelDisplayMap[rawModelName] || rawModelName;

      let supplierProfile = input.supplierProfile;
      if (dealerId) {
        const dealerRecord = await storage.getDealerById(dealerId);
        if (dealerRecord) {
          supplierProfile = dealerRecord.identificationCode;
        }
      }

      const payload = {
        ...input,
        gender: genderGeo,
        famale: Boolean(isFemale && !isMale),
        male: Boolean(isMale && !isFemale),
        product_name: ovenName,
        oven_name: ovenName,
        pensioner: input.pensioner ? "True" : "False",
        supplierProfile,
      };

      const finalWebhookUrl = process.env.SUBMIT_ALL_DATA_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f";
      const n8nRes = await axios.post(finalWebhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 120000,
      });
      console.log("[Submission Submit] n8n responded:", n8nRes.status);
      res.status(200).json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const firstErr = err.errors[0];
        return res.status(400).json({
          message: `${firstErr.path.join(".")}: ${firstErr.message}`,
          field: firstErr.path.join("."),
        });
      }
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // Workspace submission — dealer JWT auth (cookie or Bearer), tags dealer_id
  app.post("/api/workspace/submit", async (req: Request, res: Response) => {
    const bearerToken = req.headers.authorization?.split(" ")[1];
    const token =
      (bearerToken && bearerToken !== "null" && bearerToken !== "undefined" ? bearerToken : undefined)
      || req.cookies?.dealer_token
      || req.cookies?.auth_token;
    if (!token) return res.status(401).json({ message: "Not authenticated" });

    let dealerId: number;
    let dealerKey: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (decoded.role !== "dealer") throw new Error();
      dealerId = decoded.dealerId;
      dealerKey = decoded.dealerKey;
    } catch {
      return res.status(401).json({ message: "Invalid dealer token" });
    }

    try {
      const input = submissionSchema.parse(req.body);

      // Authoritative dealer name from DB — cannot be tampered with by the frontend
      const dealerRecord = await storage.getDealerById(dealerId);
      const dealerName = dealerRecord?.name || input.supplierName || "";
      const dealerIdentificationCode = (dealerRecord as any)?.identificationCode || "";

      const allProducts = await storage.getProducts(dealerId);
      const selectedProduct = allProducts.find(
        (p) => p.name === input.model || p.id.toString() === input.model,
      );

      const deliveryFee = dealerKey === "iron" ? Math.max(0, Number(input.deliveryFee ?? 0)) : 0;
      const ironPlusFee = dealerKey === "iron" && input.model.includes("L1-MZ-27") && input.ironPlus ? 100 : 0;

      const pricing = selectedProduct
        ? calculateConditionalDiscountPricing({
          product: selectedProduct,
          sociallyVulnerable: Boolean(input.sociallyVulnerable),
          pensioner: Boolean(input.pensioner),
          deliveryFee,
          ironPlusFee,
        })
        : {
          price: input.price,
          subsidyRate: input.subsidyRate,
          finalPayable: input.finalPayable,
        };

      // Map gender code to Georgian
      const genderMap: Record<string, string> = { M: "მამრობითი", F: "მდედრობითი", m: "მამრობითი", f: "მდედრობითი" };
      const genderGeo = genderMap[input.gender] || input.gender || "NONE";

      const rawGender = String(input.gender ?? "").trim().toLowerCase();
      const isFemale = rawGender === "f" || rawGender.startsWith("f ") || rawGender.includes("ქალ") || rawGender.includes("female");
      const isMale = rawGender === "m" || rawGender.startsWith("m ") || rawGender.includes("კაც") || rawGender.includes("male");

      const modelDisplayMap: Record<string, string> = {
        "A1-MZ-08": "ენერგოეფექტური ღუმელი MZ-08 (A1)",
        "B1-MZ-18": "ენერგოეფექტური ღუმელი MZ-18 (B1)",
        "F1-MZ-25": "ენერგოეფექტური ღუმელი MZ-25 (F1)",
        "G1-MZ-26": "ენერგოეფექტური ღუმელი MZ-26 (G1)",
        "L1-MZ-27": "ენერგოეფექტური ღუმელი MZ-27 (L1)",
        "C1 ბუხარი": "ენერგოეფექტური ღუმელი - (C1)",
      };

      // Derived fields
      const legalAddress = input.legalAddress || "NONE";
      const rawModelName = selectedProduct?.name || input.model || "NONE";
      const ovenName = modelDisplayMap[rawModelName] || rawModelName;
      const productName = ovenName;
      const serialNumber = selectedProduct?.id?.toString() || input.supplierId || "NONE";
      const totalPriceRaw = selectedProduct ? (selectedProduct.price / 100) : input.price;
      const userCopayment = pricing.finalPayable;
      const fullName = `${input.firstName} ${input.lastName}`;
      const installationAddressFull = [input.cityDistrict, input.addressVillage]
        .filter(Boolean)
        .join(", ") || "NONE";

      const supplierProfile = dealerIdentificationCode;

      const payload = {
        // Raw form data + server-calculated pricing
        ...input,
        pensioner: input.pensioner ? "True" : "False",
        supplierProfile,
        gender: genderGeo,
        famale: Boolean(isFemale && !isMale),
        male: Boolean(isMale && !isFemale),
        ...pricing,
        supplierName: dealerName,
        dealerName,
        deliveryFee,
        ironPlusFee,
        dealer_id: dealerId,
        dealer_key: dealerKey,
        dealer_identification_code: dealerIdentificationCode,

        // Product Details
        product_name: productName,
        oven_name: ovenName,
        serial_number: serialNumber,
        dealer_name: dealerName,
        total_price_raw: totalPriceRaw,

        // Financials
        user_copayment: userCopayment,

        // Legal & Installation Address
        legal_address: legalAddress,
        region: input.region || "NONE",
        municipality: input.municipality || "NONE",
        city_village: input.city || "NONE",
        installation_address: installationAddressFull,

        // Simplified address fields (new)
        city_district: input.cityDistrict || "NONE",
        address_village: input.addressVillage || "NONE",

        // Verification Context
        personalId: input.idNumber,
        fullName,

        // 1. ზოგადი ინფორმაცია პოტენციური ბენეფიციარის შესახებ
        "1.1_სახელი_და_გვარი": fullName,
        "1.2_პირადი_ნომერი": input.idNumber,
        "1.3_მობილურის_ნომერი": input.phone,
        "1.4_დამატებითი_ტელეფონი": "NONE",
        "1.5_ელ_ფოსტა": "NONE",
        "1.6_სქესი": genderGeo,
        "1.7_იურიდიული_მისამართი": legalAddress,
        "1.7.1_რეგიონი": input.region || "NONE",
        "1.7.2_მუნიციპალიტეტი": input.municipality || "NONE",
        "1.7.3_ქალაქი_სოფელი": input.city || "NONE",
        "1.7.4_მონტაჟის_ქალაქი_რაიონი": input.cityDistrict || "NONE",
        "1.7.5_მონტაჟის_მისამართი_სოფელი": input.addressVillage || "NONE",
        "1.8_სოციალურად_დაუცველი": input.sociallyVulnerable ? "კი" : "არა",
        "1.9_მომთაბარე": input.nomadic ? "კი" : "არა",
        "1.10_პენსიონერი": input.pensioner ? "True" : "False",
        "1.10_დამატებითი_ინფორმაცია": "NONE",
        "1.11_დამატებითი_ინფორმაცია": "NONE",
      };

      // Log payload (skip huge base64 strings)
      const logSafe = Object.fromEntries(
        Object.entries(payload).map(([k, v]) => [k, typeof v === "string" && (v as string).length > 500 ? `[base64 ${(v as string).length} chars]` : v])
      );
      console.log("Final Submission Payload:", JSON.stringify(logSafe, null, 2));

      const finalWebhookUrl = process.env.SUBMIT_ALL_DATA_WEBHOOK || "https://n8n.srv1020074.hstgr.cloud/webhook/69083b0e-989b-4fa9-a091-0bd322884e1f";

      const n8nRes = await axios.post(finalWebhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
        maxBodyLength: Infinity,
        timeout: 120000,
      });

      console.log("[Workspace Submit] n8n responded:", n8nRes.status);
      return res.status(200).json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const firstErr = err.errors[0];
        const field = firstErr.path.join(".");
        console.error("[Workspace Submit] Zod validation errors:", err.errors.map(e => `${e.path.join(".")}: ${e.message}`));
        return res.status(400).json({
          message: `${field}: ${firstErr.message}`,
          field,
        });
      }
      return res.status(500).json({ message: (err as Error).message });
    }
  });

  // Public Products Route
  app.get("/api/products", async (req, res) => {
    try {
      const dealerKeyRaw = req.query.dealer;
      const dealerKey = (Array.isArray(dealerKeyRaw) ? dealerKeyRaw[0] : dealerKeyRaw) as string | undefined;
      const dealerId = dealerKey ? await storage.getDealerIdByKey(dealerKey) : await storage.getDealerIdByKey("iron");
      if (!dealerId) return res.status(404).json({ message: "Dealer not found" });
      const products = await storage.getProducts(dealerId);
      res.json(products);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // Public Branches Route
  app.get("/api/branches", async (req, res) => {
    try {
      const dealerKeyRaw = req.query.dealer;
      const dealerKey = (Array.isArray(dealerKeyRaw) ? dealerKeyRaw[0] : dealerKeyRaw) as string | undefined;
      const dealerId = dealerKey ? await storage.getDealerIdByKey(dealerKey) : await storage.getDealerIdByKey("iron");
      if (!dealerId) return res.status(404).json({ message: "Dealer not found" });
      const branches = await storage.getBranches(dealerId);
      res.json(branches);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // Admin Routes
  app.post("/api/admin/login", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (email === ADMIN_EMAIL && bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
      const token = jwt.sign({ email, role: "admin" }, JWT_SECRET, { expiresIn: "2h" });
      res.cookie("auth_token", token, securityConfig.cookieOptions);
      res.cookie("admin_token", token, securityConfig.cookieOptions);
      return res.json({ role: "admin", redirect: "/admin/dashboard" });
    }
    res.status(401).json({ message: "Invalid credentials" });
  });

  // ── Dealer Auth ──
  app.post("/api/dealer/login", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    try {
      console.log("[Dealer Login] Attempt:", { email: String(email) });
      const dealer = await storage.getDealerByEmail(email);
      if (!dealer || !dealer.password) {
        console.warn("[Dealer Login] Invalid credentials:", {
          email: String(email),
          dealerFound: Boolean(dealer),
          hasPasswordHash: Boolean(dealer?.password),
        });
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const valid = bcrypt.compareSync(password, dealer.password);
      if (!valid) {
        console.warn("[Dealer Login] Password mismatch:", { email: String(email), dealerId: dealer.id, dealerKey: dealer.key });
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const token = jwt.sign(
        { dealerId: dealer.id, dealerKey: dealer.key, email: dealer.email, role: "dealer" },
        JWT_SECRET,
        { expiresIn: "2h" }
      );
      res.cookie("auth_token", token, securityConfig.cookieOptions);
      res.cookie("dealer_token", token, securityConfig.cookieOptions);
      console.log("[Dealer Login] Success:", { dealerId: dealer.id, dealerKey: dealer.key, email: dealer.email });
      return res.json({ role: "dealer", dealer: { id: dealer.id, key: dealer.key, name: dealer.name, email: dealer.email } });
    } catch (err) {
      console.error("[Dealer Login] Error:", err);
      return res.status(500).json({ message: "Login failed" });
    }
  });

  app.get("/api/dealer/me", withAuth as any, withDealerOnly as any, async (req: Request, res: Response) => {
    try {
      const dealerId = (req as AuthRequest).user?.dealerId;
      if (!dealerId) return res.status(401).json({ message: "Unauthorized" });
      const dealer = await storage.getDealerById(dealerId);
      if (!dealer) return res.status(404).json({ message: "Dealer not found" });
      return res.json({ id: dealer.id, key: dealer.key, name: dealer.name, email: dealer.email });
    } catch {
      return res.status(401).json({ message: "Unauthorized" });
    }
  });

  app.get("/api/admin/me", authenticateAdmin, (req: Request, res: Response) => {
    return res.json({ role: "admin", email: (req as any).adminEmail || ADMIN_EMAIL });
  });

  // ── Admin Dealer Management ──
  app.get("/api/admin/dealers", authenticateAdmin, async (_req: Request, res: Response) => {
    try {
      const allDealers = await storage.getAllDealers();
      const safe = allDealers.map(({ password: _pwd, ...rest }) => rest);
      res.json(safe);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.post("/api/admin/dealers", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const { name, email, password: rawPassword, identificationCode } = req.body;
      if (!name || !email || !rawPassword || !identificationCode) {
        return res.status(400).json({ message: "Name, identification code, email, and password are required" });
      }

      const idCodeStr = String(identificationCode).trim();
      if (!/^(\d{9}|\d{11})$/.test(idCodeStr)) {
        return res.status(400).json({ message: "Identification code must be 9 or 11 digits" });
      }

      const existing = await storage.getDealerByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Dealer with this email already exists" });
      }

      const key = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const hashedPassword = bcrypt.hashSync(rawPassword, 10);

      const dealer = await storage.createDealer({
        key,
        name,
        identificationCode: idCodeStr,
        email,
        password: hashedPassword,
      });

      // Note: Webhook configuration is hardcoded in DEFAULT_WEBHOOKS constant
      // and should be used by frontend when making requests to vision endpoints

      const { password: _, ...safe } = dealer;
      res.json({ ...safe, webhooks: DEFAULT_WEBHOOKS });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("duplicate key") || message.includes("unique")) {
        return res.status(409).json({ message: "Dealer with this key or email already exists" });
      }
      res.status(500).json({ message });
    }
  });

  app.patch("/api/admin/dealers/:id", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const { name, email, password: rawPassword, identificationCode } = req.body;
      const update: any = {};
      if (name) update.name = name;
      if (identificationCode !== undefined) {
        const idCodeStr = String(identificationCode).trim();
        if (!/^(\d{9}|\d{11})$/.test(idCodeStr)) {
          return res.status(400).json({ message: "Identification code must be 9 or 11 digits" });
        }
        update.identificationCode = idCodeStr;
      }
      if (email) update.email = email;
      if (rawPassword) update.password = bcrypt.hashSync(rawPassword, 10);

      const dealer = await storage.updateDealer(id, update);
      const { password: _, ...safe } = dealer;
      res.json(safe);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("duplicate key") || message.includes("unique")) {
        return res.status(409).json({ message: "Dealer with this email already exists" });
      }
      res.status(400).json({ message });
    }
  });

  app.delete("/api/admin/dealers/:id", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      await storage.deleteDealerCascade(id);
      res.sendStatus(200);
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  });

  app.get("/api/admin/products", authenticateAdmin, async (req: Request, res: Response) => {
    const dealerId = await resolveDealerId(req, res);
    if (!dealerId) return;
    const products = await storage.getProducts(dealerId);
    res.json(products);
  });

  // Branch management (Admin)
  app.get("/api/admin/branches", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const branches = await storage.getBranches(dealerId);
      res.json(branches);
    } catch (err) {
      console.error("Error fetching branches:", err);
      res.status(500).json({ message: "Failed to load branches", error: (err as Error).message });
    }
  });

  app.post("/api/admin/branches", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ message: "Branch name is required" });
      const branch = await storage.createBranch({ dealerId, name });
      res.json(branch);
    } catch (err) {
      console.error("Error creating branch:", err);
      const message = (err as Error).message;
      if (message.includes("duplicate key") || message.includes("already exists") || message.includes("unique")) {
        return res.status(409).json({ message: "Branch with this name already exists" });
      }
      res.status(400).json({ message });
    }
  });

  app.patch("/api/admin/branches/:id", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const id = Number(req.params.id);
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ message: "Branch name is required" });
      const branch = await storage.updateBranch(dealerId, id, { name });
      res.json(branch);
    } catch (err) {
      console.error("Error updating branch:", err);
      const message = (err as Error).message;
      if (message.includes("duplicate key") || message.includes("already exists") || message.includes("unique")) {
        return res.status(409).json({ message: "Branch with this name already exists" });
      }
      res.status(400).json({ message });
    }
  });

  app.delete("/api/admin/branches/:id", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const id = Number(req.params.id);
      await storage.deleteBranch(dealerId, id);
      res.sendStatus(200);
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  });

  app.post("/api/admin/products", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      console.log("Admin Add Product Request:", req.body);
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const productData = {
        ...req.body,
        dealerId,
        price: Number(req.body.price),
        stock: Number(req.body.stock),
      };
      const product = await storage.createProduct(productData);
      res.json(product);
    } catch (err) {
      console.error("Error adding product:", err);
      res.status(400).json({ message: (err as Error).message });
    }
  });

  app.patch("/api/admin/products/:id", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const id = Number(req.params.id);
      const existing = await storage.getProduct(dealerId, id);
      if (!existing) return res.status(404).json({ message: "Product not found" });

      const input = z
        .object({
          name: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
          category: z.string().min(1).optional(),
          imageUrl: z.string().optional().nullable(),
          stock: z.coerce.number().int().optional(),
          price: z.coerce.number().int().optional(),
          discountPrice: z.coerce.number().int().optional().nullable(),
          discountPercentage: z.coerce.number().int().optional().nullable(),
          discountExpiry: z.coerce.string().optional().nullable(),
        })
        .parse(req.body);

      const update: any = { ...input };
      if (update.discountExpiry !== undefined) {
        update.discountExpiry = update.discountExpiry ? new Date(update.discountExpiry) : null;
      }

      const MAX_DISCOUNT_CENTS = 300 * 100;
      const priceCents = typeof update.price === "number" ? update.price : existing.price;

      // Enforce discount cap (50% up to 300 GEL) on any discount update.
      if (typeof update.discountPercentage === "number") {
        const pct = Math.max(0, Math.min(100, update.discountPercentage));
        const rawDiscount = Math.round(priceCents * (pct / 100));
        const discountAmount = Math.min(rawDiscount, MAX_DISCOUNT_CENTS);
        update.discountPrice = Math.max(0, priceCents - discountAmount);
        update.discountPercentage = pct;
      } else if (typeof update.discountPrice === "number") {
        const discountAmount = Math.max(0, priceCents - update.discountPrice);
        const cappedDiscountAmount = Math.min(discountAmount, MAX_DISCOUNT_CENTS);
        update.discountPrice = Math.max(0, priceCents - cappedDiscountAmount);
      }

      const product = await storage.updateProduct(dealerId, id, update);
      return res.json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(400).json({ message: (err as Error).message });
    }
  });

  app.patch("/api/admin/products/:id/price", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const id = Number(req.params.id);
      const existing = await storage.getProduct(dealerId, id);
      if (!existing) return res.status(404).json({ message: "Product not found" });
      const product = await storage.updateProduct(dealerId, id, { price: req.body.price });
      res.json(product);
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  });

  app.patch("/api/admin/products/:id/discount", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const dealerId = await resolveDealerId(req, res);
      if (!dealerId) return;
      const id = Number(req.params.id);
      const existing = await storage.getProduct(dealerId, id);
      if (!existing) return res.status(404).json({ message: "Product not found" });

      const MAX_DISCOUNT_CENTS = 300 * 100;
      const priceCents = existing.price;

      // If percentage is provided, compute discount price with cap.
      let discountPrice = req.body.discountPrice;
      let discountPercentage = req.body.discountPercentage;

      if (typeof discountPercentage === "number") {
        const pct = Math.max(0, Math.min(100, discountPercentage));
        const rawDiscount = Math.round(priceCents * (pct / 100));
        const discountAmount = Math.min(rawDiscount, MAX_DISCOUNT_CENTS);
        discountPrice = Math.max(0, priceCents - discountAmount);
        discountPercentage = pct;
      } else if (typeof discountPrice === "number") {
        const discountAmount = Math.max(0, priceCents - discountPrice);
        const cappedDiscountAmount = Math.min(discountAmount, MAX_DISCOUNT_CENTS);
        discountPrice = Math.max(0, priceCents - cappedDiscountAmount);
      }

      const product = await storage.updateProduct(dealerId, id, {
        discountPrice,
        discountPercentage,
        discountExpiry: req.body.discountExpiry ? new Date(req.body.discountExpiry) : null,
      });
      res.json(product);
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  });

  app.delete("/api/admin/products/:id", authenticateAdmin, async (req: Request, res: Response) => {
    const dealerId = await resolveDealerId(req, res);
    if (!dealerId) return;
    const id = Number(req.params.id);
    const existing = await storage.getProduct(dealerId, id);
    if (!existing) return res.status(404).json({ message: "Product not found" });
    await storage.deleteProduct(dealerId, id);
    res.sendStatus(200);
  });

  app.post("/api/admin/products/copy", authenticateAdmin, async (req: Request, res: Response) => {
    try {
      const input = z
        .object({ from: z.string().min(1), to: z.string().min(1) })
        .parse(req.body);

      const fromId = await storage.getDealerIdByKey(input.from);
      const toId = await storage.getDealerIdByKey(input.to);
      if (!fromId) return res.status(404).json({ message: "Source dealer not found" });
      if (!toId) return res.status(404).json({ message: "Target dealer not found" });

      const products = await storage.getProducts(fromId);
      let copied = 0;
      let updated = 0;
      for (const p of products) {
        const existing = (await storage.getProducts(toId)).find((x: any) => x.name === p.name);
        if (!existing) {
          await storage.createProduct({
            dealerId: toId,
            name: p.name,
            description: p.description,
            price: p.price,
            category: p.category,
            stock: p.stock,
            imageUrl: p.imageUrl,
          });
          copied++;
        } else {
          await storage.updateProduct(toId, existing.id, {
            description: p.description,
            price: p.price,
            category: p.category,
            imageUrl: p.imageUrl,
            stock: p.stock,
            discountPrice: p.discountPrice,
            discountPercentage: p.discountPercentage,
            discountExpiry: p.discountExpiry as any,
          } as any);
          updated++;
        }
      }

      return res.json({ success: true, copied, updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(500).json({ message: (err as Error).message });
    }
  });
  void (async () => {
    try {
      const demoUser = await storage.getUserByUsername("demo@example.com");
      if (!demoUser) {
        await storage.createUser({
          username: "demo@example.com",
          password: "Energo123#",
        });
      }
    } catch (e) {
      console.log("Error seeding demo user (tables might not exist yet):", e);
    }
  })();

  return httpServer;
}
