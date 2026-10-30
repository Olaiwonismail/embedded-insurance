import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupPage } from '../src/pages/SetupPage';
import type { MerchantStore } from '../src/api';

const PUBLIC_KEY = 'pk_live_abc123def456';
const WEBHOOK_SECRET = 'whsec_do_not_show_me';
const SECRET_KEY = 'sk_live_also_secret';

const store: MerchantStore = {
  id: 1,
  name: '3C Hub',
  platform: 'custom',
  status: 'active',
  allowedDomains: ['3chub.com', 'shop.3chub.com'],
  enabledCategories: ['phones'],
  createdAt: '2026-10-01T00:00:00.000Z',
  publicKey: PUBLIC_KEY,
  billingEmail: 'owner@3chub.com',
  commissionRate: '0.1000',
  settlementFrequency: 'weekly',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ store }),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderPage() {
  render(<SetupPage />);
  await waitFor(() => expect(screen.getByText(/Set up 3C Hub/)).toBeDefined());
}

describe('SetupPage', () => {
  it('shows the store public key', async () => {
    await renderPage();

    expect(document.body.textContent).toContain(PUBLIC_KEY);
  });

  it('shows the webhook address with the public key filled in', async () => {
    await renderPage();

    expect(document.body.textContent).toContain(
      `https://dashboard.insureongo.test/v1/webhooks/custom/${PUBLIC_KEY}`,
    );
  });

  it('shows the script tag and the element with the real key', async () => {
    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toContain('/widget/v1/insureongo.js');
    expect(text).toContain(`public-key="${PUBLIC_KEY}"`);
  });

  it('lists every allowed domain and explains that subdomains count', async () => {
    await renderPage();

    const text = document.body.textContent ?? '';
    for (const domain of store.allowedDomains) expect(text).toContain(domain);
    expect(text).toMatch(/[Ss]ubdomains/);
  });

  it('names all three ways to hand the quote id to the cart', async () => {
    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toContain('offer.value');
    expect(text).toContain('insureongo:change');
    expect(text).toContain('insureongo_quote_id');
  });

  it('states the five minute window and that eventId must be unique', async () => {
    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toMatch(/5\s*minutes/);
    expect(text).toContain('eventId');
  });

  it('never shows any secret', async () => {
    await renderPage();

    const html = document.body.innerHTML;
    expect(html).not.toContain(WEBHOOK_SECRET);
    expect(html).not.toContain(SECRET_KEY);
    // No secret-looking key of any kind, only the public one.
    expect(html).not.toMatch(/whsec_[A-Za-z0-9]/);
    expect(html).not.toMatch(/sk_live_[A-Za-z0-9]/);
  });

  it('reads the current store from the merchant endpoint', async () => {
    await renderPage();

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/v1/merchant/me');
  });
});
