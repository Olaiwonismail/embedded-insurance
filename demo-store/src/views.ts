import { Order, Protection, Settings } from './state';
import { PRODUCTS, Product } from './products';

const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
});

export function money(value: number): string {
  return naira.format(value);
}

// Everything interpolated below goes through this. The customer name and the keys are
// typed in by hand, and a demo is no excuse for an injection.
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  :root {
    --bg: #f5f5f2;
    --surface: #ffffff;
    --ink: #17181b;
    --ink-soft: #5d6168;
    --line: #e4e4df;
    --brand: #17181b;
    --link: #2448c8;
    --good: #0b6b3a;
    --good-wash: #e7f4ec;
    --warn-wash: #fff6e8;
    --warn-line: #f2c98a;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--ink);
    background: var(--bg);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--link); }
  :focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }

  /* Header */
  header.bar {
    position: sticky; top: 0; z-index: 10;
    background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
  }
  header.bar .inner {
    max-width: 72rem; margin: 0 auto; padding: 0.85rem 1.5rem;
    display: flex; align-items: center; gap: 1.75rem;
  }
  header.bar a { color: var(--ink-soft); text-decoration: none; font-weight: 500; }
  header.bar a:hover { color: var(--ink); }
  header.bar .shop {
    display: flex; align-items: center; gap: 0.55rem;
    color: var(--ink); font-weight: 800; font-size: 1.15rem; letter-spacing: -0.02em;
    white-space: nowrap;
  }
  header.bar .logo {
    width: 1.9rem; height: 1.9rem; border-radius: 9px; background: var(--brand);
    color: #fff; display: grid; place-items: center; font-size: 0.95rem;
  }
  header.bar .spacer { margin-left: auto; }
  header.bar .cart {
    display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 0.45rem 0.9rem; border-radius: 999px;
    background: var(--brand); color: #fff; font-weight: 600;
  }
  header.bar .cart:hover { color: #fff; opacity: 0.9; }
  header.bar .count {
    min-width: 1.35rem; height: 1.35rem; padding: 0 0.35rem; border-radius: 999px;
    background: #fff; color: var(--ink); font-size: 0.8rem; font-weight: 700;
    display: inline-grid; place-items: center;
  }

  main { max-width: 72rem; margin: 2rem auto 3rem; padding: 0 1.5rem; }
  footer {
    max-width: 72rem; margin: 0 auto; padding: 1.5rem; border-top: 1px solid var(--line);
    color: var(--ink-soft); font-size: 0.875rem;
  }
  h1 { margin: 0 0 0.35rem; font-size: clamp(1.6rem, 3vw, 2.1rem); letter-spacing: -0.025em; line-height: 1.15; }
  h2 { margin: 0 0 0.75rem; font-size: 1.2rem; letter-spacing: -0.01em; }
  h1 + .two, h1 + .panel { margin-top: 1.25rem; }
  .muted { color: var(--ink-soft); }
  .small { font-size: 0.875rem; }
  .crumb { margin: 0 0 1.25rem; font-size: 0.9rem; }
  .crumb a { color: var(--ink-soft); text-decoration: none; }
  .crumb a:hover { color: var(--ink); text-decoration: underline; }

  /* Pictures: one style for every product, tinted by category */
  .pic {
    display: grid; place-items: center; aspect-ratio: 4 / 3;
    border-radius: calc(var(--radius) - 4px); color: var(--ink);
    background: var(--tint, #eceae4);
  }
  .pic svg { width: 46%; height: auto; }
  .pic.phones { --tint: #e3e9f7; }
  .pic.laptops { --tint: #e6efe7; }
  .pic.tablets { --tint: #f3e8dc; }
  .pic.accessories { --tint: #ece6f3; }

  /* Shop front */
  .hero {
    display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between;
    gap: 1rem; margin-bottom: 1.5rem;
  }
  .perks { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
  .perks li {
    padding: 0.35rem 0.75rem; border-radius: 999px; background: var(--surface);
    border: 1px solid var(--line); font-size: 0.85rem; color: var(--ink-soft);
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1.25rem; }
  .card {
    position: relative; background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 0.75rem 0.75rem 1rem;
    display: flex; flex-direction: column; gap: 0.2rem;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(23, 24, 27, 0.08); }
  .card .pic { margin-bottom: 0.65rem; }
  .card .price { font-size: 1.2rem; font-weight: 750; letter-spacing: -0.01em; }
  .card .name { color: var(--ink); text-decoration: none; font-weight: 600; }
  /* The whole card is the link */
  .card .name::after { content: ""; position: absolute; inset: 0; border-radius: var(--radius); }
  .card .blurb { color: var(--ink-soft); font-size: 0.9rem; }
  .tag {
    display: inline-block; width: fit-content; margin-top: 0.45rem;
    padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
    background: var(--good-wash); color: var(--good);
  }

  /* Product page */
  .product { display: grid; grid-template-columns: 1.1fr 1fr; gap: 2.5rem; align-items: start; }
  .product .pic { aspect-ratio: 1 / 1; border-radius: var(--radius); }
  .product .pic svg { width: 42%; }
  .buy { display: flex; flex-direction: column; }
  .price-big { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; margin: 0.75rem 0 0.25rem; }
  .trust { list-style: none; margin: 1.5rem 0 0; padding: 1rem 0 0; border-top: 1px solid var(--line); display: grid; gap: 0.45rem; }
  .trust li { display: flex; gap: 0.6rem; align-items: center; color: var(--ink-soft); font-size: 0.92rem; }
  .trust li::before { content: "✓"; color: var(--good); font-weight: 700; }

  /* Panels, forms, buttons */
  .panel {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 1.5rem; margin-bottom: 1.25rem;
  }
  .narrow { max-width: 40rem; }
  label { display: block; font-weight: 600; margin: 1rem 0 0.35rem; font-size: 0.95rem; }
  input[type="text"], input[type="email"], input[type="tel"] {
    width: 100%; padding: 0.7rem 0.8rem; border: 1px solid #cfd0ca; border-radius: 10px;
    font: inherit; background: #fff;
  }
  input:focus { outline: none; border-color: var(--link); box-shadow: 0 0 0 3px rgba(36, 72, 200, 0.15); }
  button, .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
    padding: 0.8rem 1.4rem; border: 0; border-radius: 999px;
    background: var(--brand); color: #fff; font: inherit; font-weight: 650;
    cursor: pointer; text-decoration: none;
  }
  button:hover, .btn:hover { opacity: 0.9; }
  button.wide, .btn.wide { width: 100%; }
  button.quiet, .btn.quiet { background: transparent; color: var(--ink); border: 1px solid #cfd0ca; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.25rem; }

  /* Tables and the cart */
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); font-weight: 600; }
  th, td { text-align: left; padding: 0.85rem 0.5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 800; font-size: 1.1rem; border-bottom: 0; padding-top: 1rem; }
  .line { display: flex; gap: 0.9rem; align-items: center; }
  .line .pic { width: 4rem; aspect-ratio: 1 / 1; border-radius: 10px; flex: none; }
  .line .pic svg { width: 55%; }
  .shield {
    width: 4rem; height: 4rem; flex: none; border-radius: 10px; display: grid; place-items: center;
    background: var(--good-wash); color: var(--good);
  }
  .two { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1.5rem; align-items: start; }
  .summary p { display: flex; justify-content: space-between; gap: 1rem; margin: 0.4rem 0; }
  .summary .total { border-top: 1px solid var(--line); padding-top: 0.75rem; margin-top: 0.75rem; font-weight: 800; font-size: 1.1rem; }

  .yes { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; background: var(--good-wash); color: var(--good); font-weight: 600; font-size: 0.85rem; }
  .no { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; background: #efefeb; color: var(--ink-soft); font-size: 0.85rem; }
  .notice {
    background: var(--warn-wash); border: 1px solid var(--warn-line); border-radius: 12px;
    padding: 0.9rem 1.1rem; margin-bottom: 1.5rem;
  }
  .ok { background: var(--good-wash); border-color: #a9d8bc; }
  .done { text-align: center; padding: 2rem 1.5rem; }
  .done .tick {
    width: 3.5rem; height: 3.5rem; margin: 0 auto 1rem; border-radius: 999px;
    display: grid; place-items: center; background: var(--good); color: #fff; font-size: 1.6rem;
  }
  insureongo-offer { --insureongo-accent: #0b6b3a; display: block; margin: 1.25rem 0; }
  code { background: #efefeb; padding: 0.1rem 0.35rem; border-radius: 5px; }

  @media (max-width: 760px) {
    header.bar .inner { gap: 1rem; padding: 0.75rem 1rem; }
    header.bar .hide-sm { display: none; }
    header.bar .shop .word { display: none; }
    main { padding: 0 1rem; margin-top: 1.25rem; }
    .product, .two { grid-template-columns: 1fr; gap: 1.25rem; }
    .grid { grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
    .card { padding: 0.5rem 0.5rem 0.75rem; }
    .card .price { font-size: 1.05rem; }
    .panel { padding: 1.1rem; }
  }
`;

// One simple drawing per category, so every product has a picture in the same style.
const ICONS: Record<string, string> = {
  phones: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="18" y="4" width="28" height="56" rx="6"/><path d="M28 10h8"/><circle cx="32" cy="52" r="1.5" fill="currentColor"/></svg>`,
  laptops: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="12" y="14" width="40" height="27" rx="3"/><path d="M4 48h56l-4 5H8z"/></svg>`,
  tablets: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="10" y="6" width="44" height="52" rx="6"/><circle cx="32" cy="52" r="1.5" fill="currentColor"/></svg>`,
  accessories: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 12a8 8 0 0 1 8 8v8a6 6 0 0 1-6 6h-2v18a4 4 0 0 1-8 0V20a8 8 0 0 1 8-8z"/>
    <path d="M44 12a8 8 0 0 0-8 8v8a6 6 0 0 0 6 6h2v18a4 4 0 0 0 8 0V20a8 8 0 0 0-8-8z"/></svg>`,
};

const SHIELD = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>`;

function picture(product: Product): string {
  const icon = ICONS[product.category] ?? ICONS.accessories;
  return `<div class="pic ${esc(product.category)}">${icon}</div>`;
}

export function layout(title: string, body: string, cartCount: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} · Demo Gadgets</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="bar">
    <div class="inner">
      <a class="shop" href="/" aria-label="Demo Gadgets home"><span class="logo" aria-hidden="true">DG</span><span class="word">Demo Gadgets</span></a>
      <a href="/">Shop</a>
      <a href="/orders">Orders</a>
      <span class="spacer"></span>
      <a class="hide-sm" href="/settings">Settings</a>
      <a class="cart" href="/cart">Cart <span class="count">${cartCount}</span></a>
    </div>
  </header>
  <main>${body}</main>
  <footer>Demo Gadgets is a pretend shop for showing the insureOnGo checkout offer.</footer>
</body>
</html>`;
}

export function notConfigured(): string {
  return `<div class="notice">
    This shop has no insureOnGo keys yet, so no protection is offered.
    <a href="/settings">Add them in Settings</a>.
  </div>`;
}

export function shopPage(configured: boolean): string {
  const cards = PRODUCTS.map(
    (product) => `<article class="card">
      ${picture(product)}
      <span class="price">${money(product.price)}</span>
      <a class="name" href="/product/${esc(product.id)}">${esc(product.name)}</a>
      <span class="blurb">${esc(product.blurb)}</span>
    </article>`,
  ).join('');

  return `${configured ? '' : notConfigured()}
    <div class="hero">
      <div>
        <h1>Everything in stock</h1>
        <p class="muted" style="margin:0">Phones, laptops and tablets, with protection at checkout.</p>
      </div>
      <ul class="perks">
        <li>Free delivery in Lagos</li>
        <li>7-day returns</li>
        <li>Genuine products</li>
      </ul>
    </div>
    <div class="grid">${cards}</div>`;
}

export function productPage(
  product: Product,
  settings: Settings,
  base: string,
  configured: boolean,
): string {
  const widget = configured
    ? `<script src="${esc(base)}/widget/v1/insureongo.js" defer></script>
       <insureongo-offer
         id="offer"
         public-key="${esc(settings.publicKey)}"
         item-name="${esc(product.name)}"
         item-category="${esc(product.category)}"
         item-price="${esc(product.price)}"
         item-condition="${esc(product.condition)}"
         store-item-ref="${esc(product.sku)}"></insureongo-offer>`
    : '';

  return `${configured ? '' : notConfigured()}
    <p class="crumb"><a href="/">Shop</a> / ${esc(product.name)}</p>
    <div class="product">
      ${picture(product)}

      <div class="buy">
        <h1>${esc(product.name)}</h1>
        <p class="muted" style="margin:0">${esc(product.blurb)}</p>
        <p class="price-big">${money(product.price)}</p>
        <p class="muted small" style="margin:0">Total today: <strong id="total">${money(product.price)}</strong></p>

        <form method="post" action="/cart">
          <input type="hidden" name="productId" value="${esc(product.id)}" />
          <input type="hidden" name="quoteId" id="quoteId" value="" />
          <input type="hidden" name="premium" id="premium" value="" />
          <input type="hidden" name="planName" id="planName" value="" />
          <input type="hidden" name="insurerName" id="insurerName" value="" />
          ${widget}
          <button type="submit" class="wide">Add to cart</button>
        </form>

        <ul class="trust">
          <li>Free delivery in Lagos, 1 to 2 days</li>
          <li>7-day returns if it is unopened</li>
          <li>SKU ${esc(product.sku)}</li>
        </ul>
      </div>
    </div>

    <script>
      // Whatever the shopper picks is copied into the hidden fields, so the cart gets
      // the quote id, the price and which plan it was. The total beside the button
      // follows along, so the shopper sees what they will pay before adding to cart.
      const offer = document.getElementById('offer');
      const itemPrice = ${Number(product.price)};
      const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
      if (offer) {
        offer.addEventListener('insureongo:change', (event) => {
          const chosen = event.detail.quoteId ? event.detail : null;
          document.getElementById('quoteId').value = chosen ? chosen.quoteId : '';
          document.getElementById('premium').value = chosen ? chosen.premium : '';
          document.getElementById('planName').value = chosen ? chosen.planName : '';
          document.getElementById('insurerName').value = chosen ? chosen.insurerName : '';
          const premium = chosen ? Number(chosen.premium) : 0;
          document.getElementById('total').textContent = naira.format(itemPrice + premium);
        });
      }
    </script>`;
}

function itemRow(product: { name: string; category: string; price: number }, detail: string): string {
  const icon = ICONS[product.category] ?? ICONS.accessories;
  return `<tr>
    <td><div class="line">
      <div class="pic ${esc(product.category)}">${icon}</div>
      <div><strong>${esc(product.name)}</strong><br /><span class="muted small">${esc(detail)}</span></div>
    </div></td>
    <td class="num">${money(product.price)}</td>
  </tr>`;
}

function protectionRow(protection: Protection): string {
  return `<tr>
    <td><div class="line">
      <div class="shield">${SHIELD}</div>
      <div><strong>Protection: ${esc(protection.planName)}</strong>
        <br /><span class="muted small">${esc(protection.insurerName)}, quote #${esc(protection.quoteId)}</span></div>
    </div></td>
    <td class="num">${money(protection.premium)}</td>
  </tr>`;
}

export function cartPage(product: Product | null, protection?: Protection): string {
  if (!product) {
    return `<div class="panel done">
        <h1>Your cart is empty</h1>
        <p class="muted">Pick something from the shop.</p>
        <p><a class="btn" href="/">Go to the shop</a></p>
      </div>`;
  }

  const total = product.price + (protection?.premium ?? 0);

  return `<h1>Your cart</h1>
    <div class="two">
      <div class="panel">
        <table>
          <tbody>
            ${itemRow(product, product.blurb)}
            ${protection ? protectionRow(protection) : ''}
          </tbody>
        </table>
        ${protection ? '' : '<p class="muted small" style="margin-bottom:0">No protection on this order.</p>'}
      </div>
      <div class="panel summary">
        <h2>Summary</h2>
        <p><span>Item</span><span>${money(product.price)}</span></p>
        ${protection ? `<p><span>Protection</span><span>${money(protection.premium)}</span></p>` : ''}
        <p><span>Delivery</span><span>Free</span></p>
        <p class="total"><span>Total</span><span>${money(total)}</span></p>
        <div class="actions">
          <a class="btn wide" href="/checkout">Checkout</a>
          <a class="btn quiet wide" href="/">Keep shopping</a>
        </div>
      </div>
    </div>`;
}

export function checkoutPage(product: Product, protection?: Protection): string {
  const total = product.price + (protection?.premium ?? 0);

  return `<h1>Checkout</h1>
    <div class="two">
      <div class="panel">
        <h2>Your details</h2>
        <form method="post" action="/checkout">
          <label for="name">Full name</label>
          <input type="text" id="name" name="name" required autocomplete="name" />
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required autocomplete="email" />
          <label for="phone">Phone</label>
          <input type="tel" id="phone" name="phone" autocomplete="tel" />
          <div class="actions"><button type="submit" class="wide">Pay ${money(total)}</button></div>
        </form>
      </div>
      <div class="panel summary">
        <h2>Order</h2>
        <p><span>${esc(product.name)}</span><span>${money(product.price)}</span></p>
        ${
          protection
            ? `<p><span>${esc(protection.planName)}</span><span>${money(protection.premium)}</span></p>`
            : ''
        }
        <p><span>Delivery</span><span>Free</span></p>
        <p class="total"><span>Total</span><span>${money(total)}</span></p>
      </div>
    </div>`;
}

export function orderPage(order: Order): string {
  const total = order.price + (order.protection?.premium ?? 0);
  const product = PRODUCTS.find((p) => p.name === order.productName);

  return `<div class="panel done">
      <div class="tick" aria-hidden="true">✓</div>
      <h1>Thank you, your order is paid</h1>
      <p class="muted" style="margin:0">Order ${esc(order.ref)}. A receipt is on its way to ${esc(order.customer.email)}.</p>
    </div>

    <div class="two">
      <div class="panel">
        <h2>What you bought</h2>
        <table>
          <tbody>
            ${itemRow(
              { name: order.productName, category: product?.category ?? 'accessories', price: order.price },
              product?.blurb ?? '',
            )}
            ${order.protection ? protectionRow(order.protection) : ''}
          </tbody>
          <tfoot><tr><td>Paid</td><td class="num">${money(total)}</td></tr></tfoot>
        </table>
      </div>

      ${
        order.protection
          ? `<div class="panel">
               <h2>Your protection</h2>
               <p><strong>${esc(order.protection.planName)}</strong><br />
                 Covered by ${esc(order.protection.insurerName)}</p>
               <p class="muted small">${esc(order.protection.insurerName)} will email your policy
                 documents to ${esc(order.customer.email)}.</p>
               <p class="muted small" style="margin-bottom:0">insureOnGo replied
                 ${esc(order.notified.status ?? '—')}: ${esc(order.notified.detail)}</p>
             </div>`
          : `<div class="panel">
               <h2>No protection on this order</h2>
               <p class="muted small" style="margin-bottom:0">${esc(order.notified.detail)}</p>
             </div>`
      }
    </div>

    <div class="actions">
      <a class="btn quiet" href="/orders">All orders</a>
      <a class="btn" href="/">Keep shopping</a>
    </div>`;
}

export function ordersPage(orders: Order[]): string {
  if (orders.length === 0) {
    return `<div class="panel done">
        <h1>No orders yet</h1>
        <p class="muted">Orders appear here once someone checks out.</p>
        <p><a class="btn" href="/">Go to the shop</a></p>
      </div>`;
  }

  const rows = orders
    .map(
      (order) => `<tr>
        <td><a href="/order/${esc(order.id)}">${esc(order.ref)}</a></td>
        <td>${esc(order.productName)}</td>
        <td>${esc(order.customer.name)}</td>
        <td class="num">${money(order.price + (order.protection?.premium ?? 0))}</td>
        <td>${
          order.protection
            ? `<span class="yes">Protected</span><br /><span class="muted small">${esc(
                order.protection.planName,
              )}</span>`
            : '<span class="no">No</span>'
        }</td>
      </tr>`,
    )
    .join('');

  return `<h1>Orders</h1>
    <p class="muted">Every order this shop has taken, with or without protection.</p>
    <div class="panel" style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Order</th><th>Item</th><th>Customer</th>
            <th class="num">Paid</th><th>Protected</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <form method="post" action="/reset" onsubmit="return confirm('Clear all orders and the cart? The keys are kept.')">
      <button type="submit" class="quiet">Clear orders (demo reset)</button>
    </form>`;
}

export function settingsPage(settings: Settings, saved: boolean): string {
  return `<div class="narrow">
    ${saved ? '<div class="notice ok">Saved. Protection is now live on the shop.</div>' : ''}
    <h1>insureOnGo settings</h1>
    <p class="muted">
      Copy these three from the insureOnGo merchant dashboard. The public key and webhook
      address are on its Setup page; the webhook secret was shown once at signup.
    </p>
    <div class="panel">
      <form method="post" action="/settings">
        <label for="publicKey">Public key</label>
        <input type="text" id="publicKey" name="publicKey" required
               placeholder="pk_live_..." value="${esc(settings.publicKey)}" />

        <label for="webhookUrl">Webhook address</label>
        <input type="text" id="webhookUrl" name="webhookUrl" required
               placeholder="http://localhost:8080/v1/webhooks/custom/pk_live_..."
               value="${esc(settings.webhookUrl)}" />

        <label for="webhookSecret">Webhook signing secret</label>
        <input type="text" id="webhookSecret" name="webhookSecret" required
               placeholder="whsec_..." value="${esc(settings.webhookSecret)}" />

        <div class="actions"><button type="submit">Save</button></div>
      </form>
    </div>
    <p class="muted small">
      The widget and the quote requests are loaded from the webhook address's own origin,
      so there is nothing else to configure.
    </p>
  </div>`;
}
