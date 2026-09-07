/** Keep unknown-request protection for the same buyer, but never transfer it to another buyer. */
export type CheckoutAttempt = { owner: string | undefined; key: string; signature: string | null };
export function checkoutAttemptForOwner(attempt: CheckoutAttempt, owner: string | undefined, createKey: () => string): CheckoutAttempt {
  return attempt.owner === owner ? attempt : { owner, key: createKey(), signature: null };
}

export function ownedCheckoutValue<T>(entry: { owner: string | undefined; value: T } | null, owner: string | undefined): T | null {
  return owner && entry?.owner === owner ? entry.value : null;
}
