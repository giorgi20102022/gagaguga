# Security Implementation - Quick Start Guide

## 🚨 IMMEDIATE ACTIONS REQUIRED

### Step 1: Update Frontend Auth (Remove localStorage)

#### File: `client/src/hooks/use-dealer-auth.ts`

**BEFORE (INSECURE - uses localStorage):**
```typescript
const token = localStorage.getItem("dealer_token");
localStorage.setItem("dealer_token", token);
```

**AFTER (SECURE - uses HttpOnly cookies):**
```typescript
// Remove all localStorage references
// Cookies are automatically sent with credentials: "include"

const login = async (email: string, password: string) => {
  const res = await fetch("/api/dealer/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // Send cookies
    body: JSON.stringify({ email, password }),
  });
  
  if (!res.ok) throw new Error("Login failed");
  
  const { dealer } = await res.json();
  setDealer(dealer);
  setLocation("/workspace");
};

const logout = () => {
  fetch("/api/logout", { 
    method: "POST", 
    credentials: "include" 
  });
  setDealer(null);
  setLocation("/login");
};
```

#### File: `client/src/hooks/use-auth.ts`

Update similarly - remove localStorage, add `credentials: "include"` to all fetch calls.

### Step 2: Add Logout Endpoint

#### File: `server/routes.ts`

Add after login route:

```typescript
// Logout endpoint
app.post("/api/logout", (req: Request, res: Response) => {
  res.clearCookie("auth_token", securityConfig.cookieOptions);
  res.clearCookie("admin_token", securityConfig.cookieOptions);
  res.clearCookie("dealer_token", securityConfig.cookieOptions);
  res.json({ success: true });
});
```

### Step 3: Protect Admin Routes

Find all routes starting with `/api/admin/` and add middleware:

```typescript
// BEFORE:
app.get("/api/admin/dealers", async (req, res) => { ... });

// AFTER:
app.get("/api/admin/dealers", withAuth, withAdminOnly, async (req: AuthRequest, res) => {
  // Only admins can access this
});

app.post("/api/admin/dealers", withAuth, withAdminOnly, validateBody(dealerSchema), async (req: AuthRequest, res) => {
  // Create dealer with validation
});
```

### Step 4: Protect Dealer Routes with Scoping

```typescript
// Dealer "me" endpoint
app.get("/api/dealer/me", withAuth, withDealerOnly, async (req: AuthRequest, res) => {
  const dealerId = req.user!.dealerId;
  const dealer = await storage.getDealerById(dealerId);
  res.json(dealer);
});

// Workspace submission
app.post("/api/workspace/submit", withAuth, withDealerScope, validateBody(submissionSchema), async (req: AuthRequest, res) => {
  const dealerId = req.user!.dealerId;
  const dealerKey = req.user!.dealerKey;
  
  // Ensure submission is tied to authenticated dealer
  const payload = { ...req.body, dealer_id: dealerId, dealer_key: dealerKey };
  
  // Submit to webhook
  const response = await fetch(n8nWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  res.json({ success: true });
});
```

### Step 5: Add Dealer-Scoped Database Queries

**CRITICAL**: Prevent dealers from accessing other dealers' data

```typescript
// Products endpoint - MUST filter by dealer
app.get("/api/products", validateQuery(productQuerySchema), async (req, res) => {
  const dealerKey = req.query.dealer as string;
  const storage = getStorage();
  const dealerId = await storage.getDealerIdByKey(dealerKey);
  
  if (!dealerId) {
    return res.status(404).json({ message: "Dealer not found" });
  }
  
  // IMPORTANT: Filter by dealerId to prevent cross-dealer access
  const products = await db.query.products.findMany({
    where: eq(products.dealerId, dealerId)
  });
  
  res.json(products);
});
```

## 🔧 Testing the Security

### Test 1: Verify HttpOnly Cookies
1. Open browser DevTools → Application → Cookies
2. Login as dealer
3. Check for `auth_token` and `dealer_token` cookies
4. Verify `HttpOnly` flag is checked
5. Verify `Secure` flag (in production)
6. Verify `SameSite: Strict`

### Test 2: Verify Token Expiration
1. Login
2. Wait 2 hours
3. Try to access protected route
4. Should get 401 Unauthorized

### Test 3: Verify Cross-Dealer Protection
1. Login as Dealer A (e.g., Iron Plus)
2. Try to access Dealer B's products via API
3. Should be blocked or return empty

### Test 4: Verify Admin Protection
1. Login as dealer
2. Try to access `/api/admin/dealers`
3. Should get 403 Forbidden

### Test 5: Verify XSS Protection
1. Try to inject `<script>alert('XSS')</script>` in form fields
2. Should be sanitized/blocked by CSP headers

## 📋 Security Audit Checklist

Run these commands to verify security:

```bash
# 1. Check for localStorage usage (should find none in auth)
grep -r "localStorage" client/src/hooks/

# 2. Check bcrypt salt rounds (should be 12+)
grep -r "bcrypt.hashSync" server/

# 3. Check for unprotected admin routes
grep -r "app\.\(get\|post\|put\|delete\).*\/api\/admin\/" server/routes.ts

# 4. Check for credentials: "include" in fetch calls
grep -r "fetch.*credentials" client/src/

# 5. Verify JWT_SECRET in .env
cat .env | grep JWT_SECRET
```

## 🚀 Production Deployment

1. Generate strong secrets:
```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

2. Update `.env`:
```
NODE_ENV=production
JWT_SECRET=[generated-secret-1]
AUTH_SECRET=[generated-secret-2]
FRONTEND_URL=https://yourdomain.com
```

3. Verify SSL:
- Database: `sslmode=require` ✅ (already configured)
- Server: HTTPS enabled on hosting platform

4. Test all security measures before going live

## ⚡ Quick Fix Summary

**What's Done:**
- ✅ Helmet.js security headers
- ✅ CORS restricted to frontend URL
- ✅ HttpOnly cookies configured
- ✅ JWT 2-hour expiration
- ✅ Bcrypt 12 salt rounds
- ✅ Middleware created (withAuth, withAdminOnly, withDealerScope)
- ✅ Zod validation schemas

**What's Needed:**
- ⚠️ Update frontend to use cookies (remove localStorage)
- ⚠️ Add logout endpoint
- ⚠️ Protect all admin routes with middleware
- ⚠️ Add dealer-scoped queries to prevent cross-access
- ⚠️ Test thoroughly

**Time Estimate:** 2-3 hours to complete remaining tasks
