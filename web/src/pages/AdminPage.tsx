import { useCallback, useEffect, useState } from 'react';

import {
  AdminOverview,
  ApiError,
  BillRunResult,
  StoreStatus,
  StoreSummary,
  categoryLabel,
  getOverview,
  listStores,
  platformLabel,
  runWeeklyBill,
} from '../api';
import { KeyGate, readSavedKey, saveKey } from '../components/AdminKeyGate';

// Each store has its own admin page.
export function storePath(id: number): string {
  return `/admin/stores/${id}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
export const STATUS_LABEL: Record<StoreStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  suspended: 'Suspended',
};

type Filter = 'all' | StoreStatus;

// The schema stores amounts without a currency, so none is shown.
function amount(value: string): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Overview({
  adminKey,
  reloadToken,
  onError,
}: {
  adminKey: string;
  reloadToken: number;
  onError: (err: unknown) => string;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState(false);
  const [billResult, setBillResult] = useState<BillRunResult | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOverview(await getOverview(adminKey));
    } catch (err) {
      setError(onError(err));
    }
  }, [adminKey, onError]);

  useEffect(() => {
    load();
  }, [load, reloadToken]);

  async function runBill() {
    setBilling(true);
    setError(null);
    setBillResult(null);
    try {
      setBillResult(await runWeeklyBill(adminKey));
      await load();
    } catch (err) {
      setError(onError(err));
    } finally {
      setBilling(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="overview-title">
      <h2 id="overview-title">Across all stores</h2>

      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}

      {overview === null && !error ? (
        <p className="muted">Loading totals…</p>
      ) : (
        overview && (
          <>
            <dl className="totals">
              <div>
                <dt>Stores</dt>
                <dd>
                  {overview.totals.activeStores} active
                  {overview.totals.pendingStores > 0 &&
                    `, ${overview.totals.pendingStores} pending`}
                </dd>
              </div>
              <div>
                <dt>Policies sold</dt>
                <dd>{overview.totals.policiesSold}</dd>
              </div>
              <div>
                <dt>Premiums</dt>
                <dd>{amount(overview.totals.premiumTotal)}</dd>
              </div>
              <div className="totals__earned">
                <dt>Our commission</dt>
                <dd>{amount(overview.totals.commissionTotal)}</dd>
              </div>
            </dl>

            {overview.stores.length > 0 && (
              <div className="table-wrap">
                <table className="stores">
                  <thead>
                    <tr>
                      <th scope="col">Store</th>
                      <th scope="col" className="num">
                        Policies
                      </th>
                      <th scope="col" className="num">
                        Premiums
                      </th>
                      <th scope="col" className="num">
                        Commission
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.stores.map((store) => (
                      <tr key={store.id}>
                        <th scope="row">
                          <a className="row-link" href={storePath(store.id)}>
                            {store.name}
                          </a>{' '}
                          <StatusBadge status={store.status} />
                        </th>
                        <td className="num">{store.policiesSold}</td>
                        <td className="num">{amount(store.premiumTotal)}</td>
                        <td className="num">{amount(store.commissionTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      <div className="admin__bar-actions">
        <button type="button" className="btn btn--small" onClick={runBill} disabled={billing}>
          {billing ? 'Billing…' : 'Run weekly bill now'}
        </button>
        {billResult && (
          <span className="muted" role="status">
            {billResult.billed === 0
              ? 'Nothing new to bill.'
              : `Billed ${billResult.billed} store${billResult.billed === 1 ? '' : 's'} for ${
                  billResult.periodStart
                } to ${billResult.periodEnd}, ${billResult.emailed} emailed.`}
          </span>
        )}
      </div>
    </section>
  );
}

export function AdminPage() {
  const [adminKey, setAdminKey] = useState(readSavedKey);
  const [keyRejected, setKeyRejected] = useState(false);

  // Stable so the list doesn't refetch on every render.
  const signOut = useCallback((rejected = false) => {
    saveKey('');
    setAdminKey('');
    setKeyRejected(rejected);
  }, []);

  if (!adminKey) {
    return (
      <KeyGate
        rejected={keyRejected}
        onSubmit={(key) => {
          saveKey(key);
          setKeyRejected(false);
          setAdminKey(key);
        }}
      />
    );
  }
  return <MerchantList adminKey={adminKey} onSignOut={signOut} />;
}

function MerchantList({
  adminKey,
  onSignOut,
}: {
  adminKey: string;
  onSignOut: (rejected?: boolean) => void;
}) {
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  // A 401 anywhere means the key is wrong or was changed on the server.
  const handleError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError && err.status === 401) {
        onSignOut(true);
      }
      return err instanceof Error ? err.message : 'Something went wrong.';
    },
    [onSignOut],
  );

  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    setReloadToken((token) => token + 1);
    try {
      const { stores } = await listStores(adminKey);
      setStores(stores);
    } catch (err) {
      setLoadError(handleError(err));
    }
  }, [adminKey, handleError]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = {
    all: stores?.length ?? 0,
    pending: stores?.filter((s) => s.status === 'pending').length ?? 0,
    active: stores?.filter((s) => s.status === 'active').length ?? 0,
    suspended: stores?.filter((s) => s.status === 'suspended').length ?? 0,
  };
  const visible = stores?.filter((s) => filter === 'all' || s.status === filter) ?? [];

  return (
    <div className="admin">
      <header className="admin__bar">
        <p className="brand">insureOnGo</p>
        <h1>Merchants</h1>
        <div className="admin__bar-actions">
          <button type="button" className="btn btn--quiet" onClick={load}>
            Refresh
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => onSignOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="admin__body">
        <section className="admin__list" aria-label="Stores">
          <Overview adminKey={adminKey} reloadToken={reloadToken} onError={handleError} />

          <div className="filters" role="group" aria-label="Show stores by status">
            {(['all', 'pending', 'active', 'suspended'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className="filter"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : STATUS_LABEL[f]}
                <span className="filter__count">{counts[f]}</span>
              </button>
            ))}
          </div>

          {loadError && (
            <p className="alert alert--error" role="alert">
              {loadError}{' '}
              <button type="button" className="link" onClick={load}>
                Try again
              </button>
            </p>
          )}

          {stores === null && !loadError && <p className="muted">Loading stores…</p>}

          {stores !== null && visible.length === 0 && (
            <p className="empty">
              {stores.length === 0
                ? 'No stores have signed up yet. New signups from /signup appear here.'
                : `No ${filter} stores.`}
            </p>
          )}

          {visible.length > 0 && (
            <div className="table-wrap">
              <table className="stores">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Platform</th>
                    <th scope="col">Status</th>
                    <th scope="col">Domains</th>
                    <th scope="col">Categories</th>
                    <th scope="col">Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id} onClick={() => window.location.assign(storePath(s.id))}>
                      <th scope="row">
                        <a className="row-link" href={storePath(s.id)}>
                          {s.name}
                        </a>
                      </th>
                      <td>{platformLabel(s.platform)}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="domains">{s.allowedDomains.join(', ')}</td>
                      <td>{s.enabledCategories.map(categoryLabel).join(', ')}</td>
                      <td className="nowrap">{dateFormat.format(new Date(s.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: StoreStatus }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
