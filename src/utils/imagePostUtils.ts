/**
 * Shared utility functions for image-type post components (ImagePost and ImageVideoPost).
 * Both classes handle image data and share identical implementations for favorite
 * management and dialog positioning.
 */

import { StashAPI } from '../StashAPI.js';

interface ImageTag {
  id?: string;
  name: string;
}

interface ToggleImageFavoriteResult {
  newIsFavorite: boolean;
  newTags: ImageTag[];
}

/**
 * Toggle the favorite status of an image by adding/removing a favorite tag.
 * Returns the new favorite state and updated tag list.
 * Throws on API failure so the caller can revert UI state.
 */
export async function toggleImageFavorite(
  imageId: string,
  currentTagsInput: ImageTag[] | undefined,
  api: StashAPI,
  isFavorite: boolean,
  favoriteTagName: string,
): Promise<ToggleImageFavoriteResult> {
  const favoriteTagId = (await api.ensureTag(favoriteTagName))?.id;
  if (!favoriteTagId) {
    throw new Error('Favorite tag unavailable');
  }

  const currentTags = currentTagsInput ? [...currentTagsInput] : [];
  const hasFavoriteTag =
    currentTags.some((tag) => tag.id === favoriteTagId || tag.name === favoriteTagName) || isFavorite;
  const shouldFavorite = !hasFavoriteTag;

  const existingTagIds = Array.from(
    new Set(
      currentTags
        .map((tag) => tag.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  let nextTagIds: string[];
  if (shouldFavorite) {
    nextTagIds = existingTagIds.includes(favoriteTagId)
      ? existingTagIds
      : [...existingTagIds, favoriteTagId];
  } else {
    nextTagIds = existingTagIds.filter((id) => id !== favoriteTagId);
  }

  await api.updateImageTags(imageId, nextTagIds);

  let newTags: ImageTag[];
  if (shouldFavorite) {
    const alreadyPresent = currentTags.some((tag) => tag.id === favoriteTagId || tag.name === favoriteTagName);
    newTags = alreadyPresent
      ? currentTags
      : [...currentTags, { id: favoriteTagId, name: favoriteTagName }];
  } else {
    newTags = currentTags.filter(
      (tag) => tag.id !== favoriteTagId && tag.name !== favoriteTagName
    );
  }

  return { newIsFavorite: shouldFavorite, newTags };
}

/**
 * Adjust a dialog's position to keep it within the card boundaries.
 * The dialog is centered on the button group but clamped to card edges.
 */
export function adjustImageDialogPosition(
  dialog: HTMLElement,
  container: HTMLElement,
  buttonGroup: HTMLElement | undefined,
): void {
  if (!dialog || !container) return;

  const dialogRect = dialog.getBoundingClientRect();
  const dialogWidth = dialogRect.width;

  const cardContainer = container.closest('.video-post, .image-post');
  if (!cardContainer) return;

  const cardRect = cardContainer.getBoundingClientRect();
  const buttonGroupRect = buttonGroup?.getBoundingClientRect();
  if (!buttonGroupRect) return;

  const buttonCenterX = buttonGroupRect.left + buttonGroupRect.width / 2 - cardRect.left;
  const dialogHalfWidth = dialogWidth / 2;

  const minLeft = dialogHalfWidth + 16;
  const maxLeft = cardRect.width - dialogHalfWidth - 16;

  let offsetX = 0;
  if (buttonCenterX < minLeft) {
    offsetX = minLeft - buttonCenterX;
  } else if (buttonCenterX > maxLeft) {
    offsetX = maxLeft - buttonCenterX;
  }

  dialog.style.left = '50%';
  dialog.style.transform = `translateX(calc(-50% + ${offsetX}px)) translateY(0) scale(1)`;
}
