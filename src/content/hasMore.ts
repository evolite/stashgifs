export interface HasMoreInput {
  append: boolean;
  offset: number;
  expectedLimit: number;
  totalContentLength: number;
  counts: { markerCount: number; shortFormCount: number; imageCount: number };
  imagesOnly: boolean;
  imagesLoaded: number;
  shouldLoadRandom: boolean;
}

export function computeHasMore(input: HasMoreInput): boolean {
  const { append, offset, expectedLimit, totalContentLength, counts, imagesOnly, imagesLoaded, shouldLoadRandom } = input;

  if (imagesOnly) {
    if (append && imagesLoaded === 0) return false;
    if (counts.imageCount === 0) return imagesLoaded >= expectedLimit;
    return offset + imagesLoaded < counts.imageCount;
  }

  if (append && totalContentLength === 0) return false;

  const totalAvailable = counts.markerCount + counts.shortFormCount + counts.imageCount;
  let hasMore: boolean;
  if (totalAvailable > 0) {
    hasMore = offset + totalContentLength < totalAvailable;
  } else if (!append && totalContentLength === 0) {
    hasMore = true;
  } else {
    hasMore = totalContentLength >= expectedLimit;
  }

  if (shouldLoadRandom && !hasMore && totalContentLength > 0) hasMore = true;
  return hasMore;
}
