import {
  Esewa,
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
import { NepalPaymentGatewayConfig } from './types';

export * from './errors';
export * from './types';
export { Esewa, Khalti };
export {
  initiateEsewaPayment,
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
    const globalIsTest = config.isTest !== undefined ? config.isTest : true;

    this.esewa = new Esewa({
      isTest: globalIsTest,
      ...config.esewa,
    });

    this.khalti = new Khalti({
      isTest: globalIsTest,
      ...config.khalti,
    });
  }
}

export default NepalPaymentGateway;
