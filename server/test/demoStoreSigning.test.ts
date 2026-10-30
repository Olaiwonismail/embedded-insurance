// The demo shop signs its paid-order webhooks with its own code. This checks the real
// verifier accepts what that code produces, so the webhook step of the demo is known
// to work before anyone is watching.

import { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { CustomVerifier } from '../src/lib/webhooks/custom';
import { signBody } from '../../demo-store/src/sign';

const SECRET = 'whsec_known_test_secret';

function requestWith(signature: string, timestamp: number): Request {
  const headers: Record<string, string> = {
    'x-insureongo-signature': signature,
    'x-insureongo-timestamp': String(timestamp),
  };
  return { get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("the demo shop's webhook signing", () => {
  const verifier = new CustomVerifier();

  // The same shape sendPaidOrder builds.
  const body = JSON.stringify({
    type: 'order.paid',
    eventId: 'evt_demo_1',
    orderRef: 'DEMO-1001',
    quoteId: 42,
    customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '+2348030000000' },
  });

  it('produces a signature the real verifier accepts', () => {
    const signature = signBody(body, SECRET);

    expect(verifier.verifySignature(requestWith(signature, nowSeconds()), Buffer.from(body), SECRET)).toBe(
      true,
    );
  });

  it('is rejected with the wrong secret', () => {
    const signature = signBody(body, 'whsec_someone_elses');

    expect(verifier.verifySignature(requestWith(signature, nowSeconds()), Buffer.from(body), SECRET)).toBe(
      false,
    );
  });
});
