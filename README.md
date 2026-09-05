# nepal-payment-gateway 🇳🇵💳

[![npm version](https://img.shields.io/npm/v/nepal-payment-gateway.svg?style=flat-square)](https://www.npmjs.com/package/nepal-payment-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/github/actions/workflow/status/your-username/nepal-payment-gateway/test.yml?branch=main&style=flat-square)](https://github.com/your-username/nepal-payment-gateway/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)

A modern, lightweight, and unified Node.js SDK for seamlessly integrating **eSewa (ePay v2)** and **Khalti (ePayment v2)** payment gateways in Nepal.

---

## ✨ Features

- 🚀 **Unified API**: Unified interface for both eSewa and Khalti or standalone modular imports.
- 🔒 **eSewa ePay v2**: Automated HMAC-SHA256 signature generation, callback base64 decoding, signature verification, and server-to-server status checks.
- ⚡ **Khalti ePayment v2**: Checkout session initiation (`/epayment/initiate/`) and server-side payment status verification (`/epayment/lookup/`).
- 📦 **Dual Module Support**: Full compatibility with **ESM** (`import`) and **CommonJS** (`require`).
- 🛡️ **Fully Typed**: 100% written with TypeScript, exporting full type definitions (`.d.ts`) with rich autocompletion.
- 🧪 **Zero Heavy Dependencies**: Uses standard Node.js built-ins (`crypto`, native `fetch`), keeping your bundle lightweight and secure.
- 🎛️ **Environment Configurable**: Switch effortlessly between Sandbox/UAT and Production via options or environment variables.

---

## 📥 Installation

```bash
npm install nepal-payment-gateway
```

or with yarn / pnpm / bun:

```bash
yarn add nepal-payment-gateway
# or
pnpm add nepal-payment-gateway
# or
bun add nepal-payment-gateway
```

---

## ⚙️ Environment Configuration

You can configure credentials using a `.env` file in your project:

```env
# eSewa Configuration
ESEWA_PRODUCT_CODE=EPAYTEST
ESEWA_SECRET_KEY=8gBm/:&EnhH.1/q
ESEWA_IS_TEST=true

# Khalti Configuration
KHALTI_SECRET_KEY=live_secret_key_68791341fdd94846a146f0457ff7b455
KHALTI_IS_TEST=true
```

---

## 🚀 Quick Start

### 1. Unified Gateway Manager

```javascript
import { NepalPaymentGateway } from 'nepal-payment-gateway';
// Or in CommonJS:
// const { NepalPaymentGateway } = require('nepal-payment-gateway');

const gateway = new NepalPaymentGateway({
  isTest: true, // true for sandbox/testing, false for production
  esewa: {
    productCode: 'EPAYTEST',
    secretKey: '8gBm/:&EnhH.1/q',
  },
  khalti: {
    secretKey: 'your_khalti_secret_key',
  },
});

// Access eSewa or Khalti
// gateway.esewa.initiatePayment(...)
// gateway.khalti.initiatePayment(...)
```

---

### 2. eSewa Integration

#### A. Initiate Payment (Generate Form / Redirect)

```javascript
import { Esewa } from 'nepal-payment-gateway';

const esewa = new Esewa({
  productCode: 'EPAYTEST',
  secretKey: '8gBm/:&EnhH.1/q',
  isTest: true, // Sandbox mode
});

const paymentData = esewa.initiatePayment({
  amount: 1000, // Amount in NPR
  taxAmount: 130, // Optional tax (NPR)
  productServiceCharge: 0, // Optional service charge
  productDeliveryCharge: 50, // Optional delivery charge
  transactionUuid: `TXN-${Date.now()}`, // Unique transaction ID
  successUrl: 'https://yourwebsite.com/api/payment/esewa/success',
  failureUrl: 'https://yourwebsite.com/api/payment/esewa/failure',
});

console.log(paymentData);
/*
Output:
{
  paymentUrl: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
  totalAmount: '1180',
  signature: '...',
  formFields: {
    amount: '1000',
    tax_amount: '130',
    total_amount: '1180',
    transaction_uuid: 'TXN-1709600000000',
    product_code: 'EPAYTEST',
    product_service_charge: '0',
    product_delivery_charge: '50',
    success_url: 'https://yourwebsite.com/api/payment/esewa/success',
    failure_url: 'https://yourwebsite.com/api/payment/esewa/failure',
    signed_field_names: 'total_amount,transaction_uuid,product_code',
    signature: '...'
  },
  formHtml: '<!DOCTYPE html>...' // Auto-submitting HTML form
}
*/
```

#### B. Handle eSewa Callback & Verification

When a payment succeeds, eSewa redirects to your `successUrl` with a `?data=...` query parameter:

```javascript
import { Esewa } from 'nepal-payment-gateway';

const esewa = new Esewa({
  productCode: 'EPAYTEST',
  secretKey: '8gBm/:&EnhH.1/q',
  isTest: true,
});

// In your Express or Next.js route handler:
app.get('/api/payment/esewa/success', async (req, res) => {
  const { data } = req.query; // base64-encoded string from eSewa

  try {
    // 1. Decode callback payload
    const decoded = esewa.decodeCallbackData(data);

    // 2. Verify callback HMAC-SHA256 signature
    const isSignatureValid = esewa.verifySignature(decoded);
    if (!isSignatureValid) {
      return res.status(400).json({ error: 'Tampered payment callback signature' });
    }

    // 3. Server-to-server transaction status check (CRITICAL)
    const verification = await esewa.verifyPayment({
      transactionUuid: decoded.transaction_uuid,
      totalAmount: decoded.total_amount,
      productCode: decoded.product_code,
    });

    if (verification.success && verification.status === 'COMPLETE') {
      // Payment confirmed! Update order status in your database
      return res.json({
        message: 'Payment verified successfully',
        refId: verification.refId,
        transactionUuid: verification.transactionUuid,
      });
    } else {
      return res.status(400).json({ error: 'Payment incomplete or failed', status: verification.status });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
```

---

### 3. Khalti Integration

#### A. Initiate Payment (Get Checkout URL)

```javascript
import { Khalti } from 'nepal-payment-gateway';

const khalti = new Khalti({
  secretKey: 'live_secret_key_68791341fdd94846a146f0457ff7b455', // Test or Live key
  isTest: true, // Sandbox mode
});

const payment = await khalti.initiatePayment({
  returnUrl: 'https://yourwebsite.com/api/payment/khalti/callback',
  websiteUrl: 'https://yourwebsite.com',
  amount: 1000, // 1000 Paisa = Rs. 10 NPR
  purchaseOrderId: `ORDER-${Date.now()}`,
  purchaseOrderName: 'Premium Subscription',
  customerInfo: {
    name: 'Ram Bahadur',
    email: 'ram@example.com',
    phone: '9800000001',
  },
});

console.log(payment);
/*
Output:
{
  pidx: 'HT6HuGPEacv2hwLQL8yA2L',
  paymentUrl: 'https://test-pay.khalti.com/?pidx=HT6HuGPEacv2hwLQL8yA2L',
  expiresAt: '2026-09-05T18:00:00Z',
  expiresIn: 1800,
  rawResponse: { ... }
}
*/

// Redirect your user to payment.paymentUrl
```

#### B. Verify Khalti Payment (Lookup API)

When the user completes payment on Khalti, they are redirected to your `returnUrl` with `?pidx=...`:

```javascript
import { Khalti } from 'nepal-payment-gateway';

const khalti = new Khalti({
  secretKey: 'live_secret_key_68791341fdd94846a146f0457ff7b455',
  isTest: true,
});

app.get('/api/payment/khalti/callback', async (req, res) => {
  const { pidx, status, transaction_id } = req.query;

  try {
    // Call Khalti lookup API to verify payment state
    const result = await khalti.verifyPayment({ pidx });

    if (result.success && result.status === 'Completed') {
      // Payment confirmed!
      return res.json({
        message: 'Payment completed successfully',
        transactionId: result.transactionId,
        totalAmount: result.totalAmount, // In Paisa
      });
    } else {
      return res.status(400).json({ error: 'Payment not completed', status: result.status });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
```

---

## 🧪 Sandbox Test Credentials

### eSewa Sandbox Credentials
- **Portal URL**: [https://rc-epay.esewa.com.np](https://rc-epay.esewa.com.np)
- **Product Code**: `EPAYTEST`
- **Secret Key**: `8gBm/:&EnhH.1/q`
- **Test eSewa ID**: `9841000000` / `9841000001`
- **Test Password**: `123456`
- **Test MPIN**: `1122`
- **Test Token / OTP**: `123456`

### Khalti Sandbox Credentials
- **Merchant Dashboard**: [https://test-admin.khalti.com](https://test-admin.khalti.com)
- **Test Phone Numbers**: `9800000000`, `9800000001`, `9800000002`, `9800000003`, `9800000004`, `9800000005`
- **Test MPIN**: `1111`
- **Test OTP**: `987654`

---

## ⚠️ Error Handling

The SDK provides specific error classes for clean error handling:

```javascript
import {
  NepalPaymentGatewayError,
  ValidationError,
  EsewaError,
  KhaltiError
} from 'nepal-payment-gateway';

try {
  await khalti.initiatePayment({ ... });
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('Missing or invalid parameters:', err.missingFields);
  } else if (err instanceof KhaltiError) {
    console.error(`Khalti API Error (HTTP ${err.statusCode}):`, err.message, err.details);
  } else if (err instanceof EsewaError) {
    console.error(`eSewa API Error (HTTP ${err.statusCode}):`, err.message, err.details);
  } else {
    console.error('Unknown Error:', err);
  }
}
```

---

## 🛠️ Development & Publishing Guide

### 1. Build and Run Tests

```bash
# Install dependencies
npm install

# Run test suite
npm test

# Run tests with coverage
npm run test:coverage

# Build TypeScript to dual ESM (.mjs) & CommonJS (.cjs)
npm run build
```

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "feat: initial release of nepal-payment-gateway"
git branch -M main
git remote add origin https://github.com/your-username/nepal-payment-gateway.git
git push -u origin main
```

### 3. Publish to NPM

```bash
# 1. Login to npm
npm login

# 2. Verify build and tests pass automatically (prepublishOnly)
npm publish --access public
```

---

## 📄 License

MIT © [nepal-payment-gateway](LICENSE)
