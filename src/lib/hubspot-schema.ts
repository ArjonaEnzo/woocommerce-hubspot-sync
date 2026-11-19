// HubSpot schema the sync needs. Created idempotently by scripts/hubspot-setup.mjs.
import type { StageKey } from './types.ts';

export interface PropertyDef {
  groupName: string;
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'enumeration';
  fieldType: 'text' | 'textarea' | 'number' | 'date' | 'select';
  hasUniqueValue?: boolean;
  options?: { value: string; label: string; displayOrder: number }[];
}

export interface StageDef<K extends string = string> {
  key: K;
  label: string;
  displayOrder: number;
  metadata: Record<string, string>;
}

export interface PipelineDef<K extends string = string> {
  label: string;
  displayOrder: number;
  stages: StageDef<K>[];
}

export const PROPERTY_GROUP = { name: 'woocommerce', label: 'WooCommerce', displayOrder: -1 };

const base = { groupName: PROPERTY_GROUP.name };
const text = (name: string, label: string, extra: Partial<PropertyDef> = {}): PropertyDef => ({ ...base, name, label, type: 'string', fieldType: 'text', ...extra });
const number = (name: string, label: string): PropertyDef => ({ ...base, name, label, type: 'number', fieldType: 'number' });
const date = (name: string, label: string): PropertyDef => ({ ...base, name, label, type: 'date', fieldType: 'date' });
const select = (name: string, label: string, values: [string, string][]): PropertyDef => ({
  ...base, name, label, type: 'enumeration', fieldType: 'select',
  options: values.map(([value, optionLabel], displayOrder) => ({ value, label: optionLabel, displayOrder })),
});
const uniqueId = (name: string, label: string) => text(name, label, { hasUniqueValue: true });

export const PROPERTIES: Record<string, PropertyDef[]> = {
  contacts: [
    text('woo_customer_id', 'Woo customer ID'),
    number('total_orders', 'Total orders (paid)'),
    // Not 'total_revenue': that name is a read-only HubSpot default property on contacts.
    number('woo_total_revenue', 'Woo total revenue (net of refunds)'),
    date('first_order_date', 'First order date'),
    date('last_order_date', 'Last order date'),
    select('customer_segment', 'Customer segment', [['new', 'New'], ['repeat', 'Repeat'], ['vip', 'VIP']]),
    select('data_quality_status', 'Data quality status', [['ok', 'OK'], ['needs_review', 'Needs review']]),
    text('data_quality_issues', 'Data quality issues', { type: 'string', fieldType: 'textarea' }),
  ],
  // Upsert key for companies: one per business email domain, enforced by HubSpot (HubSpot's own `domain`
  // property is not unique, and companies created through the API are not deduplicated).
  companies: [uniqueId('woo_company_domain', 'Woo company domain')],
  deals: [
    uniqueId('woo_order_id', 'Woo order ID'),
    number('refund_amount', 'Refund amount'),
    text('woo_status', 'Woo order status'),
  ],
  // HubSpot does not support unique-value properties on products, so products are looked up by search and
  // then updated or created (sync-plan.ts). Line items do accept them (verified against the API 2026-11-16).
  products: [text('woo_product_id', 'Woo product ID')],
  line_items: [uniqueId('woo_line_item_key', 'Woo line item key')],
  // One ticket per distinct sync problem, so re-running the backfill never duplicates tickets.
  tickets: [uniqueId('sync_error_key', 'Sync error key')],
};

const stage = <K extends string>(key: K, label: string, displayOrder: number, metadata: Record<string, string>): StageDef<K> => ({ key, label, displayOrder, metadata });

export const DEAL_PIPELINE: PipelineDef<StageKey> = {
  label: 'WooCommerce',
  displayOrder: 1,
  stages: [
    stage('pending_payment', 'Pending payment', 0, { probability: '0.2' }),
    stage('paid', 'Paid', 1, { probability: '0.9' }),
    stage('closedwon', 'Closed won', 2, { probability: '1.0' }),
    stage('closedlost', 'Closed lost', 3, { probability: '0.0' }),
    stage('refunded', 'Refunded', 4, { probability: '0.0' }),
  ],
};

export const TICKET_PIPELINE: PipelineDef<'new' | 'resolved'> = {
  label: 'Integration errors',
  displayOrder: 1,
  stages: [
    stage('new', 'New', 0, { ticketState: 'OPEN' }),
    stage('resolved', 'Resolved', 1, { ticketState: 'CLOSED' }),
  ],
};
