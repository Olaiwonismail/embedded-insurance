import { describe, expect, it } from 'vitest';

import {
  FAKE_BASIC_RATE,
  FAKE_PREMIUM_RATE,
  fakeInsureongoClient,
} from '../src/lib/insureongo';

const item = {
  itemName: 'iPhone 15',
  itemCategory: 'phones',
  itemPrice: 900000,
  itemCondition: 'new',
};

describe('the fake insureOnGo client', () => {
  it('prices both plans off the item, not a flat fee', async () => {
    const matches = await fakeInsureongoClient.getQuotes(item);

    expect(matches).toHaveLength(2);
    expect(matches[0].premium).toBe('54000.00');
    expect(matches[1].premium).toBe('81000.00');
  });

  it('offers the cheaper plan first', async () => {
    const matches = await fakeInsureongoClient.getQuotes(item);

    expect(Number(matches[0].premium)).toBeLessThan(Number(matches[1].premium));
    expect(FAKE_BASIC_RATE).toBeLessThan(FAKE_PREMIUM_RATE);
  });

  it('scales with the price and always gives exactly two decimals', async () => {
    const cheap = await fakeInsureongoClient.getQuotes({ ...item, itemPrice: 220000 });
    const odd = await fakeInsureongoClient.getQuotes({ ...item, itemPrice: 999.99 });

    expect(cheap[0].premium).toBe('13200.00');
    expect(odd[0].premium).toBe('60.00');
    for (const premium of [...cheap, ...odd].map((match) => match.premium)) {
      expect(premium).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('issues a one-year policy', async () => {
    const policy = await fakeInsureongoClient.issuePolicy({
      insureongoQuoteId: 'fake-quote-001',
      issuanceKey: '1:ORDER-1:1',
      name: 'Jane Doe',
      email: 'jane@example.com',
    });

    expect(policy.policyNumber).toBe('POL-fake-quote-001');
    expect(policy.endsAt.getFullYear() - policy.startsAt.getFullYear()).toBe(1);
  });
});
