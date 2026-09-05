import { EsewaError, ValidationError } from './errors';
import {
  EsewaCallbackData,
  EsewaConfig,
  EsewaFormFields,
  EsewaInitiatePaymentParams,
  EsewaInitiatePaymentResult,
  EsewaVerifyPaymentParams,
  EsewaVerifyPaymentResult,
} from './types';
import {
  formatAmount,
  generateHmacSha256,
  normalizeUrl,
  timingSafeEqual,
  validateRequired,
} from './utils';

export const ESEWA_SANDBOX_BASE_URL = 'https://rc-epay.esewa.com.np';
export const ESEWA_PRODUCTION_BASE_URL = 'https://epay.esewa.com.np';
export const ESEWA_SANDBOX_PRODUCT_CODE = 'EPAYTEST';
export const ESEWA_SANDBOX_SECRET_KEY = '8gBm/:&EnhH.1/q';

/**
 * eSewa Payment Gateway Integration Class
 */
export class Esewa {
  private productCode?: string;
  private secretKey?: string;
  private isTest: boolean;
  private baseUrl?: string;

  constructor(config: EsewaConfig = {}) {
    this.isTest = config.isTest !== undefined ? config.isTest : true;
    this.productCode = config.productCode || process.env.ESEWA_PRODUCT_CODE || (this.isTest ? ESEWA_SANDBOX_PRODUCT_CODE : undefined);
    this.secretKey = config.secretKey || process.env.ESEWA_SECRET_KEY || (this.isTest ? ESEWA_SANDBOX_SECRET_KEY : undefined);
    this.baseUrl = config.baseUrl || process.env.ESEWA_BASE_URL;
  }

  /**
   * Resolves the base URL for eSewa API requests based on settings.
   */
  private getBaseUrl(overrideBaseUrl?: string, overrideIsTest?: boolean): string {
    if (overrideBaseUrl) {
      return normalizeUrl(overrideBaseUrl);
    }
    if (this.baseUrl) {
      return normalizeUrl(this.baseUrl);
    }
    const isTest = overrideIsTest !== undefined ? overrideIsTest : this.isTest;
    return isTest ? ESEWA_SANDBOX_BASE_URL : ESEWA_PRODUCTION_BASE_URL;
  }

  /**
   * Generates signature and required form fields for initiating an eSewa ePay v2 payment.
   */
  public initiatePayment(params: EsewaInitiatePaymentParams): EsewaInitiatePaymentResult {
    const productCode = params.productCode || this.productCode;
    const secretKey = params.secretKey || this.secretKey;
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

    const amountNum = parseFloat(String(params.amount));
    const taxAmountNum = params.taxAmount !== undefined ? parseFloat(String(params.taxAmount)) : 0;
    const pscNum = params.productServiceCharge !== undefined ? parseFloat(String(params.productServiceCharge)) : 0;
    const pdcNum = params.productDeliveryCharge !== undefined ? parseFloat(String(params.productDeliveryCharge)) : 0;

    if (isNaN(amountNum) || amountNum <= 0) {
      throw new ValidationError('Amount must be a positive number');
    }

    const calculatedTotal = params.totalAmount !== undefined
      ? parseFloat(String(params.totalAmount))
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
   * Verifies an eSewa transaction status by calling eSewa's transaction status API.
   */
  public async verifyPayment(params: EsewaVerifyPaymentParams): Promise<EsewaVerifyPaymentResult> {
    const productCode = params.productCode || this.productCode;
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
        refId: data.ref_id,
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
   */
  public decodeCallbackData(encodedData: string): EsewaCallbackData {
    if (!encodedData || typeof encodedData !== 'string') {
      throw new ValidationError('Encoded callback data string is required');
    }

    try {
      const jsonString = Buffer.from(encodedData, 'base64').toString('utf8');
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
    const secretKey = secretKeyOverride || this.secretKey;
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
  <form id="esewaPaymentForm" name="esewaPaymentForm" action="${actionUrl}" method="POST">
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

// Standalone function exports for functional usage
const defaultEsewaInstance = new Esewa();

export function initiatePayment(params: EsewaInitiatePaymentParams): EsewaInitiatePaymentResult {
  return defaultEsewaInstance.initiatePayment(params);
}

export function verifyPayment(params: EsewaVerifyPaymentParams): Promise<EsewaVerifyPaymentResult> {
  return defaultEsewaInstance.verifyPayment(params);
}

export function decodeCallbackData(encodedData: string): EsewaCallbackData {
  return defaultEsewaInstance.decodeCallbackData(encodedData);
}

export function verifySignature(
  payloadOrEncodedData: EsewaCallbackData | string,
  secretKey?: string
): boolean {
  return defaultEsewaInstance.verifySignature(payloadOrEncodedData, secretKey);
}

export function generatePaymentFormHtml(formFields: EsewaFormFields, actionUrl: string): string {
  return defaultEsewaInstance.generatePaymentFormHtml(formFields, actionUrl);
}
