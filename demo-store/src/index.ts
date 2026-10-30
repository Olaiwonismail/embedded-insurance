// A pretend merchant shop, standing in for a real store's website during the demo.
// It is a customer of the insureOnGo API, not part of it.

import crypto from 'crypto';
import express, { Request, Response } from 'express';

import { PRODUCTS, findProduct } from './products';
import { sendPaidOrder } from './sign';
import {
  Order,
  Protection,
  apiBase,
  clearActivity,
  getState,
  isConfigured,
  takeRef,
  update,
} from './state';
import {
  cartPage,
  checkoutPage,
  layout,
  orderPage,
  ordersPage,
  productPage,
  settingsPage,
  shopPage,
} from './views';

const PORT = Number(process.env.PORT ?? 4174);

const app = express();
app.use(express.urlencoded({ extended: false }));

function send(res: Response, title: string, body: string): void {
  res.type('html').send(layout(title, body, getState().cart ? 1 : 0));
}

function text(value: unknown, max = 255): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Only accepts a protection choice that is complete and sane. A half-filled one means
// the shopper left the box unticked, which is not an error.
function readProtection(body: Record<string, unknown>): Protection | undefined {
  const quoteId = Number(text(body.quoteId));
  const premium = Number(text(body.premium));
  const planName = text(body.planName);
  const insurerName = text(body.insurerName);

  if (!Number.isInteger(quoteId) || quoteId <= 0) return undefined;
  if (!Number.isFinite(premium) || premium <= 0) return undefined;
  if (!planName || !insurerName) return undefined;

  return { quoteId, premium, planName, insurerName };
}

app.get('/', (_req: Request, res: Response) => {
  send(res, 'Shop', shopPage(isConfigured()));
});

app.get('/product/:id', (req: Request<{ id: string }>, res: Response) => {
  const product = findProduct(req.params.id);
  if (!product) {
    res.status(404);
    send(res, 'Not found', '<h1>No such product</h1><p><a href="/">Back to the shop</a></p>');
    return;
  }
  const { settings } = getState();
  send(res, product.name, productPage(product, settings, apiBase(), isConfigured()));
});

app.post('/cart', (req: Request, res: Response) => {
  const product = findProduct(text(req.body.productId));
  if (!product) {
    res.redirect('/');
    return;
  }
  const protection = readProtection(req.body);
  update((state) => {
    state.cart = { productId: product.id, ...(protection && { protection }) };
  });
  res.redirect('/cart');
});

app.get('/cart', (_req: Request, res: Response) => {
  const { cart } = getState();
  const product = cart ? findProduct(cart.productId) ?? null : null;
  send(res, 'Cart', cartPage(product, cart?.protection));
});

app.get('/checkout', (_req: Request, res: Response) => {
  const { cart } = getState();
  const product = cart ? findProduct(cart.productId) : undefined;
  if (!cart || !product) {
    res.redirect('/cart');
    return;
  }
  send(res, 'Checkout', checkoutPage(product, cart.protection));
});

app.post('/checkout', async (req: Request, res: Response) => {
  const state = getState();
  const product = state.cart ? findProduct(state.cart.productId) : undefined;
  if (!state.cart || !product) {
    res.redirect('/cart');
    return;
  }

  const protection = state.cart.protection;
  const customer = {
    name: text(req.body.name) || 'Demo Shopper',
    email: text(req.body.email) || 'shopper@example.com',
    phone: text(req.body.phone, 30),
  };

  const ref = takeRef();
  const order: Order = {
    id: crypto.randomUUID(),
    ref,
    productId: product.id,
    productName: product.name,
    price: product.price,
    ...(protection && { protection }),
    customer,
    createdAt: new Date().toISOString(),
    notified: { status: null, detail: '' },
  };

  // Only an order that includes protection is any of insureOnGo's business.
  if (!protection) {
    order.notified = {
      status: null,
      detail: 'The shopper did not add protection, so insureOnGo was not told about this order.',
    };
  } else {
    try {
      const result = await sendPaidOrder(state.settings.webhookUrl, state.settings.webhookSecret, {
        eventId: order.id,
        orderRef: ref,
        quoteId: protection.quoteId,
        customer,
      });
      order.notified = { status: result.status, detail: result.body };
      if (result.status !== 200) {
        console.error(`insureOnGo rejected order ${ref}: ${result.status} ${result.body}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'could not be reached';
      order.notified = { status: null, detail: `insureOnGo could not be reached: ${reason}` };
      console.error(`Could not notify insureOnGo about order ${ref}: ${reason}`);
    }
  }

  update((current) => {
    current.orders.unshift(order);
    current.cart = null;
  });

  res.redirect(`/order/${order.id}`);
});

app.get('/order/:id', (req: Request<{ id: string }>, res: Response) => {
  const order = getState().orders.find((candidate) => candidate.id === req.params.id);
  if (!order) {
    res.status(404);
    send(res, 'Not found', '<h1>No such order</h1><p><a href="/orders">All orders</a></p>');
    return;
  }
  send(res, `Order ${order.ref}`, orderPage(order));
});

app.get('/orders', (_req: Request, res: Response) => {
  send(res, 'Orders', ordersPage(getState().orders));
});

app.get('/settings', (req: Request, res: Response) => {
  send(res, 'Settings', settingsPage(getState().settings, req.query.saved === '1'));
});

app.post('/settings', (req: Request, res: Response) => {
  update((state) => {
    state.settings = {
      publicKey: text(req.body.publicKey),
      webhookUrl: text(req.body.webhookUrl, 500),
      webhookSecret: text(req.body.webhookSecret),
    };
  });
  res.redirect('/settings?saved=1');
});

app.post('/reset', (_req: Request, res: Response) => {
  clearActivity();
  res.redirect('/orders');
});

app.listen(PORT, () => {
  console.log(`Demo Gadgets on http://127.0.0.1:${PORT}`);
  console.log(
    isConfigured()
      ? `Using insureOnGo at ${apiBase()}`
      : 'No insureOnGo keys yet. Open /settings and paste them in.',
  );
  console.log(`${PRODUCTS.length} products loaded.`);
});
