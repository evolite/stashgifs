/**
 * Image Player
 * Displays GIFs, static images, and looping videos with support for looping and fullscreen
 */

import { isVideoFile, setupLoopingVideoElement } from './utils.js';

export class ImagePlayer {
  private readonly container: HTMLElement;
  private imageElement?: HTMLImageElement;
  private videoElement?: HTMLVideoElement;
  private readonly imageUrl: string;
  private readonly isGif: boolean;
  private readonly isVideo: boolean;
  private readonly videoCodec?: string;
  private isLoaded: boolean = false;
  private loadingIndicator?: HTMLElement;
  private wrapper?: HTMLElement;
  private errorMessage?: HTMLElement;

  constructor(container: HTMLElement, imageUrl: string, options?: {
    isGif?: boolean;
    isVideo?: boolean;
    videoCodec?: string;
  }) {
    this.container = container;
    this.imageUrl = imageUrl;
    // Use provided isVideo option, or detect from URL extension
    this.isVideo = options?.isVideo ?? isVideoFile(imageUrl);
    this.isGif = options?.isGif ?? (!this.isVideo && imageUrl.toLowerCase().endsWith('.gif'));
    
    // Store video codec for MIME type detection
    this.videoCodec = options?.videoCodec;
    
    this.createMediaElement();
  }

  private createMediaElement(): void {
    // Create loading indicator (reused for both image and video)
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
    
    const wrapper = document.createElement('div');
    wrapper.className = 'image-player';
    wrapper.style.position = 'absolute';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.zIndex = '1';
    wrapper.style.backgroundColor = 'transparent';
    
    // Create video or image element based on file type
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
    this.imageElement.style.objectFit = 'cover';
    this.imageElement.style.display = 'block';
    
    wrapper.appendChild(this.imageElement);

    // Handle image load
    this.imageElement.addEventListener('load', () => {
      this.isLoaded = true;
      this.hideLoadingIndicator();
    }, { once: true });

    this.imageElement.addEventListener('error', () => {
      this.hideLoadingIndicator();
      console.error('ImagePlayer: Failed to load image', this.imageUrl);
    }, { once: true });

    // Set src to start loading
    this.imageElement.src = this.imageUrl;
  }

  private createVideoElement(wrapper: HTMLElement): void {
    this.videoElement = document.createElement('video');
    this.videoElement.className = 'image-player__element';
    
    // Setup looping video properties (reused utility function)
    setupLoopingVideoElement(this.videoElement);
    
    // Try to determine MIME type from URL extension or codec to help browser decode correctly
    const lowerUrl = this.imageUrl.toLowerCase();
    let mimeType: string | undefined;
    
    // Check codec first (more reliable)
    if (this.videoCodec) {
      const lowerCodec = this.videoCodec.toLowerCase();
      if (lowerCodec.includes('prores')) {
        mimeType = 'video/quicktime'; // ProRes is typically in MOV/QuickTime container
      } else if (lowerCodec.includes('h264') || lowerCodec.includes('avc')) {
        mimeType = 'video/mp4';
      } else if (lowerCodec.includes('vp8') || lowerCodec.includes('vp9')) {
        mimeType = 'video/webm';
      }
    }
    
    // Fall back to URL extension if codec didn't help
    if (!mimeType) {
      if (lowerUrl.includes('.mov') || lowerUrl.includes('quicktime')) {
        mimeType = 'video/quicktime';
      } else if (lowerUrl.includes('.mp4') || lowerUrl.includes('.m4v')) {
        mimeType = 'video/mp4';
      } else if (lowerUrl.includes('.webm')) {
        mimeType = 'video/webm';
      } else if (lowerUrl.includes('.mkv')) {
        mimeType = 'video/x-matroska';
      } else if (lowerUrl.includes('.avi')) {
        mimeType = 'video/x-msvideo';
      } else if (lowerUrl.includes('.wmv')) {
        mimeType = 'video/x-ms-wmv';
      } else if (lowerUrl.includes('.flv') || lowerUrl.includes('.f4v')) {
        mimeType = 'video/x-flv';
      }
    }
    
    // Set type attribute to help browser decode
    if (mimeType) {
      this.videoElement.setAttribute('type', mimeType);
    }
    
    wrapper.appendChild(this.videoElement);

    // Handle video load events
    const handleLoadedData = () => {
      this.isLoaded = true;
      this.hideLoadingIndicator();
      
      // Try to play the video (autoplay might be blocked)
      if (this.videoElement) {
        this.videoElement.play().catch(() => {
          // Autoplay blocked - video will play when user interacts
        });
      }
    };

    this.videoElement.addEventListener('loadeddata', handleLoadedData, { once: true });
    this.videoElement.addEventListener('canplay', handleLoadedData, { once: true });

    this.videoElement.addEventListener('error', () => {
      this.hideLoadingIndicator();
      this.showVideoError();
    }, { once: true });

    // Set src to start loading
    this.videoElement.src = this.imageUrl;
  }

  private hideLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'none';
    }
  }

  /**
   * Show error message when video fails to load
   */
  private showVideoError(): void {
    if (this.errorMessage || !this.wrapper) {
      return;
    }

    // Determine error message based on codec
    let message = 'Video format not supported';
    let details = 'This video cannot be played in your browser.';
    
    if (this.videoCodec) {
      const lowerCodec = this.videoCodec.toLowerCase();
      if (lowerCodec.includes('prores')) {
        message = 'ProRes codec not supported';
        details = 'This video uses ProRes codec which is not supported in web browsers. Please transcode to H.264/MP4 for web playback.';
      } else if (lowerCodec.includes('hevc') || lowerCodec.includes('h.265') || lowerCodec.includes('h265')) {
        message = 'HEVC/H.265 codec not supported';
        details = 'This video uses HEVC codec which may not be supported in all browsers.';
      }
    }

    // Create error message element
    this.errorMessage = document.createElement('div');
    this.errorMessage.className = 'image-player__error';
    this.errorMessage.style.position = 'absolute';
    this.errorMessage.style.top = '0';
    this.errorMessage.style.left = '0';
    this.errorMessage.style.width = '100%';
    this.errorMessage.style.height = '100%';
    this.errorMessage.style.display = 'flex';
    this.errorMessage.style.flexDirection = 'column';
    this.errorMessage.style.alignItems = 'center';
    this.errorMessage.style.justifyContent = 'center';
    this.errorMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    this.errorMessage.style.color = 'rgba(255, 255, 255, 0.9)';
    this.errorMessage.style.padding = '20px';
    this.errorMessage.style.boxSizing = 'border-box';
    this.errorMessage.style.textAlign = 'center';
    this.errorMessage.style.zIndex = '3';

    // Error icon/text
    const errorIcon = document.createElement('div');
    errorIcon.textContent = '⚠️';
    errorIcon.style.fontSize = '48px';
    errorIcon.style.marginBottom = '16px';
    this.errorMessage.appendChild(errorIcon);

    // Error title
    const errorTitle = document.createElement('div');
    errorTitle.textContent = message;
    errorTitle.style.fontSize = '18px';
    errorTitle.style.fontWeight = '600';
    errorTitle.style.marginBottom = '8px';
    this.errorMessage.appendChild(errorTitle);

    // Error details
    const errorDetails = document.createElement('div');
    errorDetails.textContent = details;
    errorDetails.style.fontSize = '14px';
    errorDetails.style.color = 'rgba(255, 255, 255, 0.7)';
    errorDetails.style.lineHeight = '1.5';
    errorDetails.style.maxWidth = '400px';
    this.errorMessage.appendChild(errorDetails);

    // Add codec info if available
    if (this.videoCodec) {
      const codecInfo = document.createElement('div');
      codecInfo.textContent = `Codec: ${this.videoCodec}`;
      codecInfo.style.fontSize = '12px';
      codecInfo.style.color = 'rgba(255, 255, 255, 0.5)';
      codecInfo.style.marginTop = '12px';
      this.errorMessage.appendChild(codecInfo);
    }

    this.wrapper.appendChild(this.errorMessage);
  }

  /**
   * Get the image element (for images) or video element (for videos)
   */
  getImageElement(): HTMLImageElement | HTMLVideoElement {
    if (this.isVideo && this.videoElement) {
      return this.videoElement;
    }
    if (this.imageElement) {
      return this.imageElement;
    }
    throw new Error('Media element is not initialized');
  }

  /**
   * Check if media is loaded
   */
  isImageLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Check if this is a GIF
   */
  getIsGif(): boolean {
    return this.isGif;
  }

  /**
   * Check if this is a video
   */
  getIsVideo(): boolean {
    return this.isVideo;
  }

  /**
   * Destroy the player
   */
  destroy(): void {
    if (this.wrapper) {
      this.wrapper.remove();
      this.wrapper = undefined;
    }
    
    // Clean up video element
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.load();
      this.videoElement = undefined;
    }
    
    this.imageElement = undefined;
    this.loadingIndicator = undefined;
    this.errorMessage = undefined;
    this.isLoaded = false;
  }
}

