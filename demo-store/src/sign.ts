import crypto from 'crypto';

// The rule insureOnGo verifies: HMAC-SHA256 over the exact request body bytes,
// lowercase hex. The timestamp header is sent but is not part of what is signed.
// A test in the server package checks the real verifier accepts what this produces.
export function signBody(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export interface PaidOrderWebhook {
  eventId: string;
  orderRef: string;
  quoteId: number;
  customer: { name: string; email: string; phone?: string };
}

export interface SendResult {
  status: number;
  body: string;
}

// Builds the body once and signs that exact string. Re-serialising it before sending
// would change the bytes and the signature would no longer match.
export async function sendPaidOrder(
  webhookUrl: string,
  secret: string,
  order: PaidOrderWebhook,
): Promise<SendResult> {
  const body = JSON.stringify({ type: 'order.paid', ...order });

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-InsureOnGo-Signature': signBody(body, secret),
      'X-InsureOnGo-Timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body,
  });

  return { status: response.status, body: (await response.text()).slice(0, 300) };
}
