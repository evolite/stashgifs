/**
 * Unified touch handler utilities for consistent mobile interaction
 * Provides standardized touch detection logic across the application
 */

/**
 * Standard touch detection thresholds
 */
export const TOUCH_THRESHOLDS = {
  /** Maximum pixel movement to consider a tap (not a scroll) */
  MOVE_THRESHOLD: 15,
  /** Maximum duration in ms to consider a tap (not a long press) */
  DURATION_THRESHOLD: 250,
  /** Maximum distance between taps for double-tap detection */
  DOUBLE_TAP_DISTANCE: 50,
  /** Maximum time between taps for double-tap detection */
  DOUBLE_TAP_TIME: 300,
} as const;

/**
 * Touch tracking state for a single element
 */
export interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  isScrolling: boolean;
  lastTapTime: number;
  lastTapX: number;
  lastTapY: number;
}

/**
 * Initialize touch state
 */
export function createTouchState(): TouchState {
  return {
    startX: 0,
    startY: 0,
    startTime: 0,
    isScrolling: false,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
  };
}

/**
 * Handle touchstart event and update state
 */
export function handleTouchStart(
  event: TouchEvent,
  state: TouchState
): void {
  const touch = event.touches[0];
  if (touch) {
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.startTime = Date.now();
    state.isScrolling = false;
  }
}

/**
 * Handle touchmove event and detect scrolling
 */
export function handleTouchMove(
  event: TouchEvent,
  state: TouchState
): void {
  if (event.touches.length > 0) {
    const touch = event.touches[0];
    if (touch) {
      const deltaX = Math.abs(touch.clientX - state.startX);
      const deltaY = Math.abs(touch.clientY - state.startY);
      if (deltaX > TOUCH_THRESHOLDS.MOVE_THRESHOLD || deltaY > TOUCH_THRESHOLDS.MOVE_THRESHOLD) {
        state.isScrolling = true;
      }
    }
  }
}

/**
 * Result of touch end analysis
 */
export interface TouchEndResult {
  /** Whether this was a valid tap (not a scroll) */
  isTap: boolean;
  /** Whether this was a double tap */
  isDoubleTap: boolean;
  /** Total distance moved */
  distance: number;
  /** Duration of the touch */
  duration: number;
}

/**
 * Analyze touchend event and determine if it was a tap
 */
export function analyzeTouchEnd(
  event: TouchEvent,
  state: TouchState
): TouchEndResult {
  const touch = event.changedTouches[0];
  if (!touch) {
    return {
      isTap: false,
      isDoubleTap: false,
      distance: Infinity,
      duration: Infinity,
    };
  }

  const deltaX = Math.abs(touch.clientX - state.startX);
  const deltaY = Math.abs(touch.clientY - state.startY);
  const totalDistance = Math.hypot(deltaX, deltaY);
  const touchDuration = Date.now() - state.startTime;
  const currentTime = Date.now();

  // Check for double tap
  const timeSinceLastTap = currentTime - state.lastTapTime;
  const distanceFromLastTap = Math.hypot(
    touch.clientX - state.lastTapX,
    touch.clientY - state.lastTapY
  );

  const isDoubleTap = timeSinceLastTap < TOUCH_THRESHOLDS.DOUBLE_TAP_TIME &&
    distanceFromLastTap < TOUCH_THRESHOLDS.DOUBLE_TAP_DISTANCE;

  // Determine if this was a valid tap
  const isTap = !state.isScrolling &&
    totalDistance < TOUCH_THRESHOLDS.MOVE_THRESHOLD &&
    touchDuration < TOUCH_THRESHOLDS.DURATION_THRESHOLD;

  // Update last tap info for next double-tap detection
  state.lastTapTime = currentTime;
  state.lastTapX = touch.clientX;
  state.lastTapY = touch.clientY;

  // Reset touch tracking
  state.isScrolling = false;
  state.startX = 0;
  state.startY = 0;
  state.startTime = 0;

  return {
    isTap,
    isDoubleTap,
    distance: totalDistance,
    duration: touchDuration,
  };
}

/**
 * Setup unified touch handlers for an element
 * Returns cleanup function
 */
export interface TouchHandlerOptions {
  /** Callback for single tap */
  onTap?: (event: TouchEvent) => void;
  /** Callback for double tap */
  onDoubleTap?: (event: TouchEvent) => void;
  /** Whether to prevent default on tap */
  preventDefault?: boolean;
  /** Whether to stop propagation on tap */
  stopPropagation?: boolean;
  /** Whether to stop immediate propagation on tap */
  stopImmediatePropagation?: boolean;
}

export function setupTouchHandlers(
  element: HTMLElement,
  options: TouchHandlerOptions = {}
): () => void {
  const {
    onTap,
    onDoubleTap,
    preventDefault = false,
    stopPropagation = false,
    stopImmediatePropagation = false,
  } = options;

  const state = createTouchState();

  const handleStart = (e: TouchEvent) => {
    handleTouchStart(e, state);
  };

  const handleMove = (e: TouchEvent) => {
    handleTouchMove(e, state);
  };

  const handleEnd = (e: TouchEvent) => {
    const result = analyzeTouchEnd(e, state);

    if (result.isDoubleTap && onDoubleTap) {
      if (preventDefault) e.preventDefault();
      if (stopPropagation) e.stopPropagation();
      if (stopImmediatePropagation) e.stopImmediatePropagation();
      onDoubleTap(e);
      // Reset to prevent triple tap
      state.lastTapTime = 0;
      return;
    }

    if (result.isTap && onTap) {
      if (preventDefault) e.preventDefault();
      if (stopPropagation) e.stopPropagation();
      if (stopImmediatePropagation) e.stopImmediatePropagation();
      onTap(e);
    }
  };

  // Add event listeners
  element.addEventListener('touchstart', handleStart, { passive: true });
  element.addEventListener('touchmove', handleMove, { passive: true });
  element.addEventListener('touchend', handleEnd, { passive: !preventDefault });

  // Return cleanup function
  return () => {
    element.removeEventListener('touchstart', handleStart);
    element.removeEventListener('touchmove', handleMove);
    element.removeEventListener('touchend', handleEnd);
  };
}

/**
 * Prevent click event from firing after touch (to avoid double-firing)
 * Call this in touchend handler to prevent subsequent click event
 */
export function preventClickAfterTouch(element: HTMLElement, timeout: number = 300): void {
  let clickPrevented = false;

  const preventClick = (e: MouseEvent) => {
    if (clickPrevented) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  };

  const handleTouchEnd = () => {
    clickPrevented = true;
    element.addEventListener('click', preventClick, { capture: true, once: true });
    setTimeout(() => {
      clickPrevented = false;
    }, timeout);
  };

  element.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Cleanup on element removal
  const observer = new MutationObserver(() => {
    if (!element.isConnected) {
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('click', preventClick, true);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

