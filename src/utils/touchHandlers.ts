const TOUCH_THRESHOLDS = {
  MOVE_THRESHOLD: 15,
  DURATION_THRESHOLD: 250,
  DOUBLE_TAP_DISTANCE: 50,
  DOUBLE_TAP_TIME: 300,
} as const;

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  isScrolling: boolean;
  lastTapTime: number;
  lastTapX: number;
  lastTapY: number;
}

function createTouchState(): TouchState {
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

function handleTouchStart(
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

function handleTouchMove(
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

interface TouchEndResult {
  isTap: boolean;
  isDoubleTap: boolean;
  distance: number;
  duration: number;
}

function analyzeTouchEnd(
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

  const timeSinceLastTap = currentTime - state.lastTapTime;
  const distanceFromLastTap = Math.hypot(
    touch.clientX - state.lastTapX,
    touch.clientY - state.lastTapY
  );

  const isDoubleTap = timeSinceLastTap < TOUCH_THRESHOLDS.DOUBLE_TAP_TIME &&
    distanceFromLastTap < TOUCH_THRESHOLDS.DOUBLE_TAP_DISTANCE;

  const isTap = !state.isScrolling &&
    totalDistance < TOUCH_THRESHOLDS.MOVE_THRESHOLD &&
    touchDuration < TOUCH_THRESHOLDS.DURATION_THRESHOLD;

  state.lastTapTime = currentTime;
  state.lastTapX = touch.clientX;
  state.lastTapY = touch.clientY;

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

interface TouchHandlerOptions {
  onTap?: (event: TouchEvent) => void;
  onDoubleTap?: (event: TouchEvent) => void;
  preventDefault?: boolean;
  stopPropagation?: boolean;
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

  const applyEventOptions = (e: TouchEvent): void => {
    if (preventDefault) e.preventDefault();
    if (stopPropagation) e.stopPropagation();
    if (stopImmediatePropagation) e.stopImmediatePropagation();
  };

  const handleEnd = (e: TouchEvent) => {
    const result = analyzeTouchEnd(e, state);

    if (result.isDoubleTap && onDoubleTap) {
      applyEventOptions(e);
      onDoubleTap(e);
      state.lastTapTime = 0;
      return;
    }

    if (result.isTap && onTap) {
      applyEventOptions(e);
      onTap(e);
    }
  };

  element.addEventListener('touchstart', handleStart, { passive: true });
  element.addEventListener('touchmove', handleMove, { passive: true });
  element.addEventListener('touchend', handleEnd, { passive: !preventDefault });

  return () => {
    element.removeEventListener('touchstart', handleStart);
    element.removeEventListener('touchmove', handleMove);
    element.removeEventListener('touchend', handleEnd);
  };
}

export function preventClickAfterTouch(element: HTMLElement, timeout: number = 300): () => void {
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

  return () => {
    element.removeEventListener('touchend', handleTouchEnd);
    element.removeEventListener('click', preventClick, true);
  };
}

