import { createCheckout, verifyCallback } from './checkout';
import { NepalPaymentGatewayError, ValidationError } from './errors';
import { Esewa } from './esewa';
import { Khalti } from './khalti';
import {
  CheckoutVerificationResult,
  EsewaConfig,
  GatewayName,
  KhaltiConfig,
  KhaltiCustomerInfo,
} from './types';

/**
 * Context passed to resolveOrder. The amount ALWAYS comes from your server —
 * never trust an amount sent by the browser.
 */
export interface ResolveOrderContext {
  gateway: GatewayName;
  orderId: string;
  /** Arbitrary metadata forwarded from the client's checkout request body */
  metadata?: Record<string, unknown>;
  request: Request;
}

export interface ResolvedOrder {
  /** Authoritative amount in paisa (integer). */
  amount: number;
  /** Order/product display name. Defaults to the orderId. */
  orderName?: string;
  /** Optional customer details (Khalti only) */
  customer?: KhaltiCustomerInfo;
}

export interface CallbackResult extends CheckoutVerificationResult {
  /** Your order identifier, recovered from the callback URL */
  orderId: string;
}

export interface CheckoutHandlerConfig {
  esewa?: EsewaConfig;
  khalti?: KhaltiConfig;
  /** Global sandbox toggle applied to both gateways */
  isTest?: boolean;
  /**
   * Maps an incoming checkout request to the authoritative order details.
   * This is the security boundary: derive the amount from your database or
   * price list — never from client input.
   */
  resolveOrder: (ctx: ResolveOrderContext) => ResolvedOrder | Promise<ResolvedOrder>;
  /**
   * Called after a payment is verified as completed (signature checked and
   * confirmed via the gateway's server-to-server API). Mark the order paid
   * here. May be called more than once for the same payment if the user
   * refreshes the callback page — make it idempotent.
   */
  onSuccess?: (payment: CallbackResult) => void | Promise<void>;
  /** Called when a callback arrives but the payment is not completed. */
  onFailure?: (payment: CallbackResult) => void | Promise<void>;
  /** Browser destination after a verified successful payment. */
  successRedirect: string;
  /** Browser destination after a failed/cancelled/invalid payment. */
  failureRedirect: string;
  /**
   * Public origin for gateway callback URLs (e.g. "https://myshop.com").
   * Defaults to the origin of the incoming request — set this explicitly when
   * running behind a proxy that rewrites Host headers.
   */
  origin?: string;
  /**
   * Rename the handler's path segments, e.g. when the defaults collide with
   * routes you already have. Single path segments only (no slashes).
   * Defaults: { checkout: 'checkout', callback: 'callback' } — i.e.
   * POST {base}/checkout and GET {base}/callback/{gateway}/{orderId}.
   */
  routes?: {
    checkout?: string;
    callback?: string;
  };
}

export interface CheckoutHandler {
  /** Handles POST {base}/checkout and GET {base}/callback/{gateway}/{orderId} */
  handleRequest(request: Request): Promise<Response>;
  /**
   * Builds the path (relative to the mount point) of the handler's callback
   * route for a given order — use this when you create checkout sessions
   * yourself (e.g. from an existing endpoint via createCheckout) but still
   * want this handler to receive and verify the gateway callbacks:
   *
   *   successUrl: `${origin}${mountBase}${handler.callbackPath('khalti', orderId)}`
   */
  callbackPath(gateway: GatewayName, orderId: string): string;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function appendQuery(url: string, params: Record<string, string | undefined>, base: string): string {
  const target = new URL(url, base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      target.searchParams.set(key, value);
    }
  }
  return target.toString();
}

/**
 * Creates a framework-agnostic checkout handler speaking web-standard
 * Request/Response. Routes (relative to wherever you mount it):
 *
 *   POST {base}/checkout                          body: { gateway, orderId, metadata? }
 *   GET  {base}/callback/{gateway}/{orderIdB64}   gateway redirect target
 *
 * Use the `/next` or `/express` subpath exports for framework bindings.
 */
export function createCheckoutHandler(config: CheckoutHandlerConfig): CheckoutHandler {
  if (typeof config?.resolveOrder !== 'function') {
    throw new ValidationError('createCheckoutHandler requires a resolveOrder function');
  }
  if (!config.successRedirect || !config.failureRedirect) {
    throw new ValidationError('createCheckoutHandler requires successRedirect and failureRedirect');
  }

  const checkoutSegment = config.routes?.checkout ?? 'checkout';
  const callbackSegment = config.routes?.callback ?? 'callback';
  for (const [name, segment] of [['checkout', checkoutSegment], ['callback', callbackSegment]]) {
    if (!/^[A-Za-z0-9._~-]+$/.test(segment)) {
      throw new ValidationError(
        `routes.${name} must be a single URL path segment (letters, digits, . _ ~ -), got: ${JSON.stringify(segment)}`
      );
    }
  }

  const gateways = {
    esewa: new Esewa({ isTest: config.isTest, ...config.esewa }),
    khalti: new Khalti({ isTest: config.isTest, ...config.khalti }),
  };

  async function handleCreateCheckout(request: Request, callbackBase: string): Promise<Response> {
    let body: { gateway?: string; orderId?: string; metadata?: Record<string, unknown> };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Invalid JSON request body' }, 400);
    }

    const gateway = body.gateway as GatewayName;
    if (gateway !== 'esewa' && gateway !== 'khalti') {
      return json({ error: "gateway must be 'esewa' or 'khalti'" }, 400);
    }
    if (!body.orderId || typeof body.orderId !== 'string') {
      return json({ error: 'orderId is required' }, 400);
    }

    const order = await config.resolveOrder({
      gateway,
      orderId: body.orderId,
      metadata: body.metadata,
      request,
    });

    const orderIdSegment = base64UrlEncode(body.orderId);
    const callbackUrl = `${callbackBase}/${callbackSegment}/${gateway}/${orderIdSegment}`;

    // Callback URLs must carry no query string: eSewa appends `?data=...`
    // itself. Success and failure share one URL; a failure redirect simply
    // arrives without a decodable `data` payload.
    const session = await createCheckout(
      {
        gateway,
        amount: order.amount,
        orderId: body.orderId,
        orderName: order.orderName || body.orderId,
        successUrl: callbackUrl,
        failureUrl: callbackUrl,
        customer: order.customer,
      },
      gateways
    );

    return json({
      gateway: session.gateway,
      sessionId: session.sessionId,
      orderId: session.orderId,
      amount: session.amount,
      url: session.url,
      form: session.form,
    });
  }

  async function handleCallback(
    request: Request,
    requestUrl: URL,
    gateway: GatewayName,
    orderIdSegment: string
  ): Promise<Response> {
    let orderId: string;
    try {
      orderId = base64UrlDecode(orderIdSegment);
    } catch {
      orderId = orderIdSegment;
    }

    const query: Record<string, string> = {};
    requestUrl.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const redirectTo = (destination: string, result?: CheckoutVerificationResult): Response => {
      const location = appendQuery(
        destination,
        {
          gateway,
          orderId,
          sessionId: result?.sessionId,
          status: result ? String(result.status) : undefined,
          transactionId: result?.transactionId,
        },
        requestUrl.origin
      );
      return new Response(null, { status: 303, headers: { Location: location } });
    };

    // eSewa failure_url redirect carries no `data` payload — treat as a failure.
    if (gateway === 'esewa' && !query.data) {
      const failure: CallbackResult = {
        gateway,
        orderId,
        success: false,
        status: 'FAILED',
        sessionId: '',
        raw: { callback: query },
      };
      await config.onFailure?.(failure);
      return redirectTo(config.failureRedirect, failure);
    }

    let result: CheckoutVerificationResult;
    try {
      result = await verifyCallback({ gateway, query }, gateways);
    } catch (err) {
      const failure: CallbackResult = {
        gateway,
        orderId,
        success: false,
        status: 'ERROR',
        sessionId: '',
        raw: { callback: query, verification: err instanceof Error ? err.message : String(err) },
      };
      await config.onFailure?.(failure);
      return redirectTo(config.failureRedirect, failure);
    }

    const payment: CallbackResult = { ...result, orderId };
    if (payment.success) {
      await config.onSuccess?.(payment);
      return redirectTo(config.successRedirect, payment);
    }
    await config.onFailure?.(payment);
    return redirectTo(config.failureRedirect, payment);
  }

  async function handleRequest(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);

    try {
      if (request.method === 'POST' && segments[segments.length - 1] === checkoutSegment) {
        const origin = config.origin ? config.origin.replace(/\/+$/, '') : requestUrl.origin;
        const basePath = pathname.slice(0, -(checkoutSegment.length + 1));
        return await handleCreateCheckout(request, `${origin}${basePath}`);
      }

      const callbackIndex = segments.lastIndexOf(callbackSegment);
      if (
        request.method === 'GET' &&
        callbackIndex !== -1 &&
        callbackIndex === segments.length - 3
      ) {
        const gateway = segments[callbackIndex + 1] as GatewayName;
        const orderIdSegment = segments[callbackIndex + 2];
        if (gateway !== 'esewa' && gateway !== 'khalti') {
          return json({ error: `Unknown gateway in callback path: ${gateway}` }, 404);
        }
        return await handleCallback(request, requestUrl, gateway, orderIdSegment);
      }

      return json(
        {
          error: 'Not found',
          routes: [
            `POST {base}/${checkoutSegment}`,
            `GET {base}/${callbackSegment}/{esewa|khalti}/{orderId}`,
          ],
        },
        404
      );
    } catch (err) {
      if (err instanceof ValidationError) {
        return json({ error: err.message, code: err.code }, 400);
      }
      if (err instanceof NepalPaymentGatewayError) {
        return json({ error: err.message, code: err.code }, 502);
      }
      return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
    }
  }

  function callbackPath(gateway: GatewayName, orderId: string): string {
    return `/${callbackSegment}/${gateway}/${base64UrlEncode(orderId)}`;
  }

  return { handleRequest, callbackPath };
}
