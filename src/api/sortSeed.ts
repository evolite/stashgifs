export function generateRandomSortSeed(): string {
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= 4_200_000_000);
  const randomSeed = (buf[0] % 100_000_000).toString().padStart(8, '0');
  return `random_${randomSeed}`;
}
