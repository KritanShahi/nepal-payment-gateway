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

export type EsewaPaymentStatus = 'COMPLETE' | 'PENDING' | 'NOT_FOUND' | 'CANCELED' | 'AMBIGUOUS' | 'FAILED' | string;

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

export type KhaltiPaymentStatus = 'Completed' | 'Pending' | 'Initiated' | 'Refunded' | 'Expired' | 'User canceled' | string;

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
