/**
 * Image Player
 * Displays GIFs and static images with support for looping and fullscreen
 */

export class ImagePlayer {
  private readonly container: HTMLElement;
  private imageElement?: HTMLImageElement;
  private readonly imageUrl: string;
  private readonly isGif: boolean;
  private isLoaded: boolean = false;
  private loadingIndicator?: HTMLElement;
  private wrapper?: HTMLElement;

  constructor(container: HTMLElement, imageUrl: string, options?: {
    isGif?: boolean;
  }) {
    this.container = container;
    this.imageUrl = imageUrl;
    this.isGif = options?.isGif ?? imageUrl.toLowerCase().endsWith('.gif');
    
    this.createImageElement();
  }

  private createImageElement(): void {
    this.imageElement = document.createElement('img');
    this.imageElement.className = 'image-player__element';
    this.imageElement.style.width = '100%';
    this.imageElement.style.height = '100%';
    this.imageElement.style.objectFit = 'cover';
    this.imageElement.style.display = 'block';
    
    // Create loading indicator
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
    
    wrapper.appendChild(this.imageElement);
    wrapper.appendChild(this.loadingIndicator);
    this.wrapper = wrapper;
    this.container.appendChild(wrapper);

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

  private hideLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'none';
    }
  }

  /**
   * Get the image element
   */
  getImageElement(): HTMLImageElement {
    if (!this.imageElement) {
      throw new Error('Image element is not initialized');
    }
    return this.imageElement;
  }

  /**
   * Check if image is loaded
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
   * Destroy the player
   */
  destroy(): void {
    if (this.wrapper) {
      this.wrapper.remove();
      this.wrapper = undefined;
    }
    this.imageElement = undefined;
    this.loadingIndicator = undefined;
    this.isLoaded = false;
  }
}

