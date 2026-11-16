import type { SceneMarker, Image } from '../types.js';

export type ContentItem = { type: 'marker' | 'image'; data: SceneMarker | Image; date?: string };

type ContentType = 'marker' | 'shortform' | 'image';

export function shuffle<T>(arr: T[], random: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getSingleContentTypeResult(
  markers: SceneMarker[],
  shortFormMarkers: SceneMarker[],
  images: Image[],
  scenePreviewMarkers: SceneMarker[]
): ContentItem[] | null {
  const videoMarkers = [...markers, ...shortFormMarkers, ...scenePreviewMarkers];

  if (videoMarkers.length === 0) {
    return createImageContentArray(images);
  }

  if (images.length === 0) {
    return createMarkerContentArray(videoMarkers);
  }

  return null;
}

export function mixContent(
  markers: SceneMarker[],
  shortFormMarkers: SceneMarker[],
  images: Image[],
  scenePreviewMarkers: SceneMarker[] = [],
  random: () => number = Math.random
): ContentItem[] {
  const singleTypeResult = getSingleContentTypeResult(markers, shortFormMarkers, images, scenePreviewMarkers);
  if (singleTypeResult !== null) {
    return singleTypeResult;
  }

  return unifiedMixContent(markers, shortFormMarkers, images, scenePreviewMarkers, random);
}

function createImageContentArray(images: Image[]): Array<{ type: 'image'; data: Image; date?: string }> {
  return images.map(image => ({
    type: 'image' as const,
    data: image,
    date: image.date,
  }));
}

function createMarkerContentArray(markers: SceneMarker[]): Array<{ type: 'marker'; data: SceneMarker; date?: string }> {
  return markers.map(marker => ({
    type: 'marker' as const,
    data: marker,
    date: marker.scene.date,
  }));
}

function unifiedMixContent(
  markers: SceneMarker[],
  shortFormMarkers: SceneMarker[],
  images: Image[],
  scenePreviewMarkers: SceneMarker[] = [],
  random: () => number = Math.random
): ContentItem[] {
  const content: ContentItem[] = [];

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
    const videoChunkSize = 3 + Math.floor(random() * 3);
    const imageChunkSize = 1 + Math.floor(random() * 2);

    addVideoChunk(content, allVideos, videoChunkSize, state);

    addScenePreviewChunk(content, scenePreviewMarkers, 1, state);

    addImageChunk(content, images, imageChunkSize, state);

    addRemainingItems(content, allVideos, images, state);
  }

  return content;
}

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
    
    if (state.lastType === 'marker') {
      state.consecutiveCount++;
      if (state.consecutiveCount >= state.maxConsecutive) {
        break;
      }
    } else {
      state.consecutiveCount = 1;
      state.lastType = 'marker';
    }
  }
}

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
