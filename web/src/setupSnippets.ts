// The code shown on the Setup page. SIGN_FUNCTION is kept separate because a server
// test runs it against the real webhook verifier, so what merchants are told to do
// cannot drift from what we actually accept.

export const WIDGET_SCRIPT = (apiBase: string) =>
  `<script src="${apiBase}/widget/v1/insureongo.js" defer></script>`;

export const WIDGET_ELEMENT = (publicKey: string) =>
  `<insureongo-offer
  public-key="${publicKey}"
  item-name="iPhone 15"
  item-category="phones"
  item-price="900000"
  item-condition="new"
  store-item-ref="SKU-123">
</insureongo-offer>`;

export const READ_VALUE_EXAMPLE = `const offer = document.querySelector('insureongo-offer');

// "" when the shopper has not ticked the box.
const quoteId = offer.value;`;

export const EVENT_EXAMPLE = `const offer = document.querySelector('insureongo-offer');

offer.addEventListener('insureongo:change', (event) => {
  // { quoteId: 42, premium: 54000 } when ticked, { quoteId: null } when not.
  cart.protectionQuoteId = event.detail.quoteId;
});

// A plain change event fires too, if that suits your cart better.
offer.addEventListener('change', () => console.log(offer.value));`;

export const FORM_EXAMPLE = `<form action="/cart/add" method="post">
  <insureongo-offer ...></insureongo-offer>
  <button type="submit">Add to cart</button>
</form>

<!-- Submits as insureongo_quote_id, or set name="..." to choose your own. -->`;

// Signs exactly what we verify: the raw request body bytes, HMAC-SHA256, lowercase hex.
export const SIGN_FUNCTION = `const crypto = require('crypto');

function signBody(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}`;

export const SEND_EXAMPLE = (webhookUrl: string) =>
  `// body must be the exact bytes you send. Build the string once and reuse it:
// signing a re-serialised copy gives a different signature.
const body = JSON.stringify({
  eventId: 'evt_1001',        // unique per event; a repeat is ignored
  type: 'order.paid',
  orderRef: 'ORDER-1001',
  quoteId: 42,                // from the widget
  customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '+2348000000001' },
});

await fetch('${webhookUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-InsureOnGo-Signature': signBody(body, process.env.INSUREONGO_WEBHOOK_SECRET),
    'X-InsureOnGo-Timestamp': String(Math.floor(Date.now() / 1000)),
  },
  body,
});`;

export const WIDGET_ATTRIBUTES = [
  { name: 'public-key', required: true, note: 'Your public key, shown above.' },
  { name: 'item-name', required: true, note: 'Shown to the shopper, for example "iPhone 15".' },
  {
    name: 'item-category',
    required: true,
    note: 'One of phones, laptops or tablets. Your own product names cannot be quoted yet.',
  },
  { name: 'item-price', required: true, note: 'A positive number in naira, no currency symbol.' },
  { name: 'item-condition', required: true, note: 'new or used.' },
  { name: 'store-item-ref', required: false, note: 'Your own id for the product, such as a SKU.' },
  {
    name: 'name',
    required: false,
    note: 'The form field name. Defaults to insureongo_quote_id.',
  },
] as const;
