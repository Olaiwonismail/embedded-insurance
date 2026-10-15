// Reads a paid order out of each platform's webhook body.

export interface PaidOrder {
  quoteId: number;
  orderRef: string;
  customer: {
    name: string;
    email: string;
    phone?: string;
  };
}

export type ExtractResult = { order: PaidOrder } | { missing: string[] };

// Line item property the store's checkout sets to our quote id.
export const SHOPIFY_QUOTE_PROPERTY = 'insureongo_quote_id';

function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function wholeNumber(value: unknown): number | undefined {
  const raw = text(value);
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function build(fields: {
  quoteId?: number;
  orderRef?: string;
  name?: string;
  email?: string;
  phone?: string;
}): ExtractResult {
  const missing: string[] = [];
  if (fields.quoteId === undefined) missing.push('quoteId');
  if (fields.orderRef === undefined) missing.push('orderRef');
  if (fields.name === undefined) missing.push('customer.name');
  if (fields.email === undefined) missing.push('customer.email');
  if (missing.length > 0) {
    return { missing };
  }

  return {
    order: {
      quoteId: fields.quoteId!,
      orderRef: fields.orderRef!,
      customer: {
        name: fields.name!,
        email: fields.email!.toLowerCase(),
        ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      },
    },
  };
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as any) : {};
}

// Body as defined by the webhook brief: { orderRef, quoteId, customer: { name, email, phone? } }
export function extractCustomOrder(payload: unknown): ExtractResult {
  const body = asObject(payload);
  const customer = asObject(body.customer);
  return build({
    quoteId: wholeNumber(body.quoteId),
    orderRef: text(body.orderRef),
    name: text(customer.name),
    email: text(customer.email),
    phone: text(customer.phone),
  });
}

// Shopify order: the quote id is a line item property, the rest comes from the order.
export function extractShopifyOrder(payload: unknown): ExtractResult {
  const order = asObject(payload);
  const customer = asObject(order.customer);
  const billing = asObject(order.billing_address);

  let quoteId: number | undefined;
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  for (const item of lineItems) {
    const properties = asObject(item).properties;
    if (!Array.isArray(properties)) continue;
    const property = properties.find((p) => asObject(p).name === SHOPIFY_QUOTE_PROPERTY);
    if (property) {
      quoteId = wholeNumber(asObject(property).value);
      break;
    }
  }

  const fullName = [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(' ');

  return build({
    quoteId,
    orderRef: text(order.id),
    name: fullName || text(billing.name),
    email: text(order.email) ?? text(customer.email),
    phone: text(order.phone) ?? text(customer.phone) ?? text(billing.phone),
  });
}

// Which event type means "order paid" on each platform. Add new platforms here.
export const PAID_ORDER_PLATFORMS: Record<
  string,
  { type: string; extract: (payload: unknown) => ExtractResult }
> = {
  shopify: { type: 'orders/paid', extract: extractShopifyOrder },
  custom: { type: 'order.paid', extract: extractCustomOrder },
};
