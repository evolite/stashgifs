import { ImageVideoPostData, IVideoPlayer } from './types.js';
import { calculateAspectRatio, getAspectRatioClass, normalizeMediaUrl, toAbsoluteUrl } from './utils.js';
import { VideoPostBase, BaseVideoPostOptions } from './VideoPostBase.js';
interface ImageVideoPostOptions extends BaseVideoPostOptions {}

export class ImageVideoPost extends VideoPostBase {
  protected readonly data: ImageVideoPostData;
  private player?: IVideoPlayer;

  constructor(
    container: HTMLElement,
    data: ImageVideoPostData,
    options?: ImageVideoPostOptions
  ) {
    super(container, options);
    this.data = data;
    this.onMuteToggle = options?.onMuteToggle;
    this.getGlobalMuteState = options?.getGlobalMuteState;
    this.hdModeFromSettings = options?.hdModeFromSettings === true;
    this.initImagePostOptions(this.data.image.o_counter, options?.ratingSystemConfig);
    this.render();
  }

  private render(): void {
    this.renderImageBasedPost('video-post', this.data.image.id, () => this.createPlayerContainer(), () => this.createFooter());
  }

  private createPlayerContainer(): HTMLElement {
    let aspectRatio: number | undefined;
    let aspectRatioClass = 'aspect-16-9';
    if (this.data.image.width && this.data.image.height && this.data.image.height > 0) {
      aspectRatio = calculateAspectRatio(this.data.image.width, this.data.image.height);
      aspectRatioClass = getAspectRatioClass(aspectRatio);
    } else if (this.data.aspectRatio && Number.isFinite(this.data.aspectRatio)) {
      aspectRatio = this.data.aspectRatio;
      if (aspectRatio !== undefined) {
        aspectRatioClass = getAspectRatioClass(aspectRatio);
      }
    }

    return this.createVideoPlayerContainer(aspectRatio, aspectRatioClass);
  }

  private createFooter(): HTMLElement {
    const { footer, buttonGroup } = this.buildFooterContainer();
    this.buttonGroup = buttonGroup;

    this.appendCommonImageFooterButtons(buttonGroup, this.data.image.id);

    if (this.api && !this.isHQMode && !this.hdModeFromSettings) {
      this.hqButton = this.createHQButton();
      buttonGroup.appendChild(this.hqButton);
    }

    const muteBtn = this.createMuteOverlayButton();
    buttonGroup.appendChild(muteBtn);

    this.appendImageButtons(buttonGroup, this.data.image.id);

    return footer;
  }

  protected getHQAriaLabel(): string {
    return 'Load high-quality video with audio';
  }

  protected getHQTitle(): string {
    return 'Load HD video';
  }

  protected performHQUpgrade(): void {
    this.upgradeToHDVideo();
  }

  public override setHQMode(isHQ: boolean): void {
    super.setHQMode(isHQ);
    if (this.player && this.getGlobalMuteState) {
      const shouldBeMuted = this.getGlobalMuteState();
      this.player.setMuted(shouldBeMuted);
    }
  }

  private upgradeToHDVideo(): void {
    if (!this.api) {
      throw new Error('API not available');
    }

    const imagePath = this.data.image.paths?.image;
    if (!imagePath) {
      throw new Error('Image video URL not available');
    }
    const resolvedVideoUrl = imagePath.startsWith('http') 
      ? imagePath 
      : toAbsoluteUrl(imagePath);
    const hdVideoUrl = normalizeMediaUrl(resolvedVideoUrl);
    
    if (!hdVideoUrl) {
      throw new Error('Image video URL not available');
    }

    const { playerContainer } = this.capturePlayerState();

    this.destroyCurrentPlayer();

    this.cleanupPlayerElements(playerContainer);

    this.createHDVideoPlayer(playerContainer, hdVideoUrl);

    this.notifyPlayerReady();
  }

  private createHDVideoPlayer(playerContainer: HTMLElement, hdVideoUrl: string): void {
    try {
      const shouldBeMuted = this.getGlobalMuteState ? this.getGlobalMuteState() : true;
      this.player = this.createVideoPlayer(playerContainer, hdVideoUrl, {
        muted: shouldBeMuted,
        startTime: undefined,
        endTime: undefined,
      });

      this.isLoaded = true;
      this.attachLoadErrorHandler();
      this.attachReelAutoAdvance();
      this.setupProgressBar();
    } catch (error) {
      console.error('ImageVideoPost: Failed to create HD video player', {
        error,
        hdVideoUrl,
        imageId: this.data.image.id,
      });
      throw error;
    }
  }

  private notifyPlayerReady(): void {
    if (this.data.image.id && this.player) {
      this.onPlayerReady?.(this.data.image.id);
    }
  }

  private destroyCurrentPlayer(): void {
    if (this.player) {
      this.detachLoadErrorHandler();
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;
  }

  private cleanupPlayerElements(container: HTMLElement): void {
    const videoElements = container.querySelectorAll('video');
    for (const video of videoElements) {
      video.remove();
    }
  }

  loadPlayer(videoUrl: string): IVideoPlayer | undefined {
    if (this.isLoaded) {
      return this.player;
    }

    if (!this.playerContainer) {
      console.error('ImageVideoPost: Player container not found');
      return undefined;
    }

    try {
      const finalStartTime = undefined;

      const shouldBeMuted = this.isHQMode && this.getGlobalMuteState
        ? this.getGlobalMuteState()
        : true;
      this.player = this.createVideoPlayer(this.playerContainer, videoUrl, {
        muted: shouldBeMuted,
        startTime: finalStartTime,
        endTime: undefined,
      });

      this.isLoaded = true;
      this.attachLoadErrorHandler();
      this.attachReelAutoAdvance();
      this.setupProgressBar();

    } catch (error) {
      console.error('ImageVideoPost: Failed to create video player', {
        error,
        videoUrl,
        imageId: this.data.image.id,
      });
      return undefined;
    }

    return this.player;
  }

  protected applyMuteButtonHQState(btn: HTMLElement): void {
    if (this.isHQMode) {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    } else {
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
    }
  }

  getPlayer(): IVideoPlayer | undefined {
    return this.player;
  }

  protected getHQButtonOffLabel(): string {
    return 'Load HD video';
  }

  hasVideoSource(): boolean {
    return !!this.data.videoUrl;
  }

  preload(): IVideoPlayer | undefined {
    const videoUrl = this.data.videoUrl;
    if (!videoUrl) {
      return undefined;
    }
    const reloaded = this.attemptReloadIfUnloaded();
    if (reloaded) {
      this.attachReelAutoAdvance();
      return reloaded;
    }

    return this.loadPlayer(videoUrl);
  }

  getPostId(): string {
    return this.data.image.id;
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  destroy(): void {
    if (this.player) {
      if (!this.player.getIsUnloaded()) this.player.unload();
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;
    super.destroy();
  }
}
