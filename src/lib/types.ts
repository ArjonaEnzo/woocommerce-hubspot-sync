// Shared types for the sync. Type-only: erased at build time, never inlined into n8n.

/** Woo order statuses the sync knows how to map. Anything else becomes an "unknown status" ticket. */
export type WooStatus = 'pending' | 'on-hold' | 'processing' | 'completed' | 'cancelled' | 'failed' | 'refunded';

/** Internal deal stage keys. Real HubSpot stage ids come from hubspot-setup (.hubspot-ids.json). */
export type StageKey = 'pending_payment' | 'paid' | 'closedwon' | 'closedlost' | 'refunded';

/** WooCommerce REST billing block. Every field can be missing or dirty: it is customer input. */
export interface WooBilling {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
}

export interface WooLineItem {
  id: number | string;
  name: string;
  product_id: number | string;
  quantity: number;
  price: number | string;
  total?: string;
  sku?: string | null;
}

export interface WooRefund {
  id?: number;
  reason?: string;
  /** Woo sends refunds as negative strings, e.g. "-20.00". */
  total: string | number;
}

/** The subset of a WooCommerce REST order the sync reads. `status` is a plain string: Woo can send any. */
export interface WooOrder {
  id: number | string;
  number?: string | null;
  status: string;
  currency?: string;
  customer_id?: number | string;
  /** "YYYY-MM-DDTHH:mm:ss", UTC without a zone suffix. */
  date_created_gmt: string;
  total: string | number;
  billing?: WooBilling;
  line_items?: WooLineItem[];
  refunds?: WooRefund[];
}

/** Result of a single field check: a clean value, or null plus the reason. */
export interface Checked<T = string> {
  value: T | null;
  issue: string | null;
}

export type Properties = Record<string, string | number | undefined>;

/** One record for a HubSpot batch upsert, keyed by a unique property. */
export interface UpsertInput {
  idProperty: string;
  id: string;
  properties: Properties;
}

export interface PipelineContext {
  pipelineId: string;
  stageIds: Partial<Record<StageKey, string>>;
  ticketPipelineId?: string;
  ticketStageNewId?: string;
}

/** One record in a batch body: an upsert, an update by id, a create, or an association pair. */
export interface BatchInput {
  id?: string;
  idProperty?: string;
  properties?: Properties;
  from?: { id: string };
  to?: { id: string };
}

export interface SearchFilter {
  propertyName: string;
  operator: 'IN';
  values: string[];
}

/** Body of a batch write ({ inputs }) or of a CRM search ({ filterGroups, properties, limit }). */
export interface RequestBody {
  inputs?: BatchInput[];
  filterGroups?: { filters: SearchFilter[] }[];
  properties?: string[];
  limit?: number;
}

/** A HubSpot call the sync-orders workflow makes, or a skip marker when there is nothing to send. */
export interface HubSpotRequest {
  method?: 'POST';
  path?: string;
  body?: RequestBody;
  label: string;
  skip?: true;
  tolerateClientError?: true;
  ids?: string[];
}

/** What the "HubSpot request" sub-workflow returns for one request. */
export interface HubSpotResponse {
  label?: string;
  ok?: boolean;
  /** Set by the sub-workflow when the request was a skip marker and nothing was sent. */
  skipped?: boolean;
  status?: number;
  ids?: string[];
  body?: {
    results?: { id: string | number; properties?: Record<string, string | null> }[];
    errors?: { status?: string; category?: string; message?: string; context?: { ids?: string[] } }[];
    /** Batch status, e.g. "COMPLETE". */
    status?: string;
    category?: string;
    message?: string;
  } | null;
}

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

/** A sync problem that becomes one ticket in the "Integration errors" pipeline. */
export interface SyncProblem {
  key: string;
  subject: string;
  content: string;
  priority: Priority;
}
