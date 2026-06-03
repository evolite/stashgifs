/**
 * ReelScroller — JS-native, one-card-per-gesture scrolling for reel mode.
 *
 * Replaces CSS scroll-snap (`scroll-snap-type` / `scroll-snap-align`), whose
 * settling behaviour is browser/OS-dependent and caused fast wheel flicks to
 * snap back to the wrong card. Instead this owns the scroll position outright:
 * every wheel notch, swipe, or arrow key advances exactly one card via an
 * animated `scrollTop` transition, with input locked until the animation lands.
 *
 * It does not allocate any per-card state — cards are enumerated live via the
 * `getCards` callback, so dynamically appended posts (infinite scroll) just work.
 */

interface ReelScrollerOptions {
  /** The element that actually scrolls (overflow-y:auto, fixed viewport height). */
  scrollContainer: HTMLElement;
  /** Ordered list of the post-card elements currently in the DOM. */
  getCards: () => HTMLElement[];
  /** Extract a stable post id from a card element. */
  getPostId: (card: HTMLElement) => string | null;
  /** Called once the scroller settles on a card (after the animation finishes). */
  onSettle: (postId: string, index: number) => void;
}

const ANIMATION_MS = 360;
/** Swallow the inertial tail of trackpad/wheel gestures after one card fires. */
const WHEEL_COOLDOWN_MS = 120;
/** Ignore micro wheel deltas (e.g. horizontal trackpad noise). */
const WHEEL_MIN_DELTA = 4;
/** Fraction of viewport height a swipe must cover to advance (if slow). */
const SWIPE_DISTANCE_RATIO = 0.18;
/** px/ms swipe velocity that advances regardless of distance. */
const SWIPE_VELOCITY = 0.35;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class ReelScroller {
  private readonly scrollContainer: HTMLElement;
  private readonly getCards: () => HTMLElement[];
  private readonly getPostId: (card: HTMLElement) => string | null;
  private readonly onSettle: (postId: string, index: number) => void;

  private enabled = false;
  private isAnimating = false;
  private pendingAdvance = false;
  private animationFrameId?: number;
  private wheelCooldownUntil = 0;

  // Touch-gesture state
  private touchActive = false;
  private touchStartY = 0;
  private touchStartScrollTop = 0;
  private touchStartIndex = 0;
  private touchLastY = 0;
  private touchLastTime = 0;
  private touchVelocity = 0;

  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onTouchStart = (e: TouchEvent) => this.handleTouchStart(e);
  private readonly onTouchMove = (e: TouchEvent) => this.handleTouchMove(e);
  private readonly onTouchEnd = () => this.handleTouchEnd();

  constructor(options: ReelScrollerOptions) {
    this.scrollContainer = options.scrollContainer;
    this.getCards = options.getCards;
    this.getPostId = options.getPostId;
    this.onSettle = options.onSettle;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.scrollContainer.addEventListener('wheel', this.onWheel, { passive: false });
    this.scrollContainer.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.scrollContainer.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.scrollContainer.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.scrollContainer.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    document.addEventListener('keydown', this.onKeyDown);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.cancelAnimation();
    this.pendingAdvance = false;
    this.scrollContainer.removeEventListener('wheel', this.onWheel);
    this.scrollContainer.removeEventListener('touchstart', this.onTouchStart);
    this.scrollContainer.removeEventListener('touchmove', this.onTouchMove);
    this.scrollContainer.removeEventListener('touchend', this.onTouchEnd);
    this.scrollContainer.removeEventListener('touchcancel', this.onTouchEnd);
    document.removeEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    this.disable();
  }

  /** Post id of the card currently at the top of the scroll container, or null if none. */
  getCurrentPostId(): string | null {
    const cards = this.getCards();
    const card = cards[this.getCurrentIndex()];
    return card ? this.getPostId(card) : null;
  }

  /** Programmatically advance one card (e.g. reel auto-advance on video loop). */
  next(): void {
    if (!this.enabled) return;
    if (this.isAnimating) {
      this.pendingAdvance = true;
      return;
    }
    this.goToIndex(this.getCurrentIndex() + 1, true);
  }

  prev(): void {
    if (!this.enabled || this.isAnimating) return;
    this.goToIndex(this.getCurrentIndex() - 1, true);
  }

  /**
   * Snap (no animation, no onSettle) to the card nearest the top. Used when reel
   * mode is toggled on mid-feed so the viewport lands on a whole card instead of
   * a partial one — autoplay is driven separately by the initial-card path.
   */
  realign(): void {
    if (!this.enabled) return;
    this.cancelAnimation();
    const cards = this.getCards();
    const card = cards[this.getCurrentIndex()];
    if (card) {
      this.scrollContainer.scrollTop = this.targetScrollTopFor(card);
    }
  }

  // --- Geometry helpers ----------------------------------------------------

  /** Target scrollTop that aligns `card` to the top of the scroll container. */
  private targetScrollTopFor(card: HTMLElement): number {
    const containerRect = this.scrollContainer.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return this.scrollContainer.scrollTop + (cardRect.top - containerRect.top);
  }

  private clampIndex(index: number, cardCount: number): number {
    if (cardCount === 0) return 0;
    return Math.max(0, Math.min(index, cardCount - 1));
  }

  /** Index of the card currently at the top of the scroll container. */
  private getCurrentIndex(): number {
    const cards = this.getCards();
    if (cards.length === 0) return 0;
    const cardHeight = this.scrollContainer.clientHeight;
    if (cardHeight <= 0) return 0;
    const estimated = Math.round(this.scrollContainer.scrollTop / cardHeight);
    return Math.max(0, Math.min(estimated, cards.length - 1));
  }

  // --- Core motion ---------------------------------------------------------

  private goToIndex(index: number, animate: boolean): void {
    const cards = this.getCards();
    const clamped = this.clampIndex(index, cards.length);
    const card = cards[clamped];
    if (!card) return;

    const target = this.targetScrollTopFor(card);
    if (!animate || Math.abs(target - this.scrollContainer.scrollTop) < 1) {
      this.cancelAnimation();
      this.scrollContainer.scrollTop = target;
      this.settle(card, clamped);
      return;
    }
    this.animateTo(target, card, clamped);
  }

  private animateTo(target: number, card: HTMLElement, index: number): void {
    this.cancelAnimation();
    const start = this.scrollContainer.scrollTop;
    const distance = target - start;
    const startTime = performance.now();
    this.isAnimating = true;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / ANIMATION_MS);
      this.scrollContainer.scrollTop = start + distance * easeOutCubic(progress);
      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(step);
      } else {
        this.animationFrameId = undefined;
        this.isAnimating = false;
        this.wheelCooldownUntil = performance.now() + WHEEL_COOLDOWN_MS;
        this.settle(card, index);
      }
    };
    this.animationFrameId = requestAnimationFrame(step);
  }

  private cancelAnimation(): void {
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    this.isAnimating = false;
    this.pendingAdvance = false;
  }

  private settle(card: HTMLElement, index: number): void {
    const postId = this.getPostId(card);
    if (postId) {
      this.onSettle(postId, index);
    }
    if (this.pendingAdvance) {
      this.pendingAdvance = false;
      this.goToIndex(index + 1, true);
    }
  }

  // --- Input handlers ------------------------------------------------------

  private handleWheel(e: WheelEvent): void {
    // Let nested scrollable UI (e.g. a search-suggestions dropdown) scroll natively.
    if (this.isOverNestedScrollable(e.target)) return;
    e.preventDefault(); // We own scrolling; never let the container free-scroll.
    if (this.isAnimating || performance.now() < this.wheelCooldownUntil) return;
    if (Math.abs(e.deltaY) < WHEEL_MIN_DELTA) return;
    if (e.deltaY > 0) {
      this.next();
    } else {
      this.prev();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isTypingTarget(e.target)) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        this.next();
        break;
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        this.prev();
        break;
      default:
        break;
    }
  }

  /**
   * True if `target` sits inside a scrollable element nested within the scroll
   * container (its own overflow that hasn't hit its limit) — those should keep
   * their native wheel/scroll behaviour rather than advancing the reel.
   */
  private isOverNestedScrollable(target: EventTarget | null): boolean {
    let node = target instanceof HTMLElement ? target : null;
    while (node && node !== this.scrollContainer) {
      const style = getComputedStyle(node);
      const scrollable = /(auto|scroll)/.test(style.overflowY);
      if (scrollable && node.scrollHeight > node.clientHeight) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  private handleTouchStart(e: TouchEvent): void {
    if (this.isAnimating || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    this.touchActive = true;
    this.touchStartY = y;
    this.touchLastY = y;
    this.touchLastTime = performance.now();
    this.touchVelocity = 0;
    this.touchStartScrollTop = this.scrollContainer.scrollTop;
    this.touchStartIndex = this.getCurrentIndex();
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.touchActive || e.touches.length !== 1) return;
    e.preventDefault(); // Block native momentum scrolling; we follow the finger.
    const y = e.touches[0].clientY;
    const now = performance.now();
    const dt = now - this.touchLastTime;
    if (dt > 0) {
      this.touchVelocity = (this.touchLastY - y) / dt; // +ve = swiping up (→ next)
    }
    this.touchLastY = y;
    this.touchLastTime = now;

    // Follow the finger, but clamp to ±1 card so a single swipe can never fling
    // past one neighbour.
    const cards = this.getCards();
    const desired = this.touchStartScrollTop + (this.touchStartY - y);
    const lower = this.boundScrollTop(cards, this.touchStartIndex - 1);
    const upper = this.boundScrollTop(cards, this.touchStartIndex + 1);
    this.scrollContainer.scrollTop = Math.max(lower, Math.min(desired, upper));
  }

  /** scrollTop that would align card[index] to top, clamped to existing cards. */
  private boundScrollTop(cards: HTMLElement[], index: number): number {
    const clamped = this.clampIndex(index, cards.length);
    const card = cards[clamped];
    return card ? this.targetScrollTopFor(card) : this.scrollContainer.scrollTop;
  }

  private handleTouchEnd(): void {
    if (!this.touchActive) return;
    this.touchActive = false;

    const moved = this.scrollContainer.scrollTop - this.touchStartScrollTop;
    const threshold = this.scrollContainer.clientHeight * SWIPE_DISTANCE_RATIO;
    const fastEnough = Math.abs(this.touchVelocity) >= SWIPE_VELOCITY;

    let targetIndex = this.touchStartIndex;
    if (moved > threshold || (fastEnough && this.touchVelocity > 0)) {
      targetIndex = this.touchStartIndex + 1;
    } else if (moved < -threshold || (fastEnough && this.touchVelocity < 0)) {
      targetIndex = this.touchStartIndex - 1;
    }
    this.goToIndex(targetIndex, true);
  }
}
