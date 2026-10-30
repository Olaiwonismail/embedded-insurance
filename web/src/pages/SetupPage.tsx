import { useEffect, useState } from 'react';

import { ApiError, MerchantStore, getMerchant } from '../api';
import { CopyField } from '../components/CopyField';
import {
  EVENT_EXAMPLE,
  FORM_EXAMPLE,
  READ_VALUE_EXAMPLE,
  SEND_EXAMPLE,
  SIGN_FUNCTION,
  WIDGET_ATTRIBUTES,
  WIDGET_ELEMENT,
  WIDGET_SCRIPT,
} from '../setupSnippets';

// The API and this page are served from one origin, so the page's own origin is the
// API address. Nothing on the server hands it to us.
function apiBase(): string {
  return window.location.origin;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="code-block">
      <code>{children}</code>
    </pre>
  );
}

export function SetupPage() {
  const [store, setStore] = useState<MerchantStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const me = await getMerchant();
      setStore(me.store);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <main className="gate">
        <div className="gate__card">
          <p className="alert alert--error" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn--primary btn--wide" onClick={load}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!store) {
    return (
      <main className="gate">
        <p className="muted">Loading your setup details…</p>
      </main>
    );
  }

  const base = apiBase();
  const webhookUrl = `${base}/v1/webhooks/custom/${store.publicKey}`;

  return (
    <main className="page">
      <header className="page__head">
        <h1>Set up {store.name}</h1>
        <p className="muted">
          Four steps to put a protection offer on your product pages.{' '}
          <a href="/dashboard">Back to the dashboard</a>
        </p>
      </header>

      {store.status !== 'active' && (
        <p className="alert alert--info" role="status">
          Your store is still under review. You can add the widget now, but it will not
          show an offer until we approve the store.
        </p>
      )}

      <section className="panel" aria-labelledby="step-widget">
        <h2 id="step-widget">1. Add the widget</h2>
        <p>Put this script tag once in your page template, ideally just before the closing body tag.</p>
        <Code>{WIDGET_SCRIPT(base)}</Code>

        <p>Then put this where you want the offer to appear on a product page.</p>
        <Code>{WIDGET_ELEMENT(store.publicKey)}</Code>

        <CopyField
          label="Your public key"
          value={store.publicKey}
          hint="Safe to put in your page source. It only allows asking for quotes."
        />

        <div className="table-wrap">
          <table className="stores">
            <thead>
              <tr>
                <th scope="col">Attribute</th>
                <th scope="col">Required</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {WIDGET_ATTRIBUTES.map((attribute) => (
                <tr key={attribute.name}>
                  <th scope="row">
                    <code>{attribute.name}</code>
                  </th>
                  <td>{attribute.required ? 'Yes' : 'No'}</td>
                  <td>{attribute.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Where it is allowed to run</h3>
        <p>
          The widget only works on the domains you gave us. Subdomains of a listed domain
          are included, so <code>www.</code> and <code>shop.</code> work without being
          listed separately. Anywhere else gets no offer.
        </p>
        <ul className="plain-list">
          {store.allowedDomains.map((domain) => (
            <li key={domain}>
              <code>{domain}</code>
            </li>
          ))}
        </ul>
        <p className="muted">
          Need another domain? Reply to your signup email and we will add it.
        </p>
      </section>

      <section className="panel" aria-labelledby="step-cart">
        <h2 id="step-cart">2. Save the chosen quote with the order</h2>
        <p>
          When a shopper ticks the box, the widget hands you a quote id. Keep it with the
          order; you send it back to us in step 3. Pick whichever of these three suits
          your cart.
        </p>

        <h3>Read it directly</h3>
        <Code>{READ_VALUE_EXAMPLE}</Code>

        <h3>Listen for a change</h3>
        <Code>{EVENT_EXAMPLE}</Code>

        <h3>Let the form submit it</h3>
        <p>Inside a form the widget submits itself, so you may not need any JavaScript.</p>
        <Code>{FORM_EXAMPLE}</Code>
      </section>

      <section className="panel" aria-labelledby="step-webhook">
        <h2 id="step-webhook">3. Tell us when an order is paid</h2>
        <p>
          Once the shopper has paid, post the order to this address. We then issue the
          policy and it appears in your dashboard.
        </p>

        <CopyField label="Your webhook address" value={webhookUrl} />

        <h3>Headers</h3>
        <div className="table-wrap">
          <table className="stores">
            <thead>
              <tr>
                <th scope="col">Header</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  <code>Content-Type</code>
                </th>
                <td>
                  <code>application/json</code>
                </td>
              </tr>
              <tr>
                <th scope="row">
                  <code>X-InsureOnGo-Signature</code>
                </th>
                <td>The signature from the rule below, as lowercase hex.</td>
              </tr>
              <tr>
                <th scope="row">
                  <code>X-InsureOnGo-Timestamp</code>
                </th>
                <td>
                  Unix time in <strong>seconds</strong>. We reject anything more than 5
                  minutes away from our clock, in either direction.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Body</h3>
        <div className="table-wrap">
          <table className="stores">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Required</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  <code>eventId</code>
                </th>
                <td>Yes</td>
                <td>
                  Your own id for this event, and it must be different for every event. If
                  we see the same one twice we ignore the repeat, which is what makes it
                  safe for you to retry.
                </td>
              </tr>
              <tr>
                <th scope="row">
                  <code>type</code>
                </th>
                <td>Yes</td>
                <td>
                  <code>order.paid</code>
                </td>
              </tr>
              <tr>
                <th scope="row">
                  <code>quoteId</code>
                </th>
                <td>Yes</td>
                <td>The id the widget gave you in step 2.</td>
              </tr>
              <tr>
                <th scope="row">
                  <code>orderRef</code>
                </th>
                <td>Yes</td>
                <td>Your own order id, so we can match the policy to the order.</td>
              </tr>
              <tr>
                <th scope="row">
                  <code>customer</code>
                </th>
                <td>Yes</td>
                <td>
                  An object with <code>name</code>, <code>email</code> and optionally{' '}
                  <code>phone</code>. The insurer needs these to issue the policy.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Signing the request</h3>
        <p>
          Sign the <strong>exact bytes of the request body</strong> with HMAC-SHA256 using
          your webhook secret, and send the result as lowercase hex. The timestamp header
          is not part of what you sign.
        </p>
        <Code>{SIGN_FUNCTION}</Code>
        <Code>{SEND_EXAMPLE(webhookUrl)}</Code>
        <p className="alert alert--info">
          Your webhook secret is the one starting <code>whsec_</code> that we showed you
          once at signup. We never show it again, and it is not on this page. If you have
          lost it, reply to your signup email and we will issue a new one.
        </p>
      </section>

      <section className="panel" aria-labelledby="step-check">
        <h2 id="step-check">4. Check it works</h2>
        <ol className="plain-list">
          <li>
            Open a product page on one of your listed domains. The protection checkbox
            should appear with a price.
          </li>
          <li>
            Tick it and place a test order. Your cart should keep the quote id from step 2.
          </li>
          <li>
            Send the paid-order webhook. A{' '}
            <code>200</code> back means we have it; a <code>401</code> means the signature
            did not match.
          </li>
          <li>
            Open <a href="/dashboard">your dashboard</a>. The event shows under recent
            events, and once we have issued it, the policy shows under recent policies.
          </li>
        </ol>
      </section>
    </main>
  );
}
