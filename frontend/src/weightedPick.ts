/**
 * One item out of `items`, each as likely as its weight: one cumulative draw.
 * `undefined` for no items, or for no item that weighs anything at all — a
 * weight of zero, a negative one or one that is not a number never wins.
 *
 * The phone's own reel draws *Wishlist (weighted)* with this, over the weights
 * the server sends on `WishRead.weight`, so the formula behind them lives on
 * the server alone (docs/dev/reel-weighting.md §2.1).
 */
export function weightedPick<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  random: () => number = Math.random,
): T | undefined {
  const weights = items.map((item) => {
    const weight = weightOf(item);
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return undefined;
  let left = random() * total;
  let last: T | undefined;
  for (const [index, item] of items.entries()) {
    const weight = weights[index] ?? 0;
    if (weight <= 0) continue;
    last = item;
    if (left < weight) return item;
    left -= weight;
  }
  // Rounding can leave a sliver past the last weight: that is the last item
  // that weighs anything, never one that weighs nothing.
  return last;
}
