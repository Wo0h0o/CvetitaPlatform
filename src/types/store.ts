// ============================================================
// Database row types (match Supabase tables)
// ============================================================

export interface StoreRow {
  id: string;
  organization_id: string;
  name: string;
  market_code: string;
  platform: "shopify" | "woocommerce" | "custom";
  domain: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StoreCredentialRow {
  id: string;
  store_id: string;
  service: string;
  credentials: Record<string, string>;
  status: "active" | "expired" | "error";
  connected_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Runtime / decrypted types
// ============================================================

export interface ShopifyCredentials {
  store_domain: string;
  access_token: string;
  client_secret: string | null;
  api_version: string;
}

export interface StoreConfig {
  store: StoreRow;
  credentials: ShopifyCredentials;
  schemaName: string;
}

// ============================================================
// Webhook types
// ============================================================

export interface WebhookEvent {
  webhookId: string;
  topic: string;
  storeId: string;
  shopDomain: string;
  payload: unknown;
  receivedAt: Date;
}

// ============================================================
// Normalized data types (match per-store schema tables)
// ============================================================

export interface NormalizedLineItem {
  shopify_line_item_id: number;
  product_id: number | null;
  variant_id: number | null;
  title: string;
  quantity: number;
  price: number;
  sku: string | null;
}

export interface NormalizedOrder {
  shopify_order_id: number;
  shopify_order_number: string;
  webhook_event_id: string;
  event_type: "created" | "updated" | "cancelled" | "refunded";
  email: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  currency: string;
  total_price: number;
  subtotal_price: number;
  total_tax: number;
  total_discounts: number;
  total_refunded: number;
  line_items: NormalizedLineItem[];
  raw_payload: unknown;
  shopify_created_at: string;
  shopify_updated_at: string;
}

export interface ProductVariant {
  id: number;
  sku: string | null;
  price: number;
  inventory_quantity: number;
  title: string;
}

export interface ProductImage {
  id: number;
  src: string;
  alt: string | null;
}

export interface NormalizedProduct {
  shopify_product_id: number;
  title: string;
  handle: string;
  vendor: string | null;
  product_type: string | null;
  status: string;
  tags: string[];
  variants: ProductVariant[];
  images: ProductImage[];
  shopify_created_at: string;
  shopify_updated_at: string;
}

// ============================================================
// Sync progress types
// ============================================================

export interface SyncProgress {
  store_id: string;
  sync_type: "orders" | "products";
  status: "running" | "completed" | "failed";
  total_estimate: number | null;
  current_page: number;
  records_synced: number;
  started_at: string;
  error?: string;
}

// ============================================================
// Aggregates
// ============================================================

export interface DailyAggregate {
  order_date: string;
  total_revenue: number;
  total_orders: number;
  avg_order_value: number;
  total_refunded: number;
  unique_customers: number;
  top_products: { title: string; quantity: number; revenue: number }[];
  refreshed_at: string;
}
