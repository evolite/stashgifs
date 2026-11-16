import { addCacheBusting, normalizeMediaUrl, setupLoopingVideoElement, THEME, subscribeWindowScroll, createFullscreenWrapper, createCoverDiv } from './utils.js';

export class ImagePlayer {
  private readonly container: HTMLElement;
  private imageElement?: HTMLImageElement;
  private videoElement?: HTMLVideoElement;
  private readonly imageUrl: string;
  private readonly isGif: boolean;
  private readonly isVideo: boolean;
  private readonly objectFit: 'cover' | 'contain' = 'contain';
  private hasRetried: boolean = false;
  private loadingIndicator?: HTMLElement;
  private wrapper?: HTMLElement;
  private errorMessage?: HTMLElement;
  private interactionScrollCleanup?: () => void;

  constructor(container: HTMLElement, imageUrl: string, options?: {
    isGif?: boolean;
    isVideo?: boolean;
    objectFit?: 'cover' | 'contain';
  }) {
    this.container = container;
    this.imageUrl = imageUrl;
    this.isVideo = options?.isVideo ?? false;
    this.isGif = options?.isGif ?? (!this.isVideo && imageUrl.toLowerCase().endsWith('.gif'));
    if (options?.objectFit) this.objectFit = options.objectFit;
    
    this.createMediaElement();
  }

  private createMediaElement(): void {
    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.className = 'image-player__loading';
    this.loadingIndicator.style.display = 'flex';
    this.loadingIndicator.style.position = 'absolute';
    this.loadingIndicator.style.top = '50%';
    this.loadingIndicator.style.left = '50%';
    this.loadingIndicator.style.transform = 'translate(-50%, -50%)';
    this.loadingIndicator.style.zIndex = '2';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    this.loadingIndicator.appendChild(spinner);
    
    const wrapper = createFullscreenWrapper('image-player');
    
    if (this.isVideo) {
      this.createVideoElement(wrapper);
    } else {
      this.createImageElement(wrapper);
    }
    
    wrapper.appendChild(this.loadingIndicator);
    this.wrapper = wrapper;
    this.container.appendChild(wrapper);
  }

  private createImageElement(wrapper: HTMLElement): void {
    this.imageElement = document.createElement('img');
    this.imageElement.className = 'image-player__element';
    this.imageElement.style.width = '100%';
    this.imageElement.style.height = '100%';
    this.imageElement.style.objectFit = this.objectFit;
    this.imageElement.style.display = 'block';
    
    wrapper.appendChild(this.imageElement);

    const handleLoad = () => {
      this.hideLoadingIndicator();
    };

    const handleError = () => {
      this.hideLoadingIndicator();
      if (!this.hasRetried) {
        const retryUrl = this.getRetryUrl();
        if (retryUrl && retryUrl !== this.imageElement?.src) {
          this.hasRetried = true;
          this.showLoadingIndicator();
          this.setImageSource(retryUrl);
          return;
        }
      }
      console.error('ImagePlayer: Failed to load image', this.imageUrl);
    };

    this.imageElement.addEventListener('load', handleLoad);
    this.imageElement.addEventListener('error', handleError);

    this.setImageSource(this.imageUrl);
  }

  private createVideoElement(wrapper: HTMLElement): void {
    this.videoElement = document.createElement('video');
    this.videoElement.className = 'image-player__element';
    
    setupLoopingVideoElement(this.videoElement, { objectFit: this.objectFit });
    
    const urlLower = this.imageUrl.toLowerCase();
    if (urlLower.endsWith('.mp4') || urlLower.endsWith('.m4v')) {
      this.videoElement.setAttribute('type', 'video/mp4');
    } else {
      this.videoElement.setAttribute('type', 'video/webm');
    }
    
    wrapper.appendChild(this.videoElement);

    this.videoElement.muted = true;

    const tryPlay = async (): Promise<void> => {
      if (!this.videoElement) return;
      
      try {
        await this.videoElement.play();
        this.hideLoadingIndicator();
      } catch (error) {
        console.log('ImagePlayer: Autoplay blocked, will retry on visibility/interaction', error);
        this.hideLoadingIndicator();
      }
    };

    const handleVideoReady = () => {
      this.hideLoadingIndicator();
      void tryPlay();
    };

    this.videoElement.addEventListener('loadeddata', handleVideoReady, { once: true });
    this.videoElement.addEventListener('canplay', handleVideoReady, { once: true });
    this.videoElement.addEventListener('canplaythrough', handleVideoReady, { once: true });

    this.videoElement.addEventListener('error', (e) => {
      this.hideLoadingIndicator();
      if (!this.hasRetried) {
        const retryUrl = this.getRetryUrl();
        if (retryUrl && retryUrl !== this.videoElement?.src) {
          this.hasRetried = true;
          this.showLoadingIndicator();
          this.setVideoSource(retryUrl);
          void tryPlay();
          return;
        }
      }
      const error = this.videoElement?.error;
      console.error('ImagePlayer: Video error', e, error, {
        code: error?.code,
        message: error?.message,
        url: this.imageUrl,
      });
      
      this.showVideoError('Failed to load video', 
        'The video failed to load. This may be due to network issues, CORS restrictions, or file corruption. Please check the console for details.');
    });

    this.setupVisibilityPlayback(wrapper);

    this.setupInteractionPlayback();

    this.setVideoSource(this.imageUrl);
  }

  private getRetryUrl(): string | undefined {
    const normalized = normalizeMediaUrl(this.imageUrl);
    if (!normalized) return undefined;
    return addCacheBusting(normalized);
  }

  private setImageSource(url: string): void {
    if (!this.imageElement) return;
    const normalized = normalizeMediaUrl(url);
    if (!normalized) {
      this.hideLoadingIndicator();
      console.warn('ImagePlayer: Invalid image URL, skipping', { url });
      return;
    }
    this.imageElement.src = normalized;
  }

  private setVideoSource(url: string): void {
    if (!this.videoElement) return;
    const normalized = normalizeMediaUrl(url);
    if (!normalized) {
      this.hideLoadingIndicator();
      console.warn('ImagePlayer: Invalid video URL, skipping', { url });
      return;
    }
    this.videoElement.src = normalized;
    this.videoElement.load();
  }

  private showLoadingIndicator(): void {
    if (!this.loadingIndicator) return;
    this.loadingIndicator.style.display = 'flex';
  }

  private setupVisibilityPlayback(wrapper: HTMLElement): void {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && this.videoElement?.paused) {
            this.videoElement.play().catch((error) => {
              console.log('ImagePlayer: Play failed on visibility', error);
            });
          } else if (!entry.isIntersecting && this.videoElement && !this.videoElement.paused) {
            this.videoElement.pause();
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(wrapper);

    (wrapper as any).__videoObserver = observer;
  }

  private setupInteractionPlayback(): void {
    if (!this.videoElement) return;

    const tryPlayOnInteraction = () => {
      if (this.videoElement?.paused) {
        this.videoElement.play().catch((error) => {
          console.log('ImagePlayer: Play failed on interaction', error);
        });
      }
    };

    let scrollTimeout: ReturnType<typeof setTimeout> | undefined;
    const handleScroll = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        tryPlayOnInteraction();
      }, 100);
    };

    const handleInteraction = () => {
      tryPlayOnInteraction();
    };

    this.interactionScrollCleanup = subscribeWindowScroll(handleScroll);
    globalThis.addEventListener('touchstart', handleInteraction, { passive: true, once: true });
    globalThis.addEventListener('click', handleInteraction, { once: true });

    (this.videoElement as any).__interactionCleanup = () => {
      if (this.interactionScrollCleanup) {
        this.interactionScrollCleanup();
        this.interactionScrollCleanup = undefined;
      }
      globalThis.removeEventListener('touchstart', handleInteraction);
      globalThis.removeEventListener('click', handleInteraction);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }

  private hideLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'none';
    }
  }

  private showVideoError(customMessage: string = 'Failed to load video', customDetails: string = 'The video failed to load. This may be due to network issues, CORS restrictions, or file corruption.'): void {
    if (this.errorMessage || !this.wrapper || this.isGif) {
      return;
    }

    const message = customMessage;
    const details = customDetails;

    this.errorMessage = createCoverDiv('image-player__error');
    this.errorMessage.style.display = 'flex';
    this.errorMessage.style.flexDirection = 'column';
    this.errorMessage.style.alignItems = 'center';
    this.errorMessage.style.justifyContent = 'center';
    this.errorMessage.style.backgroundColor = THEME.colors.overlay;
    this.errorMessage.style.color = THEME.colors.textPrimary;
    this.errorMessage.style.padding = '20px';
    this.errorMessage.style.boxSizing = 'border-box';
    this.errorMessage.style.textAlign = 'center';
    this.errorMessage.style.zIndex = '3';

    const errorIcon = document.createElement('div');
    errorIcon.textContent = '⚠️';
    errorIcon.style.fontSize = '48px';
    errorIcon.style.marginBottom = '16px';
    this.errorMessage.appendChild(errorIcon);

    const errorTitle = document.createElement('div');
    errorTitle.textContent = message;
    errorTitle.style.fontSize = '18px';
    errorTitle.style.fontWeight = '600';
    errorTitle.style.marginBottom = '8px';
    this.errorMessage.appendChild(errorTitle);

    const errorDetails = document.createElement('div');
    errorDetails.textContent = details;
    errorDetails.style.fontSize = '14px';
    errorDetails.style.color = THEME.colors.textSecondary;
    errorDetails.style.lineHeight = '1.5';
    errorDetails.style.maxWidth = '400px';
    this.errorMessage.appendChild(errorDetails);

    this.wrapper.appendChild(this.errorMessage);
  }

  destroy(): void {
    if (this.wrapper) {
      const observer = (this.wrapper as any).__videoObserver;
      if (observer) {
        observer.disconnect();
      }
    }
    
    if (this.videoElement) {
      const cleanup = (this.videoElement as any).__interactionCleanup;
      if (cleanup) {
        cleanup();
      }
    }
    
    if (this.wrapper) {
      this.wrapper.remove();
      this.wrapper = undefined;
    }
    
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
      this.videoElement = undefined;
    }
    
    this.imageElement = undefined;
    this.loadingIndicator = undefined;
    this.errorMessage = undefined;
  }
}
