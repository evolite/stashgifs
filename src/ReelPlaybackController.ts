/**
 * ReelPlaybackController — owns video playback for the reel.
 *
 * In a reel-only world exactly one card is active at a time, so the elaborate
 * "which of many visible videos plays / owns audio" arbitration collapses to:
 *
 *   - the active card loads, plays, and (unless global mute) is the audio owner
 *   - every other card is paused and muted
 *   - a small window around the active card is preloaded / kept; the rest unload
 *
 * Single-video playback is enforced with a `play` guard on each video element:
 * any non-active card that starts playing (autoplay race, clip loop) is paused
 * immediately. video.js players are created with `autoplay: true`, so this guard
 * is what keeps preloaded neighbours from running in the background.
 */

import type { IVideoPlayer } from './types.js';
import type { ImagePlayer } from './ImagePlayer.js';
import { VideoPost } from './VideoPost.js';
import { ImageVideoPost } from './ImageVideoPost.js';
import type { ImagePost } from './ImagePost.js';

type PostType = VideoPost | ImagePost | ImageVideoPost;

function isVideoPlayer(player: IVideoPlayer | ImagePlayer | undefined): player is IVideoPlayer {
  return player !== undefined && 'getVideoElement' in player;
}

export interface ReelPlaybackControllerOptions {
  /** Post ids in feed order — used to find neighbours of the active card. */
  getOrderedPostIds: () => string[];
  getPost: (postId: string) => PostType | undefined;
}

/** Preload this many cards ahead of the active one for an instant next swipe. */
const PRELOAD_AHEAD = 1;
/** Unload video players farther than this many cards from the active one. */
const KEEP_WINDOW = 2;

export class ReelPlaybackController {
  private readonly getOrderedPostIds: () => string[];
  private readonly getPost: (postId: string) => PostType | undefined;

  private readonly guards = new Map<string, { el: HTMLVideoElement; handler: () => void }>();
  private activePostId?: string;
  private globalMute = true;

  constructor(options: ReelPlaybackControllerOptions) {
    this.getOrderedPostIds = options.getOrderedPostIds;
    this.getPost = options.getPost;
  }

  /** Called when a card enters the feed — no-op now, kept for symmetry with unregisterCard. */
  registerCard(_postId: string, _post: PostType): void {}

  /** Stop tracking a card and detach its guard. */
  unregisterCard(postId: string): void {
    this.detachGuard(postId);
    if (this.activePostId === postId) {
      this.activePostId = undefined;
    }
  }

  /**
   * Make `postId` the single playing card: load + play it (audio per global
   * mute), pause/mute the previous one, preload the next, and unload far cards.
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
    this.preloadNeighbours(postId);
    this.unloadFarCards(postId);
  }

  /** Re-apply playback after a card's player is (re)created — e.g. HQ upgrade. */
  onPlayerReady(postId: string): void {
    const post = this.getPost(postId);
    const player = post?.getPlayer();
    if (!isVideoPlayer(player)) return;
    this.attachGuard(postId, player);
    if (postId === this.activePostId) {
      this.playActive(player);
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
    if (this.activePostId) {
      this.setActive(this.activePostId);
    }
  }

  /** Pause every tracked video (used before modal flows like marker creation). */
  pauseAll(): void {
    for (const postId of this.getOrderedPostIds()) {
      const player = this.getPost(postId)?.getPlayer();
      if (isVideoPlayer(player) && player.isPlaying()) {
        player.pause();
      }
    }
  }

  destroy(): void {
    for (const postId of [...this.guards.keys()]) {
      this.detachGuard(postId);
    }
    this.activePostId = undefined;
  }

  // --- internals -----------------------------------------------------------

  private activate(postId: string, post: PostType): void {
    if (!post.hasVideoSource()) return; // image post — nothing to play
    const player = post.preload(); // creates + loads (or reloads) the player
    if (!isVideoPlayer(player)) return;
    this.attachGuard(postId, player);
    this.playActive(player);
  }

  private playActive(player: IVideoPlayer): void {
    if (player.getIsUnloaded()) {
      player.reload();
    }
    // Browsers only allow autoplay without a gesture while muted, so always start
    // muted and let the play-guard unmute the active card once playback begins.
    player.setMuted(true);
    if (!player.isPlaying() && !player.isManuallyPaused()) {
      player.play()?.catch(() => {});
    } else if (!this.globalMute) {
      player.setMuted(false); // already playing — apply audio now
    }
  }

  private deactivate(postId: string): void {
    const player = this.getPost(postId)?.getPlayer();
    if (!isVideoPlayer(player)) return;
    player.setMuted(true);
    if (player.isPlaying()) {
      player.pause();
    }
  }

  private preloadNeighbours(postId: string): void {
    const order = this.getOrderedPostIds();
    const index = order.indexOf(postId);
    if (index === -1) return;

    for (let offset = 1; offset <= PRELOAD_AHEAD; offset++) {
      const neighbourId = order[index + offset];
      if (!neighbourId) continue;
      const post = this.getPost(neighbourId);
      if (!post || !(post instanceof VideoPost || post instanceof ImageVideoPost)) continue;
      if (!post.hasVideoSource() || post.isPlayerLoaded()) continue;
      try {
        const player = post.preload();
        if (isVideoPlayer(player)) {
          this.attachGuard(neighbourId, player);
          player.setMuted(true);
        }
      } catch (error) {
        console.warn('ReelPlaybackController: neighbour preload failed', { postId: neighbourId, error });
      }
    }
  }

  private unloadFarCards(activeId: string): void {
    const order = this.getOrderedPostIds();
    const activeIndex = order.indexOf(activeId);
    if (activeIndex === -1) return;

    for (const postId of order) {
      const distance = Math.abs(order.indexOf(postId) - activeIndex);
      if (distance <= KEEP_WINDOW) continue;
      const player = this.getPost(postId)?.getPlayer();
      if (isVideoPlayer(player) && !player.getIsUnloaded()) {
        player.unload();
        this.detachGuard(postId);
      }
    }
  }

  /**
   * Attach (or refresh) the single-video guard on a card's video element. The
   * guard pauses + mutes the card whenever it starts playing while not active.
   */
  private attachGuard(postId: string, player: IVideoPlayer): void {
    const el = player.getVideoElement();
    const existing = this.guards.get(postId);
    if (existing) {
      if (existing.el === el) return;
      existing.el.removeEventListener('play', existing.handler);
    }
    const handler = () => {
      if (this.activePostId === postId) {
        if (!this.globalMute) {
          player.setMuted(false);
        }
      } else {
        player.setMuted(true);
        player.pause();
      }
    };
    el.addEventListener('play', handler);
    this.guards.set(postId, { el, handler });
  }

  private detachGuard(postId: string): void {
    const guard = this.guards.get(postId);
    if (guard) {
      guard.el.removeEventListener('play', guard.handler);
      this.guards.delete(postId);
    }
  }
}
