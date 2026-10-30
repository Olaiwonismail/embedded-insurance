import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formValues } from './setup';
import '../src/index';
import { PUBLIC_KEY_HEADER } from '../src/quotes';

const ATTRS: Record<string, string> = {
  'public-key': 'pk_live_abc123',
  'item-name': 'iPhone 15',
  'item-category': 'phones',
  'item-price': '900000',
  'item-condition': 'new',
};

const ONE_QUOTE = [
  { id: 42, insurerName: 'Acme Insurance', planName: 'Screen Protect', premium: '54000.00' },
];

const TWO_QUOTES = [
  ...ONE_QUOTE,
  { id: 43, insurerName: 'Beta Assurance', planName: 'Full Cover', premium: '72500.50' },
];

function jsonOk(body: unknown) {
  return { status: 200, json: async () => body } as unknown as Response;
}

function status(code: number) {
  return {
    status: code,
    json: async () => {
      throw new Error('no body');
    },
  } as unknown as Response;
}

function create(overrides: Record<string, string | null> = {}): HTMLElement {
  const el = document.createElement('insureongo-offer');
  for (const [name, value] of Object.entries({ ...ATTRS, ...overrides })) {
    if (value !== null) el.setAttribute(name, value);
  }
  return el;
}

async function mount(overrides: Record<string, string | null> = {}): Promise<HTMLElement> {
  const el = create(overrides);
  document.body.append(el);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  await Promise.resolve();
  await Promise.resolve();
  return el;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const checkbox = (el: HTMLElement) => shadow(el).querySelector('input[type="checkbox"]')!;
const moreButton = (el: HTMLElement) => shadow(el).querySelector('.more');
const text = (el: HTMLElement) => shadow(el).textContent ?? '';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.replaceChildren();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => jsonOk(ONE_QUOTE)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('one quote', () => {
  it('shows the formatted premium, plan and insurer, with no other-options button', async () => {
    const el = await mount();

    expect(text(el)).toContain('54,000');
    expect(text(el)).not.toContain('54,000.00');
    expect(text(el)).toContain('iPhone 15');
    expect(text(el)).toContain('Screen Protect');
    expect(text(el)).toContain('Acme Insurance');
    expect(moreButton(el)).toBeNull();
  });

  it('starts unticked, with a real checkbox tied to a label', async () => {
    const el = await mount();
    const box = checkbox(el) as HTMLInputElement;
    const label = shadow(el).querySelector('label') as HTMLLabelElement;

    expect(box.checked).toBe(false);
    expect(el.getAttribute('name')).toBe('insureongo_quote_id');
    expect(label.htmlFor).toBe(box.id);
    expect(box.id).not.toBe('');
  });
});

describe('two quotes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOk(TWO_QUOTES)));
  });

  it('offers the other options and switches the shown premium and value when one is picked', async () => {
    const el = await mount();
    const more = moreButton(el) as HTMLButtonElement;

    expect(more).not.toBeNull();
    expect(more.getAttribute('aria-label')).toBe('Other options');
    expect(text(el)).toContain('54,000');

    more.click();
    const picks = [...shadow(el).querySelectorAll('.options button')] as HTMLButtonElement[];
    expect(picks).toHaveLength(1);
    expect(picks[0].textContent).toContain('Full Cover');

    picks[0].click();

    expect(text(el)).toContain('72,500.50');
    expect((el as HTMLElement & { value: string }).value).toBe('43');
    expect((checkbox(el) as HTMLInputElement).checked).toBe(true);
  });
});

describe('nothing to show', () => {
  it.each([
    ['204 no offer', async () => status(204)],
    ['500 from the API', async () => status(500)],
    [
      'network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    ['body that is not a list', async () => jsonOk({ error: 'nope' })],
    ['empty list', async () => jsonOk([])],
    ['list with a malformed entry', async () => jsonOk([{ id: 'not-a-number' }])],
  ])('renders nothing and throws nothing on %s', async (_name, responder) => {
    vi.stubGlobal('fetch', vi.fn(responder));
    const el = await mount();

    expect(shadow(el).childElementCount).toBe(0);
    expect((el as HTMLElement & { value: string }).value).toBe('');
  });

  it('renders nothing when the request times out after 5 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );

    const el = create();
    document.body.append(el);
    await vi.advanceTimersByTimeAsync(5000);

    expect(shadow(el).childElementCount).toBe(0);
  });

  it('renders nothing and warns once when public-key is missing', async () => {
    const el = create({ 'public-key': null });
    document.body.append(el);
    await Promise.resolve();

    expect(fetch).not.toHaveBeenCalled();
    expect(shadow(el).childElementCount).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('public-key');
  });

  it.each([
    ['item-price', '0'],
    ['item-price', '-5'],
    ['item-price', 'free'],
    ['item-condition', 'refurbished'],
  ])('renders nothing and warns once when %s is %s', async (name, value) => {
    const el = create({ [name]: value });
    document.body.append(el);
    await Promise.resolve();

    expect(fetch).not.toHaveBeenCalled();
    expect(shadow(el).childElementCount).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(name);
  });
});

describe('the request', () => {
  it('carries the public key header and exactly the accepted fields', async () => {
    await mount({ 'store-item-ref': 'SKU-123' });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://shop.example.com/v1/quotes');
    expect(init.method).toBe('POST');
    expect(init.headers[PUBLIC_KEY_HEADER]).toBe('pk_live_abc123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      itemName: 'iPhone 15',
      itemCategory: 'phones',
      itemPrice: 900000,
      itemCondition: 'new',
      storeItemRef: 'SKU-123',
    });
  });

  it('leaves storeItemRef out entirely when the attribute is absent', async () => {
    await mount();

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Object.keys(JSON.parse(init.body))).not.toContain('storeItemRef');
  });
});

describe('handing the choice to the cart', () => {
  it('sets value and fires both events on tick, and clears on untick', async () => {
    const el = await mount();
    const changes: Event[] = [];
    const detailed: CustomEvent[] = [];
    document.body.addEventListener('change', (e) => changes.push(e));
    document.body.addEventListener('insureongo:change', (e) => detailed.push(e as CustomEvent));

    const box = checkbox(el) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));

    expect((el as HTMLElement & { value: string }).value).toBe('42');
    expect(formValues.get(el)).toBe('42');
    expect(changes).toHaveLength(1);
    expect(detailed).toHaveLength(1);
    expect(detailed[0].detail).toEqual({
      quoteId: 42,
      premium: 54000,
      planName: 'Screen Protect',
      insurerName: 'Acme Insurance',
    });

    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));

    expect((el as HTMLElement & { value: string }).value).toBe('');
    expect(formValues.get(el)).toBeNull();
    expect(changes).toHaveLength(2);
    expect(detailed[1].detail).toEqual({ quoteId: null });
  });

  it('submits under the name attribute when the merchant sets one', async () => {
    const el = await mount({ name: 'protection_quote' });
    const box = checkbox(el) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));

    expect(el.getAttribute('name')).toBe('protection_quote');
    expect(formValues.get(el)).toBe('42');
  });
});

describe('reacting to the page', () => {
  it('asks again once, 300ms after item-price changes', async () => {
    vi.useFakeTimers();
    const el = create();
    document.body.append(el);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    el.setAttribute('item-price', '950000');
    await vi.advanceTimersByTimeAsync(299);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].body).itemPrice)
      .toBe(950000);
  });

  it('collapses a burst of changes into one request', async () => {
    vi.useFakeTimers();
    const el = create();
    document.body.append(el);
    await vi.advanceTimersByTimeAsync(0);

    el.setAttribute('item-price', '910000');
    await vi.advanceTimersByTimeAsync(100);
    el.setAttribute('item-name', 'iPhone 15 Pro');
    await vi.advanceTimersByTimeAsync(100);
    el.setAttribute('item-condition', 'used');
    await vi.advanceTimersByTimeAsync(300);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
