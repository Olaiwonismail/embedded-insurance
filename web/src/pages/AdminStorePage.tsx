import { useCallback, useEffect, useState } from 'react';

import {
  Activity,
  ApiError,
  StoreDetails,
  approveStore,
  categoryLabel,
  getStore,
  getStoreActivity,
  isStandardCategory,
  platformLabel,
  suspendStore,
} from '../api';
import { KeyGate, readSavedKey, saveKey } from '../components/AdminKeyGate';
import {
  BillsPanel,
  EventsPanel,
  PoliciesPanel,
  SalesPanel,
  dateTimeFormat,
} from '../components/StoreActivity';
import { StatusBadge } from './AdminPage';

// The store id from /admin/stores/:id, or null when the path is not one.
export function storeIdFromPath(path: string): number | null {
  const match = /^\/admin\/stores\/(\d{1,10})\/?$/.exec(path);
  if (!match) return null;
  const id = Number(match[1]);
  return id >= 1 && id <= 2_147_483_647 ? id : null;
}

export function AdminStorePage() {
  const [adminKey, setAdminKey] = useState(readSavedKey);
  const [keyRejected, setKeyRejected] = useState(false);

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

  const storeId = storeIdFromPath(window.location.pathname);
  if (storeId === null) {
    return <NotFound message="That isn't a store address." />;
  }
  return <StorePage adminKey={adminKey} storeId={storeId} onSignOut={signOut} />;
}

function NotFound({ message }: { message: string }) {
  return (
    <main className="gate">
      <div className="gate__card">
        <p className="alert alert--error" role="alert">
          {message}
        </p>
        <a className="btn btn--primary btn--wide" href="/admin">
          Back to all merchants
        </a>
      </div>
    </main>
  );
}

function StorePage({
  adminKey,
  storeId,
  onSignOut,
}: {
  adminKey: string;
  storeId: number;
  onSignOut: (rejected?: boolean) => void;
}) {
  const [store, setStore] = useState<StoreDetails | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

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

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ store }, act] = await Promise.all([
        getStore(adminKey, storeId),
        getStoreActivity(adminKey, storeId),
      ]);
      setStore(store);
      setActivity(act);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setMissing(true);
        return;
      }
      setError(handleError(err));
    }
  }, [adminKey, storeId, handleError]);

  useEffect(() => {
    load();
  }, [load]);

  if (missing) {
    return <NotFound message="No store has that id." />;
  }

  return (
    <div className="dash">
      <header className="admin__bar">
        <p className="brand">insureOnGo</p>
        <a className="back-link" href="/admin">
          &larr; All merchants
        </a>
        <h1>{store?.name ?? 'Store'}</h1>
        {store && <StatusBadge status={store.status} />}
        <div className="admin__bar-actions">
          <button type="button" className="btn btn--quiet" onClick={load}>
            Refresh
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => onSignOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p className="alert alert--error page-alert" role="alert">
          {error}{' '}
          <button type="button" className="link" onClick={load}>
            Try again
          </button>
        </p>
      )}

      {!error && (!store || !activity) && (
        <main className="gate">
          <p className="muted">Loading the store…</p>
        </main>
      )}

      {store && activity && (
        <div className="dash__body">
          <main className="dash__main">
            <SalesPanel sales={activity.sales} commissionLabel="Commission" />

            <PoliciesPanel
              policies={activity.recentPolicies}
              emptyText={
                store.status === 'active'
                  ? 'No policies yet. Policies appear here once shoppers add cover at this checkout.'
                  : 'No policies yet. Sales start once the store is approved and the widget is on its checkout.'
              }
            />

            <BillsPanel
              settlements={activity.settlements}
              emptyText="No bills yet. Bills are made on Fridays for any week with sales."
            />

            <EventsPanel
              events={activity.webhookEvents}
              title={`Events from ${platformLabel(store.platform)}`}
              emptyText="No events yet. Paid orders the store sends us appear here."
            />
          </main>

          <StoreDetailsPanel
            adminKey={adminKey}
            store={store}
            onChanged={(updated) => {
              setStore(updated);
              load();
            }}
            handleError={handleError}
          />
        </div>
      )}
    </div>
  );
}

function StoreDetailsPanel({
  adminKey,
  store,
  onChanged,
  handleError,
}: {
  adminKey: string;
  store: StoreDetails;
  onChanged: (s: StoreDetails) => void;
  handleError: (err: unknown) => string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: 'approve' | 'suspend') {
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
        const fresh = await getStore(adminKey, store.id).catch(() => null);
        if (fresh) onChanged(fresh.store);
      }
    } finally {
      setBusy(false);
    }
  }

  const standard = store.enabledCategories.filter(isStandardCategory);
  const custom = store.enabledCategories.filter((c) => !isStandardCategory(c));

  return (
    <aside className="panel dash__side" aria-labelledby="details-title">
      <h2 id="details-title">Store details</h2>

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
        <dd>{standard.map(categoryLabel).join(', ') || 'None'}</dd>
        {custom.length > 0 && (
          <>
            <dt>Other products</dt>
            <dd>
              {custom.map(categoryLabel).join(', ')}
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
    </aside>
  );
}
