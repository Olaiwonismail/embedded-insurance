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

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// The schema stores amounts without a currency, so none is shown.
function amount(value: string): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const STORE_STATUS: Record<string, string> = {
  pending: 'Under review',
  active: 'Live',
  suspended: 'Suspended',
};

const POLICY_STATUS: Record<string, string> = {
  pending: 'Awaiting payment',
  active: 'Active',
  expired: 'Ended',
  cancelled: 'Cancelled',
};

const SETTLEMENT_STATUS: Record<string, string> = {
  pending: 'Being prepared',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

const EVENT_STATUS: Record<string, string> = {
  received: 'Received',
  processed: 'Handled',
  failed: 'Failed',
};

// Maps each status to one of the existing badge colours.
const TONE: Record<string, string> = {
  pending: 'pending',
  active: 'active',
  paid: 'active',
  processed: 'active',
  invoiced: 'pending',
  received: 'pending',
  expired: 'muted',
  cancelled: 'suspended',
  suspended: 'suspended',
  failed: 'suspended',
};

function Badge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return <span className={`badge badge--${TONE[status] ?? 'muted'}`}>{labels[status] ?? status}</span>;
}

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
          <section className="panel" aria-labelledby="sales-title">
            <h2 id="sales-title">Sales</h2>
            <dl className="totals">
              <div>
                <dt>Policies sold</dt>
                <dd>{sales.policiesSold.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Premiums</dt>
                <dd>{amount(sales.premiumTotal)}</dd>
              </div>
              <div className="totals__earned">
                <dt>Your commission</dt>
                <dd>{amount(sales.commissionTotal)}</dd>
              </div>
              <div>
                <dt>Awaiting payment</dt>
                <dd>{sales.pendingPolicies.toLocaleString()}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="policies-title">
            <h2 id="policies-title">Recent policies</h2>
            {recentPolicies.length === 0 ? (
              <p className="empty empty--inline">
                {store.status === 'active'
                  ? 'No policies yet. When a shopper adds cover at your checkout, it shows up here.'
                  : 'No policies yet. Sales start once your store is approved and the widget is on your checkout.'}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="stores">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Item</th>
                      <th scope="col" className="num">Premium</th>
                      <th scope="col" className="num">Commission</th>
                      <th scope="col">Status</th>
                      <th scope="col">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPolicies.map((p) => (
                      <tr key={p.id}>
                        <th scope="row" className="mono">{p.orderRef}</th>
                        <td>
                          {p.itemName}
                          <span className="sub">{categoryLabel(p.itemCategory)}</span>
                        </td>
                        <td className="num">{amount(p.premium)}</td>
                        <td className="num">{amount(p.commissionAmount)}</td>
                        <td>
                          <Badge status={p.status} labels={POLICY_STATUS} />
                        </td>
                        <td className="nowrap">{dateFormat.format(new Date(p.createdAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="payouts-title">
            <h2 id="payouts-title">Bills</h2>
            {settlements.length === 0 ? (
              <p className="empty empty--inline">
                No statements yet. We total your sales and commission{' '}
                {store.settlementFrequency === 'weekly' ? 'every Friday' : 'each period'} you sell
                cover.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="stores">
                  <thead>
                    <tr>
                      <th scope="col">Week</th>
                      <th scope="col" className="num">Policies</th>
                      <th scope="col" className="num">Premiums</th>
                      <th scope="col" className="num">Commission</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((s) => (
                      <tr key={s.id}>
                        <th scope="row" className="nowrap">
                          {dateFormat.format(new Date(`${s.periodStart}T00:00:00`))} &ndash;{' '}
                          {dateFormat.format(new Date(`${s.periodEnd}T00:00:00`))}
                        </th>
                        <td className="num">{s.policyCount}</td>
                        <td className="num">{amount(s.premiumTotal)}</td>
                        <td className="num">{amount(s.commissionTotal)}</td>
                        <td>
                          <Badge status={s.status} labels={SETTLEMENT_STATUS} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="events-title">
            <h2 id="events-title">Events from {platformLabel(store.platform)}</h2>
            {webhookEvents.length === 0 ? (
              <p className="empty empty--inline">
                No events yet. Updates your platform sends us, such as paid orders, appear here.
              </p>
            ) : (
              <ul className="events">
                {webhookEvents.map((e) => (
                  <li key={e.id}>
                    <span className="mono">{e.type}</span>
                    <Badge status={e.status} labels={EVENT_STATUS} />
                    <time className="muted" dateTime={e.receivedAt}>
                      {dateTimeFormat.format(new Date(e.receivedAt))}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
