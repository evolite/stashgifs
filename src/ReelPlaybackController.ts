import type { IVideoPlayer } from './types.js';
import type { ImagePlayer } from './ImagePlayer.js';
import { VideoPost } from './VideoPost.js';
import { ImageVideoPost } from './ImageVideoPost.js';
import type { ImagePost } from './ImagePost.js';

type PostType = VideoPost | ImagePost | ImageVideoPost;

function isVideoPlayer(player: IVideoPlayer | ImagePlayer | undefined): player is IVideoPlayer {
  return player !== undefined && 'getVideoElement' in player;
}

interface ReelPlaybackControllerOptions {
  getOrderedPostIds: () => string[];
  getPost: (postId: string) => PostType | undefined;
}

export class ReelPlaybackController {
  private readonly getOrderedPostIds: () => string[];
  private readonly getPost: (postId: string) => PostType | undefined;

  private activePostId?: string;
  private preloadedPostId?: string;
  private globalMute = false;

  constructor(options: ReelPlaybackControllerOptions) {
    this.getOrderedPostIds = options.getOrderedPostIds;
    this.getPost = options.getPost;
  }

  setActive(postId: string): void {
    const post = this.getPost(postId);
    if (!post) return;

    const previous = this.activePostId;
    this.activePostId = postId;
    if (previous && previous !== postId) {
      this.deactivate(previous);
    }
    this.activate(postId, post);
    this.preloadNext(postId);
  }

  private preloadNext(activePostId: string): void {
    const order = this.getOrderedPostIds();
    const idx = order.indexOf(activePostId);
    if (idx < 0) return;
    const nextId = order[idx + 1];
    const stale = this.preloadedPostId;
    if (stale && stale !== nextId && stale !== activePostId) this.deactivate(stale);
    this.preloadedPostId = nextId;
    if (!nextId) return;
    const post = this.getPost(nextId);
    if (!(post instanceof VideoPost || post instanceof ImageVideoPost)) return;
    if (!post.hasVideoSource()) return;
    post.preload();
  }

  onPlayerReady(postId: string): void {
    const post = this.getPost(postId);
    const player = post?.getPlayer();
    if (!isVideoPlayer(player)) return;
    if (postId === this.activePostId) {
      this.enforceActive(player);
    } else if (player.isPlaying()) {
      player.pause();
    }
  }

  setGlobalMute(isMuted: boolean): void {
    this.globalMute = isMuted;
    if (!this.activePostId) return;
    const player = this.getPost(this.activePostId)?.getPlayer();
    if (isVideoPlayer(player)) {
      player.setMuted(isMuted);
    }
  }

  retryActive(): void {
    if (!this.activePostId) return;
    const player = this.getPost(this.activePostId)?.getPlayer();
    if (isVideoPlayer(player) && player.isPlaying() && !player.getIsUnloaded()) return;
    this.setActive(this.activePostId);
  }

  pauseAll(): void {
    for (const postId of this.getOrderedPostIds()) {
      const player = this.getPost(postId)?.getPlayer();
      if (!isVideoPlayer(player)) continue;
      if (player.isPlaying()) {
        player.pause();
      }
    }
  }

  private activate(postId: string, post: PostType): void {
    if (!post.hasVideoSource()) return;
    const player = post.preload();
    if (!isVideoPlayer(player)) return;
    this.enforceActive(player);
  }

  private enforceActive(player: IVideoPlayer): void {
    if (player.getIsUnloaded()) {
      player.reload();
    }
    if (player.isManuallyPaused()) return;
    player.setMuted(this.globalMute);
    if (!player.isPlaying()) {
      void player.play();
    }
  }

  private deactivate(postId: string): void {
    const player = this.getPost(postId)?.getPlayer();
    if (!isVideoPlayer(player)) return;
    player.clearManualPause();
    if (player.isPlaying()) {
      player.pause();
    }
    if (!player.getIsUnloaded()) {
      player.unload();
    }
  }
}
