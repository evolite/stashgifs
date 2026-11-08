/**
 * Generate a random sort seed in the format random_<8-digit-number>
 * Example: random_23120320
 */
export function generateRandomSortSeed(): string {
  // Reject the top sliver of the uint32 range so the modulo stays unbiased (4.2e9 = 42 * 1e8).
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= 4_200_000_000);
  const randomSeed = (buf[0] % 100_000_000).toString().padStart(8, '0');
  return `random_${randomSeed}`;
}
