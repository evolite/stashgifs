import type { Scene, SceneMarker, VideoSource } from '../types.js';
import { normalizeMediaUrl, stripApiKey } from '../utils.js';

export class MediaUrls {
  constructor(
    private readonly baseUrl: string,
    private readonly maxResolution: () => number,
  ) {}

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

  getVideoUrl(scene: Scene): string | undefined {
    const cap = this.resolutionCapFor(scene);

    if (!cap) {
      const streamUrl = this.tryGetUrlFromStreams(scene);
      if (streamUrl) return streamUrl;
    }

    const streamPathUrl = this.tryGetUrlFromPath(scene.paths?.stream, cap);
    if (streamPathUrl) return streamPathUrl;

    if (cap) {
      const transcoded = this.pickTranscodedStream(scene);
      if (transcoded) return this.buildAndValidateUrl(MediaUrls.capStreamUrl(transcoded, cap));
    }

    const filePathUrl = this.tryGetUrlFromFiles(scene.files);
    if (filePathUrl) return filePathUrl;

    return undefined;
  }

  private resolutionCapFor(scene: Scene): string | undefined {
    if (this.maxResolution() <= 0) return undefined;
    const file = scene.files?.[0];
    const height = file?.height ?? file?.width ?? 0;
    if (height <= this.maxResolution()) return undefined;
    return MediaUrls.resolutionEnum(this.maxResolution());
  }

  static resolutionEnum(px: number): string {
    if (px <= 240) return 'LOW';
    if (px <= 480) return 'STANDARD';
    if (px <= 720) return 'STANDARD_HD';
    if (px <= 1080) return 'FULL_HD';
    return 'FOUR_K';
  }

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

    if (out.length === 0) {
      push(scene.paths?.stream ?? undefined, 'video/mp4');
      push(scene.files?.[0]?.path, 'video/mp4');
    }
    return out;
  }

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

  private buildUrl(path: string): string {
    return path.startsWith('http') ? path : `${this.baseUrl}${path}`;
  }

  private stableUrl(url: string): string {
    return stripApiKey(url);
  }
}
