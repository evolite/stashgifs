import { VideoPostData, Scene, IVideoPlayer } from './types.js';
import { StashAPI } from './StashAPI.js';
import { calculateAspectRatio, getAspectRatioClass, normalizeMediaUrl, showToast, toAbsoluteUrl, THEME, extractValidPerformerIds, setIcon } from './utils.js';
import { getStashBaseUrl } from './utils/baseUrl.js';
import { MARKER_SVG, BOOKMARK_SVG_OUTLINE, BOOKMARK_SVG_FILLED } from './icons.js';
import { VideoPostBase, BaseVideoPostOptions } from './VideoPostBase.js';
import { BookmarkManager } from './BookmarkManager.js';
import { FAVORITE_TAG_NAME } from './FavoritesManager.js';
import type { PostButton } from './Hotkeys.js';

const MARKER_TAG_NAME = 'StashGifs Marker';

interface VideoPostOptions extends BaseVideoPostOptions {
  useShuffleMode?: boolean;
  showMarkerTitle?: boolean;
  bookmarkManager?: BookmarkManager;
  showBookmarkButton?: boolean;
  onMarkerTitleChipClick?: (title: string) => void;
  trackWatchHistory?: boolean;
}

export class VideoPost extends VideoPostBase {
  protected readonly data: VideoPostData;
  private player?: IVideoPlayer;
  private markerButton?: HTMLElement;
  private markerDialog?: HTMLElement;
  private markerDialogInput?: HTMLInputElement;
  private markerDialogSuggestions?: HTMLElement;
  private markerDialogRecentTags?: HTMLElement;
  private markerDialogCreateButton?: HTMLButtonElement;
  private isMarkerDialogOpen: boolean = false;
  private isAddTagMode: boolean = false;
  private selectedTagId?: string;
  private selectedTagName?: string;
  private autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;
  private tagSearchLoadingTimer?: ReturnType<typeof setTimeout>;
  private isTagSearchLoading: boolean = false;
  private hasCreatedMarker: boolean = false;

  private watchTrackingInterval: ReturnType<typeof setInterval> | undefined;
  private accumulatedWatchSeconds: number = 0;
  private viewCounted: boolean = false;
  private lastActivitySubmitTime: number = 0;

  private readonly onCancelRequests?: () => void;
  private readonly trackWatchHistory: boolean = true;

  private readonly useShuffleMode: boolean = false;
  private readonly showMarkerTitle: boolean = false;
  private readonly bookmarkManager?: BookmarkManager;
  private isBookmarked: boolean = false;
  private bookmarkButton?: HTMLElement;
  private isTogglingBookmark: boolean = false;
  private showBookmarkButton: boolean = false;
  private readonly onMarkerTitleChipClick?: (title: string) => void;

  constructor(
    container: HTMLElement, 
    data: VideoPostData,
    options: VideoPostOptions = {}
  ) {
    super(container, options);
    this.data = data;
    this.useShuffleMode = options.useShuffleMode || false;
    this.showMarkerTitle = options.showMarkerTitle === true;
    this.bookmarkManager = options.bookmarkManager;
    this.showBookmarkButton = options.showBookmarkButton === true;
    this.onMarkerTitleChipClick = options.onMarkerTitleChipClick;
    this.hdModeFromSettings = options.hdModeFromSettings === true;
    this.onCancelRequests = options.onCancelRequests;
    this.trackWatchHistory = options.trackWatchHistory !== false;
    this.onMuteToggle = options.onMuteToggle;
    this.getGlobalMuteState = options.getGlobalMuteState;
    this.oCount = this.data.marker.scene.o_counter || 0;
    this.ratingSystemConfig = options.ratingSystemConfig;
    if (this.isShortFormContent() || this.data.playMarkerToEnd) {
      this.isHQMode = true;
    }
    
    this.render();
  }

  private render(): void {
    const { header, playerContainer, footer } = this.renderBasePost({
      className: 'video-post',
      postId: this.data.marker.id,
      createHeader: () => this.createHeader(),
      createPlayerContainer: () => this.createPlayerContainer(),
      createFooter: () => this.createFooter()
    });
    this.playerContainer = playerContainer;
    this.footer = footer;

    this.applyReelModeLayout({ header, playerContainer, footer });
  }

  private createPlayerContainer(): HTMLElement {
    let aspectRatio: number | undefined;
    let aspectRatioClass = 'aspect-16-9';
    if (this.data.marker.scene.files && this.data.marker.scene.files.length > 0) {
      const file = this.data.marker.scene.files[0];
      if (file?.width && file?.height && file.height > 0) {
        aspectRatio = calculateAspectRatio(file.width, file.height);
        aspectRatioClass = getAspectRatioClass(aspectRatio);
      }
    }

    return this.createVideoPlayerContainer(aspectRatio, aspectRatioClass);
  }

  protected createHeader(): HTMLElement {
    const header = this.createHeaderContainer();
    header.appendChild(this.buildPerformersSection());

    if (this.showSceneTitle && this.data.marker.scene.title) {
      header.appendChild(this.buildTitleElement(this.data.marker.scene.title));
    }

    const tagsSection = this.buildTagsSection();
    if (tagsSection) header.appendChild(tagsSection);

    return header;
  }

  private buildPerformersSection(): HTMLElement {
    const performers = this.filterPerformersByGender((this.data.marker.scene.performers ?? []).filter(
      (p) => p?.id && p?.name
    ));
    const performersSection = this.createPerformersContainer(performers.length);
    if (performers.length > 0) {
      this.appendPerformerChips(performersSection, performers);
    } else {
      performersSection.appendChild(this.createAddPerformerPlaceholder());
    }
    return performersSection;
  }

  private buildTagsSection(): HTMLElement | undefined {
    const studio = this.data.marker.scene.studio;
    const hasStudio = !!studio && this.showStudioChips;
    const canAddTag = !this.useShuffleMode || this.hasCreatedMarker;
    const addTagChipTitle = this.isRealMarker() || this.isWholeSceneSyntheticContent() ? 'Add tag to marker' : 'Add tag';
    const addTagChip = canAddTag ? this.createAddTagChip(addTagChipTitle) : undefined;

    const tagsSection = document.createElement('div');
    tagsSection.className = 'video-post__tags';
    if (hasStudio) tagsSection.appendChild(this.createStudioChip(studio));
    this.addTagChips(tagsSection);
    if (addTagChip) tagsSection.appendChild(addTagChip);
    if (tagsSection.childElementCount === 0) return undefined;
    this.applyReelModeTagStyles(tagsSection);
    return tagsSection;
  }

  private shouldSkipTag(tag: { id?: string; name?: string } | null | undefined, displayedTagIds: Set<string>): boolean {
    if (!tag?.id || !tag?.name || displayedTagIds.has(tag.id)) {
      return true;
    }
    
    if (this.data.marker.primary_tag?.id === tag.id) {
      return true;
    }
    
    if (tag.name === FAVORITE_TAG_NAME) {
      return true;
    }
    
    if (tag.name === MARKER_TAG_NAME) {
      return true;
    }
    
    return false;
  }

  private addPrimaryTagChip(chips: HTMLElement, displayedTagIds: Set<string>): HTMLElement | null {
    if (this.data.marker.primary_tag?.id && 
        this.data.marker.primary_tag.name &&
        this.data.marker.primary_tag.name !== FAVORITE_TAG_NAME &&
        this.data.marker.primary_tag.name !== MARKER_TAG_NAME) {
      const chip = this.createTagChip(this.data.marker.primary_tag);
      chips.appendChild(chip);
      displayedTagIds.add(this.data.marker.primary_tag.id);
      return chip;
    }
    return null;
  }

  private addSpacingToFirstTag(chip: HTMLElement, hasPerformers: boolean, isFirstTag: boolean): boolean {
    if (hasPerformers && isFirstTag) {
      chip.style.marginLeft = '8px';
      return false;
    }
    return isFirstTag;
  }

  private addTagsFromList(
    tags: Array<{ id: string; name: string }> | undefined,
    chips: HTMLElement,
    displayedTagIds: Set<string>,
    hasPerformers: boolean,
    isFirstTag: boolean
  ): boolean {
    if (!tags || tags.length === 0) {
      return isFirstTag;
    }

    for (const tag of tags) {
      if (this.shouldSkipTag(tag, displayedTagIds)) {
        continue;
      }
      
      const chip = this.createTagChip(tag);
      isFirstTag = this.addSpacingToFirstTag(chip, hasPerformers, isFirstTag);
      chips.appendChild(chip);
      displayedTagIds.add(tag.id);
    }

    return isFirstTag;
  }

  private addTagChips(chips: HTMLElement): void {
    if (this.showMarkerTitle && !this.isWholeSceneSyntheticContent() && this.data.marker.title) {
      const title = document.createElement('span');
      title.textContent = this.data.marker.title;
      title.style.fontSize = '14px';
      title.style.lineHeight = '1.4';
      title.style.color = '#ffffff';
      title.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
      title.style.minHeight = '44px';
      title.style.display = 'inline-flex';
      title.style.alignItems = 'center';
      if (this.onMarkerTitleChipClick) {
        title.style.cursor = 'pointer';
        title.addEventListener('click', () => this.onMarkerTitleChipClick!(this.data.marker.title));
      }
      chips.appendChild(title);
      return;
    }

    const hasPerformers = !!(this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0);
    const displayedTagIds = new Set<string>();
    let isFirstTag = true;
    
    const primaryTagChip = this.addPrimaryTagChip(chips, displayedTagIds);
    if (primaryTagChip) {
      isFirstTag = this.addSpacingToFirstTag(primaryTagChip, hasPerformers, isFirstTag);
    }
    
    isFirstTag = this.addTagsFromList(this.data.marker.tags, chips, displayedTagIds, hasPerformers, isFirstTag);
    
    if (this.showPerformerTags) {
      for (const performer of (this.data.marker.scene.performers ?? [])) {
        isFirstTag = this.addTagsFromList(performer.tags, chips, displayedTagIds, hasPerformers, isFirstTag);
      }
    }

    if (this.isWholeSceneSyntheticContent() || this.useShuffleMode || this.showSceneTags) {
      this.addTagsFromList(this.data.marker.scene.tags, chips, displayedTagIds, hasPerformers, isFirstTag);
    }

    this.applyTagLimit(chips, this.tagDisplayLimit);
  }

  private isShortFormContent(): boolean {
    return typeof this.data.marker.id === 'string' && this.data.marker.id.startsWith('shortform-');
  }

  private isScenePreviewContent(): boolean {
    return typeof this.data.marker.id === 'string' && this.data.marker.id.startsWith('scenepreview-');
  }

  private isWholeSceneSyntheticContent(): boolean {
    return this.isShortFormContent() || this.isScenePreviewContent();
  }

  private addActionButtons(buttonGroup: HTMLElement): void {
    if (this.useShuffleMode) {
      this.addShuffleModeButtons(buttonGroup);
    } else {
      this.addStandardButtons(buttonGroup);
    }
  }

  private addShuffleModeButtons(buttonGroup: HTMLElement): void {
    if (this.hasCreatedMarker && this.favoritesManager) {
      buttonGroup.appendChild(this.createHeartButton());
    } else if (this.api) {
      buttonGroup.appendChild(this.createMarkerButton());
    }
  }

  protected override getButton(button: PostButton): HTMLElement | undefined {
    return button === 'bookmark' ? this.bookmarkButton : super.getButton(button);
  }

  private addStandardButtons(buttonGroup: HTMLElement): void {
    if (this.favoritesManager) {
      buttonGroup.appendChild(this.createHeartButton());
    }
    if (this.showBookmarkButton && this.bookmarkManager) {
      this.bookmarkButton = this.createBookmarkButton();
      buttonGroup.appendChild(this.bookmarkButton);
    }
  }

  private createFooter(): HTMLElement {
    const { footer, info, row, buttonGroup } = this.buildFooterContainer();
    info.style.flexDirection = 'row';
    info.style.justifyContent = 'flex-end';
    row.style.justifyContent = 'flex-end';
    buttonGroup.style.flexWrap = 'nowrap';
    buttonGroup.style.flexShrink = '0';
    this.buttonGroup = buttonGroup;

    this.addActionButtons(buttonGroup);

    const viewCount = this.data.marker.scene.play_count ?? 0;
    buttonGroup.appendChild(this.createViewCountBadge(viewCount));

    if (this.api) {
      const oCountBtn = this.createOCountButton();
      buttonGroup.appendChild(oCountBtn);
    }

    const ratingControl = this.createRatingSection();
    buttonGroup.appendChild(ratingControl);

    if (this.api && !this.hdModeFromSettings && !this.isScenePreviewContent() && !this.data.playMarkerToEnd) {
      const hqBtn = this.createHQButton();
      buttonGroup.appendChild(hqBtn);
    }

    const muteBtn = this.createMuteOverlayButton();
    buttonGroup.appendChild(muteBtn);

    const playBtn = this.createPlayButton();
    buttonGroup.appendChild(playBtn);

    return footer;
  }

  private createPlayButton(): HTMLElement {
    return this.buildExternalLinkButton(
      this.getSceneLink(),
      'icon-btn--play',
      'View full scene',
      'Open scene in Stash'
    );
  }

  protected async toggleFavoriteAction(): Promise<boolean> {
    if (!this.favoritesManager) {
      throw new Error('FavoritesManager not available');
    }
    return await this.favoritesManager.toggleFavorite(this.data.marker);
  }

  private createBookmarkButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'icon-btn icon-btn--bookmark';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle bookmark');
    btn.title = 'Add to bookmarks';
    this.applyIconButtonStyles(btn);
    btn.style.padding = '0';
    btn.style.flexShrink = '0';
    this.updateBookmarkButton(btn);

    btn.addEventListener('click', async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isTogglingBookmark) return;
      this.isTogglingBookmark = true;
      btn.disabled = true;
      btn.style.opacity = '0.5';
      try {
        this.isBookmarked = await this.bookmarkManager!.toggleBookmark(this.data.marker);
        this.updateBookmarkButton(btn);
      } catch (error) {
        console.error('Failed to toggle bookmark', error);
        showToast('Failed to update bookmark. Please try again.');
      } finally {
        this.isTogglingBookmark = false;
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    });

    return btn;
  }

  private updateBookmarkButton(button?: HTMLElement): void {
    const btn = button || this.bookmarkButton;
    if (!btn) return;
    if (this.isBookmarked) {
      setIcon(btn, BOOKMARK_SVG_FILLED);
      btn.style.color = THEME.colors.accentPrimary;
      btn.title = 'Remove from bookmarks';
    } else {
      setIcon(btn, BOOKMARK_SVG_OUTLINE);
      btn.style.color = THEME.colors.textPrimary;
      btn.title = 'Add to bookmarks';
    }
  }

  private async checkBookmarkStatus(): Promise<void> {
    if (!this.bookmarkManager || !this.bookmarkButton) return;
    try {
      this.isBookmarked = await this.bookmarkManager.isBookmarked(this.data.marker);
      this.updateBookmarkButton();
    } catch (error) {
      console.error('Failed to check bookmark status', error);
    }
  }

  public setShowBookmarkButton(show: boolean): void {
    this.showBookmarkButton = show;
    if (this.bookmarkButton) {
      this.bookmarkButton.style.display = show ? '' : 'none';
    } else if (show && this.bookmarkManager && this.buttonGroup) {
      this.bookmarkButton = this.createBookmarkButton();
      const firstBtn = this.buttonGroup.firstChild;
      if (firstBtn?.nextSibling) {
        this.buttonGroup.insertBefore(this.bookmarkButton, firstBtn.nextSibling);
      } else {
        this.buttonGroup.appendChild(this.bookmarkButton);
      }
      void this.checkBookmarkStatus();
    }
  }

  private createMarkerButton(): HTMLElement {
    const markerBtn = document.createElement('button');
    markerBtn.className = 'icon-btn icon-btn--marker';
    markerBtn.type = 'button';
    markerBtn.setAttribute('aria-label', 'Create marker');
    markerBtn.title = 'Create marker from post';
    this.applyIconButtonStyles(markerBtn);
    markerBtn.style.padding = '0';
    setIcon(markerBtn, MARKER_SVG);

    const clickHandler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMarkerDialog();
    };

    markerBtn.addEventListener('click', clickHandler);
    this.markerButton = markerBtn;
    return markerBtn;
  }

  private isRealMarker(): boolean {
    const markerId = this.data.marker?.id;
    if (!markerId) return false;
    if (typeof markerId === 'string' && markerId.startsWith('synthetic-')) {
      return false;
    }
    return true;
  }

  private replaceMarkerButtonWithHeart(): void {
    if (!this.buttonGroup || !this.markerButton || !this.favoritesManager) return;

    this.markerButton?.remove();
    this.markerButton = undefined;

    const heartBtn = this.createHeartButton();
    this.buttonGroup.insertBefore(heartBtn, this.buttonGroup.firstChild);

    if (this.api && this.isRealMarker()) {
      const addTagBtn = this.createAddTagButton();
      if (this.buttonGroup.firstChild) {
        this.buttonGroup.insertBefore(addTagBtn, this.buttonGroup.firstChild.nextSibling);
      } else {
        this.buttonGroup.appendChild(addTagBtn);
      }
    }

    this.checkFavoriteStatus();
    void this.checkBookmarkStatus();
  }

  protected async updateLocalTagsAfterFavoriteToggle(newFavoriteState: boolean): Promise<void> {
    const isWholeSceneSynthetic = this.isWholeSceneSyntheticContent();
    const favoriteTagId = await this.favoritesManager?.getFavoriteTagId() ?? null;
    const tagId = favoriteTagId ?? undefined;

    if (isWholeSceneSynthetic) {
      this.updateSceneTagsAfterFavoriteToggle(newFavoriteState, tagId);
    } else {
      this.updateMarkerTagsAfterFavoriteToggle(newFavoriteState, tagId);
    }
  }

  private updateSceneTagsAfterFavoriteToggle(newFavoriteState: boolean, favoriteTagId: string | undefined): void {
    this.data.marker.scene.tags ??= [];
    const tags = this.data.marker.scene.tags;
    if (!tags) return;
    
    if (newFavoriteState) {
      this.addFavoriteTagToScene(tags, favoriteTagId);
    } else {
      this.removeFavoriteTagFromScene(tags, favoriteTagId);
    }
  }

  private updateMarkerTagsAfterFavoriteToggle(newFavoriteState: boolean, favoriteTagId: string | undefined): void {
    this.data.marker.tags ??= [];
    const tags = this.data.marker.tags;
    if (!tags) return;
    
    if (newFavoriteState) {
      this.addFavoriteTagToMarker(tags, favoriteTagId);
    } else {
      this.removeFavoriteTagFromMarker(tags, favoriteTagId);
    }
  }

  private addFavoriteTag(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    if (favoriteTagId && !tags.some(tag => tag.id === favoriteTagId || tag.name === FAVORITE_TAG_NAME)) {
      tags.push({ id: favoriteTagId, name: FAVORITE_TAG_NAME });
    }
  }

  private removeFavoriteTag(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): Array<{ id: string; name: string }> {
    return tags.filter(
      tag => tag.id !== favoriteTagId && tag.name !== FAVORITE_TAG_NAME
    );
  }

  private addFavoriteTagToScene(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.addFavoriteTag(tags, favoriteTagId);
  }

  private removeFavoriteTagFromScene(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.data.marker.scene.tags = this.removeFavoriteTag(tags, favoriteTagId);
  }

  private addFavoriteTagToMarker(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.addFavoriteTag(tags, favoriteTagId);
  }

  private removeFavoriteTagFromMarker(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.data.marker.tags = this.removeFavoriteTag(tags, favoriteTagId);
  }

  protected async incrementOCountAction(): Promise<void> {
    if (!this.api) {
      throw new Error('API not available');
    }
    const result = await this.api.incrementOCount(this.data.marker.scene.id);
    this.oCount = result.count;
    this.data.marker.scene.o_counter = result.count;
  }

  protected getProductionDate(): string | undefined {
    return this.data.marker.scene.date;
  }

  protected getHQAriaLabel(): string {
    return 'Load high-quality scene video with audio';
  }

  protected getHQTitle(): string {
    return 'Load HD marker';
  }

  protected performHQUpgrade(): void {
    if (this.isScenePreviewContent()) return;
    this.upgradeToSceneVideo();
  }

  protected createRatingSection(): HTMLElement {
    return this.buildRatingSection(
      'scene',
      () => this.data.marker.scene.rating100,
      (value) => { this.data.marker.scene.rating100 = value; },
      this.api ? (rating10) => this.api!.updateSceneRating(this.data.marker.scene.id, rating10) : undefined
    );
  }

  private getViewThresholdSeconds(): number {
    const clipLen = (this.data.marker.end_seconds ?? 0) - this.data.marker.seconds;
    return clipLen > 0 ? Math.min(3, clipLen * 0.5) : 3;
  }

  private resetWatchTracking(): void {
    this.accumulatedWatchSeconds = 0;
    this.viewCounted = false;
    this.lastActivitySubmitTime = 0;
  }

  private startWatchTracking(): void {
    if (!this.api || this.watchTrackingInterval !== undefined) return;
    this.resetWatchTracking();
    const sceneId = this.data.marker.scene.id;
    this.watchTrackingInterval = setInterval(() => {
      const player = this.player;
      if (!player) return;
      const state = player.getState();
      if (!state.isPlaying) return;

      this.accumulatedWatchSeconds++;

      if (!this.viewCounted && this.accumulatedWatchSeconds >= this.getViewThresholdSeconds()) {
        this.viewCounted = true;
        if (this.isShortFormContent()) {
          void this.api!.incrementScenePlayCount(sceneId);
        }
      }

      if (this.trackWatchHistory && this.accumulatedWatchSeconds - this.lastActivitySubmitTime >= 30) {
        this.lastActivitySubmitTime = this.accumulatedWatchSeconds;
        void this.api!.saveSceneActivity(sceneId, state.currentTime, this.accumulatedWatchSeconds);
      }
    }, 1000);
  }

  private stopWatchTracking(): void {
    if (this.watchTrackingInterval !== undefined) {
      clearInterval(this.watchTrackingInterval);
      this.watchTrackingInterval = undefined;
    }
    if (this.trackWatchHistory && this.api && this.accumulatedWatchSeconds > 0) {
      const sceneId = this.data.marker.scene.id;
      const currentTime = this.player?.getState().currentTime;
      void this.api.saveSceneActivity(sceneId, currentTime, this.accumulatedWatchSeconds);
    }
  }

  private destroyCurrentPlayer(): void {
    if (!this.player) {
      return;
    }

    this.stopWatchTracking();
    this.detachLoadErrorHandler();
    this.detachReelAutoAdvance();

    if (this.player.getIsUnloaded()) {
      this.player.destroy();
      this.player = undefined;
      this.isLoaded = false;
      return;
    }
    this.player.unload();

    this.player.destroy();
    this.player = undefined;
    this.isLoaded = false;
  }

  private cleanupPlayerElements(playerContainer: HTMLElement): void {
    try {
      const oldPlayerWrappers = playerContainer.querySelectorAll('.video-player');
      for (const wrapper of Array.from(oldPlayerWrappers)) {
        wrapper.remove();
      }
      
      const oldControls = playerContainer.querySelectorAll('.video-player__controls');
      for (const controls of Array.from(oldControls)) {
        controls.remove();
      }
    } catch (e) {
      console.warn('Failed to remove old player elements', e);
      try {
        playerContainer.innerHTML = '';
      } catch (error_) {
        console.error('Failed to clear player container', error_);
        throw new Error('Failed to clear player container for upgrade');
      }
    }
  }

  private createSceneVideoPlayer(playerContainer: HTMLElement, sceneVideoUrl: string): void {
    try {
      const startTime = this.data.startTime ?? this.data.marker.seconds;

      const markerId = this.data.marker.id;
      const isImageMarker = typeof markerId === 'string' && markerId.startsWith('image-');
      const sources = (!isImageMarker && this.api)
        ? this.api.getSceneSources(this.data.marker.scene)
        : undefined;

      this.player = this.createVideoPlayer(playerContainer, sceneVideoUrl, {
        muted: true,
        startTime: startTime,
        endTime: this.resolvePlaybackEndTime(),
        sources,
      });

      this.isLoaded = true;
      this.attachLoadErrorHandler();
      this.attachReelAutoAdvance();
      this.setupProgressBar();
    } catch (error) {
      console.error('VideoPost: Failed to create scene video player', {
        error,
        sceneVideoUrl,
        markerId: this.data.marker.id,
        sceneId: this.data.marker.scene?.id,
      });
      throw error;
    }
  }

  private notifyPlayerReady(): void {
    if (this.data.marker.id && this.player) {
      this.onPlayerReady?.(this.data.marker.id);
    }
  }

  private validateAndPrepareUpgrade(): { sceneVideoUrl: string; playerContainer: HTMLElement; wasPlaying: boolean } {
    if (!this.api) {
      throw new Error('API not available');
    }

    const markerId = this.data.marker.id;
    const isImageMarker = typeof markerId === 'string' && markerId.startsWith('image-');
    
    let sceneVideoUrl: string | undefined;
    
    if (isImageMarker) {
      const imagePaths = this.data.marker.scene?.paths as { image?: string; preview?: string; thumbnail?: string } | undefined;
      const imagePath = imagePaths?.image;
      if (!imagePath) {
        throw new Error('Image video URL not available');
      }
      sceneVideoUrl = imagePath.startsWith('http') 
        ? imagePath 
        : toAbsoluteUrl(imagePath);
    } else {
      sceneVideoUrl = this.api.getVideoUrl(this.data.marker.scene);
    }
    
    const normalizedSceneVideoUrl = normalizeMediaUrl(sceneVideoUrl);
    if (!normalizedSceneVideoUrl) {
      throw new Error('Scene video URL not available');
    }

    const { playerContainer, wasPlaying } = this.capturePlayerState();

    return { sceneVideoUrl: normalizedSceneVideoUrl, playerContainer, wasPlaying };
  }

  private upgradeToSceneVideo(): void {
    const { sceneVideoUrl, playerContainer } = this.validateAndPrepareUpgrade();

    this.destroyCurrentPlayer();

    this.cleanupPlayerElements(playerContainer);

    this.createSceneVideoPlayer(playerContainer, sceneVideoUrl);

    this.notifyPlayerReady();
  }

  protected getFavoriteTagSource(): Array<{ name: string }> | undefined {
    const isWholeSceneSynthetic = this.isWholeSceneSyntheticContent();

    if (isWholeSceneSynthetic) {
      return this.data.marker.scene?.tags;
    } else {
      return this.data.marker.tags;
    }
  }

  private getSceneLink(): string {
    const s = this.data.marker.scene;
    const t = Math.max(0, Math.floor(this.data.marker.seconds || 0));
    return `${getStashBaseUrl()}/scenes/${s.id}?t=${t}`;
  }

  private resolvePlaybackEndTime(endTime?: number): number | undefined {
    if (this.data.playMarkerToEnd) return undefined;
    return endTime ?? this.data.endTime ?? this.data.marker.end_seconds;
  }

  loadPlayer(videoUrl: string, startTime?: number, endTime?: number): IVideoPlayer | undefined {
    if (this.isLoaded) {
      return this.player;
    }

    const normalizedVideoUrl = normalizeMediaUrl(videoUrl);
    if (!normalizedVideoUrl) {
      console.warn('VideoPost: Invalid media URL, skipping player creation', { 
        videoUrl,
        markerId: this.data.marker.id,
        sceneId: this.data.marker.scene?.id,
      });
      return undefined;
    }

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      console.warn('VideoPost: Player container not found', { markerId: this.data.marker.id });
      return undefined;
    }

    try {
      const hasPrerenderedClip = !!this.data.marker.stream;
      const finalStartTime = (this.isHQMode || !hasPrerenderedClip)
        ? (startTime ?? this.data.startTime ?? this.data.marker.seconds)
        : undefined;
      const finalEndTime = (this.isHQMode || !hasPrerenderedClip)
        ? this.resolvePlaybackEndTime(endTime)
        : undefined;

      const shouldBeMuted = this.getGlobalMuteState ? this.getGlobalMuteState() : true;

      const markerId = this.data.marker.id;
      const isImageMarker = typeof markerId === 'string' && markerId.startsWith('image-');
      const sources = (this.isHQMode && !isImageMarker && this.api)
        ? this.api.getSceneSources(this.data.marker.scene)
        : undefined;

      this.player = this.createVideoPlayer(playerContainer, normalizedVideoUrl, {
        muted: shouldBeMuted,
        startTime: finalStartTime,
        endTime: finalEndTime,
        sources,
      });

      this.isLoaded = true;
      this.attachLoadErrorHandler();
      this.attachReelAutoAdvance();
      this.setupProgressBar();

      this.startWatchTracking();

    } catch (error) {
      console.error('VideoPost: Failed to create video player', {
        error,
        videoUrl,
        markerId: this.data.marker.id,
      });
      return undefined;
    }

    return this.player;
  }

  hasVideoSource(): boolean {
    return !!normalizeMediaUrl(this.data.videoUrl);
  }

  preload(): IVideoPlayer | undefined {
    if (!this.hasVideoSource()) {
      return undefined;
    }

    const reloaded = this.attemptReloadIfUnloaded();
    if (reloaded) {
      this.attachReelAutoAdvance();
      return reloaded;
    }

    return this.loadPlayer(
      this.data.videoUrl!,
      this.data.startTime ?? this.data.marker.seconds
    );
  }

  getPostId(): string {
    return this.data.marker.id;
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  getPlayer(): IVideoPlayer | undefined {
    return this.player;
  }

  override getPerformers() {
    return this.data.marker.scene.performers ?? [];
  }

  protected getHQButtonOffLabel(): string {
    return 'Load HD video with audio';
  }

  private createMarkerDialog(): HTMLElement {
    const dialog = this.createDialogContainer('marker-dialog');
    this.markerDialog = dialog;

    dialog.appendChild(this.createDialogTitle('Create Marker', 'marker-dialog-title'));

    const { inputWrapper, input, suggestions } = this.createDialogInputSection({
      placeholder: 'Search for tag...',
      ariaLabel: 'Tag name',
      suggestionsClassName: 'marker-dialog__suggestions',
    });
    suggestions.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
    this.markerDialogInput = input;
    this.markerDialogSuggestions = suggestions;

    input.addEventListener('input', () => {
      this.handleMarkerTagInput();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.selectedTagId && this.markerDialogCreateButton && !this.markerDialogCreateButton.disabled) {
        e.preventDefault();
        if (this.isAddTagMode) {
          void this.addTagToMarker();
        } else {
          void this.createMarker();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeMarkerDialog();
      }
    });

    dialog.appendChild(inputWrapper);

    const recentSection = document.createElement('div');
    recentSection.className = 'marker-dialog__recent';
    recentSection.style.marginBottom = '12px';
    const recentTitle = document.createElement('div');
    recentTitle.textContent = 'Recent tags';
    recentTitle.style.fontSize = '12px';
    recentTitle.style.fontWeight = '500';
    recentTitle.style.color = THEME.colors.textMuted;
    recentTitle.style.marginBottom = '8px';
    recentSection.appendChild(recentTitle);
    const recentTags = document.createElement('div');
    recentTags.style.display = 'none';
    recentTags.style.flexWrap = 'wrap';
    recentTags.style.gap = '6px';
    this.markerDialogRecentTags = recentTags;
    recentSection.appendChild(recentTags);
    dialog.appendChild(recentSection);

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    buttons.style.justifyContent = 'flex-end';

    buttons.appendChild(this.createDialogCancelButton(() => this.closeMarkerDialog()));

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.id = 'marker-dialog-action-button';
    createBtn.textContent = 'Create';
    createBtn.disabled = true;
    createBtn.style.padding = '8px 16px';
    createBtn.style.background = THEME.colors.accentPrimary;
    createBtn.style.border = `1px solid ${THEME.colors.accentPrimary}`;
    createBtn.style.color = THEME.colors.textPrimary;
    createBtn.style.fontSize = '14px';
    createBtn.style.cursor = 'not-allowed';
    createBtn.style.transition = 'all 0.2s ease';
    createBtn.addEventListener('click', () => {
      if (this.isAddTagMode) {
        void this.addTagToMarker();
      } else {
        void this.createMarker();
      }
    });
    this.markerDialogCreateButton = createBtn;
    buttons.appendChild(createBtn);

    dialog.appendChild(buttons);

    return dialog;
  }

  private openMarkerDialog(mode: 'create' | 'add' = 'create'): void {
    const buttonGroup = (this.markerButton || this.addTagButton)?.parentElement;
    if (!buttonGroup) return;
    this.markerDialog ??= this.createMarkerDialog();
    if (this.markerDialog.parentElement !== buttonGroup) {
      buttonGroup.style.position = 'relative';
      buttonGroup.appendChild(this.markerDialog);
    }
    if (this.isMarkerDialogOpen) return;

    this.isAddTagMode = mode === 'add';
    this.isMarkerDialogOpen = true;
    this.selectedTagId = undefined;
    this.selectedTagName = undefined;
    if (this.markerDialogInput) {
      this.markerDialogInput.value = '';
    }
    
    const title = this.markerDialog?.querySelector('#marker-dialog-title');
    const actionButton = this.markerDialog?.querySelector('#marker-dialog-action-button') as HTMLButtonElement;
    if (title) {
      title.textContent = this.isAddTagMode ? 'Add Tag' : 'Create Marker';
    }
    if (actionButton) {
      actionButton.textContent = this.isAddTagMode ? 'Add' : 'Create';
    }
    
    this.updateMarkerDialogState();
    this.loadRecentTags();

    if (this.markerDialog) {
      this.markerDialog.hidden = false;
      this.markerDialog.setAttribute('aria-hidden', 'false');
      this.markerDialog.style.opacity = '1';
      this.markerDialog.style.transform = 'translateX(-50%) translateY(0) scale(1)';
      this.markerDialog.style.pointerEvents = 'auto';
      
      requestAnimationFrame(() => {
        this.adjustDialogPosition(this.markerDialog!);
      });
    }

    document.addEventListener('mousedown', this.onMarkerDialogOutsideClick);
    document.addEventListener('touchstart', this.onMarkerDialogOutsideClick);
    document.addEventListener('keydown', this.onMarkerDialogKeydown);

    requestAnimationFrame(() => {
      this.markerDialogInput?.focus({ preventScroll: true });
    });
  }

  private resetMarkerDialogButton(text: string = 'Add'): void {
    if (this.markerDialogCreateButton) {
      this.markerDialogCreateButton.disabled = false;
      this.markerDialogCreateButton.textContent = text;
      this.markerDialogCreateButton.style.opacity = '1';
    }
  }

  private closeMarkerDialog(resumePlayback = true): void {
    if (!this.isMarkerDialogOpen) return;
    this.isMarkerDialogOpen = false;

    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
      this.autocompleteDebounceTimer = undefined;
    }
    if (this.tagSearchLoadingTimer) {
      clearTimeout(this.tagSearchLoadingTimer);
      this.tagSearchLoadingTimer = undefined;
    }
    this.clearTagSuggestionsLoading();

    if (this.markerDialog) {
      this.markerDialog.style.opacity = '0';
      this.markerDialog.style.transform = 'translateX(-50%) translateY(4px) scale(0.96)';
      this.markerDialog.style.pointerEvents = 'none';
      setTimeout(() => {
        if (this.markerDialog && !this.isMarkerDialogOpen) {
          this.markerDialog.hidden = true;
          this.markerDialog.setAttribute('aria-hidden', 'true');
        }
      }, 200);
    }

    if (this.markerDialogSuggestions) {
      this.markerDialogSuggestions.style.display = 'none';
    }

    document.removeEventListener('mousedown', this.onMarkerDialogOutsideClick);
    document.removeEventListener('touchstart', this.onMarkerDialogOutsideClick);
    document.removeEventListener('keydown', this.onMarkerDialogKeydown);

    if (resumePlayback) this.onPlayerReady?.(this.data.marker.id);
  }

  private readonly onMarkerDialogOutsideClick = (event: Event): void => {
    if (!this.isMarkerDialogOpen || !this.markerDialog) return;
    const target = event.target as Node | null;
    if (target && this.markerDialog.contains(target)) {
      return;
    }
    this.closeMarkerDialog();
  };

  private readonly onMarkerDialogKeydown = (event: KeyboardEvent): void => {
    if (!this.isMarkerDialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMarkerDialog();
      this.markerButton?.focus();
    }
  };

  private handleMarkerTagInput(): void {
    if (!this.markerDialogInput) return;

    const searchTerm = this.markerDialogInput.value.trim();
    this.selectedTagId = undefined;
    this.selectedTagName = undefined;
    this.updateMarkerDialogState();

    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
    }
    if (this.tagSearchLoadingTimer) {
      clearTimeout(this.tagSearchLoadingTimer);
      this.tagSearchLoadingTimer = undefined;
    }

    if (searchTerm.length === 0) {
      this.clearTagSuggestionsLoading();
      if (this.markerDialogSuggestions) {
        this.markerDialogSuggestions.style.display = 'none';
      }
      return;
    }

    this.autocompleteDebounceTimer = setTimeout(() => {
      void this.searchTagsForMarker(searchTerm);
    }, 250);
  }

  private showTagSuggestionsLoading(): void {
    if (!this.markerDialogSuggestions || this.isTagSearchLoading) return;

    this.isTagSearchLoading = true;
    this.markerDialogSuggestions.innerHTML = '';
    this.markerDialogSuggestions.style.display = 'block';

    const loadingItem = document.createElement('div');
    loadingItem.style.width = '100%';
    loadingItem.style.padding = '10px 12px';
    loadingItem.style.display = 'flex';
    loadingItem.style.alignItems = 'center';
    loadingItem.style.color = THEME.colors.textSecondary;
    loadingItem.style.fontSize = '14px';
    loadingItem.textContent = 'Loading tags...';
    
    this.markerDialogSuggestions.appendChild(loadingItem);
  }

  private clearTagSuggestionsLoading(): void {
    if (!this.markerDialogSuggestions) return;

    this.markerDialogSuggestions.innerHTML = '';
    this.isTagSearchLoading = false;
  }

  private async searchTagsForMarker(searchTerm: string): Promise<void> {
    if (!this.api || !this.markerDialogSuggestions) return;

    this.clearTagSuggestionsLoading();

    this.tagSearchLoadingTimer = setTimeout(() => {
      if (!this.isTagSearchLoading) {
        this.showTagSuggestionsLoading();
      }
    }, 200);

    try {
      const tags = await this.api.searchMarkerTags(searchTerm, 20);
      
      if (this.tagSearchLoadingTimer) {
        clearTimeout(this.tagSearchLoadingTimer);
        this.tagSearchLoadingTimer = undefined;
      }
      
      this.clearTagSuggestionsLoading();
      
      this.displayTagSuggestions(tags);
    } catch (error) {
      console.error('Failed to search tags', error);
      if (this.tagSearchLoadingTimer) {
        clearTimeout(this.tagSearchLoadingTimer);
        this.tagSearchLoadingTimer = undefined;
      }
      this.clearTagSuggestionsLoading();
    }
  }

  private displayTagSuggestions(tags: Array<{ id: string; name: string }>): void {
    if (!this.markerDialogSuggestions) return;

    this.clearTagSuggestionsLoading();

    this.markerDialogSuggestions.innerHTML = '';
    this.markerDialogSuggestions.style.display = tags.length > 0 ? 'block' : 'none';

    if (tags.length === 0) {
      const noResults = document.createElement('div');
      noResults.textContent = 'No tags found';
      noResults.style.padding = '12px';
      noResults.style.color = THEME.colors.textMuted;
      noResults.style.fontSize = '14px';
      this.markerDialogSuggestions.appendChild(noResults);
      return;
    }

    for (const tag of tags) {
      const item = this.createMenuSuggestionItem(tag.name, () => this.selectTagForMarker(tag.id, tag.name));
      if (this.markerDialogSuggestions) {
        this.markerDialogSuggestions.appendChild(item);
      }
    }
  }

  private selectTagForMarker(tagId: string, tagName: string): void {
    this.selectedTagId = tagId;
    this.selectedTagName = tagName;
    if (this.markerDialogInput) {
      this.markerDialogInput.value = tagName;
    }
    if (this.markerDialogSuggestions) {
      this.markerDialogSuggestions.style.display = 'none';
    }
    this.updateMarkerDialogState();
    this.addToRecentTags(tagId, tagName);

    if (this.isAddTagMode) {
      void this.addTagToMarker();
    }
  }

  private updateMarkerDialogState(): void {
    if (!this.markerDialogCreateButton) return;

    const hasTag = !!this.selectedTagId;
    this.markerDialogCreateButton.disabled = !hasTag;

    if (hasTag) {
      this.markerDialogCreateButton.style.background = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.borderColor = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.color = THEME.colors.textPrimary;
      this.markerDialogCreateButton.style.cursor = 'pointer';
    } else {
      this.markerDialogCreateButton.style.background = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.borderColor = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.color = THEME.colors.textMuted;
      this.markerDialogCreateButton.style.cursor = 'not-allowed';
    }
  }

  private loadRecentTags(): void {
    if (!this.markerDialogRecentTags) return;

    try {
      const stored = localStorage.getItem('stashgifs-recent-marker-tags');
      if (!stored) return;

      let recentTags: Array<{ id: string; name: string }> = [];
      try {
        recentTags = JSON.parse(stored) as Array<{ id: string; name: string }>;
      } catch (error) {
        console.warn('Failed to parse recent tags from localStorage', error);
        return;
      }
      this.markerDialogRecentTags.innerHTML = '';

      if (recentTags.length === 0) {
        if (this.markerDialogRecentTags) {
          this.markerDialogRecentTags.style.display = 'none';
        }
        const recentSection = this.markerDialogRecentTags?.parentElement;
        if (recentSection) {
          recentSection.style.display = 'none';
        }
        return;
      }

      const recentSection = this.markerDialogRecentTags?.parentElement;
      if (recentSection) {
        recentSection.style.display = 'block';
      }
      this.markerDialogRecentTags.style.display = 'flex';
      for (const tag of recentTags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = tag.name;
        chip.style.padding = '6px 12px';
        chip.style.background = THEME.colors.backgroundSecondary;
        chip.style.border = `1px solid ${THEME.colors.border}`;
        chip.style.borderRadius = THEME.radius.tag;
        chip.style.color = THEME.colors.textPrimary;
        chip.style.fontSize = THEME.typography.sizeMeta;
        chip.style.cursor = 'pointer';
        chip.style.transition = 'all 0.15s ease';

        chip.addEventListener('mouseenter', () => {
          chip.style.background = THEME.colors.surfaceHover;
          chip.style.borderColor = THEME.colors.border;
        });
        chip.addEventListener('mouseleave', () => {
          chip.style.background = THEME.colors.backgroundSecondary;
          chip.style.borderColor = THEME.colors.border;
        });

        chip.addEventListener('click', () => {
          this.selectTagForMarker(tag.id, tag.name);
        });

        if (this.markerDialogRecentTags) {
          this.markerDialogRecentTags.appendChild(chip);
        }
      }
    } catch (error) {
      console.error('Failed to load recent tags', error);
    }
  }

  private addToRecentTags(tagId: string, tagName: string): void {
    try {
      const stored = localStorage.getItem('stashgifs-recent-marker-tags');
      let recentTags: Array<{ id: string; name: string }> = [];
      if (stored) {
        try {
          recentTags = JSON.parse(stored) as Array<{ id: string; name: string }>;
        } catch (error) {
          console.warn('Failed to parse recent tags from localStorage', error);
          recentTags = [];
        }
      }

      recentTags = recentTags.filter(t => t.id !== tagId);

      recentTags.unshift({ id: tagId, name: tagName });

      recentTags = recentTags.slice(0, 20);

      localStorage.setItem('stashgifs-recent-marker-tags', JSON.stringify(recentTags));
    } catch (error) {
      console.error('Failed to save recent tags', error);
    }
  }

  private async createMarker(): Promise<void> {
    if (!this.api || !this.selectedTagId || !this.selectedTagName) return;
    if (!this.markerDialogCreateButton) return;

    const sceneIdRaw = this.data.marker.scene?.id;
    if (!sceneIdRaw) {
      console.error('Failed to create marker: scene ID is missing', this.data.marker);
      showToast('Failed to create marker: scene information is missing.');
      return;
    }

    this.prepareForMarkerCreation();

    try {
      const markerTagId = await this.ensureMarkerTagExists(this.api);
      const tagIds = markerTagId ? [String(markerTagId)] : [];

      const createdMarker = await this.api.createSceneMarker(
        String(sceneIdRaw),
        this.data.startTime ?? this.data.marker.seconds,
        String(this.selectedTagId),
        '',
        null,
        tagIds
      );

      if (createdMarker) {
        this.applyCreatedMarkerData(createdMarker);
      }

      showToast(`Marker created with tag "${this.selectedTagName}"`);
      this.hasCreatedMarker = true;
      this.refreshHeader();
      this.replaceMarkerButtonWithHeart();
      this.checkFavoriteStatus();
      this.closeMarkerDialog();
    } catch (error) {
      console.error('Failed to create marker', error);
      showToast('Failed to create marker. Please try again.');
      this.resetMarkerDialogButton('Create');
    }
  }

  private prepareForMarkerCreation(): void {
    this.onPauseAll?.();
    if (this.onCancelRequests) {
      this.onCancelRequests();
    }
    this.markerDialogCreateButton!.disabled = true;
    this.markerDialogCreateButton!.textContent = 'Creating...';
    this.markerDialogCreateButton!.style.opacity = '0.6';
  }

  private async ensureMarkerTagExists(api: StashAPI): Promise<string | null> {
    try {
      return (await api.ensureTag(MARKER_TAG_NAME))?.id ?? null;
    } catch (error) {
      console.warn('VideoPost: Failed to get marker tag, continuing without it', error);
      return null;
    }
  }

  private applyCreatedMarkerData(createdMarker: Awaited<ReturnType<StashAPI['createSceneMarker']>>): void {
    const existingScene = this.data.marker.scene;
    this.data.marker = {
      id: createdMarker.id,
      title: createdMarker.title,
      seconds: createdMarker.seconds,
      end_seconds: createdMarker.end_seconds,
      stream: createdMarker.stream,
      preview: createdMarker.preview,
      primary_tag: createdMarker.primary_tag,
      tags: createdMarker.tags || [],
      scene: {
        ...existingScene,
        ...createdMarker.scene,
        files: createdMarker.scene.files ? createdMarker.scene.files.map((f: { width?: number; height?: number; path?: string }) => ({
          id: '',
          path: f.path || '',
          width: f.width,
          height: f.height,
        })) : existingScene.files,
      } as Scene,
    };
  }

  protected openAddTagDialog(): void {
    this.openMarkerDialog('add');
  }

  protected async removeTagAction(tagId: string, tagName: string): Promise<boolean> {
    const api = this.api;
    if (!api) {
      showToast('API not available.');
      return false;
    }

    if (this.isWholeSceneSyntheticContent()) {
      return this.removeTagFromScene(api, tagId, tagName);
    }

    if (!this.isRealMarker()) {
      showToast('Cannot remove tag from synthetic marker. Please create the marker first.');
      return false;
    }

    return this.removeTagFromMarker(api, tagId, tagName);
  }

  private getTagIds<T extends { id?: string | null }>(tags: T[] | undefined): string[] {
    return (tags || [])
      .map((tag) => tag.id)
      .filter((id): id is string => id !== null && id !== undefined)
      .map(String);
  }

  private removeTagFromList<T extends { id?: string | null }>(tags: T[], tagId: string): T[] {
    return tags.filter((tag) => String(tag.id) !== String(tagId));
  }

  private async removeTagFromScene(api: StashAPI, tagId: string, tagName: string): Promise<boolean> {
    const sceneId = this.data.marker.scene?.id;
    if (!sceneId) {
      showToast('Scene ID not available.');
      return false;
    }

    const currentTagIds = this.getTagIds(this.data.marker.scene.tags);
    if (!currentTagIds.includes(String(tagId))) {
      showToast(`Tag "${tagName}" is not on this scene.`);
      return false;
    }

    try {
      await api.removeTagFromScene(sceneId, tagId);
      const sceneTags = this.data.marker.scene.tags ?? [];
      this.data.marker.scene.tags = this.removeTagFromList(sceneTags, tagId);
      showToast(`Tag "${tagName}" removed from scene`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error('Failed to remove tag from scene', error);
      showToast('Failed to remove tag. Please try again.');
      return false;
    }
  }

  private async removeTagFromMarker(api: StashAPI, tagId: string, tagName: string): Promise<boolean> {
    const primaryTagId = this.data.marker.primary_tag?.id;
    if (primaryTagId && String(primaryTagId) === String(tagId)) {
      const availableTags = (this.data.marker.tags || []).filter((tag) => tag.id);
      if (availableTags.length === 0) {
        showToast('Add another tag before removing the primary tag.');
        return false;
      }

      const nextPrimary = availableTags[0];
      const remainingTags = availableTags.filter((tag) => String(tag.id) !== String(nextPrimary.id));
      const remainingTagIds = remainingTags.map((tag) => String(tag.id));

      try {
        await api.updateMarkerTagsWithPrimary(this.data.marker, String(nextPrimary.id), remainingTagIds);
        this.data.marker.primary_tag = { id: String(nextPrimary.id), name: nextPrimary.name };
        this.data.marker.tags = remainingTags;
        showToast(`Primary tag changed to "${nextPrimary.name}"`);
        this.refreshHeader();
        return true;
      } catch (error) {
        console.error('Failed to remove primary tag from marker', error);
        showToast('Failed to remove tag. Please try again.');
        return false;
      }
    }

    const currentTagIds = this.getTagIds(this.data.marker.tags);
    if (!currentTagIds.includes(String(tagId))) {
      showToast(`Tag "${tagName}" is not on this marker.`);
      return false;
    }

    try {
      await api.removeTagFromMarker(this.data.marker, tagId);
      const markerTags = this.data.marker.tags ?? [];
      this.data.marker.tags = this.removeTagFromList(markerTags, tagId);
      showToast(`Tag "${tagName}" removed from marker`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error('Failed to remove tag from marker', error);
      showToast('Failed to remove tag. Please try again.');
      return false;
    }
  }

  protected async removePerformerAction(performerId: string, performerName: string): Promise<boolean> {
    if (!this.api) {
      showToast('API not available.');
      return false;
    }

    const sceneId = this.data.marker.scene?.id;
    if (!sceneId) {
      showToast('Scene ID not available.');
      return false;
    }

    const currentPerformerIds = extractValidPerformerIds(this.data.marker.scene.performers || []);

    if (!currentPerformerIds.includes(performerId)) {
      showToast(`Performer "${performerName}" is not on this scene.`);
      return false;
    }

    try {
      const nextPerformerIds = currentPerformerIds.filter((id) => id !== performerId);
      await this.api.updateScenePerformers(sceneId, nextPerformerIds);

      this.data.marker.scene.performers = (this.data.marker.scene.performers || []).filter(
        (performer) => performer.id !== performerId
      );
      showToast(`Performer "${performerName}" removed from scene`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error('Failed to remove performer from scene', error);
      showToast('Failed to remove performer. Please try again.');
      return false;
    }
  }

  private async addTagToMarker(): Promise<void> {
    if (!this.api || !this.selectedTagId || !this.selectedTagName) return;
    if (!this.markerDialogCreateButton) return;

    const isWholeSceneSynthetic = this.isWholeSceneSyntheticContent();

    if (isWholeSceneSynthetic) {
      if (!this.data.marker.scene?.id) {
        showToast('Scene ID not available.');
        return;
      }

      this.markerDialogCreateButton.disabled = true;
      this.markerDialogCreateButton.textContent = 'Adding...';
      this.markerDialogCreateButton.style.opacity = '0.6';

      try {
        const currentTagIds = (this.data.marker.scene.tags || []).map(t => t.id).filter(Boolean);
        if (currentTagIds.includes(this.selectedTagId)) {
          showToast(`Tag "${this.selectedTagName}" is already added to this scene.`);
          this.resetMarkerDialogButton();
          return;
        }

        await this.api.addTagToScene(this.data.marker.scene.id, this.selectedTagId);

        this.data.marker.scene.tags ??= [];
        
        this.data.marker.scene.tags.push({ id: this.selectedTagId, name: this.selectedTagName });

        showToast(`Tag "${this.selectedTagName}" added to scene`);
        
        this.refreshHeader();
        
        this.closeMarkerDialog();
      } catch (error) {
        console.error('Failed to add tag to scene', error);
        showToast('Failed to add tag. Please try again.');
        this.resetMarkerDialogButton();
      }
      return;
    }

    if (!this.isRealMarker()) {
      showToast('Cannot add tag to synthetic marker. Please create the marker first.');
      return;
    }

    this.markerDialogCreateButton.disabled = true;
    this.markerDialogCreateButton.textContent = 'Adding...';
    this.markerDialogCreateButton.style.opacity = '0.6';

    try {
      const currentTagIds = (this.data.marker.tags || []).map(t => t.id);
      if (currentTagIds.includes(this.selectedTagId)) {
        showToast(`Tag "${this.selectedTagName}" is already added to this marker.`);
        this.resetMarkerDialogButton();
        return;
      }

      await this.api.addTagToMarker(this.data.marker, this.selectedTagId);

      this.data.marker.tags ??= [];
      
      this.data.marker.tags.push({ id: this.selectedTagId, name: this.selectedTagName });

      showToast(`Tag "${this.selectedTagName}" added to marker`);
      
      this.refreshHeader();
      
      this.closeMarkerDialog();
    } catch (error) {
      console.error('Failed to add tag to marker', error);
      showToast('Failed to add tag. Please try again.');
      this.markerDialogCreateButton.disabled = false;
      this.markerDialogCreateButton.textContent = 'Add';
      this.markerDialogCreateButton.style.opacity = '1';
    }
  }

  private adjustDialogPosition(dialog: HTMLElement): void {
    if (!dialog || !this.container) return;

    const dialogRect = dialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width;
    
    const cardContainer = this.container.closest('.video-post, .image-post');
    if (!cardContainer) return;
    
    const cardRect = cardContainer.getBoundingClientRect();
    
    const buttonGroup = (this.markerButton || this.addTagButton)?.parentElement;
    if (!buttonGroup) return;
    
    const buttonGroupRect = buttonGroup.getBoundingClientRect();
    
    const buttonCenterX = buttonGroupRect.left + buttonGroupRect.width / 2 - cardRect.left;
    const dialogHalfWidth = dialogWidth / 2;
    
    const minLeft = dialogHalfWidth + 16;
    const maxLeft = cardRect.width - dialogHalfWidth - 16;
    
    let desiredLeft = buttonCenterX;
    
    let offsetX = 0;
    if (desiredLeft < minLeft) {
      offsetX = minLeft - buttonCenterX;
    } else if (desiredLeft > maxLeft) {
      offsetX = maxLeft - buttonCenterX;
    }
    
    dialog.style.left = '50%';
    dialog.style.transform = `translateX(calc(-50% + ${offsetX}px)) translateY(0) scale(1)`;
  }

  protected async doAddPerformerApiCall(performerId: string, performerName: string): Promise<void> {
    const sceneId = this.data.marker.scene.id;
    const currentIds = extractValidPerformerIds(this.data.marker.scene.performers ?? []);
    await this.api!.updateScenePerformers(sceneId, [...currentIds, performerId]);
    this.data.marker.scene.performers = [
      ...(this.data.marker.scene.performers ?? []),
      { id: performerId, name: performerName, image_path: this.selectedPerformerImagePath },
    ];
  }

  destroy(): void {
    this.stopWatchTracking();
    this.closeMarkerDialog(false);

    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }

    super.destroy();
  }
}
