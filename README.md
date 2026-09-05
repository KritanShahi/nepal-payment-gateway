# nepal-payment-gateway 🇳🇵💳

[![npm version](https://img.shields.io/npm/v/nepal-payment-gateway.svg?style=flat-square)](https://www.npmjs.com/package/nepal-payment-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/github/actions/workflow/status/KritanShahi/nepal-payment-gateway/test.yml?branch=main&style=flat-square)](https://github.com/KritanShahi/nepal-payment-gateway/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)

A modern, unified Node.js SDK for **eSewa (ePay v2)** and **Khalti (ePayment v2)** — one simple API: create a session, redirect the user, verify the callback. Done.

```ts
const session = await gateway.createCheckout({
  gateway: 'khalti',            // or 'esewa' — identical call
  amount: 150000,               // paisa (Rs 1500)
  orderId: 'ORDER-123',
  orderName: 'Premium Plan',
  successUrl: 'https://myshop.com/api/pay/callback',
});
// → redirect the user to session.url
```

---

## ✨ Features

- 🛒 **Unified Checkout** — one `createCheckout()` / `verifyCallback()` API for both gateways; amounts always in paisa integers (no float bugs, no Rs-vs-paisa confusion).
- 🔌 **Drop-in route handlers** for **Next.js** (App Router) and **Express** — the entire initiate → callback → verify → fulfil lifecycle in one config object.
- 🔒 **Verification you can't skip** — eSewa HMAC signature checks + server-to-server status confirmation, Khalti lookup API. `success: true` means *verified paid*, never "the redirect said so".
- ⚡ **Direct redirect URLs for eSewa** — resolves eSewa's form POST server-side into a redirect URL (just like Khalti), with automatic fallback to the documented form flow.
- 🐛 **Battle-tested against real gateway quirks** — comma-formatted callback amounts (`"1,000.0"`), URL-mangled base64 payloads, late-loaded env vars (dotenv-safe).
- 📦 **Dual ESM/CJS**, 100% TypeScript, zero runtime dependencies (native `fetch` + `crypto`).

---

## 📥 Installation

```bash
npm install nepal-payment-gateway
# or: yarn add / pnpm add / bun add nepal-payment-gateway
```

Requires Node.js ≥ 18.

---

## 🧭 How a payment flows

Understanding this makes everything else obvious. Both gateways follow the same three steps, and secret keys never leave your server:

```
 Browser                    Your backend                     Gateway
    │                            │                              │
    │ 1. POST /checkout          │                              │
    │    { gateway, orderId }    │                              │
    │ ─────────────────────────► │  createCheckout()            │
    │                            │ ───────────────────────────► │
    │ ◄───── { url } ─────────── │ ◄──── session / redirect ─── │
    │                            │                              │
    │ 2. redirect to url ──────────────────────────────────────►│  user pays
    │                            │                              │
    │ ◄──────────── 3. gateway redirects to your callback ───── │
    │ ─────────────────────────► │  verifyCallback()            │
    │                            │ ── signature + status API ─► │
    │ ◄── redirect to success ── │  onSuccess → mark order paid │
```

**Never mark an order paid from the redirect alone.** Khalti's redirect params carry no signature, and eSewa's signed callback doesn't prevent replays. This SDK always confirms server-to-server before reporting `success: true`.

---

## 🚀 Backend Integration Guide

There are three levels of abstraction. Start at Level 1; drop down only if you need control.

### Level 1 — Drop-in route handlers (recommended)

One config object wires up the whole lifecycle: checkout endpoint, both gateway callbacks, verification, and your fulfilment hook.

#### Next.js (App Router)

Create a catch-all route at `app/api/pay/[...route]/route.ts`:

```ts
import { createNextCheckoutHandlers } from 'nepal-payment-gateway/next';

export const { GET, POST } = createNextCheckoutHandlers({
  esewa: {
    productCode: process.env.ESEWA_PRODUCT_CODE,
    secretKey: process.env.ESEWA_SECRET_KEY,
  },
  khalti: { secretKey: process.env.KHALTI_SECRET_KEY },
  isTest: process.env.NODE_ENV !== 'production',

  // SECURITY BOUNDARY: the amount comes from YOUR database, never the client.
  resolveOrder: async ({ orderId, gateway }) => {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error(`Unknown order ${orderId}`);
    return { amount: order.amountPaisa, orderName: order.title };
  },

  // Called ONLY after full verification (signature + status/lookup API).
  // May fire more than once if the user refreshes — make it idempotent.
  onSuccess: async (payment) => {
    await db.order.update({
      where: { id: payment.orderId },
      data: { status: 'PAID', gatewayTxnId: payment.transactionId },
    });
  },
  onFailure: async (payment) => {
    console.warn(`Payment ${payment.status} for order ${payment.orderId}`);
  },

  // Where the user's browser lands afterwards (your pages):
  successRedirect: '/payment/success',
  failureRedirect: '/payment/failed',
});
```

This exposes two routes:

| Route | Purpose |
|---|---|
| `POST /api/pay/checkout` | Create a session. Body: `{ "gateway": "esewa" \| "khalti", "orderId": "..." }` |
| `GET /api/pay/callback/{gateway}/{orderId}` | Gateway redirect target — handled entirely for you |

#### Express

```ts
import express from 'express';
import { createExpressCheckoutHandler } from 'nepal-payment-gateway/express';

const app = express();

app.use('/api/pay', createExpressCheckoutHandler({
  esewa: { productCode: process.env.ESEWA_PRODUCT_CODE, secretKey: process.env.ESEWA_SECRET_KEY },
  khalti: { secretKey: process.env.KHALTI_SECRET_KEY },
  isTest: true,
  resolveOrder: async ({ orderId }) => {
    const order = await Order.findById(orderId);
    return { amount: order.amountPaisa, orderName: order.title };
  },
  onSuccess: async (payment) => { await Order.markPaid(payment.orderId, payment.transactionId); },
  successRedirect: '/payment/success',
  failureRedirect: '/payment/failed',
}));

app.listen(3000);
```

> Running behind a proxy/tunnel? Set `origin: 'https://your-public-domain.com'` in the config so gateway callbacks point at the right host. Callbacks must be publicly reachable — for local development use a tunnel (e.g. `ngrok http 3000`).

#### The frontend side (any framework, ~10 lines)

The handlers speak plain JSON, so any client works:

```js
async function pay(gateway, orderId) {
  const res = await fetch('/api/pay/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gateway, orderId }),
  });
  const session = await res.json();

  if (session.url) {
    window.location.assign(session.url);      // Khalti always; eSewa almost always
  } else if (session.form) {                  // eSewa fallback: build & submit a form
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = session.form.action;
    for (const [name, value] of Object.entries(session.form.fields)) {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }
}

// <button onclick="pay('esewa', 'ORDER-123')">Pay with eSewa</button>
// <button onclick="pay('khalti', 'ORDER-123')">Pay with Khalti</button>
```

After payment, the user arrives at your `successRedirect`/`failureRedirect` page with `?gateway=&orderId=&sessionId=&status=&transactionId=` appended — display whatever you like; the order was already marked paid server-side in `onSuccess`.

### Level 2 — Unified checkout, your own routes

Use `createCheckout` / `verifyCallback` directly when you want your own route structure (Fastify, Hono, NestJS, raw Node, background jobs):

```ts
import { NepalPaymentGateway, rupeesToPaisa } from 'nepal-payment-gateway';

const gateway = new NepalPaymentGateway({
  isTest: true,
  esewa: { productCode: '...', secretKey: '...' },
  khalti: { secretKey: '...' },
});

// --- Initiate (in your checkout route) ---
const session = await gateway.createCheckout({
  gateway: 'esewa',                    // or 'khalti'
  amount: rupeesToPaisa(1500),         // 150000 paisa
  orderId: 'ORDER-123',
  orderName: 'Premium Plan',
  successUrl: 'https://myshop.com/pay/callback/esewa',   // must have NO query string (eSewa appends ?data=)
  failureUrl: 'https://myshop.com/pay/callback/esewa',   // eSewa only; Khalti uses successUrl for everything
});

await db.order.update({ where: { id: 'ORDER-123' }, data: { sessionId: session.sessionId } });

// session.url      → redirect the user here (Khalti always, eSewa when resolvable)
// session.form     → { action, fields } eSewa fallback for a browser form POST
// session.formHtml → ready-to-serve auto-submitting HTML page (eSewa)

// --- Verify (in your callback route) ---
const result = await gateway.verifyCallback({
  gateway: 'esewa',                                    // or 'khalti'
  query: Object.fromEntries(url.searchParams),         // or req.query
});

if (result.success) {
  // Signature verified AND gateway's server API confirmed COMPLETE/Completed.
  // result.sessionId  → match against the order you stored
  // result.transactionId, result.amount (paisa), result.raw
  await db.order.markPaid(...);
}
```

`verifyCallback` does everything required per gateway:

| | eSewa | Khalti |
|---|---|---|
| Decode callback | base64 `data` param (handles URL-mangling + comma amounts) | reads `pidx` |
| Authenticity | HMAC-SHA256 signature check (timing-safe) | n/a — redirect params are unsigned |
| Confirmation | status API (`/api/epay/transaction/status/`) | lookup API (`/epayment/lookup/`) |
| `success: true` means | signature valid **and** status `COMPLETE` | lookup status `Completed` |

### Level 3 — Per-gateway low-level APIs

Full control over each gateway (all methods also exist as standalone imports from `nepal-payment-gateway/esewa` and `nepal-payment-gateway/khalti`):

```ts
import { Esewa } from 'nepal-payment-gateway/esewa';
import { Khalti } from 'nepal-payment-gateway/khalti';

const esewa = new Esewa({ productCode: 'EPAYTEST', secretKey: '...', isTest: true });

// Amounts here are NPR (gateway-native units), not paisa
const init = esewa.initiatePayment({
  amount: 1000, taxAmount: 130, productDeliveryCharge: 50,
  transactionUuid: 'TXN-001', successUrl: '...', failureUrl: '...',
});                                            // → formFields, formHtml, signature
const withUrl = await esewa.createPaymentUrl({ ... });  // → same + redirectUrl (or null)
const decoded = esewa.decodeCallbackData(dataParam);
const valid   = esewa.verifySignature(decoded);
const status  = await esewa.verifyPayment({ transactionUuid, totalAmount, productCode });

const khalti = new Khalti({ secretKey: '...', isTest: true });
// Amounts here are paisa (gateway-native units)
const payment = await khalti.initiatePayment({
  returnUrl: '...', websiteUrl: '...', amount: 100000,
  purchaseOrderId: 'ORDER-1', purchaseOrderName: 'Plan',
  customerInfo: { name: 'Ram', email: 'ram@example.com', phone: '9800000001' },
});
const lookup = await khalti.verifyPayment({ pidx: payment.pidx });
```

---

## 💰 Amounts: paisa everywhere (in the unified API)

The unified `createCheckout`/`verifyCallback`/handler APIs use **integer paisa** (1 NPR = 100 paisa) — working in the smallest currency unit eliminates the two most common real-world bugs (floating-point rupees, and Khalti's paisa vs eSewa's rupees confusion). Helpers:

```ts
import { rupeesToPaisa, paisaToRupees } from 'nepal-payment-gateway';
rupeesToPaisa(1500.5)   // 150050
paisaToRupees(150050)   // 1500.5
```

Only the Level-3 per-gateway APIs keep each gateway's native unit (eSewa: NPR, Khalti: paisa).

---

## ⚙️ Environment Configuration

Everything is configurable via constructor options **or** environment variables (options win). Env vars are read lazily at call time, so `dotenv.config()` after import works fine.

| Variable | Meaning |
|---|---|
| `ESEWA_PRODUCT_CODE` | eSewa merchant code (`EPAYTEST` in sandbox) |
| `ESEWA_SECRET_KEY` | eSewa HMAC secret |
| `ESEWA_IS_TEST` | `true`/`false` — sandbox toggle |
| `ESEWA_BASE_URL` | custom endpoint override |
| `KHALTI_SECRET_KEY` | Khalti secret key (test or live) |
| `KHALTI_IS_TEST` | `true`/`false` — sandbox toggle |
| `KHALTI_BASE_URL` | custom endpoint override |

In test mode, eSewa credentials default to the public sandbox pair automatically. **Everything defaults to sandbox (`isTest: true`)** — set `isTest: false` explicitly for production.

---

## 🧪 Sandbox Test Credentials

### eSewa
- Product code `EPAYTEST`, secret `8gBm/:&EnhH.1/q` (public UAT credentials, auto-applied in test mode)
- Test login: eSewa ID `9806800001..5`, password `Nepal@123`, MPIN `1122`, OTP `123456`

### Khalti
- Get a **test** secret key from [test-admin.khalti.com](https://test-admin.khalti.com)
- Test payer: phone `9800000000`–`9800000005`, MPIN `1111`, OTP `987654`
- Minimum amount: 1000 paisa (Rs 10)

---

## ⚠️ Error Handling

```ts
import { ValidationError, EsewaError, KhaltiError, NepalPaymentGatewayError } from 'nepal-payment-gateway';

try {
  await gateway.createCheckout({ ... });
} catch (err) {
  if (err instanceof ValidationError)      console.error('Bad input:', err.missingFields ?? err.message);
  else if (err instanceof EsewaError)      console.error(`eSewa (HTTP ${err.statusCode}):`, err.message, err.details);
  else if (err instanceof KhaltiError)     console.error(`Khalti (HTTP ${err.statusCode}):`, err.message, err.details);
  else if (err instanceof NepalPaymentGatewayError) console.error(err.code, err.message);
}
```

Gateway rejections include the raw response in `err.details` (e.g. eSewa's `{ code: 'ES104', message: 'Invalid payload signature.' }`).

---

## 🔐 Security model (read this once)

1. **Secrets stay server-side.** Nothing in this package belongs in browser bundles.
2. **Amounts are resolved server-side.** The drop-in handlers force this via `resolveOrder`; if you build your own routes, never accept an amount from the client.
3. **Redirects are untrusted.** `verifyCallback` / the handlers always confirm with the gateway's server API before reporting success.
4. **`onSuccess` can repeat** (user refreshes the callback URL). Make fulfilment idempotent — e.g. `UPDATE orders SET status='PAID' WHERE id=? AND status!='PAID'`.
5. **Cross-check the amount.** In `onSuccess`, compare `payment.amount` (paisa) with your order's amount before fulfilling.

---

## 🛠️ Development

```bash
npm install
npm test              # unit tests (64)
npm run test:coverage
npm run build         # dual ESM/CJS + .d.ts via tsup
```

## 📄 License

MIT © [LICENSE](LICENSE)
