import { EsewaError, ValidationError } from './errors';
import {
  EsewaCallbackData,
  EsewaConfig,
  EsewaFormFields,
  EsewaInitiatePaymentParams,
  EsewaInitiatePaymentResult,
  EsewaPaymentUrlResult,
  EsewaVerifyPaymentParams,
  EsewaVerifyPaymentResult,
} from './types';
import {
  formatAmount,
  generateHmacSha256,
  normalizeUrl,
  parseAmount,
  parseBooleanEnv,
  timingSafeEqual,
  validateRequired,
} from './utils';

export const ESEWA_SANDBOX_BASE_URL = 'https://rc-epay.esewa.com.np';
export const ESEWA_PRODUCTION_BASE_URL = 'https://epay.esewa.com.np';
export const ESEWA_SANDBOX_PRODUCT_CODE = 'EPAYTEST';
export const ESEWA_SANDBOX_SECRET_KEY = '8gBm/:&EnhH.1/q';

/**
 * eSewa Payment Gateway Integration Class
 *
 * Credentials and mode are resolved lazily at call time, so environment
 * variables loaded after import (e.g. via dotenv) are still picked up.
 */
export class Esewa {
  private config: EsewaConfig;

  constructor(config: EsewaConfig = {}) {
    this.config = config;
  }

  private resolveIsTest(override?: boolean): boolean {
    if (override !== undefined) return override;
    if (this.config.isTest !== undefined) return this.config.isTest;
    const fromEnv = parseBooleanEnv(process.env.ESEWA_IS_TEST);
    return fromEnv !== undefined ? fromEnv : true;
  }

  private resolveProductCode(isTest: boolean, override?: string): string | undefined {
    return (
      override ||
      this.config.productCode ||
      process.env.ESEWA_PRODUCT_CODE ||
      (isTest ? ESEWA_SANDBOX_PRODUCT_CODE : undefined)
    );
  }

  private resolveSecretKey(isTest: boolean, override?: string): string | undefined {
    return (
      override ||
      this.config.secretKey ||
      process.env.ESEWA_SECRET_KEY ||
      (isTest ? ESEWA_SANDBOX_SECRET_KEY : undefined)
    );
  }

  /**
   * Resolves the base URL for eSewa API requests based on settings.
   */
  private getBaseUrl(overrideBaseUrl?: string, overrideIsTest?: boolean): string {
    const customUrl = overrideBaseUrl || this.config.baseUrl || process.env.ESEWA_BASE_URL;
    if (customUrl) {
      return normalizeUrl(customUrl);
    }
    return this.resolveIsTest(overrideIsTest) ? ESEWA_SANDBOX_BASE_URL : ESEWA_PRODUCTION_BASE_URL;
  }

  /**
   * Generates signature and required form fields for initiating an eSewa ePay v2 payment.
   */
  public initiatePayment(params: EsewaInitiatePaymentParams): EsewaInitiatePaymentResult {
    const isTest = this.resolveIsTest(params.isTest);
    const productCode = this.resolveProductCode(isTest, params.productCode);
    const secretKey = this.resolveSecretKey(isTest, params.secretKey);
    const baseUrl = this.getBaseUrl(params.baseUrl, params.isTest);

    validateRequired(
      {
        amount: params.amount,
        transactionUuid: params.transactionUuid,
        successUrl: params.successUrl,
        failureUrl: params.failureUrl,
        productCode,
        secretKey,
      },
      ['amount', 'transactionUuid', 'successUrl', 'failureUrl', 'productCode', 'secretKey'],
      'eSewa initiatePayment'
    );

    const amountNum = parseAmount(params.amount);
    const taxAmountNum = params.taxAmount !== undefined ? parseAmount(params.taxAmount) : 0;
    const pscNum = params.productServiceCharge !== undefined ? parseAmount(params.productServiceCharge) : 0;
    const pdcNum = params.productDeliveryCharge !== undefined ? parseAmount(params.productDeliveryCharge) : 0;

    if (isNaN(amountNum) || amountNum <= 0) {
      throw new ValidationError('Amount must be a positive number');
    }

    const calculatedTotal = params.totalAmount !== undefined
      ? parseAmount(params.totalAmount)
      : amountNum + taxAmountNum + pscNum + pdcNum;

    const amountStr = formatAmount(amountNum);
    const taxAmountStr = formatAmount(taxAmountNum);
    const pscStr = formatAmount(pscNum);
    const pdcStr = formatAmount(pdcNum);
    const totalAmountStr = formatAmount(calculatedTotal);
    const transactionUuid = String(params.transactionUuid);
    const finalProductCode = String(productCode);

    // eSewa v2 signature message: total_amount=...,transaction_uuid=...,product_code=...
    const signatureMessage = `total_amount=${totalAmountStr},transaction_uuid=${transactionUuid},product_code=${finalProductCode}`;
    const signature = generateHmacSha256(signatureMessage, String(secretKey));

    const formFields: EsewaFormFields = {
      amount: amountStr,
      tax_amount: taxAmountStr,
      total_amount: totalAmountStr,
      transaction_uuid: transactionUuid,
      product_code: finalProductCode,
      product_service_charge: pscStr,
      product_delivery_charge: pdcStr,
      success_url: params.successUrl,
      failure_url: params.failureUrl,
      signed_field_names: 'total_amount,transaction_uuid,product_code',
      signature,
    };

    const paymentUrl = `${baseUrl}/api/epay/main/v2/form`;
    const formHtml = this.generatePaymentFormHtml(formFields, paymentUrl);

    return {
      paymentUrl,
      totalAmount: totalAmountStr,
      signature,
      formFields,
      formHtml,
    };
  }

  /**
   * Initiates an eSewa payment and additionally attempts to resolve a direct
   * checkout redirect URL by performing the form POST server-side. eSewa
   * responds to the form POST with a 302 redirect to a session checkout URL,
   * which lets you treat eSewa like Khalti: just redirect the user.
   *
   * Falls back gracefully: when no redirect can be obtained, `redirectUrl` is
   * null and the standard formFields/formHtml flow should be used.
   *
   * @throws EsewaError when eSewa explicitly rejects the payload (e.g. bad signature)
   */
  public async createPaymentUrl(params: EsewaInitiatePaymentParams): Promise<EsewaPaymentUrlResult> {
    const initiation = this.initiatePayment(params);
    const baseUrl = this.getBaseUrl(params.baseUrl, params.isTest);

    let redirectUrl: string | null = null;
    try {
      const body = new URLSearchParams(
        Object.entries(initiation.formFields).map(([k, v]) => [k, String(v)])
      );
      const response = await fetch(initiation.paymentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json, text/html',
        },
        body,
        redirect: 'manual',
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        // Location may be relative to the eSewa host
        redirectUrl = new URL(location, baseUrl).toString();
      } else if (response.status >= 400) {
        let errorData: unknown;
        const text = await response.text();
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = text;
        }
        const errObj = errorData as { code?: string; message?: string } | string;
        if (typeof errObj === 'object' && errObj !== null && (errObj.code || errObj.message)) {
          // eSewa explicitly rejected the payload (e.g. ES104 invalid signature) —
          // the form fallback would fail identically, so surface the error.
          throw new EsewaError(
            `eSewa rejected payment initiation${errObj.code ? ` (${errObj.code})` : ''}: ${errObj.message || 'unknown error'}`,
            response.status,
            errorData
          );
        }
        // Unrecognized error shape — fall back to the form flow silently.
      }
    } catch (err) {
      if (err instanceof EsewaError) {
        throw err;
      }
      // Network failure or unexpected response: the documented form flow
      // remains available, so do not fail the whole initiation.
      redirectUrl = null;
    }

    return { ...initiation, redirectUrl };
  }

  /**
   * Verifies an eSewa transaction status by calling eSewa's transaction status API.
   */
  public async verifyPayment(params: EsewaVerifyPaymentParams): Promise<EsewaVerifyPaymentResult> {
    const isTest = this.resolveIsTest(params.isTest);
    const productCode = this.resolveProductCode(isTest, params.productCode);
    const baseUrl = this.getBaseUrl(params.baseUrl, params.isTest);

    validateRequired(
      {
        transactionUuid: params.transactionUuid,
        totalAmount: params.totalAmount,
        productCode,
      },
      ['transactionUuid', 'totalAmount', 'productCode'],
      'eSewa verifyPayment'
    );

    // formatAmount strips eSewa's comma-formatted callback amounts ("1,000.0")
    const totalAmountStr = formatAmount(params.totalAmount);
    const transactionUuid = String(params.transactionUuid);
    const finalProductCode = String(productCode);

    const queryParams = new URLSearchParams({
      product_code: finalProductCode,
      total_amount: totalAmountStr,
      transaction_uuid: transactionUuid,
    });

    const statusUrl = `${baseUrl}/api/epay/transaction/status/?${queryParams.toString()}`;

    try {
      const response = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          errorData = await response.text();
        }
        throw new EsewaError(
          `eSewa status check API failed with HTTP ${response.status} ${response.statusText}`,
          response.status,
          errorData
        );
      }

      const data = (await response.json()) as {
        product_code?: string;
        transaction_uuid?: string;
        total_amount?: number | string;
        status?: string;
        ref_id?: string;
        [key: string]: unknown;
      };

      const status = (data.status || 'UNKNOWN').toUpperCase();
      const isSuccess = status === 'COMPLETE';

      return {
        success: isSuccess,
        status,
        refId: data.ref_id ?? undefined,
        transactionUuid,
        totalAmount: totalAmountStr,
        productCode: finalProductCode,
        rawResponse: data,
      };
    } catch (err: unknown) {
      if (err instanceof EsewaError || err instanceof ValidationError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new EsewaError(`Failed to verify eSewa payment: ${message}`, undefined, err);
    }
  }

  /**
   * Decodes the Base64-encoded `data` query parameter returned by eSewa on success callback.
   * Tolerates URL-encoding quirks: '+' decoded to spaces by query parsers, and
   * base64url variants.
   */
  public decodeCallbackData(encodedData: string): EsewaCallbackData {
    if (!encodedData || typeof encodedData !== 'string') {
      throw new ValidationError('Encoded callback data string is required');
    }

    // Query-string parsers decode '+' as ' '; base64url uses '-' and '_'.
    const normalized = encodedData.trim().replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');

    try {
      const jsonString = Buffer.from(normalized, 'base64').toString('utf8');
      return JSON.parse(jsonString) as EsewaCallbackData;
    } catch (err) {
      throw new ValidationError(
        `Failed to decode eSewa callback data: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Verifies the HMAC-SHA256 signature in the eSewa callback payload.
   */
  public verifySignature(
    payloadOrEncodedData: EsewaCallbackData | string,
    secretKeyOverride?: string
  ): boolean {
    const isTest = this.resolveIsTest();
    const secretKey = secretKeyOverride || this.resolveSecretKey(isTest);
    if (!secretKey) {
      throw new ValidationError('Secret key is required to verify signature');
    }

    const payload: EsewaCallbackData =
      typeof payloadOrEncodedData === 'string'
        ? this.decodeCallbackData(payloadOrEncodedData)
        : payloadOrEncodedData;

    if (!payload.signature || !payload.signed_field_names) {
      return false;
    }

    const fieldNames = payload.signed_field_names.split(',');
    const messageParts: string[] = [];

    for (const field of fieldNames) {
      const trimmed = field.trim();
      if (trimmed in payload) {
        messageParts.push(`${trimmed}=${payload[trimmed]}`);
      }
    }

    const message = messageParts.join(',');
    const expectedSignature = generateHmacSha256(message, secretKey);

    return timingSafeEqual(payload.signature, expectedSignature);
  }

  /**
   * Generates a self-submitting HTML form for eSewa payment redirection.
   */
  public generatePaymentFormHtml(formFields: EsewaFormFields, actionUrl: string): string {
    const inputFields = Object.entries(formFields)
      .map(([key, value]) => `    <input type="hidden" name="${key}" value="${escapeHtml(String(value))}">`)
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Redirecting to eSewa...</title>
</head>
<body onload="document.forms['esewaPaymentForm'].submit();">
  <p>Connecting to eSewa Payment Gateway... Please wait.</p>
  <form id="esewaPaymentForm" name="esewaPaymentForm" action="${escapeHtml(actionUrl)}" method="POST">
${inputFields}
    <noscript>
      <button type="submit">Click here if you are not automatically redirected</button>
    </noscript>
  </form>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Standalone function exports for functional usage.
// A fresh instance per call keeps env-var resolution lazy (dotenv-friendly).
export function initiatePayment(params: EsewaInitiatePaymentParams): EsewaInitiatePaymentResult {
  return new Esewa().initiatePayment(params);
}

export function createPaymentUrl(params: EsewaInitiatePaymentParams): Promise<EsewaPaymentUrlResult> {
  return new Esewa().createPaymentUrl(params);
}

export function verifyPayment(params: EsewaVerifyPaymentParams): Promise<EsewaVerifyPaymentResult> {
  return new Esewa().verifyPayment(params);
}

export function decodeCallbackData(encodedData: string): EsewaCallbackData {
  return new Esewa().decodeCallbackData(encodedData);
}

export function verifySignature(
  payloadOrEncodedData: EsewaCallbackData | string,
  secretKey?: string
): boolean {
  return new Esewa().verifySignature(payloadOrEncodedData, secretKey);
}

export function generatePaymentFormHtml(formFields: EsewaFormFields, actionUrl: string): string {
  return new Esewa().generatePaymentFormHtml(formFields, actionUrl);
}
