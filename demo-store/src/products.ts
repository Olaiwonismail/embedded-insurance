export interface Product {
  id: string;
  name: string;
  // Must be one of the categories insureOnGo prices, or no offer appears.
  category: string;
  price: number;
  condition: 'new' | 'used';
  sku: string;
  blurb: string;
}

export const PRODUCTS: Product[] = [
  {
    id: 'iphone-15',
    name: 'iPhone 15',
    category: 'phones',
    price: 900000,
    condition: 'new',
    sku: 'SKU-IP15',
    blurb: '128GB, Blue. Two-year manufacturer warranty.',
  },
  {
    id: 'macbook-air',
    name: 'MacBook Air M3',
    category: 'laptops',
    price: 1450000,
    condition: 'new',
    sku: 'SKU-MBA3',
    blurb: '13-inch, 16GB, 512GB SSD.',
  },
  {
    id: 'ipad-air',
    name: 'iPad Air',
    category: 'tablets',
    price: 620000,
    condition: 'new',
    sku: 'SKU-IPADA',
    blurb: '11-inch, Wi-Fi, 128GB.',
  },
  {
    // Not a category insureOnGo prices, so the widget renders nothing here.
    id: 'airpods-pro',
    name: 'AirPods Pro',
    category: 'accessories',
    price: 220000,
    condition: 'new',
    sku: 'SKU-APP2',
    blurb: 'Active noise cancellation. USB-C case.',
  },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}
