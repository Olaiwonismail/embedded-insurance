import { useEffect, useState } from 'react';

import {
  Activity,
  ApiError,
  MerchantStore,
  categoryLabel,
  getActivity,
  getMerchant,
  isStandardCategory,
  merchantLogout,
  platformLabel,
} from '../api';
import { CopyField } from '../components/CopyField';
import {
  Badge,
  BillsPanel,
  EventsPanel,
  PoliciesPanel,
  SalesPanel,
  dateFormat,
} from '../components/StoreActivity';

const STORE_STATUS: Record<string, string> = {
  pending: 'Under review',
  active: 'Live',
  suspended: 'Suspended',
};

export function DashboardPage() {
  const [store, setStore] = useState<MerchantStore | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [me, act] = await Promise.all([getMerchant(), getActivity()]);
      setStore(me.store);
      setActivity(act);
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

  async function signOut() {
    await merchantLogout().catch(() => undefined);
    window.location.assign('/login');
  }

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

  if (!store || !activity) {
    return (
      <main className="gate">
        <p className="muted">Loading your dashboard…</p>
      </main>
    );
  }

  const { sales, recentPolicies, settlements, webhookEvents } = activity;
  const standard = store.enabledCategories.filter(isStandardCategory);
  const custom = store.enabledCategories.filter((c) => !isStandardCategory(c));

  return (
    <div className="dash">
      <header className="admin__bar">
        <p className="brand">insureOnGo</p>
        <h1>{store.name}</h1>
        <Badge status={store.status} labels={STORE_STATUS} />
        <div className="admin__bar-actions">
          <button type="button" className="btn btn--quiet" onClick={load}>
            Refresh
          </button>
          <button type="button" className="btn btn--quiet" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {store.status === 'pending' && (
        <p className="dash__notice dash__notice--pending">
          We're reviewing your store. The checkout widget starts working once we approve it.
        </p>
      )}
      {store.status === 'suspended' && (
        <p className="dash__notice dash__notice--suspended">
          Your store is suspended, so the checkout widget is switched off and shoppers can't buy
          cover.
        </p>
      )}

      <div className="dash__body">
        <main className="dash__main">
          <SalesPanel sales={sales} commissionLabel="Your commission" />

          <PoliciesPanel
            policies={recentPolicies}
            emptyText={
              store.status === 'active'
                ? 'No policies yet. When a shopper adds cover at your checkout, it shows up here.'
                : 'No policies yet. Sales start once your store is approved and the widget is on your checkout.'
            }
          />

          <BillsPanel
            settlements={settlements}
            emptyText={`No statements yet. We total your sales and commission ${
              store.settlementFrequency === 'weekly' ? 'every Friday' : 'each period'
            } you sell cover.`}
          />

          <EventsPanel
            events={webhookEvents}
            title={`Events from ${platformLabel(store.platform)}`}
            emptyText="No events yet. Updates your platform sends us, such as paid orders, appear here."
          />
        </main>

        <aside className="panel dash__side" aria-labelledby="account-title">
          <h2 id="account-title">Account and setup</h2>

          <CopyField
            label="Public key"
            value={store.publicKey}
            hint="Goes in your checkout widget."
          />

          <p>
            <a href="/setup">How to connect your store</a>
          </p>

          <dl className="facts">
            <dt>Platform</dt>
            <dd>{platformLabel(store.platform)}</dd>
            <dt>Domains</dt>
            <dd>
              <ul className="plain">
                {store.allowedDomains.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </dd>
            <dt>Products</dt>
            <dd>{standard.map(categoryLabel).join(', ') || 'None'}</dd>
            {custom.length > 0 && (
              <>
                <dt>Other products</dt>
                <dd>
                  {custom.map(categoryLabel).join(', ')}
                  <p className="facts__note">We confirm cover for these during review.</p>
                </dd>
              </>
            )}
            <dt>Commission</dt>
            <dd>{(Number(store.commissionRate) * 100).toLocaleString()}% of each premium</dd>
            <dt>Statements</dt>
            <dd className="capitalize">{store.settlementFrequency}</dd>
            <dt>Email</dt>
            <dd>{store.billingEmail}</dd>
            <dt>Joined</dt>
            <dd>{dateFormat.format(new Date(store.createdAt))}</dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
