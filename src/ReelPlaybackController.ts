
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
  /** Post ids in feed order — used to find neighbours of the active card. */
  getOrderedPostIds: () => string[];
  getPost: (postId: string) => PostType | undefined;
}

export class ReelPlaybackController {
  private readonly getOrderedPostIds: () => string[];
  private readonly getPost: (postId: string) => PostType | undefined;

  private activePostId?: string;
  private globalMute = false;

  constructor(options: ReelPlaybackControllerOptions) {
    this.getOrderedPostIds = options.getOrderedPostIds;
    this.getPost = options.getPost;
  }


  /**
   * Make `postId` the single playing card: load + play it (audio per global
   * mute), then pause/unload every other card.
   */
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

  /**
   * Warm the card immediately after the active one: create + buffer its player so
   * scrolling to it plays instantly. All video posts create paused (see
   * VideoPostBase.AUTOPLAY_ON_CREATE), so this only buffers — it never plays the
   * neighbour offscreen. The next setActive() reuses the already-loaded player.
   */
  private preloadNext(activePostId: string): void {
    const order = this.getOrderedPostIds();
    const idx = order.indexOf(activePostId);
    if (idx < 0) return;
    const nextId = order[idx + 1];
    if (!nextId) return;
    const post = this.getPost(nextId);
    if (!(post instanceof VideoPost || post instanceof ImageVideoPost)) return;
    if (!post.hasVideoSource()) return;
    post.preload(); // creates + buffers (paused); playback waits for activation
  }

  /**
   * Re-wire playback after a card's player instance is *replaced* — i.e. an HQ
   * upgrade swaps in a new VideoJsPlayer, or marker creation resumes the card.
   * Cold loads go through activate() instead, so this is no longer double-fired.
   */
  onPlayerReady(postId: string): void {
    const post = this.getPost(postId);
    const player = post?.getPlayer();
    if (!isVideoPlayer(player)) return;
    if (postId === this.activePostId) {
      this.enforceActive(player);
    } else if (player.isPlaying()) {
      player.pause(); // stray non-active player — pause silences it
    }
  }

  /** Global mute toggle: re-apply audio to the active card. */
  setGlobalMute(isMuted: boolean): void {
    this.globalMute = isMuted;
    if (!this.activePostId) return;
    const player = this.getPost(this.activePostId)?.getPlayer();
    if (isVideoPlayer(player)) {
      player.setMuted(isMuted);
    }
  }

  /** Re-attempt playback of the active card (after a gesture lifts autoplay block). */
  retryActive(): void {
    if (!this.activePostId) return;
    const player = this.getPost(this.activePostId)?.getPlayer();
    if (isVideoPlayer(player) && player.isPlaying() && !player.getIsUnloaded()) return;
    this.setActive(this.activePostId);
  }

  /** Pause every tracked video (used before modal flows like marker creation). */
  pauseAll(): void {
    for (const postId of this.getOrderedPostIds()) {
      const player = this.getPost(postId)?.getPlayer();
      if (!isVideoPlayer(player)) continue;
      if (player.isPlaying()) {
        player.pause();
      }
    }
  }

 
  // --- internals -----------------------------------------------------------

  private activate(postId: string, post: PostType): void {
    if (!post.hasVideoSource()) return; // image post — nothing to play
    const player = post.preload(); // creates + loads (or reloads) the player
    if (!isVideoPlayer(player)) return;
    this.enforceActive(player);
  }

  /**
   * Bring `player` to the desired active state: reload if unloaded, respect a
   * user pause, apply audio strictly from the global mute setting, then play.
   * Mute is never forced here — globalMute is the single source of truth.
   */
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
      player.pause(); // pausing silences it — no need to touch mute state
    }
    if (!player.getIsUnloaded()) {
      player.unload();
    }
  }
}
