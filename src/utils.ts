import { Image } from './types.js';
import { getStashBaseUrl, stripSlashes } from './utils/baseUrl.js';

export const THEME_DEFAULTS = {
  backgroundPrimary: '#1F2A33',
  backgroundSecondary: '#24323C',
  surface: '#2C3B46',
  accentPrimary: '#4FA3D1',
};

export const THEME = {
  colors: {
    backgroundPrimary: THEME_DEFAULTS.backgroundPrimary,
    backgroundSecondary: THEME_DEFAULTS.backgroundSecondary,
    surface: THEME_DEFAULTS.surface,
    border: '#3A4A55',
    textPrimary: '#E6EEF4',
    textSecondary: '#B4C0C9',
    textMuted: '#8A99A6',
    accentPrimary: THEME_DEFAULTS.accentPrimary,
    ratingHigh: '#E53935',
    ratingMedium: '#F39C12',
    ratingLow: '#F1C40F',
    success: '#2ECC71',
    danger: '#E85C5C',
    iconInactive: '#9FB0BC',
    iconActive: '#E6EEF4',
    overlay: 'rgba(31, 42, 51, 0.96)',
    overlayMuted: 'rgba(36, 50, 60, 0.96)',
    surfaceHover: '#324351',
  },
  typography: {
    fontFamily: '"Manrope", "Space Grotesk", "Sora", system-ui, -apple-system, "Segoe UI", sans-serif',
    lineHeight: '1.5',
    lineHeightTight: '1.4',
    sizeTitle: '16px',
    sizeBody: '14px',
    sizeMeta: '12px',
    sizeControl: '13px',
    weightTitle: '600',
    weightBody: '400',
    weightBodyStrong: '500',
    weightMeta: '400',
  },
  spacing: {
    cardPadding: '14px',
    cardGap: '16px',
  },
  radius: {
    card: '8px',
    button: '6px',
    tag: '4px',
  },
  icon: {
    size: '16px',
    sizeLarge: '18px',
  },
};

export function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : fallback;
}

export function toRgba(hex: string, alpha: number): string {
  const normalized = normalizeHexColor(hex, '#000000');
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darkenHex(hex: string, fraction: number): string {
  const value = hex.replace('#', '');
  const r = Math.round(Number.parseInt(value.slice(0, 2), 16) * (1 - fraction));
  const g = Math.round(Number.parseInt(value.slice(2, 4), 16) * (1 - fraction));
  const b = Math.round(Number.parseInt(value.slice(4, 6), 16) * (1 - fraction));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function throttle<T extends (...args: never[]) => unknown>(
  func: T,
  delay: number
): T {
  let lastCall = 0;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  }) as T;
}

export function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  delay: number
): T {
  let timeoutId: number | null = null;
  return ((...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = (globalThis.setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay) as unknown as number);
  }) as T;
}

const windowScrollSubscribers = new Set<() => void>();
let windowScrollRafId: number | undefined;
let windowScrollListenerAttached = false;
const windowScrollListener = () => {
  if (windowScrollRafId !== undefined) {
    return;
  }
  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((cb: FrameRequestCallback) => globalThis.setTimeout(cb, 16));
  windowScrollRafId = requestFrame(() => {
    windowScrollRafId = undefined;
    const handlers = Array.from(windowScrollSubscribers);
    for (const handler of handlers) {
      try {
        handler();
      } catch (error) {
        console.error('Window scroll handler failed', error);
      }
    }
  });
};

export function subscribeWindowScroll(handler: () => void): () => void {
  windowScrollSubscribers.add(handler);
  if (!windowScrollListenerAttached && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('scroll', windowScrollListener, { passive: true });
    windowScrollListenerAttached = true;
  }
  return () => {
    windowScrollSubscribers.delete(handler);
    if (windowScrollSubscribers.size === 0 && windowScrollListenerAttached && typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('scroll', windowScrollListener);
      windowScrollListenerAttached = false;
      if (windowScrollRafId !== undefined) {
        const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? ((id: number) => globalThis.clearTimeout(id));
        cancelFrame(windowScrollRafId);
        windowScrollRafId = undefined;
      }
    }
  };
}

export function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function calculateAspectRatio(width: number, height: number): number {
  return width / height;
}

export function getAspectRatioClass(aspectRatio: number): string {
  if (aspectRatio > 1.5) {
    return 'aspect-16-9';
  } else if (aspectRatio < 0.7) {
    return 'aspect-9-16';
  } else {
    return 'aspect-1-1';
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function showToast(message: string, duration: number = 2000): void {
  const existing = document.querySelector('.toast-notification');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = THEME.colors.overlay;
  toast.style.color = THEME.colors.textPrimary;
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = THEME.radius.button;
  toast.style.fontSize = THEME.typography.sizeBody;
  toast.style.fontFamily = THEME.typography.fontFamily;
  toast.style.zIndex = '10000';
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  toast.style.pointerEvents = 'none';
  toast.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, duration);
}

export interface DeviceCapabilities {
  isHighEnd: boolean;
  hasHighDPI: boolean;
  availableRAM: number;
  recommendedVideoQuality: '480p' | '720p' | '1080p';
  recommendedThumbnailWidth: number;
}

export function detectDeviceCapabilities(): DeviceCapabilities {
  const isMobile = isMobileDevice();
  const isTablet = /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent);
  
  const hasHighDPI = globalThis.devicePixelRatio > 1.5;
  
  const nav = navigator as Navigator & { deviceMemory?: number };
  let estimatedRAM: number;
  if (nav.deviceMemory) {
    estimatedRAM = nav.deviceMemory * 1024;
  } else if (isMobile) {
    estimatedRAM = 2048;
  } else if (isTablet) {
    estimatedRAM = 3072;
  } else {
    estimatedRAM = 4096;
  }
  
  const isHighEnd = estimatedRAM >= 3072 && hasHighDPI;
  
  let recommendedQuality: '480p' | '720p' | '1080p';
  if (estimatedRAM < 2048) {
    recommendedQuality = '480p';
  } else if (estimatedRAM >= 4096 && !isMobile) {
    recommendedQuality = '1080p';
  } else {
    recommendedQuality = '720p';
  }
  
  const viewportWidth = globalThis.innerWidth;
  let thumbnailWidth: number;
  if (recommendedQuality === '1080p') {
    thumbnailWidth = 800;
  } else if (recommendedQuality === '720p') {
    thumbnailWidth = 600;
  } else {
    thumbnailWidth = 400;
  }
  const finalThumbnailWidth = Math.min(
    Math.ceil(viewportWidth * (hasHighDPI ? 1.5 : 1)),
    thumbnailWidth
  );
  
  return {
    isHighEnd,
    hasHighDPI,
    availableRAM: estimatedRAM,
    recommendedVideoQuality: recommendedQuality,
    recommendedThumbnailWidth: finalThumbnailWidth,
  };
}

export function toAbsoluteUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const base = getStashBaseUrl();
  if (url.startsWith('/')) return `${base}${url}`;
  try {
    return new URL(url, `${base}/`).toString();
  } catch {
    try {
      return new URL(encodeURI(url), `${base}/`).toString();
    } catch {
      return `${base}/${url}`;
    }
  }
}

export function stripApiKey(url: string): string {
  if (!url) return url;
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return url;
  const base = url.substring(0, qIndex);
  const params = new URLSearchParams(url.substring(qIndex + 1));
  if (!params.has('apikey')) return url;
  params.delete('apikey');
  const newQuery = params.toString();
  return newQuery ? `${base}?${newQuery}` : base;
}

export function normalizeMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return stripApiKey(trimmed);
  const base = getStashBaseUrl();
  if (trimmed.startsWith('/')) return stripApiKey(`${base}${trimmed}`);
  try {
    return stripApiKey(new URL(trimmed, `${base}/`).toString());
  } catch {
    try {
      return stripApiKey(new URL(encodeURI(trimmed), `${base}/`).toString());
    } catch {
      return undefined;
    }
  }
}

export function addCacheBusting(url: string): string {
  if (!url) return url;
  const clean = stripApiKey(url);
  const separator = clean.includes('?') ? '&' : '?';
  return `${clean}${separator}t=${Date.now()}`;
}

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

export function isStandaloneNavigator(nav: Navigator): nav is NavigatorStandalone {
  return 'standalone' in nav;
}

let coarsePointerQuery: MediaQueryList | undefined;
export function isMobileDevice(): boolean {
  if (!('matchMedia' in globalThis)) return false;
  coarsePointerQuery ??= globalThis.matchMedia('(pointer: coarse)');
  return coarsePointerQuery.matches;
}

const IMAGE_CODECS = ['gif', 'webp', 'apng', 'avif', 'heic', 'heif'] as const;

function isImageCodec(codec: string): boolean {
  return IMAGE_CODECS.includes(codec.toLowerCase() as typeof IMAGE_CODECS[number]);
}

export function detectVideoFromVisualFiles(visualFiles?: Array<{
  path?: string;
  video_codec?: string;
  duration?: number;
}>): { isVideo: boolean; videoFile?: { path?: string; video_codec?: string } } {
  if (!visualFiles) {
    return { isVideo: false };
  }

  const videoFile = visualFiles.find(vf => vf.video_codec);
  if (!videoFile?.video_codec) {
    return { isVideo: false };
  }

  const codec = videoFile.video_codec.toLowerCase();
  const isVideo = !isImageCodec(codec);

  return {
    isVideo,
    videoFile: isVideo ? videoFile : undefined,
  };
}

export function isMp4File(path?: string): boolean {
  if (!path) {
    return false;
  }
  const filePath = path.toLowerCase();
  return filePath.endsWith('.mp4') || filePath.endsWith('.m4v');
}

export function buildFullUrl(path: string, baseUrl: string): string {
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return stripSlashes(baseUrl, { trailing: true }) + (path.startsWith('/') ? path : `/${path}`);
}

function tryGetUrlFromPath(path: string | undefined | null, baseUrl: string): string | undefined {
  if (!path) return undefined;
  const url = buildFullUrl(path, baseUrl);
  return normalizeMediaUrl(url) ?? undefined;
}

function getMp4VideoUrl(image: Image, videoFile: { path?: string }, baseUrl: string): string | undefined {
  if (!videoFile.path || !isMp4File(videoFile.path)) return undefined;
  const videoPath = videoFile.path;
  if (/^https?:\/\//i.test(videoPath)) {
    return tryGetUrlFromPath(videoPath, baseUrl);
  }
  if (image.paths?.image) {
    return tryGetUrlFromPath(image.paths.image, baseUrl);
  }
  return undefined;
}

function getVideoPreviewUrl(image: Image, baseUrl: string): string | undefined {
  return tryGetUrlFromPath(image.paths?.preview, baseUrl);
}

function getImageUrl(image: Image, baseUrl: string): string | undefined {
  return tryGetUrlFromPath(image.paths?.image, baseUrl) ||
         tryGetUrlFromPath(image.paths?.preview, baseUrl) ||
         tryGetUrlFromPath(image.paths?.thumbnail, baseUrl);
}

export function getImageUrlForDisplay(image: Image, treatMp4AsVideo: boolean): string | undefined {
  const baseUrl = getStashBaseUrl();
  
  const { isVideo, videoFile } = detectVideoFromVisualFiles(image.visualFiles);
  
  if (isVideo && videoFile?.path && treatMp4AsVideo) {
    const mp4Url = getMp4VideoUrl(image, videoFile, baseUrl);
    if (mp4Url) return mp4Url;
  }

  if (isVideo) {
    const previewUrl = getVideoPreviewUrl(image, baseUrl);
    if (previewUrl) return previewUrl;
  }

  return getImageUrl(image, baseUrl);
}

export function setupLoopingVideoElement(
  videoElement: HTMLVideoElement,
  options?: { objectFit?: 'cover' | 'contain' }
): void {
  videoElement.loop = true;
  videoElement.muted = true;
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.style.objectFit = options?.objectFit ?? 'contain';
  videoElement.style.width = '100%';
  videoElement.style.height = '100%';
  videoElement.style.display = 'block';
  
  videoElement.setAttribute('playsinline', 'true');
  videoElement.setAttribute('webkit-playsinline', 'true');
  videoElement.setAttribute('x5-playsinline', 'true');
  videoElement.setAttribute('x-webkit-airplay', 'allow');
  
  videoElement.setAttribute('tabindex', '-1');
}

export function applyThemeColors(colors: {
  background: string;
  primary: string;
  secondary: string;
  overlay: string;
  accent: string;
}): void {
  const root = document.documentElement;
  root.style.setProperty('--color-bg', colors.background);
  root.style.setProperty('--color-surface', colors.primary);
  root.style.setProperty('--color-surface-secondary', colors.secondary);
  root.style.setProperty('--color-bg-overlay', colors.overlay);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-accent-strong', darkenHex(colors.accent, 0.15));
  root.style.setProperty('--color-accent-weak', toRgba(colors.accent, 0.18));
  root.style.setProperty('--color-accent-weaker', toRgba(colors.accent, 0.1));
}

export function createFullscreenWrapper(className: string): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = className;
  wrapper.style.position = 'absolute';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.zIndex = '1';
  wrapper.style.backgroundColor = 'transparent';
  return wrapper;
}

export function createCoverDiv(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  return el;
}

export function applyMenuItemHover(item: HTMLElement): void {
  item.addEventListener('mouseenter', () => {
    item.style.background = THEME.colors.backgroundSecondary;
  });
  item.addEventListener('mouseleave', () => {
    item.style.background = 'transparent';
  });
}

export function extractValidPerformerIds(performers: Array<{ id?: string | null }>): string[] {
  return performers
    .map((p) => p.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function initPopoverDialog(dialog: HTMLElement, bottomOffset: string): void {
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-hidden', 'true');
  dialog.hidden = true;
  dialog.style.position = 'absolute';
  dialog.style.bottom = bottomOffset;
}

const iconTemplates = new Map<string, DocumentFragment>();

export function setIcon(el: Element, svg: string): void {
  let template = iconTemplates.get(svg);
  if (!template) {
    const holder = document.createElement('template');
    holder.innerHTML = svg;
    template = holder.content;
    iconTemplates.set(svg, template);
  }
  el.replaceChildren(template.cloneNode(true));
}
