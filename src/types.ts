/**
 * Type definitions for Nepal Payment Gateway SDK
 */

// ============================================================================
// eSewa Types
// ============================================================================

export interface EsewaConfig {
  /**
   * Merchant product code provided by eSewa (e.g. 'EPAYTEST' for sandbox)
   * Falls back to process.env.ESEWA_PRODUCT_CODE
   */
  productCode?: string;
  /**
   * Secret key provided by eSewa for HMAC-SHA256 signature generation
   * Falls back to process.env.ESEWA_SECRET_KEY
   */
  secretKey?: string;
  /**
   * Whether to use the eSewa Sandbox/UAT environment
   * @default true
   */
  isTest?: boolean;
  /**
   * Custom base URL to override standard sandbox or production URLs
   */
  baseUrl?: string;
}

export interface EsewaInitiatePaymentParams {
  /**
   * The base product/service amount (in NPR). Can be number or numeric string.
   */
  amount: number | string;
  /**
   * Unique transaction identifier for the payment
   */
  transactionUuid: string;
  /**
   * Merchant product code. Optional if configured in Esewa client.
   */
  productCode?: string;
  /**
   * Merchant secret key. Optional if configured in Esewa client.
   */
  secretKey?: string;
  /**
   * Redirection URL upon successful transaction
   */
  successUrl: string;
  /**
   * Redirection URL upon failed or cancelled transaction
   */
  failureUrl: string;
  /**
   * Tax amount (in NPR). Defaults to 0.
   */
  taxAmount?: number | string;
  /**
   * Total amount. If omitted, will be computed as amount + taxAmount + productServiceCharge + productDeliveryCharge.
   */
  totalAmount?: number | string;
  /**
   * Product service charge (in NPR). Defaults to 0.
   */
  productServiceCharge?: number | string;
  /**
   * Product delivery charge (in NPR). Defaults to 0.
   */
  productDeliveryCharge?: number | string;
  /**
   * Whether to use sandbox mode. Overrides client config.
   */
  isTest?: boolean;
  /**
   * Custom base URL to override standard endpoint. Overrides client config.
   */
  baseUrl?: string;
}

export interface EsewaFormFields {
  amount: string;
  tax_amount: string;
  total_amount: string;
  transaction_uuid: string;
  product_code: string;
  product_service_charge: string;
  product_delivery_charge: string;
  success_url: string;
  failure_url: string;
  signed_field_names: string;
  signature: string;
}

export interface EsewaInitiatePaymentResult {
  /**
   * The target endpoint URL to which the form should be submitted via POST
   */
  paymentUrl: string;
  /**
   * Calculated total amount
   */
  totalAmount: string;
  /**
   * Generated HMAC-SHA256 signature
   */
  signature: string;
  /**
   * Exact key-value pairs to include in the POST form submission
   */
  formFields: EsewaFormFields;
  /**
   * Ready-to-render auto-submitting HTML form snippet
   */
  formHtml: string;
}

export interface EsewaVerifyPaymentParams {
  /**
   * The unique transaction UUID used when initiating payment
   */
  transactionUuid: string;
  /**
   * The total amount of the transaction
   */
  totalAmount: number | string;
  /**
   * Merchant product code. Optional if configured in Esewa client.
   */
  productCode?: string;
  /**
   * Whether to use sandbox mode. Overrides client config.
   */
  isTest?: boolean;
  /**
   * Custom base URL to override standard endpoint. Overrides client config.
   */
  baseUrl?: string;
}

export type EsewaPaymentStatus =
  | 'COMPLETE'
  | 'PENDING'
  | 'NOT_FOUND'
  | 'CANCELED'
  | 'AMBIGUOUS'
  | 'FULL_REFUND'
  | 'PARTIAL_REFUND'
  | 'FAILED'
  | (string & {});

export interface EsewaVerifyPaymentResult {
  /**
   * Indicates if status is 'COMPLETE'
   */
  success: boolean;
  /**
   * Status of transaction ('COMPLETE', 'PENDING', 'NOT_FOUND', etc.)
   */
  status: EsewaPaymentStatus;
  /**
   * eSewa reference ID if completed
   */
  refId?: string;
  /**
   * Transaction UUID
   */
  transactionUuid: string;
  /**
   * Total transaction amount
   */
  totalAmount: string;
  /**
   * Product code
   */
  productCode: string;
  /**
   * Raw JSON response from eSewa API
   */
  rawResponse: Record<string, unknown>;
}

export interface EsewaCallbackData {
  transaction_code: string;
  status: string;
  total_amount: string;
  transaction_uuid: string;
  product_code: string;
  signed_field_names: string;
  signature: string;
  [key: string]: unknown;
}

// ============================================================================
// Khalti Types
// ============================================================================

export interface KhaltiConfig {
  /**
   * Merchant live or test secret key provided by Khalti
   * Falls back to process.env.KHALTI_SECRET_KEY
   */
  secretKey?: string;
  /**
   * Whether to use Khalti Sandbox/Dev environment
   * @default true
   */
  isTest?: boolean;
  /**
   * Custom base URL to override standard sandbox or production URLs
   */
  baseUrl?: string;
}

export interface KhaltiCustomerInfo {
  name?: string;
  email?: string;
  phone?: string;
}

export interface KhaltiAmountBreakdownItem {
  label: string;
  amount: number;
}

export interface KhaltiProductDetailItem {
  identity: string;
  name: string;
  total_price: number;
  quantity: number;
  unit_price: number;
}

export interface KhaltiInitiatePaymentParams {
  /**
   * URL to redirect the user after payment completion/cancellation
   */
  returnUrl: string;
  /**
   * Merchant website URL
   */
  websiteUrl: string;
  /**
   * Total amount in Paisa (1 NPR = 100 Paisa). E.g., 1000 for Rs 10.
   * Can be passed as number or string.
   */
  amount: number | string;
  /**
   * Unique order identifier on merchant side
   */
  purchaseOrderId: string;
  /**
   * Descriptive name for the order or product
   */
  purchaseOrderName: string;
  /**
   * Khalti secret key. Optional if configured in Khalti client.
   */
  secretKey?: string;
  /**
   * Optional customer details
   */
  customerInfo?: KhaltiCustomerInfo;
  /**
   * Optional amount breakdown
   */
  amountBreakdown?: KhaltiAmountBreakdownItem[];
  /**
   * Optional product line items
   */
  productDetails?: KhaltiProductDetailItem[];
  /**
   * Whether to use sandbox mode. Overrides client config.
   */
  isTest?: boolean;
  /**
   * Custom base URL. Overrides client config.
   */
  baseUrl?: string;
}

export interface KhaltiInitiatePaymentResult {
  /**
   * Payment Initiation ID (PIDX)
   */
  pidx: string;
  /**
   * Khalti checkout URL where user should be redirected
   */
  paymentUrl: string;
  /**
   * ISO string indicating when the checkout session expires
   */
  expiresAt: string;
  /**
   * Expiry time in seconds
   */
  expiresIn: number;
  /**
   * Raw JSON response from Khalti API
   */
  rawResponse: Record<string, unknown>;
}

export interface KhaltiVerifyPaymentParams {
  /**
   * Payment Initiation ID (PIDX) returned during initiation or callback
   */
  pidx: string;
  /**
   * Khalti secret key. Optional if configured in Khalti client.
   */
  secretKey?: string;
  /**
   * Whether to use sandbox mode. Overrides client config.
   */
  isTest?: boolean;
  /**
   * Custom base URL. Overrides client config.
   */
  baseUrl?: string;
}

export type KhaltiPaymentStatus =
  | 'Completed'
  | 'Pending'
  | 'Initiated'
  | 'Refunded'
  | 'Partially Refunded'
  | 'Expired'
  | 'User canceled'
  | (string & {});

export interface KhaltiVerifyPaymentResult {
  /**
   * Indicates if status is 'Completed'
   */
  success: boolean;
  /**
   * Unique Payment Index (PIDX)
   */
  pidx: string;
  /**
   * Current status of the transaction
   */
  status: KhaltiPaymentStatus;
  /**
   * Khalti transaction ID once completed
   */
  transactionId?: string;
  /**
   * Total transaction amount in Paisa
   */
  totalAmount: number;
  /**
   * Khalti service fee in Paisa
   */
  fee?: number;
  /**
   * Whether payment has been refunded
   */
  refunded?: boolean;
  /**
   * Raw JSON response from Khalti lookup API
   */
  rawResponse: Record<string, unknown>;
}

// ============================================================================
// Unified Gateway Types
// ============================================================================

export interface NepalPaymentGatewayConfig {
  esewa?: EsewaConfig;
  khalti?: KhaltiConfig;
  /**
   * Global flag to toggle test/sandbox mode across both gateways
   * @default true
   */
  isTest?: boolean;
}

export type GatewayName = 'esewa' | 'khalti';

/**
 * Result of attempting to resolve a direct redirect URL for an eSewa payment
 * by performing the form POST server-side.
 */
export interface EsewaPaymentUrlResult extends EsewaInitiatePaymentResult {
  /**
   * Direct eSewa checkout URL the user can be redirected to, or null when
   * eSewa did not return a redirect (fall back to formFields/formHtml).
   */
  redirectUrl: string | null;
}

// ============================================================================
// Unified Checkout Types (Stripe-Checkout-style abstraction)
// ============================================================================

export interface CreateCheckoutParams {
  /** Which gateway to charge through */
  gateway: GatewayName;
  /**
   * Total payable amount in PAISA (integer, smallest currency unit).
   * 1 NPR = 100 paisa, e.g. 150000 = Rs 1500. Use rupeesToPaisa() to convert.
   */
  amount: number;
  /** Your unique order identifier */
  orderId: string;
  /** Human-readable order/product name (required by Khalti) */
  orderName: string;
  /**
   * URL the user lands on after a successful payment
   * (eSewa success_url / Khalti return_url)
   */
  successUrl: string;
  /**
   * URL the user lands on after a failed/cancelled payment.
   * Khalti uses a single return URL, so this only affects eSewa.
   * Defaults to successUrl.
   */
  failureUrl?: string;
  /** Merchant website URL (Khalti requirement). Defaults to the origin of successUrl. */
  websiteUrl?: string;
  /** Optional customer details (Khalti only) */
  customer?: KhaltiCustomerInfo;
  /**
   * Explicit eSewa transaction UUID. Defaults to `${orderId}-${random}` so
   * retried orders never collide. Alphanumeric and hyphens only.
   */
  transactionUuid?: string;
  /**
   * When true (default), eSewa checkout attempts a server-side form POST to
   * obtain a direct redirect URL. Set false to skip and always use the form.
   */
  preferRedirectUrl?: boolean;
}

export interface CheckoutSession {
  gateway: GatewayName;
  /**
   * Gateway session identifier: eSewa transaction_uuid or Khalti pidx.
   * Store this against your order — callbacks reference it.
   */
  sessionId: string;
  /** Your order identifier as passed to createCheckout */
  orderId: string;
  /** Amount in paisa */
  amount: number;
  /**
   * URL to redirect the user's browser to. Always set for Khalti; set for
   * eSewa when a direct redirect URL could be resolved.
   */
  url: string | null;
  /**
   * eSewa fallback: POST these fields to `action` as a top-level browser form
   * submission. Null for Khalti.
   */
  form: { action: string; fields: Record<string, string> } | null;
  /** eSewa fallback: ready-to-serve auto-submitting HTML page. Null for Khalti. */
  formHtml: string | null;
  /** Raw gateway response(s) for debugging */
  raw: unknown;
}

export interface VerifyCallbackParams {
  gateway: GatewayName;
  /**
   * The query parameters your callback route received, e.g. req.query or
   * Object.fromEntries(new URL(request.url).searchParams).
   * eSewa: expects `data` (base64). Khalti: expects `pidx`.
   */
  query: Record<string, string | string[] | undefined>;
}

export interface CheckoutVerificationResult {
  gateway: GatewayName;
  /**
   * True only when the payment is fully verified as completed:
   * eSewa — callback signature valid AND status API returns COMPLETE;
   * Khalti — lookup API returns status "Completed".
   * Only fulfil orders when this is true.
   */
  success: boolean;
  /** Gateway-native status (COMPLETE / Completed / PENDING / ...) */
  status: EsewaPaymentStatus | KhaltiPaymentStatus;
  /** eSewa transaction_uuid or Khalti pidx */
  sessionId: string;
  /** Gateway-side transaction reference: eSewa ref_id / Khalti transaction_id */
  transactionId?: string;
  /** Verified amount in paisa, per the gateway's verification API */
  amount?: number;
  /** eSewa only: whether the callback HMAC signature was valid */
  signatureValid?: boolean;
  /** Raw decoded callback payload and verification API response */
  raw: { callback?: unknown; verification?: unknown };
}
