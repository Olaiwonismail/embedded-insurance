import { FormEvent, useCallback, useEffect, useState } from 'react';

import {
  AdminOverview,
  ApiError,
  BillRunResult,
  StoreDetails,
  StoreStatus,
  StoreSummary,
  approveStore,
  categoryLabel,
  getOverview,
  getStore,
  isStandardCategory,
  listStores,
  platformLabel,
  runWeeklyBill,
  suspendStore,
} from '../api';

// Kept for this browser tab only; closing the tab forgets it.
const KEY_STORAGE = 'insureongo.adminKey';

function readSavedKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function saveKey(key: string) {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage blocked: the key still works until the page reloads.
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const STATUS_LABEL: Record<StoreStatus, string> = {
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
                          {store.name} <StatusBadge status={store.status} />
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

  // Stable so the list and detail panel don't refetch on every render.
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

function KeyGate({ rejected, onSubmit }: { rejected: boolean; onSubmit: (key: string) => void }) {
  const [value, setValue] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }

  return (
    <main className="gate">
      <form className="gate__card" onSubmit={submit}>
        <p className="brand">insureOnGo</p>
        <h1>Merchant review</h1>
        {rejected && (
          <p className="alert alert--error" role="alert">
            That admin key wasn't accepted. Check it and try again.
          </p>
        )}
        <div className="field">
          <label htmlFor="admin-key">Admin key</label>
          <p className="field__hint">The ADMIN_API_KEY value from the server's settings.</p>
          <input
            id="admin-key"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>
        <button type="submit" className="btn btn--primary btn--wide">
          Open merchant list
        </button>
      </form>
    </main>
  );
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
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  function updateRow(updated: StoreDetails) {
    setStores((current) =>
      current?.map((s) => (s.id === updated.id ? { ...s, status: updated.status } : s)) ?? null,
    );
  }

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

      <div className={selectedId ? 'admin__body admin__body--split' : 'admin__body'}>
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
                    <tr
                      key={s.id}
                      className={s.id === selectedId ? 'is-selected' : undefined}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <th scope="row">
                        <button
                          type="button"
                          className="row-link"
                          aria-current={s.id === selectedId ? 'true' : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(s.id);
                          }}
                        >
                          {s.name}
                        </button>
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

        {selectedId !== null && (
          <StoreDetailPanel
            key={selectedId}
            adminKey={adminKey}
            storeId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={updateRow}
            handleError={handleError}
          />
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: StoreStatus }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function StoreDetailPanel({
  adminKey,
  storeId,
  onClose,
  onChanged,
  handleError,
}: {
  adminKey: string;
  storeId: number;
  onClose: () => void;
  onChanged: (s: StoreDetails) => void;
  handleError: (err: unknown) => string;
}) {
  const [store, setStore] = useState<StoreDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStore(adminKey, storeId)
      .then(({ store }) => !cancelled && setStore(store))
      .catch((err) => !cancelled && setError(handleError(err)));
    return () => {
      cancelled = true;
    };
  }, [adminKey, storeId, handleError]);

  async function act(action: 'approve' | 'suspend') {
    if (!store) return;
    const rejecting = store.status === 'pending';
    if (
      action === 'suspend' &&
      !window.confirm(
        rejecting
          ? `Reject ${store.name}? They will not be able to take protection on any order.`
          : `Suspend ${store.name}? Their checkout widget will stop working straight away.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const run = action === 'approve' ? approveStore : suspendStore;
      const { store: updated } = await run(adminKey, store.id);
      setStore(updated);
      onChanged(updated);
      setNotice(
        action === 'approve'
          ? `${updated.name} approved.`
          : `${updated.name} ${rejecting ? 'rejected' : 'suspended'}.`,
      );
    } catch (err) {
      setError(handleError(err));
      // Someone else may have changed it; show the current state.
      if (err instanceof ApiError && err.status === 409) {
        const { store: fresh } = await getStore(adminKey, store.id).catch(() => ({ store }));
        setStore(fresh);
        onChanged(fresh);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="detail" aria-labelledby="detail-title">
      <div className="detail__head">
        <h2 id="detail-title">{store?.name ?? 'Store details'}</h2>
        <button type="button" className="btn btn--quiet btn--small" onClick={onClose}>
          Close
        </button>
      </div>

      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert--ok" role="status">
          {notice}
        </p>
      )}

      {!store && !error && <p className="muted">Loading…</p>}

      {store && (
        <>
          <div className="detail__status">
            <StatusBadge status={store.status} />
            {store.status === 'pending' && <span>Waiting for review. The widget won't load yet.</span>}
            {store.status === 'active' && <span>The checkout widget is live.</span>}
            {store.status === 'suspended' && <span>The checkout widget is switched off.</span>}
          </div>

          <dl className="facts">
            <dt>Store ID</dt>
            <dd>{store.id}</dd>
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
            <dt>Categories</dt>
            <dd>
              {store.enabledCategories.filter(isStandardCategory).map(categoryLabel).join(', ') ||
                'None'}
            </dd>
            {store.enabledCategories.some((c) => !isStandardCategory(c)) && (
              <>
                <dt>Other products</dt>
                <dd>
                  {store.enabledCategories
                    .filter((c) => !isStandardCategory(c))
                    .map(categoryLabel)
                    .join(', ')}
                  <span className="badge badge--custom">Added by merchant</span>
                  <p className="facts__note">Check a plan covers these before approving.</p>
                </dd>
              </>
            )}
            <dt>Billing email</dt>
            <dd>
              <a href={`mailto:${store.billingEmail}`}>{store.billingEmail}</a>
            </dd>
            <dt>Commission</dt>
            <dd>{(Number(store.commissionRate) * 100).toLocaleString()}%</dd>
            <dt>Settlement</dt>
            <dd className="capitalize">{store.settlementFrequency}</dd>
            <dt>Public key</dt>
            <dd>
              <code className="key">{store.publicKey}</code>
            </dd>
            <dt>Signed up</dt>
            <dd>{dateTimeFormat.format(new Date(store.createdAt))}</dd>
          </dl>

          <div className="detail__actions">
            {store.status === 'pending' && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => act('approve')}
              >
                Approve store
              </button>
            )}
            {store.status !== 'suspended' && (
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => act('suspend')}
              >
                {/* Turning down a store that was never live is a rejection, not a
                    suspension, though both land on the same status. */}
                {store.status === 'pending' ? 'Reject store' : 'Suspend store'}
              </button>
            )}
            {store.status === 'suspended' && (
              <p className="muted">Suspended stores can't be reactivated from here yet.</p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
