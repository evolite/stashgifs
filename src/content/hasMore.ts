/**
 * Whether the feed can load another page, decided from what the page just returned.
 *
 * Counts come from the server's totals when available; when they aren't (e.g. shuffle mode) a full
 * page is taken to mean "probably more". An empty page while appending always ends the feed.
 */

export interface HasMoreInput {
  /** True for a "next page" load, false for a fresh load. */
  append: boolean;
  /** Items already loaded before this page. */
  offset: number;
  /** Page size that was asked for. */
  expectedLimit: number;
  /** Items this page returned (all content types, after filtering). */
  totalContentLength: number;
  /** Server totals per content type (0 when unknown). */
  counts: { markerCount: number; shortFormCount: number; imageCount: number };
  /** Images-only mode pages through images alone. */
  imagesOnly: boolean;
  /** Number of images this page returned (images-only mode). */
  imagesLoaded: number;
  /** Random content can be re-queried at new positions on every fetch. */
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
    // A fresh load that returned nothing AND no count may be a transient/raced fetch rather than a truly
    // empty feed. Staying true lets the append path retry once; a real empty feed stops at the guard above.
    hasMore = true;
  } else {
    hasMore = totalContentLength >= expectedLimit;
  }

  // Random content is re-queryable, so a non-empty page means there may be more; the empty-append guard is the stop.
  if (shouldLoadRandom && !hasMore && totalContentLength > 0) hasMore = true;
  return hasMore;
}
