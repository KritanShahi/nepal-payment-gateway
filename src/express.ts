import { CheckoutHandlerConfig, createCheckoutHandler } from './handler';

export type { CallbackResult, CheckoutHandlerConfig, ResolveOrderContext, ResolvedOrder } from './handler';

/**
 * Structural types for Express request/response so this package needs no
 * dependency on express or @types/express.
 */
export interface ExpressLikeRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Present when express.json() middleware has run */
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}

export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
  end(): void;
}

export type ExpressCheckoutMiddleware = (
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next?: (err?: unknown) => void
) => Promise<void>;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readRequestBody(req: ExpressLikeRequest): Promise<string | undefined> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'object' && Object.keys(req.body as object).length > 0) {
      return JSON.stringify(req.body);
    }
  }
  if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.from(chunk));
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks).toString('utf8');
    }
  }
  return undefined;
}

/**
 * Creates an Express middleware handling the full checkout flow.
 *
 * ```ts
 * import express from 'express';
 * import { createExpressCheckoutHandler } from 'nepal-payment-gateway/express';
 *
 * const app = express();
 * app.use('/api/pay', createExpressCheckoutHandler({
 *   khalti: { secretKey: process.env.KHALTI_SECRET_KEY },
 *   isTest: true,
 *   resolveOrder: async ({ orderId }) => ({ amount: 150000, orderName: 'Premium Plan' }),
 *   onSuccess: async (payment) => { /* mark order paid *\/ },
 *   successRedirect: '/payment/success',
 *   failureRedirect: '/payment/failed',
 * }));
 * ```
 *
 * This exposes:
 *   POST /api/pay/checkout                      — create a checkout session
 *   GET  /api/pay/callback/{gateway}/{orderId}  — gateway redirect target
 */
export function createExpressCheckoutHandler(config: CheckoutHandlerConfig): ExpressCheckoutMiddleware {
  const handler = createCheckoutHandler(config);

  return async (req, res, next) => {
    try {
      const host =
        headerValue(req.headers['x-forwarded-host']) || headerValue(req.headers.host) || 'localhost';
      const protocol =
        headerValue(req.headers['x-forwarded-proto']) || req.protocol || 'http';
      const path = req.originalUrl || req.url || '/';
      const url = `${protocol}://${host}${path}`;

      const method = (req.method || 'GET').toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req);

      const request = new Request(url, {
        method,
        headers: { 'Content-Type': headerValue(req.headers['content-type']) || 'application/json' },
        body,
      });

      const response = await handler.handleRequest(request);

      res.status(response.status);
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const text = await response.text();
      if (text) {
        res.send(text);
      } else {
        res.end();
      }
    } catch (err) {
      if (next) {
        next(err);
      } else {
        res.status(500);
        res.send(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }));
      }
    }
  };
}
