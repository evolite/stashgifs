/**
 * Generate a random sort seed in the format random_<8-digit-number>
 * Example: random_23120320
 */
export function generateRandomSortSeed(): string {
  const randomSeed = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `random_${randomSeed}`;
}
