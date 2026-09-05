import { createCheckout as createCheckoutFn, verifyCallback as verifyCallbackFn } from './checkout';
import {
  Esewa,
  createPaymentUrl as createEsewaPaymentUrl,
  decodeCallbackData as decodeEsewaCallbackData,
  generatePaymentFormHtml as generateEsewaPaymentFormHtml,
  initiatePayment as initiateEsewaPayment,
  verifyPayment as verifyEsewaPayment,
  verifySignature as verifyEsewaSignature,
} from './esewa';
import * as esewaModule from './esewa';
import {
  Khalti,
  initiatePayment as initiateKhaltiPayment,
  verifyPayment as verifyKhaltiPayment,
} from './khalti';
import * as khaltiModule from './khalti';
import {
  CheckoutSession,
  CheckoutVerificationResult,
  CreateCheckoutParams,
  NepalPaymentGatewayConfig,
  VerifyCallbackParams,
} from './types';

export * from './errors';
export * from './types';
export { Esewa, Khalti };
export { createCheckout, verifyCallback } from './checkout';
export { createCheckoutHandler } from './handler';
export type {
  CallbackResult,
  CheckoutHandler,
  CheckoutHandlerConfig,
  ResolveOrderContext,
  ResolvedOrder,
} from './handler';
export { paisaToRupees, rupeesToPaisa } from './utils';
export {
  initiateEsewaPayment,
  createEsewaPaymentUrl,
  verifyEsewaPayment,
  decodeEsewaCallbackData,
  verifyEsewaSignature,
  generateEsewaPaymentFormHtml,
  initiateKhaltiPayment,
  verifyKhaltiPayment,
};
export { esewaModule as esewa, khaltiModule as khalti };

/**
 * Unified Nepal Payment Gateway Manager Class
 */
export class NepalPaymentGateway {
  public readonly esewa: Esewa;
  public readonly khalti: Khalti;

  constructor(config: NepalPaymentGatewayConfig = {}) {
    this.esewa = new Esewa({ isTest: config.isTest, ...config.esewa });
    this.khalti = new Khalti({ isTest: config.isTest, ...config.khalti });
  }

  /**
   * Creates a unified checkout session (Stripe-Checkout-style) on either
   * gateway. Amounts are integers in paisa. Redirect the user to
   * `session.url`, or fall back to `session.form`/`session.formHtml` (eSewa).
   */
  public createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    return createCheckoutFn(params, { esewa: this.esewa, khalti: this.khalti });
  }

  /**
   * Verifies a gateway callback fully (signature + server-to-server check).
   * Only fulfil orders when `result.success` is true.
   */
  public verifyCallback(params: VerifyCallbackParams): Promise<CheckoutVerificationResult> {
    return verifyCallbackFn(params, { esewa: this.esewa, khalti: this.khalti });
  }
}

export default NepalPaymentGateway;
