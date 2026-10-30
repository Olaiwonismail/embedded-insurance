// The shop's own storage. A JSON file rather than memory, so restarting mid-demo does
// not lose the keys that were pasted in or the orders already placed.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

export interface Settings {
  publicKey: string;
  webhookUrl: string;
  webhookSecret: string;
}

export interface Protection {
  quoteId: number;
  premium: number;
  planName: string;
  insurerName: string;
}

export interface CartLine {
  productId: string;
  protection?: Protection;
}

export interface Order {
  id: string;
  ref: string;
  productId: string;
  productName: string;
  price: number;
  protection?: Protection;
  customer: { name: string; email: string; phone: string };
  createdAt: string;
  // What insureOnGo said, or why we did not tell them.
  notified: { status: number | null; detail: string };
}

export interface State {
  settings: Settings;
  cart: CartLine | null;
  orders: Order[];
  nextRef: number;
}

const FILE = path.resolve(import.meta.dirname, '../data/state.json');

const EMPTY: State = {
  settings: { publicKey: '', webhookUrl: '', webhookSecret: '' },
  cart: null,
  orders: [],
  nextRef: 1001,
};

let state: State = load();

function load(): State {
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<State>;
    return {
      ...EMPTY,
      ...parsed,
      settings: { ...EMPTY.settings, ...parsed.settings },
    };
  } catch {
    // No file yet, or it was edited into something unreadable: start clean.
    return structuredClone(EMPTY);
  }
}

function save(): void {
  mkdirSync(path.dirname(FILE), { recursive: true });
  // Write then rename, so a crash cannot leave a half-written file behind.
  const temporary = `${FILE}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2));
  renameSync(temporary, FILE);
}

export function getState(): State {
  return state;
}

export function update(change: (current: State) => void): State {
  change(state);
  save();
  return state;
}

export function isConfigured(): boolean {
  const { publicKey, webhookUrl, webhookSecret } = state.settings;
  return Boolean(publicKey && webhookUrl && webhookSecret);
}

// The widget and the quote endpoint live wherever the webhook address points.
export function apiBase(): string {
  try {
    return new URL(state.settings.webhookUrl).origin;
  } catch {
    return '';
  }
}

export function takeRef(): string {
  const ref = `DEMO-${state.nextRef}`;
  state.nextRef += 1;
  return ref;
}

// Clears orders and the cart but keeps the pasted keys, so the script can be run again
// without going back through signup.
export function clearActivity(): void {
  update((current) => {
    current.cart = null;
    current.orders = [];
    current.nextRef = EMPTY.nextRef;
  });
}
