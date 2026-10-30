export const PUBLIC_KEY_HEADER = 'x-insureongo-public-key';

const TIMEOUT_MS = 5000;

export interface Quote {
  id: number;
  insurerName: string;
  planName: string;
  premium: number;
}

export interface QuoteRequest {
  itemName: string;
  itemCategory: string;
  itemPrice: number;
  itemCondition: string;
  storeItemRef?: string;
}

function toQuote(value: unknown): Quote | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  // premium is a numeric column, so the API sends it as a string.
  const premium = Number(row.premium);
  if (typeof row.id !== 'number' || !Number.isFinite(premium)) return null;
  if (typeof row.insurerName !== 'string' || typeof row.planName !== 'string') return null;
  return { id: row.id, insurerName: row.insurerName, planName: row.planName, premium };
}

// Never throws and never rejects: an empty list means "show nothing".
export async function fetchQuotes(
  base: string,
  publicKey: string,
  request: QuoteRequest,
): Promise<Quote[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/v1/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [PUBLIC_KEY_HEADER]: publicKey },
      // The endpoint rejects unknown keys, so storeItemRef is left out when unset
      // rather than sent as null.
      body: JSON.stringify(request),
      signal: abort.signal,
    });
    if (response.status !== 200) return [];
    const body = await response.json();
    if (!Array.isArray(body) || body.length === 0) return [];
    const quotes = body.map(toQuote);
    return quotes.every((quote) => quote !== null) ? (quotes as Quote[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
