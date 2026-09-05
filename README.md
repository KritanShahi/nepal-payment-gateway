# nepal-payment-gateway

[![npm version](https://img.shields.io/npm/v/nepal-payment-gateway.svg?style=flat-square)](https://www.npmjs.com/package/nepal-payment-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/github/actions/workflow/status/KritanShahi/nepal-payment-gateway/test.yml?branch=main&style=flat-square)](https://github.com/KritanShahi/nepal-payment-gateway/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)

A unified Node.js SDK for **eSewa (ePay v2)** and **Khalti (ePayment v2)**. One simple flow for both gateways: create a session, redirect the user, verify the callback.

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

**Highlights**

- One API for both gateways — amounts always in integer paisa, no unit confusion.
- Drop-in route handlers for Next.js and Express: the whole initiate → callback → verify lifecycle from one config object.
- Verification you can trust: `success: true` always means *confirmed by the gateway's server API*, never "the redirect said so".
- Direct redirect URLs for eSewa (resolved server-side, like Khalti), with automatic fallback to the official form flow.
- Handles real-world gateway quirks: comma-formatted amounts, URL-mangled callbacks, late-loaded env vars.
- Zero runtime dependencies. Dual ESM/CJS. Fully typed.

---

## Contents

1. [Installation](#installation)
2. [How a payment works](#how-a-payment-works)
3. [Quick start](#quick-start)
4. [Choosing an integration level](#choosing-an-integration-level)
5. [Level 2 — unified API, your own routes](#level-2--unified-api-your-own-routes)
6. [Level 3 — gateway-level APIs](#level-3--gateway-level-apis)
7. [Separate frontend and backend](#separate-frontend-and-backend)
8. [Reconciliation — don't rely on the redirect alone](#reconciliation--dont-rely-on-the-redirect-alone)
9. [Reference](#reference) — amounts · configuration · sandbox credentials · errors · security checklist

---

## Installation

```bash
npm install nepal-payment-gateway     # or yarn / pnpm / bun
```

Requires Node.js ≥ 18. Server-side only — secret keys must never reach the browser.

---

## How a payment works

Both gateways follow the same three steps:

```
 Browser                    Your backend                     Gateway
    │                            │                              │
    │ 1. POST /checkout          │                              │
    │ ─────────────────────────► │  create session              │
    │ ◄───────── { url } ─────── │ ◄──────────────────────────► │
    │                            │                              │
    │ 2. redirect to url ──────────────────────────────────────►│  user pays
    │                            │                              │
    │ ◄──────── 3. gateway redirects back to your callback ──── │
    │ ─────────────────────────► │  verify with gateway API     │
    │ ◄── redirect to success ── │  → mark order paid           │
```

**The one rule that matters:** never mark an order paid from the redirect alone. Khalti's redirect params carry no signature, and eSewa's signed callback doesn't prevent replays. This SDK always confirms server-to-server before reporting `success: true`.

---

## Quick start

The fastest path is the drop-in handler (Level 1). One config object wires up the checkout endpoint, both gateway callbacks, verification, and your fulfilment hook.

### Express

```ts
import express from 'express';
import { createExpressCheckoutHandler } from 'nepal-payment-gateway/express';

const app = express();

app.use('/api/pay', createExpressCheckoutHandler({
  esewa: { productCode: process.env.ESEWA_PRODUCT_CODE, secretKey: process.env.ESEWA_SECRET_KEY },
  khalti: { secretKey: process.env.KHALTI_SECRET_KEY },
  isTest: true,   // sandbox — set false in production

  // SECURITY BOUNDARY: the price comes from YOUR side, never from the client.
  resolveOrder: async ({ orderId }) => {
    // look up the order however your app stores it
    return { amount: 150000, orderName: 'Premium Plan' };   // paisa
  },

  // Called ONLY after full verification. May fire more than once
  // (user refreshes the callback page) — make it idempotent.
  onSuccess: async (payment) => {
    // mark payment.orderId as paid; keep payment.transactionId for your records
  },
  onFailure: async (payment) => {
    // optional: log/flag payment.status for payment.orderId
  },

  // Where the user's browser lands afterwards:
  successRedirect: '/payment/success',
  failureRedirect: '/payment/failed',
}));

app.listen(3000);
```

### Next.js (App Router)

Same config, mounted as a catch-all route in `app/api/pay/[...route]/route.ts`:

```ts
import { createNextCheckoutHandlers } from 'nepal-payment-gateway/next';

export const { GET, POST } = createNextCheckoutHandlers({
  /* identical config object as the Express example */
});
```

### Routes you get

| Route | Purpose |
|---|---|
| `POST /api/pay/checkout` | Create a session. Body: `{ "gateway": "esewa" \| "khalti", "orderId": "..." }` |
| `GET /api/pay/callback/{gateway}/{orderId}` | Gateway redirect target — verification handled for you |

### The frontend side (~10 lines, any framework)

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
  } else if (session.form) {                  // eSewa fallback: submit a form
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
```

```html
<button onclick="pay('esewa', 'ORDER-123')">Pay with eSewa</button>
<button onclick="pay('khalti', 'ORDER-123')">Pay with Khalti</button>
```

After payment the user arrives at your `successRedirect` / `failureRedirect` page with `?gateway=&orderId=&sessionId=&status=&transactionId=` appended. The order was already marked paid server-side in `onSuccess` — the page is purely presentational.

> Running behind a proxy or tunnel? Set `origin: 'https://your-public-domain.com'` in the config so callback URLs point at the right host. For local development use a tunnel (e.g. `ngrok http 3000`) — gateways must be able to reach your callback URL through a browser.

---

## Choosing an integration level

The package has three entry points. They are layers of the same code — Level 1 is built on Level 2, which is built on Level 3 — so you can mix them freely.

| Level | Import | Use when |
|---|---|---|
| **1 — Drop-in handlers** | `nepal-payment-gateway/next`, `/express` | You use Next.js or Express and want payments working in minutes. **Start here.** |
| **2 — Unified API** | `createCheckout`, `verifyCallback` | You want your own routes/framework (Fastify, Hono, NestJS, raw Node) but not gateway differences. |
| **3 — Gateway APIs** | `Esewa`, `Khalti` classes | You need full control: custom flows, eSewa charge breakdowns, mobile-app backends, reconciliation jobs. |

---

## Level 2 — unified API, your own routes

```ts
import { NepalPaymentGateway, rupeesToPaisa } from 'nepal-payment-gateway';

const gateway = new NepalPaymentGateway({
  isTest: true,
  esewa: { productCode: '...', secretKey: '...' },
  khalti: { secretKey: '...' },
});
```

**Initiate** (in your checkout route):

```ts
const session = await gateway.createCheckout({
  gateway: 'esewa',                    // or 'khalti'
  amount: rupeesToPaisa(1500),         // 150000 paisa
  orderId: 'ORDER-123',
  orderName: 'Premium Plan',
  successUrl: 'https://myshop.com/pay/callback/esewa',   // NO query string (eSewa appends ?data=)
  failureUrl: 'https://myshop.com/pay/callback/esewa',   // eSewa only; Khalti reuses successUrl
});

// Store session.sessionId with your order — you'll need it to verify later.
// session.url      → redirect the user here (Khalti always, eSewa when resolvable)
// session.form     → { action, fields } eSewa fallback for a browser form POST
// session.formHtml → ready-to-serve auto-submitting HTML page (eSewa)
```

**Verify** (in your callback route):

```ts
const result = await gateway.verifyCallback({
  gateway: 'esewa',                                    // or 'khalti'
  query: Object.fromEntries(url.searchParams),         // or req.query
});

if (result.success) {
  // Fully verified paid. result.sessionId ties back to your order;
  // result.transactionId and result.amount (paisa) are the gateway's records.
}
```

What `verifyCallback` does per gateway:

| | eSewa | Khalti |
|---|---|---|
| Decode callback | base64 `data` param (handles URL-mangling, comma amounts) | reads `pidx` |
| Authenticity | HMAC-SHA256 signature check (timing-safe) | n/a — redirect params are unsigned |
| Confirmation | transaction status API | lookup API |
| `success: true` means | signature valid **and** status `COMPLETE` | lookup status `Completed` |

---

## Level 3 — gateway-level APIs

Full control over each gateway, in each gateway's native units (eSewa: NPR, Khalti: paisa). Also available as standalone imports from `nepal-payment-gateway/esewa` and `nepal-payment-gateway/khalti`.

```ts
import { Esewa } from 'nepal-payment-gateway/esewa';
import { Khalti } from 'nepal-payment-gateway/khalti';

const esewa = new Esewa({ productCode: 'EPAYTEST', secretKey: '...', isTest: true });

const init = esewa.initiatePayment({           // → formFields, formHtml, signature
  amount: 1000, taxAmount: 130, productDeliveryCharge: 50,
  transactionUuid: 'TXN-001', successUrl: '...', failureUrl: '...',
});
const withUrl = await esewa.createPaymentUrl({ /* same params */ });  // → same + redirectUrl (or null)
const decoded = esewa.decodeCallbackData(dataParam);
const valid   = esewa.verifySignature(decoded);
const status  = await esewa.verifyPayment({ transactionUuid, totalAmount, productCode });

const khalti = new Khalti({ secretKey: '...', isTest: true });

const payment = await khalti.initiatePayment({
  returnUrl: '...', websiteUrl: '...', amount: 100000,       // paisa
  purchaseOrderId: 'ORDER-1', purchaseOrderName: 'Plan',
  customerInfo: { name: 'Ram', email: 'ram@example.com', phone: '9800000001' },
});
const lookup = await khalti.verifyPayment({ pidx: payment.pidx });
```

---

## Separate frontend and backend

Nothing in this package assumes a fullstack framework. The core handler speaks web-standard `Request`/`Response`; Next.js and Express bindings are thin wrappers. A fully split setup works out of the box:

```
 SPA at myshop.com          API at api.myshop.com            Gateway
        │                           │
        │  POST /api/pay/checkout   │   ← CORS applies here
        │ ─────────────────────────►│
        │                           │  callback URL lives on api.myshop.com
        │                           │◄──── gateway redirect ────
        │◄── 303 to myshop.com/success page ──
```

Three things to set:

1. **`origin`** in the handler config (`'https://api.myshop.com'`) so callback URLs are built for the right host.
2. **Absolute redirect URLs** — `successRedirect: 'https://myshop.com/payment/success'` sends the browser back to your frontend's domain after verification.
3. **CORS** on the checkout endpoint if the frontend calls it cross-origin — use your framework's CORS middleware; the handler doesn't add CORS headers itself.

The callback URL just needs to be a publicly reachable backend endpoint. It does not need to live anywhere near your frontend.

**One caveat about the word "webhook":** neither eSewa ePay v2 nor Khalti ePayment v2 offers true server-to-server webhooks. The "callback" is a browser redirect — it reaches your backend *through the user's browser*. That's why the next section exists.

---

## Reconciliation — don't rely on the redirect alone

If the user pays and then closes the tab, loses network, or kills the app before the redirect completes, **your callback is never hit** — the money moved, and no request reached you. Because there are no gateway webhooks to fall back on, every serious integration needs a reconciliation sweep:

1. When you create a checkout, store `session.sessionId` with the order (you're doing this already).
2. On a schedule (cron, worker, serverless timer), take every order still unpaid after a few minutes and ask the gateway directly:

```ts
// Khalti: sessionId is the pidx
const result = await gateway.verifyCallback({
  gateway: 'khalti',
  query: { pidx: order.sessionId },
});

// eSewa: verify by transaction UUID + amount
const status = await gateway.esewa.verifyPayment({
  transactionUuid: order.sessionId,
  totalAmount: order.amountPaisa / 100,     // eSewa's API takes NPR
});

if (result.success /* or status.success */) {
  // mark the order paid — same idempotent routine your onSuccess uses
}
```

3. Give up after the session expires (Khalti sessions expire in ~60 minutes; eSewa reports `NOT_FOUND`/`CANCELED`) and mark the order failed.

The redirect callback is the fast path that catches most payments instantly; reconciliation is the safety net that catches the rest. Both should funnel into the same idempotent "mark as paid" routine.

---

## Reference

### Amounts

The unified API (Levels 1–2) uses **integer paisa** everywhere (1 NPR = 100 paisa). Working in the smallest currency unit eliminates the two most common real-world bugs: floating-point rupee math, and mixing up Khalti's paisa with eSewa's rupees.

```ts
import { rupeesToPaisa, paisaToRupees } from 'nepal-payment-gateway';
rupeesToPaisa(1500.5)   // 150050
paisaToRupees(150050)   // 1500.5
```

Only Level 3 keeps each gateway's native unit (eSewa: NPR, Khalti: paisa).

### Configuration

Every option can come from constructor config **or** environment variables (config wins). Env vars are read lazily at call time, so `dotenv.config()` after import works fine.

| Variable | Meaning |
|---|---|
| `ESEWA_PRODUCT_CODE` | eSewa merchant code (`EPAYTEST` in sandbox) |
| `ESEWA_SECRET_KEY` | eSewa HMAC secret |
| `ESEWA_IS_TEST` | `true` / `false` — sandbox toggle |
| `ESEWA_BASE_URL` | custom endpoint override |
| `KHALTI_SECRET_KEY` | Khalti secret key (test or live) |
| `KHALTI_IS_TEST` | `true` / `false` — sandbox toggle |
| `KHALTI_BASE_URL` | custom endpoint override |

Everything defaults to sandbox (`isTest: true`) — set `isTest: false` explicitly for production. In test mode, eSewa credentials default to the public sandbox pair automatically.

### Sandbox test credentials

**eSewa** — product code `EPAYTEST`, secret `8gBm/:&EnhH.1/q` (public UAT credentials, auto-applied in test mode). Test login: eSewa ID `9806800001`–`9806800005`, password `Nepal@123`, MPIN `1122`, OTP `123456`.

**Khalti** — get a test secret key from [test-admin.khalti.com](https://test-admin.khalti.com). Test payer: phone `9800000000`–`9800000005`, MPIN `1111`, OTP `987654`. Minimum amount: 1000 paisa (Rs 10).

### Error handling

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

### Security checklist

1. **Secrets stay server-side.** Nothing from this package belongs in browser bundles.
2. **Amounts are resolved server-side.** The handlers force this via `resolveOrder`; with your own routes, never accept an amount from the client.
3. **Redirects are untrusted.** Always confirm via `verifyCallback` (the handlers do this for you).
4. **Make fulfilment idempotent.** `onSuccess` can fire more than once (refreshes, reconciliation) — marking an already-paid order paid again must be harmless.
5. **Cross-check the amount.** In `onSuccess`, compare `payment.amount` (paisa) with what the order should cost before fulfilling.

---

## Development

```bash
npm install
npm test              # unit tests
npm run test:coverage
npm run build         # dual ESM/CJS + .d.ts via tsup
```

## License

MIT © Kritan — see [LICENSE](LICENSE)
