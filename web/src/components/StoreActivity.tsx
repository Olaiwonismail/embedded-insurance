// The sales, policies, bills and events panels for one store. The merchant dashboard
// shows them for the signed-in store; the admin store page for any store.

import { Activity, categoryLabel } from '../api';

export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
export const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

// The schema stores amounts without a currency, so none is shown.
export function amount(value: string): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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

export function Badge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return <span className={`badge badge--${TONE[status] ?? 'muted'}`}>{labels[status] ?? status}</span>;
}

export function SalesPanel({
  sales,
  commissionLabel,
}: {
  sales: Activity['sales'];
  commissionLabel: string;
}) {
  return (
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
          <dt>{commissionLabel}</dt>
          <dd>{amount(sales.commissionTotal)}</dd>
        </div>
        <div>
          <dt>Awaiting payment</dt>
          <dd>{sales.pendingPolicies.toLocaleString()}</dd>
        </div>
      </dl>
    </section>
  );
}

export function PoliciesPanel({
  policies,
  emptyText,
}: {
  policies: Activity['recentPolicies'];
  emptyText: string;
}) {
  return (
    <section className="panel" aria-labelledby="policies-title">
      <h2 id="policies-title">Recent policies</h2>
      {policies.length === 0 ? (
        <p className="empty empty--inline">{emptyText}</p>
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
              {policies.map((p) => (
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
  );
}

export function BillsPanel({
  settlements,
  emptyText,
}: {
  settlements: Activity['settlements'];
  emptyText: string;
}) {
  return (
    <section className="panel" aria-labelledby="payouts-title">
      <h2 id="payouts-title">Bills</h2>
      {settlements.length === 0 ? (
        <p className="empty empty--inline">{emptyText}</p>
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
  );
}

export function EventsPanel({
  events,
  title,
  emptyText,
}: {
  events: Activity['webhookEvents'];
  title: string;
  emptyText: string;
}) {
  return (
    <section className="panel" aria-labelledby="events-title">
      <h2 id="events-title">{title}</h2>
      {events.length === 0 ? (
        <p className="empty empty--inline">{emptyText}</p>
      ) : (
        <ul className="events">
          {events.map((e) => (
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
  );
}
