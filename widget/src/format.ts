// Nigerian naira, with kobo only when the premium actually has them.
export function formatPremium(premium: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: Number.isInteger(premium) ? 0 : 2,
  }).format(premium);
}

const SHORT_NAME_MAX = 30;

export function offerLabel(itemName: string, premium: number): string {
  const subject = itemName.length <= SHORT_NAME_MAX ? itemName : 'this item';
  return `Protect ${subject} for ${formatPremium(premium)}`;
}
