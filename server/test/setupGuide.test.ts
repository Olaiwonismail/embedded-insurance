// The Setup page tells merchants how to sign a webhook. This runs the exact snippet
// shown on that page and checks the real verifier accepts the result, so the
// instructions cannot drift from what we accept.

import { createRequire } from 'module';
import { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { CustomVerifier } from '../src/lib/webhooks/custom';
import { SIGN_FUNCTION } from '../../web/src/setupSnippets';

const SECRET = 'whsec_known_test_secret';

// Evaluates the snippet and hands back the signBody function it defines.
function loadSignBody(): (body: string, secret: string) => string {
  const factory = new Function(
    'require',
    `${SIGN_FUNCTION}\nreturn signBody;`,
  ) as (req: NodeRequire) => (body: string, secret: string) => string;
  return factory(createRequire(__filename));
}

function requestWith(signature: string, timestamp: number): Request {
  const headers: Record<string, string> = {
    'x-insureongo-signature': signature,
    'x-insureongo-timestamp': String(timestamp),
  };
  return { get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('the signing example on the Setup page', () => {
  const verifier = new CustomVerifier();

  it('produces a signature the real verifier accepts', () => {
    const signBody = loadSignBody();
    const body = JSON.stringify({
      eventId: 'evt_1001',
      type: 'order.paid',
      orderRef: 'ORDER-1001',
      quoteId: 42,
      customer: { name: 'Jane Doe', email: 'jane@example.com' },
    });

    const signature = signBody(body, SECRET);

    expect(verifier.verifySignature(requestWith(signature, nowSeconds()), Buffer.from(body), SECRET)).toBe(
      true,
    );
  });

  it('is rejected when the body changes after signing', () => {
    const signBody = loadSignBody();
    const body = JSON.stringify({ eventId: 'evt_1', type: 'order.paid' });
    const signature = signBody(body, SECRET);
    const tampered = JSON.stringify({ eventId: 'evt_1', type: 'order.refunded' });

    expect(
      verifier.verifySignature(requestWith(signature, nowSeconds()), Buffer.from(tampered), SECRET),
    ).toBe(false);
  });

  it('is rejected with the wrong secret', () => {
    const signBody = loadSignBody();
    const body = JSON.stringify({ eventId: 'evt_1', type: 'order.paid' });

    expect(
      verifier.verifySignature(
        requestWith(signBody(body, 'whsec_someone_elses'), nowSeconds()),
        Buffer.from(body),
        SECRET,
      ),
    ).toBe(false);
  });

  it('is rejected outside the five minute window the page documents', () => {
    const signBody = loadSignBody();
    const body = JSON.stringify({ eventId: 'evt_1', type: 'order.paid' });
    const signature = signBody(body, SECRET);

    expect(
      verifier.verifySignature(requestWith(signature, nowSeconds() - 299), Buffer.from(body), SECRET),
    ).toBe(true);
    expect(
      verifier.verifySignature(requestWith(signature, nowSeconds() - 301), Buffer.from(body), SECRET),
    ).toBe(false);
    expect(
      verifier.verifySignature(requestWith(signature, nowSeconds() + 301), Buffer.from(body), SECRET),
    ).toBe(false);
  });

  it('signs the body only, so the timestamp is not covered', () => {
    // Worth knowing: a captured signature replays with any timestamp inside the
    // window. The unique eventId is what makes a replay harmless.
    const signBody = loadSignBody();
    const body = JSON.stringify({ eventId: 'evt_1', type: 'order.paid' });
    const signature = signBody(body, SECRET);

    expect(
      verifier.verifySignature(requestWith(signature, nowSeconds() - 60), Buffer.from(body), SECRET),
    ).toBe(true);
  });
});
