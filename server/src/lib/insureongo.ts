// insureOnGo client interface.
// The endpoint depends only on InsureongoClient, so swapping the fake for the
// real implementation is a one-line change in app.ts.

export interface InsureongoItemInput {
  itemName: string;
  itemCategory: string;
  itemPrice: number;
  itemCondition: string;
}

// The shape below is a guess at what insureOnGo's API will return.
// Update it once the real response format is known.
export interface InsureongoMatch {
  quoteId: string;
  insurerName: string;
  planName: string;
  premium: string; // string to avoid floating-point issues (stored in a numeric column)
}

export interface InsureongoPolicyInput {
  insureongoQuoteId: string;
  name: string;
  email: string;
  phone?: string;
}

// The shape below is a guess at what insureOnGo's API will return when it issues a policy.
// Update it once the real response format is known.
export interface InsureongoPolicy {
  policyNumber: string;
  startsAt: Date;
  endsAt: Date;
}

export interface InsureongoClient {
  getQuotes(item: InsureongoItemInput): Promise<InsureongoMatch[]>;
  issuePolicy(input: InsureongoPolicyInput): Promise<InsureongoPolicy>;
}

// Fake client for development and tests. Always returns two fixed matches,
// and always issues a one-year policy.
export const fakeInsureongoClient: InsureongoClient = {
  async getQuotes(_item: InsureongoItemInput): Promise<InsureongoMatch[]> {
    return [
      {
        quoteId: 'fake-quote-001',
        insurerName: 'Acme Insurance',
        planName: 'Acme Basic Cover',
        premium: '4.99',
      },
      {
        quoteId: 'fake-quote-002',
        insurerName: 'Shield Underwriters',
        planName: 'Shield Premium Protect',
        premium: '7.49',
      },
    ];
  },

  async issuePolicy(input: InsureongoPolicyInput): Promise<InsureongoPolicy> {
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setFullYear(endsAt.getFullYear() + 1);
    return {
      policyNumber: `POL-${input.insureongoQuoteId}`,
      startsAt,
      endsAt,
    };
  },
};
