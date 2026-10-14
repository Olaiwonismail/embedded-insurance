import { FormEvent, KeyboardEvent, useEffect, useState } from 'react';

import {
  ApiError,
  CATEGORIES,
  CUSTOM_PRODUCT_RULE,
  Category,
  MAX_CATEGORIES,
  PLATFORMS,
  Platform,
  SignupResult,
  categoryLabel,
  isStandardCategory,
  isValidProduct,
  normalizeProduct,
  signUp,
} from '../api';
import { CopyField } from '../components/CopyField';

type FieldErrors = Partial<Record<string, string>>;

// One domain per line (commas and spaces also work). Lowercased because the
// server only accepts lowercase hostnames.
function parseDomains(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

// The server reports e.g. "allowedDomains.1"; show it against the field, naming the
// line for domains and the item itself for products.
function toFieldErrors(
  details: ApiError['details'],
  sentCategories: string[],
): { fields: FieldErrors; other: string[] } {
  const fields: FieldErrors = {};
  const other: string[] = [];
  for (const { field, message } of details) {
    if (!field) {
      other.push(message);
      continue;
    }
    const [name, index] = field.split('.');
    let text = message;
    if (index !== undefined && name === 'enabledCategories') {
      text = `"${sentCategories[Number(index)]}" ${message}`;
    } else if (index !== undefined) {
      text = `Line ${Number(index) + 1}: ${message}`;
    }
    fields[name] = fields[name] ? `${fields[name]}. ${text}` : text;
  }
  return { fields, other };
}

// Splits what the merchant typed into tidy product names and reports any problem.
function readProducts(
  draft: string,
  existing: string[],
): { added: string[]; error: string | null } {
  const added: string[] = [];
  for (const raw of draft.split(',')) {
    const product = normalizeProduct(raw);
    if (!product) continue;
    if (!isValidProduct(product)) {
      return { added: [], error: `"${raw.trim()}" isn't valid. Use ${CUSTOM_PRODUCT_RULE}.` };
    }
    if (isStandardCategory(product)) {
      return { added: [], error: `Tick ${categoryLabel(product)} above instead.` };
    }
    if (!existing.includes(product) && !added.includes(product)) added.push(product);
  }
  return { added, error: null };
}

export function SignupPage() {
  const [result, setResult] = useState<SignupResult | null>(null);

  return (
    <div className="signup">
      <aside className="signup__intro">
        <p className="brand">insureOnGo</p>
        <h1>Offer device protection at your checkout</h1>
        <p className="lede">
          Shoppers buying a phone, laptop or tablet can add cover in one click. You earn
          commission on every policy sold.
        </p>
        <ol className="steps">
          <li className={result ? 'steps__done' : 'steps__current'}>
            <strong>Tell us about your store</strong>
            <span>Your website and what you sell.</span>
          </li>
          <li className={result ? 'steps__current' : undefined}>
            <strong>We review your store</strong>
            <span>Your account stays pending until we approve it.</span>
          </li>
          <li>
            <strong>Add the widget to your checkout</strong>
            <span>Using the public key you get today.</span>
          </li>
        </ol>
      </aside>

      <main className="signup__main">
        {result ? (
          <KeysIssued result={result} onDone={() => window.location.assign('/dashboard')} />
        ) : (
          <SignupForm onCreated={setResult} />
        )}
      </main>
    </div>
  );
}

function SignupForm({ onCreated }: { onCreated: (r: SignupResult) => void }) {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [domains, setDomains] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [otherProducts, setOtherProducts] = useState<string[]>([]);
  const [productDraft, setProductDraft] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [password, setPassword] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleCategory(value: Category) {
    setCategories((current) =>
      current.includes(value) ? current.filter((c) => c !== value) : [...current, value],
    );
  }

  // Adds what's in the product box. Returns the full list, or null if the text was invalid.
  function addProducts(): string[] | null {
    const { added, error } = readProducts(productDraft, otherProducts);
    if (error) {
      setErrors((e) => ({ ...e, otherProducts: error }));
      return null;
    }
    const next = [...otherProducts, ...added];
    if (categories.length + next.length > MAX_CATEGORIES) {
      setErrors((e) => ({ ...e, otherProducts: `You can list up to ${MAX_CATEGORIES} products in total.` }));
      return null;
    }
    setOtherProducts(next);
    setProductDraft('');
    setErrors((e) => ({ ...e, otherProducts: undefined, enabledCategories: undefined }));
    return next;
  }

  function onProductKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addProducts();
    }
  }

  function removeProduct(product: string) {
    setOtherProducts((current) => current.filter((p) => p !== product));
  }

  // Catch the obvious gaps here; the server checks everything else.
  function checkLocally(products: string[]): FieldErrors {
    const found: FieldErrors = {};
    if (!name.trim()) found.name = 'Enter your store name';
    if (!platform) found.platform = 'Choose the platform your store runs on';
    if (parseDomains(domains).length === 0) found.allowedDomains = 'Enter at least one domain';
    if (categories.length + products.length === 0) {
      found.enabledCategories = 'Choose at least one product type, or add your own';
    }
    if (!billingEmail.trim()) found.billingEmail = 'Enter your email address';
    if (password.length < 10) found.password = 'Use at least 10 characters';
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    // Anything still typed in the product box counts, even if Add wasn't pressed.
    const products = productDraft.trim() ? addProducts() : otherProducts;
    if (products === null) return;

    const local = checkLocally(products);
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    const sentCategories = [...categories, ...products];
    setSubmitting(true);
    try {
      const created = await signUp({
        name: name.trim(),
        platform: platform as Platform,
        allowedDomains: parseDomains(domains),
        enabledCategories: sentCategories,
        billingEmail: billingEmail.trim(),
        password,
        ...(webhookSecret.trim() && { webhookSecret: webhookSecret.trim() }),
      });
      onCreated(created);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Email already has an account.
        setErrors({ billingEmail: 'This email already has an account' });
        setFormError(err.message);
      } else if (err instanceof ApiError && err.details.length > 0) {
        const { fields, other } = toFieldErrors(err.details, sentCategories);
        setErrors(fields);
        setFormError(other.length ? other.join('. ') : 'Fix the highlighted fields and try again.');
      } else {
        setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const fieldProps = (id: string) => ({
    id,
    'aria-invalid': Boolean(errors[id]),
    'aria-describedby': errors[id] ? `${id}-error` : undefined,
  });

  const errorFor = (id: string) =>
    errors[id] ? (
      <p className="field__error" id={`${id}-error`}>
        {errors[id]}
      </p>
    ) : null;

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h2>Create your store account</h2>

      {formError && (
        <p className="alert alert--error" role="alert">
          {formError}
        </p>
      )}

      <div className="field">
        <label htmlFor="name">Store name</label>
        <input
          {...fieldProps('name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          autoComplete="organization"
        />
        {errorFor('name')}
      </div>

      <div className="field">
        <label htmlFor="platform">Platform</label>
        <select
          {...fieldProps('platform')}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
        >
          <option value="" disabled>
            Choose one
          </option>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {errorFor('platform')}
      </div>

      <div className="field">
        <label htmlFor="allowedDomains">Website domains</label>
        <p className="field__hint" id="allowedDomains-hint">
          One per line, without https://, for example 3chub.com. Subdomains such as
          www.3chub.com are covered automatically.
        </p>
        <textarea
          {...fieldProps('allowedDomains')}
          aria-describedby={
            errors.allowedDomains ? 'allowedDomains-hint allowedDomains-error' : 'allowedDomains-hint'
          }
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          rows={3}
          spellCheck={false}
          autoCapitalize="off"
        />
        {errorFor('allowedDomains')}
      </div>

      <fieldset
        className="field"
        aria-invalid={Boolean(errors.enabledCategories)}
        aria-describedby={errors.enabledCategories ? 'enabledCategories-error' : undefined}
      >
        <legend>Products you want to offer cover on</legend>
        <div className="checks">
          {CATEGORIES.map((c) => (
            <label key={c.value} className="check">
              <input
                type="checkbox"
                checked={categories.includes(c.value)}
                onChange={() => toggleCategory(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>

        <div className="other-products">
          <label htmlFor="otherProducts">Other products you sell</label>
          <p className="field__hint" id="otherProducts-hint">
            Type a product type, such as smartwatches or game consoles, and press Add. Add as many
            as you need. We'll confirm cover for these when we review your store.
          </p>
          <div className="add-row">
            <input
              id="otherProducts"
              value={productDraft}
              onChange={(e) => setProductDraft(e.target.value)}
              onKeyDown={onProductKeyDown}
              aria-invalid={Boolean(errors.otherProducts)}
              aria-describedby={
                errors.otherProducts ? 'otherProducts-hint otherProducts-error' : 'otherProducts-hint'
              }
              maxLength={200}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn"
              onClick={addProducts}
              disabled={!productDraft.trim()}
            >
              Add
            </button>
          </div>
          {errorFor('otherProducts')}

          {otherProducts.length > 0 && (
            <ul className="tags" aria-label="Other products added">
              {otherProducts.map((p) => (
                <li key={p} className="tag">
                  {categoryLabel(p)}
                  <button
                    type="button"
                    className="tag__remove"
                    aria-label={`Remove ${p}`}
                    onClick={() => removeProduct(p)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {errorFor('enabledCategories')}
      </fieldset>

      <div className="field">
        <label htmlFor="billingEmail">Email</label>
        <p className="field__hint" id="billingEmail-hint">
          You'll sign in with this. We also send your commission statements here.
        </p>
        <input
          {...fieldProps('billingEmail')}
          aria-describedby={
            errors.billingEmail ? 'billingEmail-hint billingEmail-error' : 'billingEmail-hint'
          }
          type="email"
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
          maxLength={255}
          autoComplete="email"
        />
        {errorFor('billingEmail')}
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <p className="field__hint" id="password-hint">
          At least 10 characters. A short phrase is easier to remember than a jumble.
        </p>
        <input
          {...fieldProps('password')}
          aria-describedby={errors.password ? 'password-hint password-error' : 'password-hint'}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
        />
        {errorFor('password')}
      </div>

      <div className="field">
        <label htmlFor="webhookSecret">
          Webhook signing secret <span className="optional">optional</span>
        </label>
        <p className="field__hint" id="webhookSecret-hint">
          If your platform gave you one, paste it here. Leave it blank and we'll create one for
          you.
        </p>
        <input
          {...fieldProps('webhookSecret')}
          aria-describedby={
            errors.webhookSecret ? 'webhookSecret-hint webhookSecret-error' : 'webhookSecret-hint'
          }
          type="password"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {errorFor('webhookSecret')}
      </div>

      <button type="submit" className="btn btn--primary btn--wide" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create store account'}
      </button>
      <p className="form__alt">
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </form>
  );
}

function KeysIssued({ result, onDone }: { result: SignupResult; onDone: () => void }) {
  const [saved, setSaved] = useState(false);

  // The secrets exist only on this screen; warn before the tab closes or reloads.
  useEffect(() => {
    if (saved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);

  const secretCount = result.webhookSecret ? 'these two secrets' : 'this secret key';

  return (
    <section className="issued" aria-labelledby="issued-title">
      <h2 id="issued-title">{result.name} is signed up</h2>
      <p className="lede">
        Your account is pending. We'll review it, and the checkout widget will start working once
        it's approved.
      </p>

      <div className="slip">
        <div className="slip__warning" role="note">
          <strong>Copy {secretCount} now.</strong> We only keep a scrambled copy, so we can't show{' '}
          {result.webhookSecret ? 'them' : 'it'} again. Store {result.webhookSecret ? 'them' : 'it'}{' '}
          somewhere safe, such as a password manager, and never put{' '}
          {result.webhookSecret ? 'them' : 'it'} in your website's code.
        </div>

        <CopyField
          secret
          label="Secret key"
          value={result.secretKey}
          hint="For your own server when it talks to us."
        />
        {result.webhookSecret && (
          <CopyField
            secret
            label="Webhook signing secret"
            value={result.webhookSecret}
            hint="Enter this in your platform's webhook settings so we can check that events come from you."
          />
        )}

        <div className="slip__tear" aria-hidden="true" />

        <CopyField
          label="Public key"
          value={result.publicKey}
          hint="Goes in your checkout widget. It's safe to show in your website's code."
        />
      </div>

      <label className="check check--confirm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've saved {result.webhookSecret ? 'my secret key and webhook signing secret' : 'my secret key'}
      </label>
      <button type="button" className="btn btn--primary" disabled={!saved} onClick={onDone}>
        Go to your dashboard
      </button>
    </section>
  );
}
