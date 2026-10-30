import { offerLabel, formatPremium } from './format';
import { fetchQuotes, Quote, QuoteRequest } from './quotes';

const DEBOUNCE_MS = 300;
const DEFAULT_FIELD_NAME = 'insureongo_quote_id';
const ITEM_ATTRIBUTES = ['item-name', 'item-category', 'item-price', 'item-condition'];
const CONDITIONS = ['new', 'used'];

// The merchant only gives us a script tag, so the API address comes from its own src.
function readApiBase(): string {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.src) {
    try {
      return new URL(script.src).origin;
    } catch {
      // fall through to the page's own origin
    }
  }
  return location.origin;
}

const apiBase = readApiBase();

const STYLES = `
  :host {
    display: block;
    font-family: var(--insureongo-font, inherit);
    font-size: 14px;
    line-height: 1.4;
    color: inherit;
  }
  .row { display: flex; align-items: center; gap: 8px; }
  input { accent-color: var(--insureongo-accent, #0b6b3a); margin: 0; }
  label { cursor: pointer; }
  .meta { margin: 2px 0 0 24px; font-size: 12px; opacity: 0.75; }
  .more {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    background: none;
    border: 0;
    padding: 4px;
    cursor: pointer;
    color: var(--insureongo-accent, #0b6b3a);
    border-radius: 4px;
  }
  .more:focus-visible { outline: 2px solid var(--insureongo-accent, #0b6b3a); }
  .options { margin: 6px 0 0 24px; padding: 0; list-style: none; }
  .options[hidden] { display: none; }
  .options button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 6px 4px;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .options button:hover { background: rgba(0, 0, 0, 0.05); }
`;

class InsureongoOffer extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = [...ITEM_ATTRIBUTES, 'store-item-ref', 'public-key'];

  #internals: ElementInternals;
  #root: ShadowRoot;
  #quotes: Quote[] = [];
  #chosen = 0;
  #checked = false;
  #expanded = false;
  #warned = false;
  #loaded = false;
  #debounce?: ReturnType<typeof setTimeout>;
  #request = 0;

  #checkbox?: HTMLInputElement;
  #label?: HTMLLabelElement;
  #meta?: HTMLParagraphElement;
  #more?: HTMLButtonElement;
  #options?: HTMLUListElement;

  constructor() {
    super();
    this.#internals = this.attachInternals();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  get value(): string {
    const quote = this.#quotes[this.#chosen];
    return this.#checked && quote ? String(quote.id) : '';
  }

  connectedCallback(): void {
    if (!this.hasAttribute('name')) this.setAttribute('name', DEFAULT_FIELD_NAME);
    this.#loaded = true;
    void this.#load();
  }

  disconnectedCallback(): void {
    clearTimeout(this.#debounce);
  }

  attributeChangedCallback(_name: string, before: string | null, after: string | null): void {
    // Attributes parsed with the page arrive before connectedCallback, which does
    // the first load itself. Only later edits are worth debouncing.
    if (before === after || !this.#loaded) return;
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => void this.#load(), DEBOUNCE_MS);
  }

  #readRequest(): { publicKey: string; request: QuoteRequest } | null {
    const publicKey = this.getAttribute('public-key')?.trim() ?? '';
    const itemName = this.getAttribute('item-name')?.trim() ?? '';
    const itemCategory = this.getAttribute('item-category')?.trim() ?? '';
    const itemCondition = this.getAttribute('item-condition')?.trim() ?? '';
    const storeItemRef = this.getAttribute('store-item-ref')?.trim();
    const itemPrice = Number(this.getAttribute('item-price')?.trim());

    const bad: string[] = [];
    if (!publicKey) bad.push('public-key');
    if (!itemName) bad.push('item-name');
    if (!itemCategory) bad.push('item-category');
    if (!Number.isFinite(itemPrice) || itemPrice <= 0) bad.push('item-price');
    if (!CONDITIONS.includes(itemCondition)) bad.push('item-condition');
    if (bad.length > 0) {
      if (!this.#warned) {
        this.#warned = true;
        console.warn(`<insureongo-offer> missing or invalid: ${bad.join(', ')}`);
      }
      return null;
    }

    const request: QuoteRequest = { itemName, itemCategory, itemPrice, itemCondition };
    if (storeItemRef) request.storeItemRef = storeItemRef;
    return { publicKey, request };
  }

  async #load(): Promise<void> {
    const parsed = this.#readRequest();
    if (!parsed) {
      this.#show([]);
      return;
    }
    const ticket = ++this.#request;
    const quotes = await fetchQuotes(apiBase, parsed.publicKey, parsed.request);
    if (ticket === this.#request) this.#show(quotes);
  }

  #show(quotes: Quote[]): void {
    const had = this.value;
    this.#quotes = quotes;
    this.#chosen = 0;
    this.#checked = false;
    this.#expanded = false;
    this.#root.replaceChildren();
    this.#checkbox = undefined;
    if (quotes.length > 0) this.#render();
    // A reload drops any earlier choice, so the cart must hear about it.
    if (had !== this.value) this.#emit();
    else this.#internals.setFormValue(this.value || null);
  }

  #render(): void {
    const style = document.createElement('style');
    style.textContent = STYLES;

    const row = document.createElement('div');
    row.className = 'row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'accept';
    checkbox.addEventListener('change', () => {
      this.#checked = checkbox.checked;
      this.#emit();
    });

    const label = document.createElement('label');
    label.htmlFor = 'accept';

    row.append(checkbox, label);

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more';
    more.setAttribute('aria-label', 'Other options');
    more.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<circle cx="3" cy="8" r="1.5" fill="currentColor"/>' +
      '<circle cx="8" cy="8" r="1.5" fill="currentColor"/>' +
      '<circle cx="13" cy="8" r="1.5" fill="currentColor"/></svg>';
    more.addEventListener('click', () => {
      this.#expanded = !this.#expanded;
      this.#update();
    });

    const meta = document.createElement('p');
    meta.className = 'meta';

    const options = document.createElement('ul');
    options.className = 'options';

    this.#root.append(style, row, meta, options);
    this.#checkbox = checkbox;
    this.#label = label;
    this.#meta = meta;
    this.#more = more;
    this.#options = options;

    if (this.#quotes.length > 1) row.append(more);
    this.#update();
  }

  #update(): void {
    const quote = this.#quotes[this.#chosen];
    if (!quote || !this.#checkbox) return;

    this.#checkbox.checked = this.#checked;
    this.#label!.textContent = offerLabel(this.getAttribute('item-name')?.trim() ?? '', quote.premium);
    this.#meta!.textContent = `${quote.planName} — ${quote.insurerName}`;
    this.#more?.setAttribute('aria-expanded', String(this.#expanded));

    const options = this.#options!;
    options.hidden = !this.#expanded;
    options.replaceChildren();
    if (!this.#expanded) return;

    this.#quotes.forEach((other, index) => {
      if (index === this.#chosen) return;
      const item = document.createElement('li');
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.textContent = `${other.planName} — ${other.insurerName} · ${formatPremium(other.premium)}`;
      pick.addEventListener('click', () => {
        this.#chosen = index;
        this.#checked = true;
        this.#expanded = false;
        this.#update();
        this.#emit();
      });
      item.append(pick);
      options.append(item);
    });
  }

  #emit(): void {
    this.#internals.setFormValue(this.value || null);
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const quote = this.#checked ? this.#quotes[this.#chosen] : undefined;
    this.dispatchEvent(
      new CustomEvent('insureongo:change', {
        bubbles: true,
        composed: true,
        detail: quote
          ? {
              quoteId: quote.id,
              premium: quote.premium,
              planName: quote.planName,
              insurerName: quote.insurerName,
            }
          : { quoteId: null },
      }),
    );
  }
}

if (!customElements.get('insureongo-offer')) {
  customElements.define('insureongo-offer', InsureongoOffer);
}

export { InsureongoOffer };
