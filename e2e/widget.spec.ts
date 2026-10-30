import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { TEST_DATABASE_URL } from '../playwright.config';

let db: Client;
let publicKey: string;
let storeId: number;

test.beforeAll(async () => {
  db = new Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();

  publicKey = `pk_live_${randomBytes(12).toString('hex')}`;
  const { rows } = await db.query(
    `insert into stores
       ("name", "platform", "publicKey", "secretKeyHash", "webhookSecret",
        "allowedDomains", "commissionRate", "billingEmail", "enabledCategories", "status")
     values ($1, 'custom', $2, 'not-used-here', 'not-used-here',
             $3, '0.1000', $4, $5, 'active')
     returning id`,
    [
      'Playwright Store',
      publicKey,
      ['localhost'],
      `e2e-${randomBytes(6).toString('hex')}@example.com`,
      ['phones'],
    ],
  );
  storeId = rows[0].id;
});

test.afterAll(async () => {
  if (storeId) {
    await db.query('delete from quotes where "storeId" = $1', [storeId]);
    await db.query('delete from stores where id = $1', [storeId]);
  }
  await db.end();
});

test('a shopper sees an offer, picks it, and the cart gets the quote id', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });

  await page.goto(`/product.html?pk=${publicKey}`);

  const offer = page.locator('insureongo-offer');
  const checkbox = offer.locator('input[type="checkbox"]');
  const label = offer.locator('label');

  await expect(label).toContainText('Protect iPhone 15 for');
  await expect(checkbox).not.toBeChecked();
  expect(warnings).toEqual([]);

  // The quote request really reached the API and was stored.
  const saved = await db.query(
    'select "itemName", "storeItemRef", premium from quotes where "storeId" = $1 order by id',
    [storeId],
  );
  expect(saved.rowCount).toBeGreaterThan(0);
  expect(saved.rows[0].itemName).toBe('iPhone 15');
  expect(saved.rows[0].storeItemRef).toBe('SKU-123');

  // The shopper is shown the top quote's premium, not the item price.
  await expect(label).toContainText(String(saved.rows[0].premium));

  // Ticking hands the choice to the form. jsdom cannot do this, so it is checked here.
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  const submitted = await page.evaluate(() =>
    new FormData(document.getElementById('cart') as HTMLFormElement).get('insureongo_quote_id'),
  );
  const elementValue = await offer.evaluate((el) => (el as HTMLElement & { value: string }).value);

  expect(submitted).toBe(elementValue);
  expect(submitted).toMatch(/^\d+$/);

  // Unticking clears it again.
  await checkbox.uncheck();
  const cleared = await page.evaluate(() =>
    new FormData(document.getElementById('cart') as HTMLFormElement).get('insureongo_quote_id'),
  );
  expect(cleared === null || cleared === '').toBe(true);
});
