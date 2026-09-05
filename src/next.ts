import { CheckoutHandlerConfig, createCheckoutHandler } from './handler';

export type { CallbackResult, CheckoutHandlerConfig, ResolveOrderContext, ResolvedOrder } from './handler';

export interface NextCheckoutHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

/**
 * Creates Next.js App Router route handlers for the full checkout flow.
 *
 * Mount them in a catch-all route, e.g. `app/api/pay/[...route]/route.ts`:
 *
 * ```ts
 * import { createNextCheckoutHandlers } from 'nepal-payment-gateway/next';
 *
 * export const { GET, POST } = createNextCheckoutHandlers({
 *   khalti: { secretKey: process.env.KHALTI_SECRET_KEY },
 *   esewa: { productCode: process.env.ESEWA_PRODUCT_CODE, secretKey: process.env.ESEWA_SECRET_KEY },
 *   isTest: process.env.NODE_ENV !== 'production',
 *   resolveOrder: async ({ orderId }) => {
 *     const order = await db.orders.find(orderId);
 *     return { amount: order.amountPaisa, orderName: order.title };
 *   },
 *   onSuccess: async (payment) => {
 *     await db.orders.markPaid(payment.orderId, payment.transactionId);
 *   },
 *   successRedirect: '/payment/success',
 *   failureRedirect: '/payment/failed',
 * });
 * ```
 *
 * This exposes:
 *   POST /api/pay/checkout                      — create a checkout session
 *   GET  /api/pay/callback/{gateway}/{orderId}  — gateway redirect target
 */
export function createNextCheckoutHandlers(config: CheckoutHandlerConfig): NextCheckoutHandlers {
  const handler = createCheckoutHandler(config);
  const handle = (request: Request) => handler.handleRequest(request);
  return { GET: handle, POST: handle };
}
