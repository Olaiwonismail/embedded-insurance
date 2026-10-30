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
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #15181c;
    background: #f6f7f9;
    line-height: 1.5;
  }
  header.bar {
    display: flex; align-items: center; gap: 1.5rem;
    padding: 1rem 1.5rem; background: #15181c; color: #fff;
  }
  header.bar a { color: #fff; text-decoration: none; opacity: 0.8; }
  header.bar a:hover { opacity: 1; }
  header.bar .shop { font-weight: 700; font-size: 1.1rem; opacity: 1; }
  header.bar .spacer { margin-left: auto; }
  main { max-width: 64rem; margin: 2rem auto; padding: 0 1.5rem; }
  h1 { margin: 0 0 0.25rem; font-size: 1.6rem; }
  .muted { color: #6b7280; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 1rem; }
  .card {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
    padding: 1rem; display: flex; flex-direction: column; gap: 0.35rem;
  }
  .card a { color: inherit; text-decoration: none; font-weight: 600; }
  .card .price { font-size: 1.15rem; font-weight: 700; }
  .panel {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
    padding: 1.25rem; margin-bottom: 1.25rem;
  }
  .price-big { font-size: 1.75rem; font-weight: 700; margin: 0.25rem 0 1rem; }
  label { display: block; font-weight: 600; margin: 0.75rem 0 0.25rem; }
  input[type="text"], input[type="email"], input[type="tel"] {
    width: 100%; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px;
    font: inherit;
  }
  button, .btn {
    display: inline-block; padding: 0.6rem 1.1rem; border: 0; border-radius: 6px;
    background: #0b6b3a; color: #fff; font: inherit; font-weight: 600;
    cursor: pointer; text-decoration: none;
  }
  button.quiet, .btn.quiet { background: #e5e7eb; color: #15181c; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.6rem 0.5rem; border-bottom: 1px solid #e5e7eb; }
  th.num, td.num { text-align: right; }
  tfoot td { font-weight: 700; border-bottom: 0; }
  .yes { color: #0b6b3a; font-weight: 600; }
  .no { color: #6b7280; }
  .notice {
    background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px;
    padding: 0.85rem 1rem; margin-bottom: 1.25rem;
  }
  .ok { background: #ecfdf5; border-color: #6ee7b7; }
  insureongo-offer { --insureongo-accent: #0b6b3a; display: block; margin: 1rem 0; }
  code { background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; }
`;

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
    <a class="shop" href="/">Demo Gadgets</a>
    <a href="/">Shop</a>
    <a href="/orders">Orders</a>
    <span class="spacer"></span>
    <a href="/cart">Cart${cartCount ? ` (${cartCount})` : ''}</a>
    <a href="/settings">Settings</a>
  </header>
  <main>${body}</main>
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
    (product) => `<div class="card">
      <a href="/product/${esc(product.id)}">${esc(product.name)}</a>
      <span class="muted">${esc(product.blurb)}</span>
      <span class="price">${money(product.price)}</span>
    </div>`,
  ).join('');

  return `${configured ? '' : notConfigured()}
    <h1>Everything in stock</h1>
    <p class="muted">Four products. Protection is offered on the ones insureOnGo covers.</p>
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
    <p class="muted"><a href="/">&larr; Back to the shop</a></p>
    <div class="panel">
      <h1>${esc(product.name)}</h1>
      <p class="muted">${esc(product.blurb)}</p>
      <p class="price-big">${money(product.price)}</p>

      <form method="post" action="/cart">
        <input type="hidden" name="productId" value="${esc(product.id)}" />
        <input type="hidden" name="quoteId" id="quoteId" value="" />
        <input type="hidden" name="premium" id="premium" value="" />
        <input type="hidden" name="planName" id="planName" value="" />
        <input type="hidden" name="insurerName" id="insurerName" value="" />
        ${widget}
        <button type="submit">Add to cart</button>
      </form>
    </div>

    <script>
      // Whatever the shopper picks is copied into the hidden fields, so the cart gets
      // the quote id, the price and which plan it was.
      const offer = document.getElementById('offer');
      if (offer) {
        offer.addEventListener('insureongo:change', (event) => {
          const chosen = event.detail.quoteId ? event.detail : null;
          document.getElementById('quoteId').value = chosen ? chosen.quoteId : '';
          document.getElementById('premium').value = chosen ? chosen.premium : '';
          document.getElementById('planName').value = chosen ? chosen.planName : '';
          document.getElementById('insurerName').value = chosen ? chosen.insurerName : '';
        });
      }
    </script>`;
}

function protectionRow(protection: Protection): string {
  return `<tr>
    <td>Protection &mdash; ${esc(protection.planName)}
      <br /><span class="muted">${esc(protection.insurerName)}, quote #${esc(protection.quoteId)}</span></td>
    <td class="num">${money(protection.premium)}</td>
  </tr>`;
}

export function cartPage(product: Product | null, protection?: Protection): string {
  if (!product) {
    return `<h1>Your cart is empty</h1>
      <p class="muted">Pick something from <a href="/">the shop</a>.</p>`;
  }

  const total = product.price + (protection?.premium ?? 0);

  return `<h1>Your cart</h1>
    <div class="panel">
      <table>
        <tbody>
          <tr>
            <td>${esc(product.name)}<br /><span class="muted">${esc(product.sku)}</span></td>
            <td class="num">${money(product.price)}</td>
          </tr>
          ${protection ? protectionRow(protection) : ''}
        </tbody>
        <tfoot>
          <tr><td>Total</td><td class="num">${money(total)}</td></tr>
        </tfoot>
      </table>
      ${protection ? '' : '<p class="muted">No protection on this order.</p>'}
      <p style="margin-top:1rem">
        <a class="btn" href="/checkout">Checkout</a>
        <a class="btn quiet" href="/">Keep shopping</a>
      </p>
    </div>`;
}

export function checkoutPage(product: Product, protection?: Protection): string {
  const total = product.price + (protection?.premium ?? 0);

  return `<h1>Checkout</h1>
    <div class="panel">
      <p>
        ${esc(product.name)} &mdash; ${money(product.price)}<br />
        ${
          protection
            ? `Protection &mdash; ${money(protection.premium)} (${esc(protection.planName)})<br />`
            : ''
        }
        <strong>Total ${money(total)}</strong>
      </p>
      <form method="post" action="/checkout">
        <label for="name">Full name</label>
        <input type="text" id="name" name="name" required autocomplete="name" />
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email" />
        <label for="phone">Phone</label>
        <input type="tel" id="phone" name="phone" autocomplete="tel" />
        <p style="margin-top:1.25rem"><button type="submit">Pay now</button></p>
      </form>
    </div>`;
}

export function orderPage(order: Order): string {
  const total = order.price + (order.protection?.premium ?? 0);

  return `<div class="notice ok"><strong>Thank you.</strong> Your order is paid.</div>
    <h1>Order ${esc(order.ref)}</h1>
    <div class="panel">
      <table>
        <tbody>
          <tr><td>${esc(order.productName)}</td><td class="num">${money(order.price)}</td></tr>
          ${order.protection ? protectionRow(order.protection) : ''}
        </tbody>
        <tfoot><tr><td>Paid</td><td class="num">${money(total)}</td></tr></tfoot>
      </table>
    </div>

    ${
      order.protection
        ? `<div class="panel">
             <h2>Your protection</h2>
             <p>
               <strong>${esc(order.protection.planName)}</strong><br />
               Covered by ${esc(order.protection.insurerName)}<br />
               <span class="muted">${esc(order.protection.insurerName)} will email your policy
               documents to ${esc(order.customer.email)}.</span>
             </p>
             <p class="muted">insureOnGo replied ${esc(order.notified.status ?? '—')}:
               ${esc(order.notified.detail)}</p>
           </div>`
        : `<div class="panel">
             <h2>No protection on this order</h2>
             <p class="muted">${esc(order.notified.detail)}</p>
           </div>`
    }

    <p><a class="btn quiet" href="/orders">All orders</a>
       <a class="btn quiet" href="/">Keep shopping</a></p>`;
}

export function ordersPage(orders: Order[]): string {
  if (orders.length === 0) {
    return `<h1>Orders</h1><p class="muted">No orders yet.</p>`;
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
            ? `<span class="yes">Protected</span><br /><span class="muted">${esc(
                order.protection.planName,
              )}</span>`
            : '<span class="no">No</span>'
        }</td>
      </tr>`,
    )
    .join('');

  return `<h1>Orders</h1>
    <div class="panel">
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
  return `${saved ? '<div class="notice ok">Saved. Protection is now live on the shop.</div>' : ''}
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

        <p style="margin-top:1.25rem"><button type="submit">Save</button></p>
      </form>
    </div>
    <p class="muted">
      The widget and the quote requests are loaded from the webhook address's own origin,
      so there is nothing else to configure.
    </p>`;
}
