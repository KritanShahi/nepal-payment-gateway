import { ValidationError } from './errors';
import { Esewa } from './esewa';
import { Khalti } from './khalti';
import {
  CheckoutSession,
  CheckoutVerificationResult,
  CreateCheckoutParams,
  EsewaCallbackData,
  VerifyCallbackParams,
} from './types';
import { paisaToRupees, parseAmount, randomSuffix, validateRequired } from './utils';

export interface CheckoutGateways {
  esewa: Esewa;
  khalti: Khalti;
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function sanitizeUuidPart(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, '-');
}

/**
 * Creates a unified checkout session (Stripe-Checkout-style) on either gateway.
 *
 * Amounts are always integers in PAISA. The result always identifies the
 * session (`sessionId`) and, whenever possible, a `url` to redirect the user
 * to. For eSewa, `form`/`formHtml` are also provided as the documented
 * fallback flow.
 */
export async function createCheckout(
  params: CreateCheckoutParams,
  gateways: CheckoutGateways = { esewa: new Esewa(), khalti: new Khalti() }
): Promise<CheckoutSession> {
  validateRequired(
    {
      gateway: params.gateway,
      amount: params.amount,
      orderId: params.orderId,
      orderName: params.orderName,
      successUrl: params.successUrl,
    },
    ['gateway', 'amount', 'orderId', 'orderName', 'successUrl'],
    'createCheckout'
  );

  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new ValidationError(
      `createCheckout amount must be a positive integer in paisa (got: ${params.amount}). ` +
        'Use rupeesToPaisa() to convert NPR amounts.'
    );
  }

  if (params.gateway === 'esewa') {
    const transactionUuid =
      params.transactionUuid || `${sanitizeUuidPart(params.orderId)}-${randomSuffix(6)}`;
    const amountRupees = paisaToRupees(params.amount);

    const initiateParams = {
      amount: amountRupees,
      transactionUuid,
      successUrl: params.successUrl,
      failureUrl: params.failureUrl || params.successUrl,
    };

    const preferRedirect = params.preferRedirectUrl !== false;
    const result = preferRedirect
      ? await gateways.esewa.createPaymentUrl(initiateParams)
      : { ...gateways.esewa.initiatePayment(initiateParams), redirectUrl: null };

    return {
      gateway: 'esewa',
      sessionId: transactionUuid,
      orderId: params.orderId,
      amount: params.amount,
      url: result.redirectUrl,
      form: {
        action: result.paymentUrl,
        fields: { ...result.formFields },
      },
      formHtml: result.formHtml,
      raw: result,
    };
  }

  if (params.gateway === 'khalti') {
    const websiteUrl = params.websiteUrl || new URL(params.successUrl).origin;

    const result = await gateways.khalti.initiatePayment({
      returnUrl: params.successUrl,
      websiteUrl,
      amount: params.amount,
      purchaseOrderId: params.orderId,
      purchaseOrderName: params.orderName,
      customerInfo: params.customer,
    });

    return {
      gateway: 'khalti',
      sessionId: result.pidx,
      orderId: params.orderId,
      amount: params.amount,
      url: result.paymentUrl,
      form: null,
      formHtml: null,
      raw: result.rawResponse,
    };
  }

  throw new ValidationError(`Unknown gateway: ${String(params.gateway)}. Expected 'esewa' or 'khalti'.`);
}

/**
 * Verifies a gateway callback in one call, performing every check that is
 * required before an order may be fulfilled:
 *
 * - eSewa: decodes the base64 `data` param, verifies its HMAC signature, then
 *   confirms via eSewa's server-to-server status API.
 * - Khalti: reads `pidx` and confirms via Khalti's lookup API (the redirect
 *   query params alone are NOT trustworthy — they carry no signature).
 *
 * `result.success` is true only when the payment is confirmed completed.
 */
export async function verifyCallback(
  params: VerifyCallbackParams,
  gateways: CheckoutGateways = { esewa: new Esewa(), khalti: new Khalti() }
): Promise<CheckoutVerificationResult> {
  if (params.gateway === 'esewa') {
    const encoded = firstQueryValue(params.query.data);
    if (!encoded) {
      throw new ValidationError(
        "eSewa callback query is missing the 'data' parameter (base64 payload)"
      );
    }

    const callback: EsewaCallbackData = gateways.esewa.decodeCallbackData(encoded);
    const signatureValid = gateways.esewa.verifySignature(callback);

    if (!signatureValid) {
      return {
        gateway: 'esewa',
        success: false,
        status: callback.status || 'UNKNOWN',
        sessionId: callback.transaction_uuid || '',
        signatureValid: false,
        raw: { callback },
      };
    }

    const verification = await gateways.esewa.verifyPayment({
      transactionUuid: callback.transaction_uuid,
      totalAmount: callback.total_amount,
      productCode: callback.product_code,
    });

    return {
      gateway: 'esewa',
      success: verification.success,
      status: verification.status,
      sessionId: verification.transactionUuid,
      transactionId: verification.refId,
      amount: Math.round(parseAmount(callback.total_amount) * 100),
      signatureValid: true,
      raw: { callback, verification: verification.rawResponse },
    };
  }

  if (params.gateway === 'khalti') {
    const pidx = firstQueryValue(params.query.pidx);
    if (!pidx) {
      throw new ValidationError("Khalti callback query is missing the 'pidx' parameter");
    }

    const verification = await gateways.khalti.verifyPayment({ pidx });

    return {
      gateway: 'khalti',
      success: verification.success,
      status: verification.status,
      sessionId: verification.pidx,
      transactionId: verification.transactionId,
      amount: verification.totalAmount,
      raw: { callback: params.query, verification: verification.rawResponse },
    };
  }

  throw new ValidationError(`Unknown gateway: ${String(params.gateway)}. Expected 'esewa' or 'khalti'.`);
}
