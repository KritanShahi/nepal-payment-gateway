import { KhaltiError, ValidationError } from './errors';
import {
  KhaltiConfig,
  KhaltiInitiatePaymentParams,
  KhaltiInitiatePaymentResult,
  KhaltiVerifyPaymentParams,
  KhaltiVerifyPaymentResult,
} from './types';
import { normalizeUrl, validateRequired } from './utils';

export const KHALTI_SANDBOX_BASE_URL = 'https://dev.khalti.com/api/v2';
export const KHALTI_PRODUCTION_BASE_URL = 'https://khalti.com/api/v2';

/**
 * Khalti Payment Gateway Integration Class (ePayment v2)
 */
export class Khalti {
  private secretKey?: string;
  private isTest: boolean;
  private baseUrl?: string;

  constructor(config: KhaltiConfig = {}) {
    this.isTest = config.isTest !== undefined ? config.isTest : true;
    this.secretKey = config.secretKey || process.env.KHALTI_SECRET_KEY;
    this.baseUrl = config.baseUrl || process.env.KHALTI_BASE_URL;
  }

  /**
   * Resolves the base URL for Khalti API requests based on configuration.
   */
  private getBaseUrl(overrideBaseUrl?: string, overrideIsTest?: boolean): string {
    if (overrideBaseUrl) {
      return normalizeUrl(overrideBaseUrl);
    }
    if (this.baseUrl) {
      return normalizeUrl(this.baseUrl);
    }
    const isTest = overrideIsTest !== undefined ? overrideIsTest : this.isTest;
    return isTest ? KHALTI_SANDBOX_BASE_URL : KHALTI_PRODUCTION_BASE_URL;
  }

  /**
   * Calls Khalti ePayment v2 Initiate API to create a payment transaction.
   * Returns checkout URL and pidx.
   */
  public async initiatePayment(params: KhaltiInitiatePaymentParams): Promise<KhaltiInitiatePaymentResult> {
    const secretKey = params.secretKey || this.secretKey;
    const baseUrl = this.getBaseUrl(params.baseUrl, params.isTest);

    validateRequired(
      {
        returnUrl: params.returnUrl,
        websiteUrl: params.websiteUrl,
        amount: params.amount,
        purchaseOrderId: params.purchaseOrderId,
        purchaseOrderName: params.purchaseOrderName,
        secretKey,
      },
      ['returnUrl', 'websiteUrl', 'amount', 'purchaseOrderId', 'purchaseOrderName', 'secretKey'],
      'Khalti initiatePayment'
    );

    const amountNum = typeof params.amount === 'string' ? parseInt(params.amount, 10) : params.amount;
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new ValidationError('Amount must be a positive integer in Paisa (e.g. 1000 for Rs 10)');
    }

    const payload: Record<string, unknown> = {
      return_url: params.returnUrl,
      website_url: params.websiteUrl,
      amount: amountNum,
      purchase_order_id: String(params.purchaseOrderId),
      purchase_order_name: String(params.purchaseOrderName),
    };

    if (params.customerInfo) {
      payload.customer_info = params.customerInfo;
    }
    if (params.amountBreakdown && params.amountBreakdown.length > 0) {
      payload.amount_breakdown = params.amountBreakdown;
    }
    if (params.productDetails && params.productDetails.length > 0) {
      payload.product_details = params.productDetails;
    }

    const initiateUrl = `${baseUrl}/epayment/initiate/`;

    try {
      const response = await fetch(initiateUrl, {
        method: 'POST',
        headers: {
          Authorization: `Key ${secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let responseData: unknown;
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }

      if (!response.ok) {
        throw new KhaltiError(
          `Khalti initiate payment failed with HTTP ${response.status} ${response.statusText}`,
          response.status,
          responseData
        );
      }

      const data = responseData as {
        pidx?: string;
        payment_url?: string;
        expires_at?: string;
        expires_in?: number;
        [key: string]: unknown;
      };

      if (!data.pidx || !data.payment_url) {
        throw new KhaltiError('Invalid response from Khalti initiate API: missing pidx or payment_url', response.status, data);
      }

      return {
        pidx: data.pidx,
        paymentUrl: data.payment_url,
        expiresAt: data.expires_at || '',
        expiresIn: data.expires_in || 0,
        rawResponse: data,
      };
    } catch (err: unknown) {
      if (err instanceof KhaltiError || err instanceof ValidationError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new KhaltiError(`Failed to initiate Khalti payment: ${message}`, undefined, err);
    }
  }

  /**
   * Calls Khalti ePayment v2 Lookup API to check transaction status.
   */
  public async verifyPayment(params: KhaltiVerifyPaymentParams): Promise<KhaltiVerifyPaymentResult> {
    const secretKey = params.secretKey || this.secretKey;
    const baseUrl = this.getBaseUrl(params.baseUrl, params.isTest);

    validateRequired(
      {
        pidx: params.pidx,
        secretKey,
      },
      ['pidx', 'secretKey'],
      'Khalti verifyPayment'
    );

    const lookupUrl = `${baseUrl}/epayment/lookup/`;

    try {
      const response = await fetch(lookupUrl, {
        method: 'POST',
        headers: {
          Authorization: `Key ${secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ pidx: params.pidx }),
      });

      let responseData: unknown;
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }

      if (!response.ok) {
        throw new KhaltiError(
          `Khalti lookup payment failed with HTTP ${response.status} ${response.statusText}`,
          response.status,
          responseData
        );
      }

      const data = responseData as {
        pidx?: string;
        total_amount?: number;
        status?: string;
        transaction_id?: string;
        fee?: number;
        refunded?: boolean;
        [key: string]: unknown;
      };

      const status = data.status || 'Unknown';
      const isSuccess = status.toLowerCase() === 'completed';

      return {
        success: isSuccess,
        pidx: data.pidx || params.pidx,
        status,
        transactionId: data.transaction_id,
        totalAmount: data.total_amount || 0,
        fee: data.fee,
        refunded: data.refunded,
        rawResponse: data,
      };
    } catch (err: unknown) {
      if (err instanceof KhaltiError || err instanceof ValidationError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new KhaltiError(`Failed to verify Khalti payment: ${message}`, undefined, err);
    }
  }
}

// Standalone function exports for functional usage
const defaultKhaltiInstance = new Khalti();

export function initiatePayment(params: KhaltiInitiatePaymentParams): Promise<KhaltiInitiatePaymentResult> {
  return defaultKhaltiInstance.initiatePayment(params);
}

export function verifyPayment(params: KhaltiVerifyPaymentParams): Promise<KhaltiVerifyPaymentResult> {
  return defaultKhaltiInstance.verifyPayment(params);
}
