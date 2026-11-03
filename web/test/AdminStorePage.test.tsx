import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminStorePage, storeIdFromPath } from '../src/pages/AdminStorePage';
import type { Activity, StoreDetails } from '../src/api';

const ADMIN_KEY = 'admin-key-for-tests-0123456789abcdef';

const store: StoreDetails = {
  id: 7,
  name: 'Demo Gadgets',
  platform: 'custom',
  status: 'pending',
  allowedDomains: ['127.0.0.1'],
  enabledCategories: ['phones', 'laptops'],
  createdAt: '2026-11-01T09:00:00.000Z',
  publicKey: 'pk_live_demo_gadgets_key',
  billingEmail: 'owner@demogadgets.example',
  commissionRate: '0.1000',
  settlementFrequency: 'weekly',
};

const activity: Activity = {
  sales: { policiesSold: 1, pendingPolicies: 0, premiumTotal: '54000.00', commissionTotal: '5400.00' },
  recentPolicies: [
    {
      id: 1,
      policyNumber: 'ACME-1',
      orderRef: 'DEMO-1001',
      itemName: 'iPhone 15',
      itemCategory: 'phones',
      itemPrice: '900000.00',
      premium: '54000.00',
      commissionAmount: '5400.00',
      status: 'active',
      createdAt: '2026-11-02T10:00:00.000Z',
    },
  ],
  settlements: [],
  webhookEvents: [],
};

let requested: { url: string; key: string | undefined }[] = [];

beforeEach(() => {
  requested = [];
  sessionStorage.setItem('insureongo.adminKey', ADMIN_KEY);
  window.history.pushState({}, '', '/admin/stores/7');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      requested.push({ url, key: headers['x-admin-key'] });
      const body = url.endsWith('/activity') ? activity : { store };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('storeIdFromPath', () => {
  it('reads the id from a store page address', () => {
    expect(storeIdFromPath('/admin/stores/7')).toBe(7);
    expect(storeIdFromPath('/admin/stores/7/')).toBe(7);
  });

  it('refuses anything else', () => {
    expect(storeIdFromPath('/admin')).toBeNull();
    expect(storeIdFromPath('/admin/stores/abc')).toBeNull();
    expect(storeIdFromPath('/admin/stores/0')).toBeNull();
    expect(storeIdFromPath('/admin/stores/7/edit')).toBeNull();
  });
});

describe('AdminStorePage', () => {
  it("loads that store's details and activity with the admin key", async () => {
    render(<AdminStorePage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo Gadgets'));

    expect(requested.map((r) => r.url).sort()).toEqual([
      '/v1/admin/stores/7',
      '/v1/admin/stores/7/activity',
    ]);
    expect(requested.every((r) => r.key === ADMIN_KEY)).toBe(true);
  });

  it('shows sales, policies and the store details', async () => {
    render(<AdminStorePage />);
    await waitFor(() => expect(screen.getByText('DEMO-1001')).toBeDefined());

    const text = document.body.textContent ?? '';
    expect(text).toContain('iPhone 15');
    expect(text).toContain('54,000.00');
    expect(text).toContain(store.publicKey);
    expect(text).toContain(store.billingEmail);
  });

  it('offers Approve and Reject while the store is pending', async () => {
    render(<AdminStorePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve store' })).toBeDefined());

    expect(screen.getByRole('button', { name: 'Reject store' })).toBeDefined();
  });

  it('links back to the list of merchants', async () => {
    render(<AdminStorePage />);
    await waitFor(() => expect(screen.getByText('DEMO-1001')).toBeDefined());

    expect(screen.getByRole('link', { name: /All merchants/ }).getAttribute('href')).toBe('/admin');
  });

  it('asks for the admin key when none is saved', () => {
    sessionStorage.clear();
    render(<AdminStorePage />);

    expect(screen.getByLabelText('Admin key')).toBeDefined();
  });
});
