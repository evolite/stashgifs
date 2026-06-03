
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
   * mute), then pause/mute/unload every other card.
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
      player.setMuted(true);
      player.pause();
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
      if (postId === this.activePostId) {
        player.setMuted(true);
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
   * user pause, then either apply audio (if already playing — a gesture has
   * lifted the autoplay gate) or start muted autoplay. Audio is applied on the
   * *next* enforceActive (gesture/visibility/re-settle) via the isPlaying branch.
   */
  private enforceActive(player: IVideoPlayer): void {
    if (player.getIsUnloaded()) {
      player.reload();
    }
    if (player.isManuallyPaused()) return;
    if (player.isPlaying()) {
      player.setMuted(this.globalMute); // already playing — audio is safe now
      return;
    }
    // Browsers only allow gesture-less autoplay while muted, so always start muted.
    player.setMuted(true);
    void player.play();
  }

  private deactivate(postId: string): void {
    const player = this.getPost(postId)?.getPlayer();
    if (!isVideoPlayer(player)) return;
    player.setMuted(true);
    player.clearManualPause();
    if (player.isPlaying()) {
      player.pause();
    }
    if (!player.getIsUnloaded()) {
      player.unload();
    }
  }
}
