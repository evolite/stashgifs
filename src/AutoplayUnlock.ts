import { isMobileDevice } from './utils.js';

const GESTURE_EVENTS = ['touchend', 'click', 'keydown'] as const;

const UNLOCK_VIDEO_SRC = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAbxtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTA6';

export class AutoplayUnlock {
  private gestureHandler?: () => void;
  private unlockHandler?: () => void;
  private visibilityHandler?: () => void;

  constructor(private readonly retryActive: () => void) {}

  start(): void {
    if (this.gestureHandler) return;

    this.gestureHandler = () => this.retryActive();
    for (const event of GESTURE_EVENTS) document.addEventListener(event, this.gestureHandler, { passive: true });

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') this.retryActive();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    if (isMobileDevice()) this.armMobileUnlock();
  }

  stop(): void {
    if (this.gestureHandler) {
      for (const event of GESTURE_EVENTS) document.removeEventListener(event, this.gestureHandler);
      this.gestureHandler = undefined;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = undefined;
    }
    this.disarmMobileUnlock();
  }

  private armMobileUnlock(): void {
    this.unlockHandler = () => {
      this.disarmMobileUnlock();
      void this.playUnlockVideo();
    };
    for (const event of GESTURE_EVENTS) document.addEventListener(event, this.unlockHandler, { once: true, passive: true });
  }

  private disarmMobileUnlock(): void {
    if (!this.unlockHandler) return;
    for (const event of GESTURE_EVENTS) document.removeEventListener(event, this.unlockHandler);
    this.unlockHandler = undefined;
  }

  private async playUnlockVideo(): Promise<void> {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.style.cssText = 'display:none;width:1px;height:1px;position:absolute;opacity:0;pointer-events:none';
    video.src = UNLOCK_VIDEO_SRC;
    document.body.appendChild(video);

    try {
      await video.play();
      setTimeout(() => this.retryActive(), 100);
    } catch (e) {
      console.debug('Autoplay unlock failed, user will need to interact', e);
    } finally {
      setTimeout(() => video.remove(), 1000);
    }
  }
}
