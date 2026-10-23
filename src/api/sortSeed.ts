/**
 * Generate a random sort seed in the format random_<8-digit-number>
 * Example: random_23120320
 */
export function generateRandomSortSeed(): string {
  const randomSeed = (crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).toString().padStart(8, '0');
  return `random_${randomSeed}`;
}
