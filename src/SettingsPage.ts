/**
 * Settings Page Component
 * Allows users to configure file types and image feed settings
 */

import { FeedSettings } from './types.js';
import * as version from './version.js';
import { THEME, THEME_DEFAULTS } from './utils.js';

export class SettingsPage {
  private readonly container: HTMLElement;
  private readonly settings: FeedSettings;
  private readonly onSave?: (settings: Partial<FeedSettings>) => void;
  private readonly onClose?: () => void;

  constructor(
    container: HTMLElement,
    settings: FeedSettings,
    onSave?: (settings: Partial<FeedSettings>) => void,
    onClose?: () => void
  ) {
    this.container = container;
    this.settings = settings;
    this.onSave = onSave;
    this.onClose = onClose;
    this.render();
  }

  /**
   * Create an info button with hover tooltip
   */
  private createInfoButton(tooltipText: string): HTMLElement {
    const infoButton = document.createElement('button');
    infoButton.type = 'button';
    infoButton.setAttribute('aria-label', 'Information');
    infoButton.innerHTML = 'ℹ️';
    infoButton.style.background = 'transparent';
    infoButton.style.border = 'none';
    infoButton.style.color = THEME.colors.textMuted;
    infoButton.style.fontSize = THEME.typography.sizeBody;
    infoButton.style.cursor = 'help';
    infoButton.style.padding = '0';
    infoButton.style.width = '20px';
    infoButton.style.height = '20px';
    infoButton.style.display = 'flex';
    infoButton.style.alignItems = 'center';
    infoButton.style.justifyContent = 'center';
    infoButton.style.marginLeft = '8px';
    infoButton.style.position = 'relative';
    infoButton.style.transition = 'color 0.2s';

    // Hover effect
    infoButton.addEventListener('mouseenter', () => {
      infoButton.style.color = THEME.colors.textPrimary;
    });
    infoButton.addEventListener('mouseleave', () => {
      infoButton.style.color = THEME.colors.textMuted;
    });

    // Create tooltip - append to container to avoid overflow clipping
    const tooltip = document.createElement('div');
    tooltip.textContent = tooltipText;
    tooltip.style.position = 'fixed';
    tooltip.style.padding = '8px 12px';
    tooltip.style.backgroundColor = THEME.colors.overlay;
    tooltip.style.color = THEME.colors.textPrimary;
    tooltip.style.fontSize = THEME.typography.sizeMeta;
    tooltip.style.borderRadius = THEME.radius.button;
    tooltip.style.whiteSpace = 'pre-wrap';
    tooltip.style.maxWidth = '300px';
    tooltip.style.width = 'max-content';
    tooltip.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.opacity = '0';
    tooltip.style.transition = 'opacity 0.2s';
    tooltip.style.zIndex = '10001';
    tooltip.style.lineHeight = '1.5';
    tooltip.style.pointerEvents = 'none';
    
    // Append tooltip to container (not button) to avoid overflow clipping
    this.container.appendChild(tooltip);

    // Update tooltip position on hover
    const updateTooltipPosition = () => {
      const buttonRect = infoButton.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      
      // Position above the button, centered horizontally
      let left = buttonRect.left + (buttonRect.width / 2) - (tooltipRect.width / 2);
      let top = buttonRect.top - tooltipRect.height - 8;
      
      // Adjust if tooltip would go off screen
      if (left < containerRect.left + 10) {
        left = containerRect.left + 10;
      }
      if (left + tooltipRect.width > containerRect.right - 10) {
        left = containerRect.right - tooltipRect.width - 10;
      }
      if (top < containerRect.top + 10) {
        // If not enough space above, show below
        top = buttonRect.bottom + 8;
      }
      
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    // Show tooltip on hover
    infoButton.addEventListener('mouseenter', () => {
      updateTooltipPosition();
      tooltip.style.opacity = '1';
    });
    infoButton.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
    });

    return infoButton;
  }

  /**
   * Create a modern toggle switch
   */
  private createToggleSwitch(checked: boolean, onChange?: (checked: boolean) => void): { container: HTMLElement; input: HTMLInputElement } {
    const container = document.createElement('label');
    container.style.position = 'relative';
    container.style.display = 'inline-block';
    container.style.width = '50px';
    container.style.height = '28px';
    container.style.cursor = 'pointer';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.style.opacity = '0';
    input.style.width = '0';
    input.style.height = '0';
    input.style.position = 'absolute';

    const slider = document.createElement('span');
    slider.style.position = 'absolute';
    slider.style.top = '0';
    slider.style.left = '0';
    slider.style.right = '0';
    slider.style.bottom = '0';
    slider.style.backgroundColor = checked ? THEME.colors.success : THEME.colors.backgroundSecondary;
    slider.style.transition = 'background-color 0.3s ease';
    slider.style.borderRadius = '28px';
    slider.style.cursor = 'pointer';

    const thumb = document.createElement('span');
    thumb.style.position = 'absolute';
    thumb.style.height = '22px';
    thumb.style.width = '22px';
    thumb.style.left = checked ? '26px' : '3px';
    thumb.style.top = '3px';
    thumb.style.backgroundColor = THEME.colors.textPrimary;
    thumb.style.borderRadius = '50%';
    thumb.style.transition = 'left 0.3s ease, box-shadow 0.3s ease';
    thumb.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    thumb.style.cursor = 'pointer';

    const updateVisualState = () => {
      const isChecked = input.checked;
      slider.style.backgroundColor = isChecked ? THEME.colors.success : THEME.colors.backgroundSecondary;
      thumb.style.left = isChecked ? '26px' : '3px';
    };

    // Add hover effect
    container.addEventListener('mouseenter', () => {
      if (!input.checked) {
        slider.style.backgroundColor = THEME.colors.surfaceHover;
      }
    });
    container.addEventListener('mouseleave', () => {
      updateVisualState();
    });

    input.addEventListener('change', () => {
      updateVisualState();
      if (onChange) {
        onChange(input.checked);
      }
    });

    // Also listen for programmatic changes
    const observer = new MutationObserver(() => {
      updateVisualState();
    });
    observer.observe(input, { attributes: true, attributeFilter: ['checked'] });

    container.appendChild(input);
    container.appendChild(slider);
    slider.appendChild(thumb);

    return { container, input };
  }

  private render(): void {
    this.container.innerHTML = '';
    this.container.style.position = 'fixed';
    this.container.style.top = '0';
    this.container.style.left = '0';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.backgroundColor = THEME.colors.overlay;
    this.container.style.zIndex = '10000';
    this.container.style.display = 'flex';
    this.container.style.alignItems = 'center';
    this.container.style.justifyContent = 'center';
    this.container.style.padding = '20px';
    this.container.style.boxSizing = 'border-box';
    this.container.style.fontFamily = THEME.typography.fontFamily;

    const modal = document.createElement('div');
    modal.style.backgroundColor = THEME.colors.backgroundSecondary;
    modal.style.borderRadius = THEME.radius.card;
    modal.style.padding = THEME.spacing.cardPadding;
    modal.style.maxWidth = '600px';
    modal.style.width = '100%';
    modal.style.height = '90vh';
    modal.style.maxHeight = '90vh';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.overflow = 'hidden';
    modal.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';

    // Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '24px';

    const title = document.createElement('h2');
    title.textContent = 'Settings';
    title.style.margin = '0';
    title.style.color = THEME.colors.textPrimary;
    title.style.fontSize = THEME.typography.sizeTitle;
    title.style.fontWeight = THEME.typography.weightTitle;
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '✕';
    closeButton.style.background = 'transparent';
    closeButton.style.border = 'none';
    closeButton.style.color = THEME.colors.textSecondary;
    closeButton.style.fontSize = THEME.icon.sizeLarge;
    closeButton.style.cursor = 'pointer';
    closeButton.style.padding = '0';
    closeButton.style.width = '32px';
    closeButton.style.height = '32px';
    closeButton.style.display = 'flex';
    closeButton.style.alignItems = 'center';
    closeButton.style.justifyContent = 'center';
    closeButton.addEventListener('click', () => this.close());
    header.appendChild(closeButton);

    modal.appendChild(header);

    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.gap = '8px';
    tabBar.style.marginBottom = '16px';
    tabBar.style.alignItems = 'center';

    const createTabButton = (label: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.padding = '0 14px';
      button.style.height = '34px';
      button.style.borderRadius = THEME.radius.button;
      button.style.border = `1px solid ${THEME.colors.border}`;
      button.style.background = THEME.colors.backgroundSecondary;
      button.style.color = THEME.colors.textSecondary;
      button.style.cursor = 'pointer';
      button.style.fontSize = THEME.typography.sizeBody;
      button.style.fontWeight = THEME.typography.weightBodyStrong;
      button.style.display = 'inline-flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      button.style.lineHeight = '1';
      button.style.transition = 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease';
      return button;
    };

    const generalTabButton = createTabButton('General');
    const themeTabButton = createTabButton('Theme');
    tabBar.appendChild(generalTabButton);
    tabBar.appendChild(themeTabButton);
    modal.appendChild(tabBar);

    const contentWrapper = document.createElement('div');
    contentWrapper.style.flex = '1 1 auto';
    contentWrapper.style.overflowY = 'auto';
    contentWrapper.style.paddingRight = '4px';
    contentWrapper.style.marginRight = '-4px';

    const generalContent = document.createElement('div');
    const themeContent = document.createElement('div');
    themeContent.style.display = 'none';

    const setActiveTab = (active: 'general' | 'theme') => {
      const isGeneral = active === 'general';
      generalContent.style.display = isGeneral ? 'block' : 'none';
      themeContent.style.display = isGeneral ? 'none' : 'block';

      generalTabButton.style.background = isGeneral ? THEME.colors.surfaceHover : THEME.colors.backgroundSecondary;
      generalTabButton.style.color = isGeneral ? THEME.colors.textPrimary : THEME.colors.textSecondary;
      generalTabButton.style.borderColor = isGeneral ? THEME.colors.accentPrimary : THEME.colors.border;

      themeTabButton.style.background = isGeneral ? THEME.colors.backgroundSecondary : THEME.colors.surfaceHover;
      themeTabButton.style.color = isGeneral ? THEME.colors.textSecondary : THEME.colors.textPrimary;
      themeTabButton.style.borderColor = isGeneral ? THEME.colors.border : THEME.colors.accentPrimary;
    };

    generalTabButton.addEventListener('click', () => setActiveTab('general'));
    themeTabButton.addEventListener('click', () => setActiveTab('theme'));
    setActiveTab('general');

    contentWrapper.appendChild(generalContent);
    contentWrapper.appendChild(themeContent);
    modal.appendChild(contentWrapper);

    const normalizeHexColor = (value: string | undefined, fallback: string): string => {
      if (!value) return fallback;
      const trimmed = value.trim();
      const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : fallback;
    };

    // Theme Section
    const themeSection = document.createElement('div');
    themeSection.style.marginBottom = '24px';
    themeSection.style.border = `1px solid ${THEME.colors.border}`;
    themeSection.style.borderRadius = THEME.radius.card;
    themeSection.style.padding = '16px';

    const themeSectionTitle = document.createElement('h3');
    themeSectionTitle.textContent = 'Theme';
    themeSectionTitle.style.margin = '0 0 16px 0';
    themeSectionTitle.style.color = THEME.colors.textPrimary;
    themeSectionTitle.style.fontSize = THEME.typography.sizeTitle;
    themeSectionTitle.style.fontWeight = THEME.typography.weightTitle;
    themeSection.appendChild(themeSectionTitle);

    const themePresets = [
      {
        id: 'default',
        label: 'Stash Default',
        colors: {
          background: THEME_DEFAULTS.backgroundPrimary,
          primary: THEME_DEFAULTS.surface,
          secondary: THEME_DEFAULTS.backgroundSecondary,
          accent: THEME_DEFAULTS.accentPrimary,
        },
      },
      {
        id: 'rounded-yellow',
        label: 'Rounded Yellow',
        colors: {
          background: '#101118',
          primary: '#1F282C',
          secondary: '#30404D',
          accent: '#CFAD0B',
        },
      },
      {
        id: 'amoled',
        label: 'AMOLED',
        colors: {
          background: '#000000',
          primary: '#000000',
          secondary: '#000000',
          accent: '#4FA3D1',
        },
      },
      {
        id: 'onyx',
        label: 'ONYX',
        colors: {
          background: '#121212',
          primary: '#2a2a2a',
          secondary: '#343b41',
          accent: '#ed6492',
        },
      },
    ];

    const buildThemePresetRow = (labelText: string): { row: HTMLElement; select: HTMLSelectElement } => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.marginBottom = '16px';

      const label = document.createElement('span');
      label.textContent = labelText;
      label.style.color = THEME.colors.textSecondary;
      label.style.fontSize = THEME.typography.sizeBody;
      row.appendChild(label);

      const select = document.createElement('select');
      select.style.minWidth = '200px';
      select.style.padding = '8px 12px';
      select.style.borderRadius = THEME.radius.button;
      select.style.border = `1px solid ${THEME.colors.border}`;
      select.style.backgroundColor = THEME.colors.surface;
      select.style.color = THEME.colors.textPrimary;
      select.style.fontSize = THEME.typography.sizeBody;
      select.style.fontWeight = THEME.typography.weightBodyStrong;
      select.style.cursor = 'pointer';

      themePresets.forEach((preset) => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label;
        select.appendChild(option);
      });

      const customOption = document.createElement('option');
      customOption.value = 'custom';
      customOption.textContent = 'Custom';
      select.appendChild(customOption);

      row.appendChild(select);

      return { row, select };
    };

    const buildThemeRow = (labelText: string, value: string): { row: HTMLElement; input: HTMLInputElement; valueLabel: HTMLElement } => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.marginBottom = '16px';

      const label = document.createElement('span');
      label.textContent = labelText;
      label.style.color = THEME.colors.textSecondary;
      label.style.fontSize = THEME.typography.sizeBody;
      row.appendChild(label);

      const control = document.createElement('div');
      control.style.display = 'flex';
      control.style.alignItems = 'center';
      control.style.gap = '10px';

      const valueLabel = document.createElement('span');
      valueLabel.style.color = THEME.colors.textMuted;
      valueLabel.style.fontSize = THEME.typography.sizeMeta;
      valueLabel.textContent = value.toUpperCase();

      const input = document.createElement('input');
      input.type = 'color';
      input.value = value;
      input.style.width = '44px';
      input.style.height = '32px';
      input.style.padding = '0';
      input.style.borderRadius = THEME.radius.button;
      input.style.border = `1px solid ${THEME.colors.border}`;
      input.style.background = THEME.colors.surface;
      input.style.cursor = 'pointer';

      control.appendChild(valueLabel);
      control.appendChild(input);
      row.appendChild(control);

      return { row, input, valueLabel };
    };

    const backgroundValue = normalizeHexColor(this.settings.themeBackground, THEME_DEFAULTS.backgroundPrimary);
    const primaryValue = normalizeHexColor(this.settings.themePrimary, THEME_DEFAULTS.surface);
    const secondaryValue = normalizeHexColor(this.settings.themeSecondary, THEME_DEFAULTS.backgroundSecondary);
    const accentValue = normalizeHexColor(this.settings.themeAccent, THEME_DEFAULTS.accentPrimary);

    const presetRow = buildThemePresetRow('Theme preset');

    const backgroundRow = buildThemeRow('Background', backgroundValue);
    const primaryRow = buildThemeRow('Primary', primaryValue);
    const secondaryRow = buildThemeRow('Secondary', secondaryValue);
    const accentRow = buildThemeRow('Accent', accentValue);

    themeSection.appendChild(presetRow.row);
    themeSection.appendChild(backgroundRow.row);
    themeSection.appendChild(primaryRow.row);
    themeSection.appendChild(secondaryRow.row);
    themeSection.appendChild(accentRow.row);

    const updateThemeLabel = (input: HTMLInputElement, label: HTMLElement) => {
      label.textContent = input.value.toUpperCase();
    };

    const getPresetIdForValues = (background: string, primary: string, secondary: string, accent: string) => {
      const normalized = {
        background: background.toUpperCase(),
        primary: primary.toUpperCase(),
        secondary: secondary.toUpperCase(),
        accent: accent.toUpperCase(),
      };

      const matchedPreset = themePresets.find((preset) => {
        return (
          preset.colors.background.toUpperCase() === normalized.background &&
          preset.colors.primary.toUpperCase() === normalized.primary &&
          preset.colors.secondary.toUpperCase() === normalized.secondary &&
          preset.colors.accent.toUpperCase() === normalized.accent
        );
      });

      return matchedPreset ? matchedPreset.id : 'custom';
    };

    const setPresetSelectValue = () => {
      presetRow.select.value = getPresetIdForValues(
        backgroundRow.input.value,
        primaryRow.input.value,
        secondaryRow.input.value,
        accentRow.input.value
      );
    };

    const applyThemePreset = (preset: typeof themePresets[number]) => {
      backgroundRow.input.value = preset.colors.background;
      primaryRow.input.value = preset.colors.primary;
      secondaryRow.input.value = preset.colors.secondary;
      accentRow.input.value = preset.colors.accent;

      updateThemeLabel(backgroundRow.input, backgroundRow.valueLabel);
      updateThemeLabel(primaryRow.input, primaryRow.valueLabel);
      updateThemeLabel(secondaryRow.input, secondaryRow.valueLabel);
      updateThemeLabel(accentRow.input, accentRow.valueLabel);

      setPresetSelectValue();
      this.saveSettings();
    };

    presetRow.select.addEventListener('change', () => {
      const selectedPreset = themePresets.find((preset) => preset.id === presetRow.select.value);
      if (!selectedPreset) return;
      applyThemePreset(selectedPreset);
    });

    setPresetSelectValue();

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset to default';
    resetButton.style.marginTop = '8px';
    resetButton.style.padding = '8px 14px';
    resetButton.style.borderRadius = THEME.radius.button;
    resetButton.style.border = `1px solid ${THEME.colors.border}`;
    resetButton.style.background = THEME.colors.backgroundSecondary;
    resetButton.style.color = THEME.colors.textSecondary;
    resetButton.style.cursor = 'pointer';
    resetButton.style.fontSize = THEME.typography.sizeBody;
    resetButton.style.fontWeight = THEME.typography.weightBodyStrong;
    resetButton.style.alignSelf = 'flex-start';
    resetButton.style.transition = 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease';

    resetButton.addEventListener('mouseenter', () => {
      resetButton.style.background = THEME.colors.surfaceHover;
      resetButton.style.color = THEME.colors.textPrimary;
      resetButton.style.borderColor = THEME.colors.accentPrimary;
    });

    resetButton.addEventListener('mouseleave', () => {
      resetButton.style.background = THEME.colors.backgroundSecondary;
      resetButton.style.color = THEME.colors.textSecondary;
      resetButton.style.borderColor = THEME.colors.border;
    });

    resetButton.addEventListener('click', () => {
      backgroundRow.input.value = THEME_DEFAULTS.backgroundPrimary;
      primaryRow.input.value = THEME_DEFAULTS.surface;
      secondaryRow.input.value = THEME_DEFAULTS.backgroundSecondary;
      accentRow.input.value = THEME_DEFAULTS.accentPrimary;
      updateThemeLabel(backgroundRow.input, backgroundRow.valueLabel);
      updateThemeLabel(primaryRow.input, primaryRow.valueLabel);
      updateThemeLabel(secondaryRow.input, secondaryRow.valueLabel);
      updateThemeLabel(accentRow.input, accentRow.valueLabel);
      setPresetSelectValue();
      this.saveSettings();
    });

    themeSection.appendChild(resetButton);

    backgroundRow.input.addEventListener('input', () => {
      updateThemeLabel(backgroundRow.input, backgroundRow.valueLabel);
      setPresetSelectValue();
      this.saveSettings();
    });
    primaryRow.input.addEventListener('input', () => {
      updateThemeLabel(primaryRow.input, primaryRow.valueLabel);
      setPresetSelectValue();
      this.saveSettings();
    });
    secondaryRow.input.addEventListener('input', () => {
      updateThemeLabel(secondaryRow.input, secondaryRow.valueLabel);
      setPresetSelectValue();
      this.saveSettings();
    });
    accentRow.input.addEventListener('input', () => {
      updateThemeLabel(accentRow.input, accentRow.valueLabel);
      setPresetSelectValue();
      this.saveSettings();
    });

    (this as any).themeBackgroundInput = backgroundRow.input;
    (this as any).themePrimaryInput = primaryRow.input;
    (this as any).themeSecondaryInput = secondaryRow.input;
    (this as any).themeAccentInput = accentRow.input;

    themeContent.appendChild(themeSection);

    // Layout Settings Section
    const layoutSection = document.createElement('div');
    layoutSection.style.marginBottom = '24px';
    layoutSection.style.border = `1px solid ${THEME.colors.border}`;
    layoutSection.style.borderRadius = THEME.radius.card;
    layoutSection.style.padding = '16px';

    const layoutSectionTitle = document.createElement('h3');
    layoutSectionTitle.textContent = 'Layout';
    layoutSectionTitle.style.margin = '0 0 16px 0';
    layoutSectionTitle.style.color = THEME.colors.textPrimary;
    layoutSectionTitle.style.fontSize = THEME.typography.sizeTitle;
    layoutSectionTitle.style.fontWeight = THEME.typography.weightTitle;
    layoutSection.appendChild(layoutSectionTitle);

    const reelModeContainer = document.createElement('div');
    reelModeContainer.style.display = 'flex';
    reelModeContainer.style.justifyContent = 'space-between';
    reelModeContainer.style.alignItems = 'center';
    reelModeContainer.style.marginBottom = '16px';

    const reelModeLabel = document.createElement('span');
    reelModeLabel.textContent = 'Reel mode (full-screen, swipe)';
    reelModeLabel.style.color = THEME.colors.textSecondary;
    reelModeLabel.style.fontSize = THEME.typography.sizeBody;
    reelModeContainer.appendChild(reelModeLabel);

    const { container: reelModeToggleContainer, input: reelModeToggle } = this.createToggleSwitch(
      this.settings.reelMode === true,
      () => this.saveSettings()
    );
    reelModeContainer.appendChild(reelModeToggleContainer);

    layoutSection.appendChild(reelModeContainer);
    generalContent.appendChild(layoutSection);

    // Image Feed Settings Section
    const imageSection = document.createElement('div');
    imageSection.style.marginBottom = '24px';
    imageSection.style.border = `1px solid ${THEME.colors.border}`;
    imageSection.style.borderRadius = THEME.radius.card;
    imageSection.style.padding = '16px';

    const imageSectionTitleContainer = document.createElement('div');
    imageSectionTitleContainer.style.display = 'flex';
    imageSectionTitleContainer.style.alignItems = 'center';
    imageSectionTitleContainer.style.marginBottom = '16px';

    const imageSectionTitle = document.createElement('h3');
    imageSectionTitle.textContent = 'Image Feed';
    imageSectionTitle.style.margin = '0';
    imageSectionTitle.style.color = THEME.colors.textPrimary;
    imageSectionTitle.style.fontSize = THEME.typography.sizeTitle;
    imageSectionTitle.style.fontWeight = THEME.typography.weightTitle;
    imageSectionTitleContainer.appendChild(imageSectionTitle);

    const imageFeedInfo = this.createInfoButton(
      'Displays images and looping videos from your Stash library.\n\n' +
      'Treated as Images by Stash (not Videos).\n' +
      'Includes video controls and can be upgraded to HD mode with audio support.\n' +
      'Supports a variety of web video extensions like mp4, m4v, webm, etc.'
    );
    imageSectionTitleContainer.appendChild(imageFeedInfo);
    imageSection.appendChild(imageSectionTitleContainer);

    // Include images toggle
    const includeImagesContainer = document.createElement('div');
    includeImagesContainer.style.display = 'flex';
    includeImagesContainer.style.justifyContent = 'space-between';
    includeImagesContainer.style.alignItems = 'center';
    includeImagesContainer.style.marginBottom = '16px';

    const includeImagesLabel = document.createElement('span');
    includeImagesLabel.textContent = 'Include images in feed';
    includeImagesLabel.style.color = THEME.colors.textSecondary;
    includeImagesLabel.style.fontSize = THEME.typography.sizeBody;
    includeImagesContainer.appendChild(includeImagesLabel);

    const { container: includeImagesToggleContainer, input: includeImagesToggle } = this.createToggleSwitch(
      this.settings.includeImagesInFeed !== false,
      () => this.saveSettings()
    );
    includeImagesContainer.appendChild(includeImagesToggleContainer);

    imageSection.appendChild(includeImagesContainer);

    // File types input
    const fileTypesContainer = document.createElement('div');
    fileTypesContainer.style.marginBottom = '16px';

    const fileTypesLabel = document.createElement('label');
    fileTypesLabel.textContent = 'File extensions (comma-separated)';
    fileTypesLabel.style.display = 'block';
    fileTypesLabel.style.color = THEME.colors.textSecondary;
    fileTypesLabel.style.fontSize = THEME.typography.sizeBody;
    fileTypesLabel.style.marginBottom = '8px';
    fileTypesLabel.style.fontWeight = THEME.typography.weightBodyStrong;
    fileTypesContainer.appendChild(fileTypesLabel);

    const fileTypesInput = document.createElement('input');
    fileTypesInput.type = 'text';
    fileTypesInput.value = (this.settings.enabledFileTypes || ['.jpg', '.png', '.gif', '.mp4', '.m4v', '.webm']).join(', ');
    fileTypesInput.style.width = '100%';
    fileTypesInput.style.padding = '12px';
    fileTypesInput.style.borderRadius = THEME.radius.button;
    fileTypesInput.style.border = `1px solid ${THEME.colors.border}`;
    fileTypesInput.style.backgroundColor = THEME.colors.surface;
    fileTypesInput.style.color = THEME.colors.textPrimary;
    fileTypesInput.style.fontSize = THEME.typography.sizeBody;
    fileTypesInput.style.boxSizing = 'border-box';
    fileTypesInput.placeholder = '.gif, .webm, .mp4';
    fileTypesContainer.appendChild(fileTypesInput);

    // Regex preview
    const regexPreview = document.createElement('div');
    regexPreview.style.marginTop = '8px';
    regexPreview.style.padding = '8px';
    regexPreview.style.backgroundColor = THEME.colors.backgroundSecondary;
    regexPreview.style.borderRadius = THEME.radius.button;
    regexPreview.style.fontSize = THEME.typography.sizeMeta;
    regexPreview.style.color = THEME.colors.textMuted;
    regexPreview.style.fontFamily = 'monospace';
    fileTypesContainer.appendChild(regexPreview);

    const updateRegexPreview = () => {
      const extensions = fileTypesInput.value
        .split(',')
        .map(ext => ext.trim())
        .filter(ext => ext.length > 0);
      
      if (extensions.length === 0) {
        regexPreview.textContent = String.raw`Regex: (?i)\.(gif)$`;
        return;
      }

      const cleanExtensions = extensions
        .map(ext => ext.replace(/^\./, '').toLowerCase())
        .filter(ext => /^[a-z0-9]+$/i.test(ext));
      
      if (cleanExtensions.length === 0) {
        regexPreview.textContent = String.raw`Regex: (?i)\.(gif)$`;
        return;
      }

      const regex = String.raw`(?i)\.(${cleanExtensions.join('|')})$`;
      regexPreview.textContent = `Regex: ${regex}`;
    };

    fileTypesInput.addEventListener('input', () => {
      updateRegexPreview();
      // Debounce the save to avoid too many saves while typing
      clearTimeout((fileTypesInput as any).saveTimeout);
      (fileTypesInput as any).saveTimeout = setTimeout(() => {
        this.saveSettings();
      }, 500);
    });
    updateRegexPreview();

    imageSection.appendChild(fileTypesContainer);

    // Images only toggle
    const imagesOnlyContainer = document.createElement('div');
    imagesOnlyContainer.style.display = 'flex';
    imagesOnlyContainer.style.justifyContent = 'space-between';
    imagesOnlyContainer.style.alignItems = 'center';
    imagesOnlyContainer.style.marginBottom = '16px';

    const imagesOnlyLabel = document.createElement('span');
    imagesOnlyLabel.textContent = 'Only load images (skip videos)';
    imagesOnlyLabel.style.color = THEME.colors.textSecondary;
    imagesOnlyLabel.style.fontSize = THEME.typography.sizeBody;
    imagesOnlyContainer.appendChild(imagesOnlyLabel);

    const { container: imagesOnlyToggleContainer, input: imagesOnlyToggle } = this.createToggleSwitch(
      this.settings.imagesOnly === true,
      (checked) => {
        if (checked) {
          includeImagesToggle.checked = true;
          includeImagesToggle.dispatchEvent(new Event('change'));
        }
        this.saveSettings();
      }
    );
    imagesOnlyContainer.appendChild(imagesOnlyToggleContainer);

    imageSection.appendChild(imagesOnlyContainer);

    generalContent.appendChild(imageSection);

    // Short Form Content Settings Section
    const shortFormSection = document.createElement('div');
    shortFormSection.style.marginBottom = '24px';
    shortFormSection.style.border = `1px solid ${THEME.colors.border}`;
    shortFormSection.style.borderRadius = THEME.radius.card;
    shortFormSection.style.padding = '16px';

    const shortFormSectionTitleContainer = document.createElement('div');
    shortFormSectionTitleContainer.style.display = 'flex';
    shortFormSectionTitleContainer.style.alignItems = 'center';
    shortFormSectionTitleContainer.style.marginBottom = '16px';

    const shortFormSectionTitle = document.createElement('h3');
    shortFormSectionTitle.textContent = 'Short-Form Videos';
    shortFormSectionTitle.style.margin = '0';
    shortFormSectionTitle.style.color = THEME.colors.textPrimary;
    shortFormSectionTitle.style.fontSize = THEME.typography.sizeTitle;
    shortFormSectionTitle.style.fontWeight = THEME.typography.weightTitle;
    shortFormSectionTitleContainer.appendChild(shortFormSectionTitle);

    const shortFormInfo = this.createInfoButton(
      'Scenes (videos) below a certain length.\n\n' +
      'Treated as Videos by Stash (not Images).\n' +
      'Full video playback with controls.\n' +
      'Supports HD and non-HD modes.'
    );
    shortFormSectionTitleContainer.appendChild(shortFormInfo);
    shortFormSection.appendChild(shortFormSectionTitleContainer);

    // Include short-form videos toggle
    const shortFormIncludeContainer = document.createElement('div');
    shortFormIncludeContainer.style.display = 'flex';
    shortFormIncludeContainer.style.justifyContent = 'space-between';
    shortFormIncludeContainer.style.alignItems = 'center';
    shortFormIncludeContainer.style.marginBottom = '16px';

    const shortFormIncludeLabel = document.createElement('span');
    shortFormIncludeLabel.textContent = 'Include short-form videos in feed';
    shortFormIncludeLabel.style.color = THEME.colors.textSecondary;
    shortFormIncludeLabel.style.fontSize = THEME.typography.sizeBody;
    shortFormIncludeContainer.appendChild(shortFormIncludeLabel);

    const { container: shortFormIncludeToggleContainer, input: shortFormIncludeToggle } = this.createToggleSwitch(
      this.settings.shortFormInHDMode !== false || this.settings.shortFormInNonHDMode !== false,
      () => this.saveSettings()
    );
    shortFormIncludeContainer.appendChild(shortFormIncludeToggleContainer);

    shortFormSection.appendChild(shortFormIncludeContainer);

    // Max duration input
    const maxDurationContainer = document.createElement('div');
    maxDurationContainer.style.marginBottom = '16px';

    const maxDurationLabel = document.createElement('label');
    maxDurationLabel.textContent = 'Maximum duration (seconds)';
    maxDurationLabel.style.display = 'block';
    maxDurationLabel.style.color = THEME.colors.textSecondary;
    maxDurationLabel.style.fontSize = THEME.typography.sizeBody;
    maxDurationLabel.style.marginBottom = '8px';
    maxDurationLabel.style.fontWeight = THEME.typography.weightBodyStrong;
    maxDurationContainer.appendChild(maxDurationLabel);

    const maxDurationInput = document.createElement('input');
    maxDurationInput.type = 'number';
    maxDurationInput.value = String(this.settings.shortFormMaxDuration || 120);
    maxDurationInput.min = '1';
    maxDurationInput.max = '600';
    maxDurationInput.style.width = '100%';
    maxDurationInput.style.padding = '12px';
    maxDurationInput.style.borderRadius = THEME.radius.button;
    maxDurationInput.style.border = `1px solid ${THEME.colors.border}`;
    maxDurationInput.style.backgroundColor = THEME.colors.surface;
    maxDurationInput.style.color = THEME.colors.textPrimary;
    maxDurationInput.style.fontSize = THEME.typography.sizeBody;
    maxDurationInput.style.boxSizing = 'border-box';
    maxDurationInput.addEventListener('input', () => {
      // Debounce the save to avoid too many saves while typing
      clearTimeout((maxDurationInput as any).saveTimeout);
      (maxDurationInput as any).saveTimeout = setTimeout(() => {
        this.saveSettings();
      }, 500);
    });
    maxDurationContainer.appendChild(maxDurationInput);

    shortFormSection.appendChild(maxDurationContainer);

    // Only short form content toggle
    const shortFormOnlyContainer = document.createElement('div');
    shortFormOnlyContainer.style.display = 'flex';
    shortFormOnlyContainer.style.justifyContent = 'space-between';
    shortFormOnlyContainer.style.alignItems = 'center';
    shortFormOnlyContainer.style.marginBottom = '16px';

    const shortFormOnlyLabel = document.createElement('span');
    shortFormOnlyLabel.textContent = 'Only short-form videos (skip regular videos)';
    shortFormOnlyLabel.style.color = THEME.colors.textSecondary;
    shortFormOnlyLabel.style.fontSize = THEME.typography.sizeBody;
    shortFormOnlyContainer.appendChild(shortFormOnlyLabel);

    const { container: shortFormOnlyToggleContainer, input: shortFormOnlyToggle } = this.createToggleSwitch(
      this.settings.shortFormOnly === true,
      (checked) => {
        if (checked) {
          shortFormIncludeToggle.checked = true;
          shortFormIncludeToggle.dispatchEvent(new Event('change'));
        }
        this.saveSettings();
      }
    );
    shortFormOnlyContainer.appendChild(shortFormOnlyToggleContainer);

    shortFormSection.appendChild(shortFormOnlyContainer);

    generalContent.appendChild(shortFormSection);


    // Version footer
    const versionFooter = document.createElement('div');
    versionFooter.style.marginTop = '32px';
    versionFooter.style.paddingTop = '24px';
    versionFooter.style.borderTop = `1px solid ${THEME.colors.border}`;
    versionFooter.style.textAlign = 'center';

    const versionText = document.createElement('div');
    const buildHash = (version as { BUILD_HASH?: string }).BUILD_HASH ?? 'dev';
    versionText.textContent = `Version ${version.VERSION} (${buildHash})`;
    versionText.style.color = THEME.colors.textMuted;
    versionText.style.fontSize = THEME.typography.sizeMeta;
    versionFooter.appendChild(versionText);

    const feedbackText = document.createElement('div');
    feedbackText.textContent = 'Suggestions or requests:';
    feedbackText.style.color = THEME.colors.textMuted;
    feedbackText.style.fontSize = THEME.typography.sizeMeta;
    feedbackText.style.marginTop = '8px';
    versionFooter.appendChild(feedbackText);

    const feedbackLinks = document.createElement('div');
    feedbackLinks.style.marginTop = '6px';
    feedbackLinks.style.display = 'flex';
    feedbackLinks.style.justifyContent = 'center';
    feedbackLinks.style.gap = '12px';

    const createFooterLink = (label: string, href: string): HTMLAnchorElement => {
      const link = document.createElement('a');
      link.textContent = label;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.style.color = THEME.colors.accentPrimary;
      link.style.fontSize = THEME.typography.sizeMeta;
      link.style.textDecoration = 'none';
      link.style.transition = 'color 0.2s ease';

      link.addEventListener('mouseenter', () => {
        link.style.color = THEME.colors.textPrimary;
      });
      link.addEventListener('mouseleave', () => {
        link.style.color = THEME.colors.accentPrimary;
      });

      return link;
    };

    feedbackLinks.appendChild(
      createFooterLink(
        '💬 Discourse',
        'https://discourse.stashapp.cc/t/stashgifs-social-media-style-browsing-experience'
      )
    );
    feedbackLinks.appendChild(
      createFooterLink('💻 GitHub', 'https://github.com/evolite/stashgifs')
    );
    versionFooter.appendChild(feedbackLinks);

    const supportLinks = document.createElement('div');
    supportLinks.style.marginTop = '6px';
    supportLinks.style.display = 'flex';
    supportLinks.style.justifyContent = 'center';
    supportLinks.style.gap = '12px';
    supportLinks.appendChild(
      createFooterLink('☕ Buy Me a Coffee', 'https://buymeacoffee.com/evolite')
    );
    versionFooter.appendChild(supportLinks);

    generalContent.appendChild(versionFooter);

    // Store references to inputs for saveSettings method
    (this as any).fileTypesInput = fileTypesInput;
    (this as any).maxDurationInput = maxDurationInput;
    (this as any).includeImagesToggle = includeImagesToggle;
    (this as any).imagesOnlyToggle = imagesOnlyToggle;
    (this as any).shortFormIncludeToggle = shortFormIncludeToggle;
    (this as any).shortFormOnlyToggle = shortFormOnlyToggle;
    (this as any).reelModeToggle = reelModeToggle;

    this.container.appendChild(modal);

    // Close on background click (but not when clicking inside modal)
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.close();
      }
    });
    
    // Prevent clicks inside modal from closing
    modal.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close on Escape key
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  }

  /**
   * Save settings automatically when toggles/inputs change
   */
  private saveSettings(): void {
    const fileTypesInput = (this as any).fileTypesInput as HTMLInputElement | undefined;
    const maxDurationInput = (this as any).maxDurationInput as HTMLInputElement | undefined;
    const includeImagesToggle = (this as any).includeImagesToggle as HTMLInputElement | undefined;
    const imagesOnlyToggle = (this as any).imagesOnlyToggle as HTMLInputElement | undefined;
    const shortFormIncludeToggle = (this as any).shortFormIncludeToggle as HTMLInputElement | undefined;
    const shortFormOnlyToggle = (this as any).shortFormOnlyToggle as HTMLInputElement | undefined;
    const reelModeToggle = (this as any).reelModeToggle as HTMLInputElement | undefined;
    const themeBackgroundInput = (this as any).themeBackgroundInput as HTMLInputElement | undefined;
    const themePrimaryInput = (this as any).themePrimaryInput as HTMLInputElement | undefined;
    const themeSecondaryInput = (this as any).themeSecondaryInput as HTMLInputElement | undefined;
    const themeAccentInput = (this as any).themeAccentInput as HTMLInputElement | undefined;

    if (!fileTypesInput || !maxDurationInput || !includeImagesToggle || !imagesOnlyToggle || 
        !shortFormIncludeToggle || !shortFormOnlyToggle || !reelModeToggle ||
        !themeBackgroundInput || !themePrimaryInput || !themeSecondaryInput || !themeAccentInput) {
      return; // Settings not fully initialized yet
    }

    const extensions = fileTypesInput.value
      .split(',')
      .map(ext => ext.trim())
      .filter(ext => ext.length > 0)
      .map(ext => ext.startsWith('.') ? ext : `.${ext}`);

    const maxDuration = Number.parseInt(maxDurationInput.value, 10);
    const validMaxDuration = !Number.isNaN(maxDuration) && maxDuration > 0 ? maxDuration : 120;

    const newSettings: Partial<FeedSettings> = {
      includeImagesInFeed: includeImagesToggle.checked,
      enabledFileTypes: extensions.length > 0 ? extensions : ['.jpg', '.png', '.gif', '.mp4', '.m4v', '.webm'],
      imagesOnly: imagesOnlyToggle.checked,
      shortFormInHDMode: shortFormIncludeToggle.checked,
      shortFormInNonHDMode: shortFormIncludeToggle.checked,
      shortFormMaxDuration: validMaxDuration,
      shortFormOnly: shortFormOnlyToggle.checked,
      reelMode: reelModeToggle.checked,
      snapToCards: reelModeToggle.checked,
      themeBackground: themeBackgroundInput.value,
      themePrimary: themePrimaryInput.value,
      themeSecondary: themeSecondaryInput.value,
      themeAccent: themeAccentInput.value,
    };

    // Notify parent to update settings and reload feed if needed
    // Parent (FeedContainer) will handle saving to localStorage
    if (this.onSave) {
      this.onSave(newSettings);
    }
  }

  private close(): void {
    if (this.onClose) {
      this.onClose();
    }
    this.container.innerHTML = '';
    this.container.style.display = 'none';
  }
}

