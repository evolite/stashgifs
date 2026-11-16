interface ReelScrollerOptions {
  scrollContainer: HTMLElement;
  getCards: () => HTMLElement[];
  getPostId: (card: HTMLElement) => string | null;
  onSettle: (postId: string, index: number) => void;
  onAdvance?: (index: number) => void;
  yieldToPage?: () => boolean;
}

const ANIMATION_MS = 360;
const WHEEL_COOLDOWN_MS = 180;
const WHEEL_MIN_DELTA = 4;
const SWIPE_DISTANCE_RATIO = 0.18;
const SWIPE_VELOCITY = 0.35;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class ReelScroller {
  private readonly scrollContainer: HTMLElement;
  private readonly getCards: () => HTMLElement[];
  private readonly getPostId: (card: HTMLElement) => string | null;
  private readonly onSettle: (postId: string, index: number) => void;
  private readonly onAdvance?: (index: number) => void;
  private readonly yieldToPage?: () => boolean;

  private enabled = false;
  private isAnimating = false;
  private pendingAdvance = false;
  private animationFrameId?: number;
  private animationTarget?: { card: HTMLElement; index: number };
  private wheelCooldownUntil = 0;
  private anchorCard?: HTMLElement;

  private touchActive = false;
  private touchId = 0;
  private touchStartY = 0;
  private touchStartScrollTop = 0;
  private touchStartIndex = 0;
  private touchLowerBound = 0;
  private touchUpperBound = 0;
  private touchLastY = 0;
  private touchLastTime = 0;
  private touchVelocity = 0;

  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onTouchStart = (e: TouchEvent) => this.handleTouchStart(e);
  private readonly onTouchMove = (e: TouchEvent) => this.handleTouchMove(e);
  private readonly onTouchEnd = (e: TouchEvent) => this.handleTouchEnd(e);
  private readonly resizeObserver = new ResizeObserver(() => this.handleResize());

  constructor(options: ReelScrollerOptions) {
    this.scrollContainer = options.scrollContainer;
    this.getCards = options.getCards;
    this.getPostId = options.getPostId;
    this.onSettle = options.onSettle;
    this.onAdvance = options.onAdvance;
    this.yieldToPage = options.yieldToPage;
  }

  isBusy(): boolean {
    return this.isAnimating || this.touchActive;
  }

  snapToCard(card: HTMLElement): void {
    this.anchorCard = card;
    this.scrollContainer.scrollTop = this.targetScrollTopFor(card);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.scrollContainer.addEventListener('wheel', this.onWheel, { passive: false });
    this.scrollContainer.addEventListener('touchstart', this.onTouchStart, { passive: true, capture: true });
    this.scrollContainer.addEventListener('touchmove', this.onTouchMove, { passive: false, capture: true });
    this.scrollContainer.addEventListener('touchend', this.onTouchEnd, { passive: true, capture: true });
    this.scrollContainer.addEventListener('touchcancel', this.onTouchEnd, { passive: true, capture: true });
    this.resizeObserver.observe(this.scrollContainer);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.cancelAnimation();
    this.pendingAdvance = false;
    this.touchActive = false;
    this.scrollContainer.removeEventListener('wheel', this.onWheel);
    this.scrollContainer.removeEventListener('touchstart', this.onTouchStart, { capture: true });
    this.scrollContainer.removeEventListener('touchmove', this.onTouchMove, { capture: true });
    this.scrollContainer.removeEventListener('touchend', this.onTouchEnd, { capture: true });
    this.scrollContainer.removeEventListener('touchcancel', this.onTouchEnd, { capture: true });
    this.resizeObserver.disconnect();
  }

  destroy(): void {
    this.disable();
  }

  getCurrentPostId(): string | null {
    const cards = this.getCards();
    const card = cards[this.getCurrentIndex()];
    return card ? this.getPostId(card) : null;
  }

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

  realign(): void {
    if (!this.enabled) return;
    this.cancelAnimation();
    const cards = this.getCards();
    const card = cards[this.getCurrentIndex()];
    if (card) {
      this.snapToCard(card);
    }
  }

  private targetScrollTopFor(card: HTMLElement): number {
    const containerRect = this.scrollContainer.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return this.scrollContainer.scrollTop + (cardRect.top - containerRect.top);
  }

  private clampIndex(index: number, cardCount: number): number {
    if (cardCount === 0) return 0;
    return Math.max(0, Math.min(index, cardCount - 1));
  }

  private getCurrentIndex(): number {
    const cards = this.getCards();
    if (cards.length === 0) return 0;
    const containerTop = this.scrollContainer.getBoundingClientRect().top;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < cards.length; i++) {
      const distance = Math.abs(cards[i].getBoundingClientRect().top - containerTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private goToIndex(index: number, animate: boolean): void {
    const cards = this.getCards();
    const clamped = this.clampIndex(index, cards.length);
    const card = cards[clamped];
    if (!card) return;

    this.onAdvance?.(clamped);

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
    this.animationTarget = { card, index };

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / ANIMATION_MS);
      this.scrollContainer.scrollTop = start + distance * easeOutCubic(progress);
      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(step);
      } else {
        this.animationFrameId = undefined;
        this.isAnimating = false;
        this.animationTarget = undefined;
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
    this.animationTarget = undefined;
    this.pendingAdvance = false;
  }

  private settle(card: HTMLElement, index: number): void {
    this.anchorCard = card;
    const postId = this.getPostId(card);
    if (postId) {
      this.onSettle(postId, index);
    }
    if (this.pendingAdvance) {
      this.pendingAdvance = false;
      this.goToIndex(index + 1, true);
    }
  }

  private handleWheel(e: WheelEvent): void {
    const now = performance.now();
    const inTail = this.isAnimating || now < this.wheelCooldownUntil;
    if (!inTail && this.isOverNestedScrollable(e.target)) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < WHEEL_MIN_DELTA) return;
    if (this.isAnimating || now < this.wheelCooldownUntil) {
      this.wheelCooldownUntil = now + WHEEL_COOLDOWN_MS;
      return;
    }
    if (e.deltaY > 0) {
      this.next();
    } else {
      this.prev();
    }
  }

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

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    if (this.yieldToPage?.()) {
      this.touchActive = false;
      return;
    }
    const touch = e.touches[0];
    const cards = this.getCards();
    const baseIndex = this.animationTarget ? cards.indexOf(this.animationTarget.card) : this.getCurrentIndex();
    this.cancelAnimation();
    this.touchActive = true;
    this.touchId = touch.identifier;
    this.touchStartY = touch.clientY;
    this.touchLastY = touch.clientY;
    this.touchLastTime = performance.now();
    this.touchVelocity = 0;
    this.touchStartScrollTop = this.scrollContainer.scrollTop;
    this.touchStartIndex = Math.max(0, baseIndex);
    this.touchLowerBound = this.boundScrollTop(cards, this.touchStartIndex - 1);
    this.touchUpperBound = this.boundScrollTop(cards, this.touchStartIndex + 1);
  }

  private trackedTouch(list: TouchList): Touch | undefined {
    return Array.from(list).find((t) => t.identifier === this.touchId);
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.touchActive) return;
    e.preventDefault();
    const touch = this.trackedTouch(e.touches);
    if (!touch) return;
    const y = touch.clientY;
    const now = performance.now();
    const dt = now - this.touchLastTime;
    if (dt > 0) {
      this.touchVelocity = (this.touchLastY - y) / dt;
    }
    this.touchLastY = y;
    this.touchLastTime = now;

    const desired = this.touchStartScrollTop + (this.touchStartY - y);
    this.scrollContainer.scrollTop = Math.max(this.touchLowerBound, Math.min(desired, this.touchUpperBound));
  }

  private boundScrollTop(cards: HTMLElement[], index: number): number {
    const clamped = this.clampIndex(index, cards.length);
    const card = cards[clamped];
    return card ? this.targetScrollTopFor(card) : this.scrollContainer.scrollTop;
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (!this.touchActive || e.touches.length > 0) return;
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

  private handleResize(): void {
    const target = this.animationTarget;
    this.touchActive = false;
    this.cancelAnimation();
    if (target?.card.isConnected) {
      this.scrollContainer.scrollTop = this.targetScrollTopFor(target.card);
      this.settle(target.card, target.index);
      return;
    }
    const card = this.anchorCard?.isConnected ? this.anchorCard : this.getCards()[this.getCurrentIndex()];
    if (card) this.scrollContainer.scrollTop = this.targetScrollTopFor(card);
  }
}
