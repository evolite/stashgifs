/**
 * Rating Control
 * Shared rating dialog and display logic for posts
 */

import { STAR_SVG, STAR_SVG_OUTLINE } from './icons.js';
import { THEME, throttle } from './utils.js';

const RATING_MAX_STARS = 10;
const RATING_MIN_STARS = 0;
const RESIZE_THROTTLE_MS = 100;

export interface RatingSystemConfig {
  type?: string;
  starPrecision?: string;
}

export interface RatingControlOptions {
  container: HTMLElement;
  subjectLabel: 'scene' | 'image';
  ratingSystemConfig?: RatingSystemConfig | null;
  buildRatingDisplayButton: (options: {
    title: string;
    onClick: (event: MouseEvent) => void;
  }) => { button: HTMLButtonElement; iconSpan: HTMLSpanElement; valueSpan: HTMLSpanElement };
  createRatingStarIcon: () => HTMLElement;
  getRating100: () => number | undefined | null;
  onUpdateRating100: (value: number | undefined) => void;
  onSaveRating10?: (rating10: number) => Promise<number>;
  onToast?: (message: string) => void;
}

export class RatingControl {
  private readonly container: HTMLElement;
  private readonly subjectLabel: 'scene' | 'image';
  private readonly ratingSystemConfig?: RatingSystemConfig | null;
  private readonly buildRatingDisplayButton: RatingControlOptions['buildRatingDisplayButton'];
  private readonly createRatingStarIcon: RatingControlOptions['createRatingStarIcon'];
  private readonly getRating100: RatingControlOptions['getRating100'];
  private readonly onUpdateRating100: RatingControlOptions['onUpdateRating100'];
  private readonly onSaveRating10?: RatingControlOptions['onSaveRating10'];
  private readonly onToast?: RatingControlOptions['onToast'];

  private ratingWrapper?: HTMLElement;
  private ratingDisplayButton?: HTMLButtonElement;
  private ratingDisplayIcon?: HTMLElement;
  private ratingDisplayValue?: HTMLElement;
  private ratingDialog?: HTMLElement;
  private ratingStarButtons: HTMLButtonElement[] = [];
  private isRatingDialogOpen = false;
  private isSavingRating = false;
  private hoveredStarIndex?: number;
  private hoveredPreviewValue?: number;
  private lastPointerSelectionTs = 0;
  private lastPointerHoverTs = 0;
  private cachedStarButtonWidth?: number;

  private ratingValue = 0;
  private hasRating = false;

  private readonly ratingOutsideClickHandler = (event: Event) => this.onRatingOutsideClick(event);
  private readonly ratingKeydownHandler = (event: KeyboardEvent) => this.onRatingKeydown(event);
  private readonly ratingResizeHandler: () => void;

  constructor(options: RatingControlOptions) {
    this.container = options.container;
    this.subjectLabel = options.subjectLabel;
    this.ratingSystemConfig = options.ratingSystemConfig;
    this.buildRatingDisplayButton = options.buildRatingDisplayButton;
    this.createRatingStarIcon = options.createRatingStarIcon;
    this.getRating100 = options.getRating100;
    this.onUpdateRating100 = options.onUpdateRating100;
    this.onSaveRating10 = options.onSaveRating10;
    this.onToast = options.onToast;

    this.ratingResizeHandler = throttle(() => {
      if (this.isRatingDialogOpen) {
        this.syncRatingDialogLayout();
      }
    }, RESIZE_THROTTLE_MS);

    this.updateFromData();
  }

  render(): HTMLElement {
    if (this.ratingWrapper) {
      this.updateFromData();
      return this.ratingWrapper;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'rating-control';
    wrapper.dataset.role = 'rating';
    wrapper.style.position = 'relative';
    this.ratingWrapper = wrapper;

    const title = this.subjectLabel === 'scene'
      ? 'Set rating on marker'
      : 'Set rating on image';

    const { button, iconSpan, valueSpan } = this.buildRatingDisplayButton({
      title,
      onClick: () => {
        if (this.isSavingRating) return;
        this.toggleRatingDialog();
      }
    });

    this.ratingDisplayButton = button;
    this.ratingDisplayIcon = iconSpan;
    this.ratingDisplayValue = valueSpan;
    wrapper.appendChild(button);

    const dialog = this.createRatingDialog();
    wrapper.appendChild(dialog);

    this.updateRatingDisplay();
    this.updateRatingStarButtons();

    return wrapper;
  }

  destroy(): void {
    if (this.isRatingDialogOpen) {
      this.closeRatingDialog();
    }
    this.detachRatingGlobalListeners();
    if (this.ratingDialog) {
      this.ratingDialog.remove();
      this.ratingDialog = undefined;
    }
    this.ratingWrapper = undefined;
    this.ratingStarButtons = [];
  }

  updateFromData(): void {
    const rating100 = this.getRating100();
    this.ratingValue = this.convertRating100ToStars(rating100 ?? undefined);
    this.hasRating = this.ratingValue > 0;
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
  }

  private getMaxStars(): number {
    return this.ratingSystemConfig?.type === 'stars' ? 5 : RATING_MAX_STARS;
  }

  private isHalfPrecision(): boolean {
    return this.ratingSystemConfig?.starPrecision === 'half';
  }

  private formatRatingValue(value: number): string {
    if (this.isHalfPrecision()) {
      return value.toFixed(1);
    }
    return Math.round(value).toString();
  }

  private clampRatingValue(value: number): number {
    if (!Number.isFinite(value)) return RATING_MIN_STARS;
    const maxStars = this.getMaxStars();
    if (this.isHalfPrecision()) {
      return Math.min(maxStars, Math.max(RATING_MIN_STARS, Math.round(value * 2) / 2));
    }
    return Math.min(maxStars, Math.max(RATING_MIN_STARS, Math.round(value)));
  }

  private convertRating100ToStars(rating100?: number): number {
    if (typeof rating100 !== 'number' || Number.isNaN(rating100)) {
      return RATING_MIN_STARS;
    }
    const maxStars = this.getMaxStars();
    const value = (rating100 / 100) * maxStars;
    return this.clampRatingValue(value);
  }

  private createRatingDialog(): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = 'rating-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.hidden = true;
    dialog.style.position = 'absolute';
    dialog.style.bottom = 'calc(100% + 10px)';
    dialog.style.left = 'auto';
    dialog.style.right = 'var(--rating-dialog-right, auto)';
    dialog.style.width = 'var(--rating-dialog-width, auto)';
    dialog.style.minWidth = '200px';
    this.ratingDialog = dialog;

    const dialogHeader = document.createElement('div');
    dialogHeader.className = 'rating-dialog__header';
    dialog.appendChild(dialogHeader);

    const starsContainer = document.createElement('div');
    starsContainer.className = 'rating-dialog__stars';
    starsContainer.setAttribute('role', 'radiogroup');
    const maxStars = this.getMaxStars();
    starsContainer.setAttribute(
      'aria-label',
      `Rate this ${this.subjectLabel} from 0 to ${maxStars}${this.isHalfPrecision() ? ' (half stars allowed)' : ''}`
    );
    this.ratingStarButtons = [];

    const isHalfPrecision = this.isHalfPrecision();
    const numStars = maxStars;

    if (isHalfPrecision) {
      const handlePointerMove = (event: PointerEvent | MouseEvent) => {
        this.handleStarsPointerMove(event);
      };
      const handlePointerLeave = () => {
        this.onStarHoverLeave();
      };
      const handlePointerDown = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') {
          const previewValue = this.calculatePreviewValueFromPointer(event.clientX);
          if (previewValue !== undefined) {
            const maxStars = this.getMaxStars();
            const starIndex = Math.min(Math.max(Math.ceil(previewValue), 1), maxStars);
            this.onStarHover(starIndex, previewValue);
          }
        }
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && (event.target as HTMLElement)?.closest('.rating-dialog__star')) {
          return;
        }
        const previewValue = this.hoveredPreviewValue ?? this.calculatePreviewValueFromPointer(event.clientX);
        if (previewValue !== undefined) {
          this.lastPointerSelectionTs = performance.now();
          void this.onRatingStarSelect(previewValue);
        }
      };
      starsContainer.addEventListener('pointermove', handlePointerMove);
      starsContainer.addEventListener('pointerleave', handlePointerLeave);
      starsContainer.addEventListener('pointerdown', handlePointerDown);
      starsContainer.addEventListener('pointerup', handlePointerUp);
    }

    for (let i = 1; i <= numStars; i++) {
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'rating-dialog__star';
      starBtn.setAttribute('role', 'radio');
      starBtn.dataset.starIndex = i.toString();
      starBtn.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
      starBtn.style.display = 'flex';
      starBtn.style.alignItems = 'center';
      starBtn.style.justifyContent = 'center';
      starBtn.style.width = '44px';
      starBtn.style.height = '44px';
      starBtn.style.minWidth = '44px';
      starBtn.style.minHeight = '44px';
      starBtn.style.margin = '0 4px';
      starBtn.style.padding = '4px';
      starBtn.style.border = 'none';
      starBtn.style.background = 'transparent';
      starBtn.style.cursor = 'pointer';
      starBtn.style.transition = 'transform 120ms ease-in-out, background 120ms ease-in-out';
      starBtn.style.borderRadius = '6px';
      starBtn.style.flexShrink = '0';

      const iconWrapper = this.createRatingStarIcon();
      starBtn.appendChild(iconWrapper);

      if (!isHalfPrecision) {
        starBtn.addEventListener('mouseenter', () => {
          this.onStarHover(i);
        });
      }
      starBtn.addEventListener('mouseleave', () => {
        this.onStarHoverLeave();
      });

      starBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const timeSincePointerSelect = performance.now() - this.lastPointerSelectionTs;
        let targetValue: number;
        if (isHalfPrecision) {
          const calculatedValue = this.calculatePreviewValueFromPointer(event.clientX);
          targetValue = this.hoveredPreviewValue ?? calculatedValue ?? i;
          if (timeSincePointerSelect < 200) {
            return;
          }
        } else {
          targetValue = i;
        }
        void this.onRatingStarSelect(targetValue);
      });

      starBtn.addEventListener('keydown', (event) => {
        this.handleRatingKeydown(event, i);
      });

      starBtn.addEventListener('focus', () => {
        const sincePointerHover = performance.now() - this.lastPointerHoverTs;
        if (this.hoveredPreviewValue !== undefined) {
          return;
        }
        if (this.isRatingDialogOpen && !this.hasRating) {
          return;
        }
        if (!isHalfPrecision || sincePointerHover > 200) {
          this.onStarHover(i);
        }
      });

      starBtn.addEventListener('blur', () => {
        this.onStarHoverLeave();
      });

      this.ratingStarButtons.push(starBtn);
      starsContainer.appendChild(starBtn);
    }

    dialog.appendChild(starsContainer);
    return dialog;
  }

  private toggleRatingDialog(force?: boolean): void {
    const shouldOpen = typeof force === 'boolean' ? force : !this.isRatingDialogOpen;
    if (shouldOpen) {
      this.openRatingDialog();
    } else {
      this.closeRatingDialog();
    }
  }

  private openRatingDialog(): void {
    if (!this.ratingDialog || this.isRatingDialogOpen) return;
    this.isRatingDialogOpen = true;
    this.ratingDialog.hidden = false;
    this.ratingDialog.setAttribute('aria-hidden', 'false');
    this.ratingDialog.classList.add('rating-dialog--open');
    this.ratingDisplayButton?.setAttribute('aria-expanded', 'true');
    this.ratingWrapper?.classList.add('rating-control--open');
    requestAnimationFrame(() => {
      this.syncRatingDialogLayout();
    });
    document.addEventListener('mousedown', this.ratingOutsideClickHandler);
    document.addEventListener('touchstart', this.ratingOutsideClickHandler);
    document.addEventListener('keydown', this.ratingKeydownHandler);
    window.addEventListener('resize', this.ratingResizeHandler);

    if (this.hasRating && this.ratingValue > 0) {
      const maxStars = this.getMaxStars();
      const starIndex = Math.min(Math.max(Math.ceil(this.ratingValue), 1), maxStars);
      this.hoveredStarIndex = starIndex;
      this.hoveredPreviewValue = this.ratingValue;
      this.updateRatingStarButtons(true);

      if (this.ratingStarButtons.length >= starIndex) {
        const targetButton = this.ratingStarButtons[starIndex - 1];
        if (targetButton) {
          try {
            targetButton.focus({ preventScroll: true });
          } catch {
            targetButton.focus();
          }
        }
      }
    } else {
      this.hoveredStarIndex = undefined;
      this.hoveredPreviewValue = undefined;
      this.updateRatingStarButtons();

      if (this.ratingStarButtons.length > 0) {
        const firstButton = this.ratingStarButtons[0];
        if (firstButton) {
          try {
            firstButton.focus({ preventScroll: true });
          } catch {
            firstButton.focus();
          }
        }
      }
    }
  }

  private closeRatingDialog(): void {
    if (!this.ratingDialog || !this.isRatingDialogOpen) return;
    this.isRatingDialogOpen = false;
    this.ratingDialog.classList.remove('rating-dialog--open');
    this.ratingDialog.setAttribute('aria-hidden', 'true');
    this.ratingDialog.hidden = true;
    this.ratingDisplayButton?.setAttribute('aria-expanded', 'false');
    this.ratingWrapper?.classList.remove('rating-control--open');
    this.hoveredStarIndex = undefined;
    this.hoveredPreviewValue = undefined;
    this.detachRatingGlobalListeners();
  }

  private detachRatingGlobalListeners(): void {
    document.removeEventListener('mousedown', this.ratingOutsideClickHandler);
    document.removeEventListener('touchstart', this.ratingOutsideClickHandler);
    document.removeEventListener('keydown', this.ratingKeydownHandler);
    window.removeEventListener('resize', this.ratingResizeHandler);
  }

  private onRatingOutsideClick(event: Event): void {
    if (!this.isRatingDialogOpen || !this.ratingWrapper) return;
    const target = event.target as Node | null;
    if (target && (this.ratingWrapper.contains(target) || this.ratingDialog?.contains(target))) {
      return;
    }
    this.closeRatingDialog();
  }

  private onRatingKeydown(event: KeyboardEvent): void {
    if (!this.isRatingDialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeRatingDialog();
      if (this.ratingDisplayButton) {
        try {
          this.ratingDisplayButton.focus({ preventScroll: true });
        } catch {
          this.ratingDisplayButton.focus();
        }
      }
    }
  }

  private handleRatingKeydown(event: KeyboardEvent, currentIndex: number): void {
    if (!this.isRatingDialogOpen) return;

    let newIndex: number;
    const maxButtons = this.ratingStarButtons.length;
    const isHalfPrecision = this.isHalfPrecision();

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        newIndex = Math.min(maxButtons, currentIndex + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        newIndex = Math.max(1, currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        newIndex = 1;
        break;
      case 'End':
        event.preventDefault();
        newIndex = maxButtons;
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (isHalfPrecision) {
          void this.onRatingStarToggle(currentIndex);
        } else {
          void this.onRatingStarSelect(currentIndex);
        }
        return;
      }
      default:
        return;
    }

    if (newIndex !== currentIndex) {
      const newButton = this.ratingStarButtons[newIndex - 1];
      if (newButton) {
        newButton.focus();
      }
    }
  }

  private updateRatingDisplay(): void {
    if (this.ratingDisplayButton) {
      const maxStars = this.getMaxStars();
      const subjectLabel = this.subjectLabel === 'scene' ? 'Scene' : 'Image';
      const ariaLabel = this.hasRating
        ? `${subjectLabel} rating ${this.formatRatingValue(this.ratingValue)} out of ${maxStars}`
        : `Rate this ${this.subjectLabel}`;
      this.ratingDisplayButton.setAttribute('aria-label', ariaLabel);
      this.ratingDisplayButton.classList.toggle('icon-btn--rating-active', this.hasRating);
    }
    if (this.ratingDisplayValue) {
      this.ratingDisplayValue.textContent = '';
    }
    if (this.ratingDisplayIcon) {
      if (this.hasRating) {
        this.ratingDisplayIcon.innerHTML = STAR_SVG;
        this.ratingDisplayIcon.style.color = '#FFD700';
      } else {
        this.ratingDisplayIcon.innerHTML = STAR_SVG_OUTLINE;
        this.ratingDisplayIcon.style.color = THEME.colors.iconInactive;
      }
    }
  }

  private onStarHover(starIndex: number, hoverValue?: number): void {
    this.hoveredStarIndex = starIndex;
    this.hoveredPreviewValue = hoverValue ?? starIndex;
    this.updateRatingStarButtons(true);
  }

  private onStarHoverLeave(): void {
    this.hoveredStarIndex = undefined;
    this.hoveredPreviewValue = undefined;
    this.updateRatingStarButtons(false);
  }

  private updateSingleStarButton(
    button: HTMLButtonElement,
    starIndex: number,
    displayValue: number,
    isPreview: boolean,
    buttonIndex: number
  ): void {
    const iconWrapper = button.querySelector<HTMLElement>('.rating-dialog__star-icon');
    const fillSpan = iconWrapper?.querySelector<HTMLElement>('.rating-dialog__star-fill');
    const outlineSpan = iconWrapper?.querySelector<HTMLElement>('.rating-dialog__star-outline');

    const starStartValue = starIndex - 1;
    const relativeFillValue = Math.min(Math.max(displayValue - starStartValue, 0), 1);
    const fillPercent = Math.round(relativeFillValue * 100);
    const isHalfState = fillPercent > 0 && fillPercent < 100;
    const isFilled = fillPercent > 0;

    const isChecked = !isPreview && this.hasRating && Math.abs(this.ratingValue - displayValue) < 0.01;
    button.classList.toggle('rating-dialog__star--active', isFilled);
    button.classList.toggle('rating-dialog__star--half', isHalfState);
    button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    button.tabIndex = isChecked || (!this.hasRating && buttonIndex === 0) ? 0 : -1;

    button.style.background = 'transparent';

    if (fillSpan && outlineSpan) {
      const clipPercent = 100 - fillPercent;
      fillSpan.style.opacity = isFilled ? '1' : '0';
      const clipInset = `inset(0 ${clipPercent}% 0 0)`;
      fillSpan.style.clipPath = clipInset;
      fillSpan.style.setProperty('-webkit-clip-path', clipInset);

      if (fillPercent === 100) {
        outlineSpan.style.opacity = '0.4';
      } else if (isFilled) {
        outlineSpan.style.opacity = '0.65';
      } else {
        outlineSpan.style.opacity = '1';
      }
    }

    button.disabled = this.isSavingRating;
  }

  private updateRatingStarButtons(isPreview: boolean = false): void {
    if (!this.ratingStarButtons || this.ratingStarButtons.length === 0) return;

    const displayValue = isPreview && this.hoveredPreviewValue !== undefined
      ? this.hoveredPreviewValue
      : this.ratingValue;

    for (let i = 0; i < this.ratingStarButtons.length; i++) {
      const button = this.ratingStarButtons[i];
      const starIndex = i + 1;
      this.updateSingleStarButton(button, starIndex, displayValue, isPreview, i);
    }
  }

  private async onRatingStarToggle(starIndex: number): Promise<void> {
    if (this.isSavingRating) return;

    const currentStarValue = starIndex;
    const halfStarValue = starIndex - 0.5;
    const previousValue = this.ratingValue;
    const previousRating100 = this.getRating100() ?? undefined;
    const previousHasRating = this.hasRating;

    let nextValue: number;
    if (Math.abs(this.ratingValue - currentStarValue) < 0.01) {
      nextValue = halfStarValue;
      this.hasRating = true;
    } else if (Math.abs(this.ratingValue - halfStarValue) < 0.01) {
      nextValue = 0;
      this.hasRating = false;
    } else {
      nextValue = currentStarValue;
      this.hasRating = true;
    }

    this.ratingValue = this.clampRatingValue(nextValue);
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    await this.persistRatingChange(previousValue, previousRating100, previousHasRating);
  }

  private async onRatingStarSelect(value: number): Promise<void> {
    if (this.isSavingRating) return;

    const nextValue = this.clampRatingValue(value);
    const previousValue = this.ratingValue;
    const previousRating100 = this.getRating100() ?? undefined;
    const previousHasRating = this.hasRating;

    this.ratingValue = nextValue;
    this.hasRating = nextValue > 0;
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    await this.persistRatingChange(previousValue, previousRating100, previousHasRating);
  }

  private async persistRatingChange(
    previousValue: number,
    previousRating100: number | undefined,
    previousHasRating: boolean
  ): Promise<void> {
    if (!this.onSaveRating10) {
      const maxStars = this.getMaxStars();
      this.onUpdateRating100(Math.round((this.ratingValue / maxStars) * 100));
      return;
    }

    this.isSavingRating = true;
    this.setRatingSavingState(true);
    this.updateRatingStarButtons();

    try {
      const maxStars = this.getMaxStars();
      const rating10 = (this.ratingValue / maxStars) * RATING_MAX_STARS;
      const updatedRating100 = await this.onSaveRating10(rating10);
      this.onUpdateRating100(updatedRating100);
      this.ratingValue = this.convertRating100ToStars(updatedRating100);
      this.hasRating = this.ratingValue > 0;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } catch (error) {
      console.error('Failed to update rating', error);
      this.onToast?.('Failed to update rating. Please try again.');
      this.ratingValue = previousValue;
      this.hasRating = previousHasRating;
      this.onUpdateRating100(previousRating100);
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } finally {
      this.isSavingRating = false;
      this.setRatingSavingState(false);
      this.updateRatingStarButtons();
    }
  }

  private setRatingSavingState(isSaving: boolean): void {
    if (!this.ratingDisplayButton) return;
    this.ratingDisplayButton.disabled = isSaving;
    if (isSaving) {
      this.ratingDisplayButton.style.opacity = '0.6';
      this.ratingDisplayButton.style.cursor = 'wait';
    } else {
      this.ratingDisplayButton.style.opacity = '1';
      this.ratingDisplayButton.style.cursor = 'pointer';
    }
  }

  private calculatePreviewValueFromPointer(pointerX: number): number | undefined {
    if (!this.isRatingDialogOpen || !this.isHalfPrecision()) {
      return undefined;
    }
    if (!this.ratingStarButtons.length) {
      return undefined;
    }

    const starRects = this.ratingStarButtons.map((btn) => btn.getBoundingClientRect());
    const firstRect = starRects[0];
    const maxStars = this.getMaxStars();

    if (pointerX <= firstRect.left + firstRect.width / 2) {
      return 0.5;
    }

    for (let i = 0; i < starRects.length; i++) {
      const rect = starRects[i];
      const nextRect = starRects[i + 1];
      if (pointerX >= rect.left && pointerX <= rect.right) {
        return i + 1;
      }
      if (nextRect && pointerX > rect.right && pointerX < nextRect.left + nextRect.width / 2) {
        return Math.min(i + 1 + 0.5, maxStars);
      }
      if (!nextRect && pointerX >= rect.right) {
        return starRects.length;
      }
    }

    return undefined;
  }

  private handleStarsPointerMove(event: PointerEvent | MouseEvent): void {
    if (!this.isRatingDialogOpen || !this.isHalfPrecision()) {
      return;
    }
    if (!this.ratingStarButtons.length) {
      return;
    }

    const previewValue = this.calculatePreviewValueFromPointer(event.clientX);
    if (previewValue === undefined) {
      return;
    }

    this.lastPointerHoverTs = performance.now();
    const maxStars = this.getMaxStars();
    const starIndex = Math.min(Math.max(Math.ceil(previewValue), 1), maxStars);
    this.onStarHover(starIndex, previewValue);
  }

  private calculateStarsWidth(dialog: HTMLElement): number {
    if (this.ratingStarButtons.length > 0) {
      if (this.cachedStarButtonWidth === undefined) {
        let totalWidth = 0;
        for (const starBtn of this.ratingStarButtons) {
          const rect = starBtn.getBoundingClientRect();
          totalWidth += rect.width;
        }
        if (this.ratingStarButtons.length > 0) {
          this.cachedStarButtonWidth = totalWidth / this.ratingStarButtons.length;
        }
        return totalWidth;
      }
      return this.cachedStarButtonWidth * this.ratingStarButtons.length;
    }
    const starsContainer = dialog.querySelector<HTMLElement>('.rating-dialog__stars');
    if (starsContainer) {
      return starsContainer.scrollWidth;
    }
    return 10 * 24;
  }

  private syncRatingDialogLayout(): void {
    if (!this.ratingWrapper) return;
    const dialog = this.ratingDialog;
    if (!dialog) return;

    const cardRect = this.container.getBoundingClientRect();
    const wrapperRect = this.ratingWrapper.getBoundingClientRect();
    if (!cardRect.width || !wrapperRect.width) return;

    const margin = 8;
    const maxWidth = cardRect.width - (margin * 2);
    const starsContainer = dialog.querySelector<HTMLElement>('.rating-dialog__stars');
    let requiredWidth = 0;

    if (this.ratingStarButtons.length > 0 && starsContainer) {
      const starCount = this.ratingStarButtons.length;
      let gap = 2;
      let marginX = 0;
      let paddingX = 8;
      let paddingY = 8;
      starsContainer.style.flexWrap = 'nowrap';

      const computeButtonSize = () => {
        const totalSpacing = (starCount - 1) * gap + starCount * (marginX * 2);
        const availableWidth = maxWidth - (paddingX * 2) - totalSpacing;
        const size = Math.floor(availableWidth / starCount);
        return { size, totalSpacing };
      };

      let { size: buttonSize, totalSpacing } = computeButtonSize();

      if (buttonSize < 18) {
        gap = 1;
        paddingX = 4;
        paddingY = 6;
        ({ size: buttonSize, totalSpacing } = computeButtonSize());
      }

      buttonSize = Math.min(44, Math.max(16, buttonSize));
      dialog.style.padding = `${paddingY}px ${paddingX}px`;
      starsContainer.style.gap = `${gap}px`;

      for (const starBtn of this.ratingStarButtons) {
        starBtn.style.margin = `0 ${marginX}px`;
        starBtn.style.width = `${buttonSize}px`;
        starBtn.style.minWidth = `${buttonSize}px`;
        starBtn.style.height = `${buttonSize}px`;
        starBtn.style.minHeight = `${buttonSize}px`;
      }

      requiredWidth = (paddingX * 2) + (buttonSize * starCount) + totalSpacing;
      this.cachedStarButtonWidth = undefined;
    }

    const starsWidth = this.calculateStarsWidth(dialog);
    const dialogWidth = requiredWidth > 0 ? requiredWidth : starsWidth;
    const finalWidth = Math.min(dialogWidth, maxWidth);

    dialog.style.boxSizing = 'border-box';
    dialog.style.width = `${finalWidth}px`;
    dialog.style.minWidth = `${finalWidth}px`;

    const targetRightEdge = cardRect.right - margin;
    const relativeRight = wrapperRect.right - targetRightEdge;
    dialog.style.left = 'auto';
    dialog.style.right = `${relativeRight}px`;
  }
}
