/**
 * Mixes the content fetched for one feed page (markers, short-form scenes, images, scene previews)
 * into the order cards are shown in.
 *
 * Randomness is injectable so the mix can be tested deterministically.
 */

import type { SceneMarker, Image } from '../types.js';

export type ContentItem = { type: 'marker' | 'image'; data: SceneMarker | Image; date?: string };

type ContentType = 'marker' | 'shortform' | 'image';

/** In-place Fisher-Yates shuffle; returns the same array. */
export function shuffle<T>(arr: T[], random: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Check if only a single content type is present
 */
function getSingleContentTypeResult(
  markers: SceneMarker[],
  shortFormMarkers: SceneMarker[],
  images: Image[],
  scenePreviewMarkers: SceneMarker[]
): ContentItem[] | null {
  const videoMarkers = [...markers, ...shortFormMarkers, ...scenePreviewMarkers];

  // If only images
  if (videoMarkers.length === 0) {
    return createImageContentArray(images);
  }

  // If only video-shaped content (markers/shortform/scene previews, no images)
  if (images.length === 0) {
    return createMarkerContentArray(videoMarkers);
  }

  return null;
}

/**
 * Merge regular markers, short-form markers, images, and scene previews in a unified mix.
 * Interleaves markers/shortform and images as before; scene previews get their own
 * lower-frequency slot in the cycle.
 */
export function mixContent(
  markers: SceneMarker[],
  shortFormMarkers: SceneMarker[],
  images: Image[],
  scenePreviewMarkers: SceneMarker[] = [],
  random: () => number = Math.random
): ContentItem[] {
  // If only one type, return it in original order
  const singleTypeResult = getSingleContentTypeResult(markers, shortFormMarkers, images, scenePreviewMarkers);
  if (singleTypeResult !== null) {
    return singleTypeResult;
  }

  // Multiple types present - mix all together proportionally
  return unifiedMixContent(markers, shortFormMarkers, images, scenePreviewMarkers, random);
}

/**
 * Create content array from images
 */
function createImageContentArray(images: Image[]): Array<{ type: 'image'; data: Image; date?: string }> {
  return images.map(image => ({
    type: 'image' as const,
    data: image,
    date: image.date,
  }));
}

/**
 * Create content array from markers
 */
function createMarkerContentArray(markers: SceneMarker[]): Array<{ type: 'marker'; data: SceneMarker; date?: string }> {
  return markers.map(marker => ({
    type: 'marker' as const,
    data: marker,
    date: marker.scene.date,
  }));
}

/**
 * Simple interleaving algorithm that mixes markers, shortform, images, and scene previews.
 * Shows 3-5 video items (markers/shortform), then up to 1 scene-preview clip (its own
 * lower-frequency slot), then 1-2 images, repeat. Prevents more than 3 consecutive
 * items of the same type for videos/images.
 */
function unifiedMixContent(
  markers: SceneMarker[],
  shortFormMarkers: SceneMarker[],
  images: Image[],
  scenePreviewMarkers: SceneMarker[] = [],
  random: () => number = Math.random
): ContentItem[] {
  const content: ContentItem[] = [];

  // Combine markers and shortform into single video array for simpler logic
  const allVideos = [...markers.map(m => ({ type: 'marker' as const, data: m })), ...shortFormMarkers.map(m => ({ type: 'marker' as const, data: m }))];

  const state = {
    videoIdx: 0,
    imageIdx: 0,
    scenePreviewIdx: 0,
    consecutiveCount: 0,
    lastType: null as ContentType | null,
    maxConsecutive: 3,
  };

  while (state.videoIdx < allVideos.length || state.imageIdx < images.length || state.scenePreviewIdx < scenePreviewMarkers.length) {
    // Determine chunk sizes: 3-5 videos, then up to 1 scene preview, then 1-2 images
    const videoChunkSize = 3 + Math.floor(random() * 3); // 3-5
    const imageChunkSize = 1 + Math.floor(random() * 2); // 1-2

    // Add video chunk
    addVideoChunk(content, allVideos, videoChunkSize, state);

    // Add scene-preview chunk (own, lower-frequency slot)
    addScenePreviewChunk(content, scenePreviewMarkers, 1, state);

    // Add image chunk
    addImageChunk(content, images, imageChunkSize, state);

    // If we've run out of one type, add remaining of the other
    addRemainingItems(content, allVideos, images, state);
  }

  return content;
}

/**
 * Add a chunk of video items to the content array
 */
function addVideoChunk(
  content: ContentItem[],
  allVideos: Array<{ type: 'marker'; data: SceneMarker }>,
  chunkSize: number,
  state: { videoIdx: number; consecutiveCount: number; lastType: ContentType | null; maxConsecutive: number }
): void {
  for (let i = 0; i < chunkSize && state.videoIdx < allVideos.length; i++) {
    const video = allVideos[state.videoIdx++];
    if (!video) continue;

    content.push({
      type: 'marker',
      data: video.data,
      date: video.data.scene.date,
    });
    
    // Track consecutive count
    if (state.lastType === 'marker') {
      state.consecutiveCount++;
      if (state.consecutiveCount >= state.maxConsecutive) {
        break; // Switch to images
      }
    } else {
      state.consecutiveCount = 1;
      state.lastType = 'marker';
    }
  }
}

/**
 * Add a chunk of image items to the content array
 */
function addImageChunk(
  content: ContentItem[],
  images: Image[],
  chunkSize: number,
  state: { imageIdx: number; consecutiveCount: number; lastType: ContentType | null }
): void {
  for (let i = 0; i < chunkSize && state.imageIdx < images.length; i++) {
    const image = images[state.imageIdx++];
    if (!image) continue;

    content.push({
      type: 'image',
      data: image,
      date: image.date,
    });
    
    if (state.lastType === 'image') {
      state.consecutiveCount++;
    } else {
      state.consecutiveCount = 1;
      state.lastType = 'image';
    }
  }
}

/**
 * Add a chunk of scene-preview items to the content array (its own, lower-frequency slot)
 */
function addScenePreviewChunk(
  content: ContentItem[],
  scenePreviewMarkers: SceneMarker[],
  chunkSize: number,
  state: { scenePreviewIdx: number }
): void {
  for (let i = 0; i < chunkSize && state.scenePreviewIdx < scenePreviewMarkers.length; i++) {
    const marker = scenePreviewMarkers[state.scenePreviewIdx++];
    if (!marker) continue;

    content.push({
      type: 'marker',
      data: marker,
      date: marker.scene.date,
    });
  }
}

/**
 * Add remaining video/image items once the other has been exhausted. Scene previews are
 * drained separately, at most one per cycle, by addScenePreviewChunk — the loop in
 * unifiedMixContent keeps running (even after videos/images are empty) until they're gone,
 * which preserves their own lower-frequency pacing instead of dumping them all at once.
 */
function addRemainingItems(
  content: ContentItem[],
  allVideos: Array<{ type: 'marker'; data: SceneMarker }>,
  images: Image[],
  state: { videoIdx: number; imageIdx: number }
): void {
  if (state.videoIdx >= allVideos.length && state.imageIdx < images.length) {
    while (state.imageIdx < images.length) {
      const image = images[state.imageIdx++];
      if (image) {
        content.push({
          type: 'image',
          data: image,
          date: image.date,
        });
      }
    }
  } else if (state.imageIdx >= images.length && state.videoIdx < allVideos.length) {
    while (state.videoIdx < allVideos.length) {
      const video = allVideos[state.videoIdx++];
      if (video) {
        content.push({
          type: 'marker',
          data: video.data,
          date: video.data.scene.date,
        });
      }
    }
  }
}
