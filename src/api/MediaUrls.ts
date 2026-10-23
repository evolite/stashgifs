/**
 * Playable URLs for Stash media: marker streams, scene sources for video.js, resolution capping.
 * Pure URL logic — no network, no caching — so it lives apart from the GraphQL client.
 */

import type { Scene, SceneMarker, VideoSource } from '../types.js';
import { normalizeMediaUrl, stripApiKey } from '../utils.js';

export class MediaUrls {
  /**
   * @param baseUrl Stash base URL (no trailing slash)
   * @param maxResolution Current resolution cap in px (0 = off); read on every call, so changes apply immediately
   */
  constructor(
    private readonly baseUrl: string,
    private readonly maxResolution: () => number,
  ) {}

  /**
   * Get video URL for a scene marker
   */
  getMarkerVideoUrl(marker: SceneMarker): string | undefined {
    if (!marker.stream) {
      return this.getVideoUrl(marker.scene);
    }
    
    const stream = marker.stream.trim();
    if (!stream || stream.length === 0) {
      return this.getVideoUrl(marker.scene);
    }
    
    const url = this.buildUrl(stream);
    const normalizedUrl = normalizeMediaUrl(url);
    if (!normalizedUrl) {
      return this.getVideoUrl(marker.scene);
    }
    
    return this.stableUrl(normalizedUrl);
  }

  /**
   * Get video URL for a scene
   * Tries multiple sources in order: sceneStreams, stream path, file path
   */
  getVideoUrl(scene: Scene): string | undefined {
    const cap = this.resolutionCapFor(scene);

    // A capped scene must NOT use the direct stream (it ignores ?resolution=);
    // go straight to the transcoded stream path so the cap takes effect.
    if (!cap) {
      const streamUrl = this.tryGetUrlFromStreams(scene);
      if (streamUrl) return streamUrl;
    }

    // Try stream path
    const streamPathUrl = this.tryGetUrlFromPath(scene.paths?.stream, cap);
    if (streamPathUrl) return streamPathUrl;

    if (cap) {
      // Last-ditch: a non-direct transcode entry from sceneStreams.
      const transcoded = this.pickTranscodedStream(scene);
      if (transcoded) return this.buildAndValidateUrl(MediaUrls.capStreamUrl(transcoded, cap));
    }

    // Try file path as last resort
    const filePathUrl = this.tryGetUrlFromFiles(scene.files);
    if (filePathUrl) return filePathUrl;

    return undefined;
  }

  /** Stash transcode-resolution enum for the current cap, or undefined when the
   *  scene is within the cap (or the cap is off). */
  private resolutionCapFor(scene: Scene): string | undefined {
    if (this.maxResolution() <= 0) return undefined;
    const file = scene.files?.[0];
    const height = file?.height ?? file?.width ?? 0;
    if (height <= this.maxResolution()) return undefined;
    return MediaUrls.resolutionEnum(this.maxResolution());
  }

  /** Map a cap in px to the nearest Stash transcode-size enum at or below it. */
  static resolutionEnum(px: number): string {
    if (px <= 240) return 'LOW';
    if (px <= 480) return 'STANDARD';
    if (px <= 720) return 'STANDARD_HD';
    if (px <= 1080) return 'FULL_HD';
    return 'FOUR_K';
  }

  /** Set/replace the `resolution` query param on a Stash stream URL. */
  static capStreamUrl(url: string, resolutionEnum: string): string {
    const [base, hash] = url.split('#');
    const [path, query = ''] = base.split('?');
    const params = query
      .split('&')
      .filter((p) => p && !p.startsWith('resolution='));
    params.push(`resolution=${resolutionEnum}`);
    const fragment = hash ? `#${hash}` : '';
    return `${path}?${params.join('&')}${fragment}`;
  }

  private pickTranscodedStream(scene: Scene): string | undefined {
    const streams = scene.sceneStreams ?? [];
    const nonDirect = streams.find((s) => !(s.label ?? '').toLowerCase().includes('direct'));
    return nonDirect?.url?.trim() || undefined;
  }

  private tryGetUrlFromStreams(scene: Scene): string | undefined {
    if (!scene.sceneStreams?.length) return undefined;
    const streamUrl = scene.sceneStreams[0]?.url?.trim();
    if (!streamUrl) return undefined;
    return this.buildAndValidateUrl(streamUrl);
  }

  /**
   * Build an ordered list of playable sources for a scene, for a player (video.js)
   * that selects/falls-back by MIME type. Order:
   *   1. Direct stream first IF the browser can decode the file's codec (cheapest, best quality).
   *   2. HLS (Stash transcodes/remuxes to a browser-compatible codec — always plays).
   *   3. Other forced-transcode variants (MP4/WebM), then DASH.
   *   4. Direct stream last as a final fallback when codec support is unknown.
   * URLs are NOT cache-busted: Stash keys transcode sessions on the URL, so a stable
   * URL lets it resume an existing transcode instead of restarting one each load.
   */
  getSceneSources(scene: Scene): VideoSource[] {
    const out: VideoSource[] = [];
    const seen = new Set<string>();
    const cap = this.resolutionCapFor(scene);
    const push = (rawUrl: string | undefined, type?: string): void => {
      const capped = rawUrl && cap ? MediaUrls.capStreamUrl(rawUrl, cap) : rawUrl;
      const built = this.buildStreamUrl(capped);
      if (built && !seen.has(built)) {
        seen.add(built);
        out.push(type ? { src: built, type } : { src: built });
      }
    };

    const streams = scene.sceneStreams ?? [];
    const isHls = (s: { mime_type?: string; label?: string }) =>
      (s.mime_type ?? '').toLowerCase().includes('mpegurl') || (s.label ?? '').toUpperCase().includes('HLS');
    const isDash = (s: { mime_type?: string; label?: string }) =>
      (s.mime_type ?? '').toLowerCase().includes('dash') || (s.label ?? '').toUpperCase().includes('DASH');
    const isDirect = (s: { label?: string }) => (s.label ?? '').toLowerCase().includes('direct');

    const direct = streams.filter(isDirect);
    const hls = streams.filter(isHls);
    const dash = streams.filter(isDash);
    const rest = streams.filter((s) => !isDirect(s) && !isHls(s) && !isDash(s));

    // A capped scene skips the direct stream entirely — it can't be resolution-limited.
    const directPlayable = !cap && this.isDirectPlayable(scene);
    if (directPlayable) {
      for (const s of direct) push(s.url, s.mime_type || 'video/mp4');
    }
    for (const s of hls) push(s.url, s.mime_type || 'application/x-mpegURL');
    for (const s of rest) push(s.url, s.mime_type || 'video/mp4');
    for (const s of dash) push(s.url, s.mime_type || 'application/dash+xml');
    if (!directPlayable && !cap) {
      for (const s of direct) push(s.url, s.mime_type || 'video/mp4');
    }

    // Fallbacks when sceneStreams is empty (older Stash or odd configs).
    if (out.length === 0) {
      push(scene.paths?.stream ?? undefined, 'video/mp4');
      push(scene.files?.[0]?.path, 'video/mp4');
    }
    return out;
  }

  /**
   * Whether the browser is likely able to directly decode the scene's primary
   * video codec. Conservative: H.264/AVC always; HEVC/AV1/VP9 only if canPlayType
   * reports support. Unknown codecs default to true (the error-fallback in the
   * player handles a wrong guess).
   */
  private isDirectPlayable(scene: Scene): boolean {
    const codec = scene.files?.find((f) => f.video_codec)?.video_codec?.toLowerCase();
    if (!codec) return true;
    if (codec.includes('264') || codec.includes('avc')) return true;

    const probe = (mime: string): boolean => {
      try {
        return !!document.createElement('video').canPlayType(mime);
      } catch {
        return false;
      }
    };
    if (codec.includes('hevc') || codec.includes('265')) {
      return probe('video/mp4; codecs="hvc1"') || probe('video/mp4; codecs="hev1"');
    }
    if (codec.includes('av1') || codec.includes('av01')) {
      return probe('video/mp4; codecs="av01.0.05M.08"');
    }
    if (codec.includes('vp9')) return probe('video/webm; codecs="vp9"');
    if (codec.includes('vp8')) return probe('video/webm; codecs="vp8"');
    return true;
  }

  /** Build a full, normalized stream URL without cache-busting (see getSceneSources). */
  private buildStreamUrl(path?: string | null): string | undefined {
    const trimmed = path?.trim();
    if (!trimmed) return undefined;
    return normalizeMediaUrl(this.buildUrl(trimmed)) ?? undefined;
  }

  private tryGetUrlFromPath(path?: string | null, resolutionEnum?: string): string | undefined {
    const trimmedPath = path?.trim();
    if (!trimmedPath) return undefined;
    const capped = resolutionEnum ? MediaUrls.capStreamUrl(trimmedPath, resolutionEnum) : trimmedPath;
    return this.buildAndValidateUrl(capped);
  }

  private tryGetUrlFromFiles(files?: Array<{ path?: string | null }>): string | undefined {
    if (!files?.length) return undefined;
    const filePath = files[0]?.path?.trim();
    if (!filePath) return undefined;
    return this.buildAndValidateUrl(filePath);
  }

  private buildAndValidateUrl(path: string): string | undefined {
    const url = this.buildUrl(path);
    const normalizedUrl = normalizeMediaUrl(url);
    if (!normalizedUrl) return undefined;
    return this.stableUrl(normalizedUrl);
  }

  /**
   * Build full URL from path
   */
  private buildUrl(path: string): string {
    return path.startsWith('http') ? path : `${this.baseUrl}${path}`;
  }

  /**
   * Stream URLs are NOT cache-busted: Stash keys transcode sessions on the exact URL, so a stable URL
   * lets it resume an existing transcode instead of restarting one on every load. (Image/poster URLs,
   * which Stash itself versions with ?t=, are handled elsewhere.)
   */
  private stableUrl(url: string): string {
    return stripApiKey(url);
  }
}
