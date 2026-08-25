/**
 * Settings Page Component
 * Allows users to configure file types and image feed settings
 */


import { FeedSettings } from './types.js';
import * as version from './version.js';
import { THEME, THEME_DEFAULTS, normalizeHexColor } from './utils.js';
import { WhisparrClient } from './WhisparrClient.js';

export class SettingsPage {
  private readonly container: HTMLElement;
  private readonly settings: FeedSettings;
  private readonly findGalleries?: (signal?: AbortSignal) => Promise<Array<{ id: string; title?: string; folder?: { path?: string } }>>;
  private readonly onSave?: (settings: Partial<FeedSettings>) => void;
  private readonly onClose?: () => void;

  constructor(
    container: HTMLElement,
    settings: FeedSettings,
    findGalleries?: (signal?: AbortSignal) => Promise<Array<{ id: string; title?: string; folder?: { path?: string } }>>,
    onSave?: (settings: Partial<FeedSettings>) => void,
    onClose?: () => void
  ) {
    this.container = container;
    this.settings = settings;
    this.findGalleries = findGalleries;
    this.onSave = onSave;
    this.onClose = onClose;
    this.render();
  }

  /**
   * Create an info button with hover tooltip
   */
  private attachTooltip(trigger: HTMLElement, tooltipText: string): void {
    const tooltip = document.createElement('div');
    tooltip.textContent = tooltipText;
    tooltip.style.position = 'fixed';
    tooltip.style.padding = '8px 12px';
    tooltip.style.backgroundColor = THEME.colors.overlay;
    tooltip.style.color = THEME.colors.textPrimary;
    tooltip.style.fontSize = THEME.typography.sizeMeta;
    tooltip.style.fontFamily = THEME.typography.fontFamily;
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
    this.container.appendChild(tooltip);

    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
      let top = rect.top - tooltipRect.height - 8;
      if (left < containerRect.left + 10) left = containerRect.left + 10;
      if (left + tooltipRect.width > containerRect.right - 10) left = containerRect.right - tooltipRect.width - 10;
      if (top < containerRect.top + 10) top = rect.bottom + 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    trigger.addEventListener('mouseenter', () => { updatePosition(); tooltip.style.opacity = '1'; });
    trigger.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
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
    slider.style.backgroundColor = checked ? THEME.colors.accentPrimary : THEME.colors.border;
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
      slider.style.backgroundColor = isChecked ? THEME.colors.accentPrimary : THEME.colors.border;
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
    tabBar.style.gap = '6px';
    tabBar.style.marginBottom = '16px';
    tabBar.style.alignItems = 'center';
    tabBar.style.flexWrap = 'nowrap';
    tabBar.style.width = '100%';

    const createTabButton = (label: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.flex = '1 1 0';
      button.style.minWidth = '0';
      button.style.padding = '0 4px';
      button.style.height = '38px';
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
      button.style.overflow = 'hidden';
      button.style.textOverflow = 'ellipsis';
      button.style.whiteSpace = 'nowrap';
      button.style.transition = 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease';
      return button;
    };

    const layoutTabButton = createTabButton('Feed');
    const filtersTabButton = createTabButton('Filters');
    const contentTabButton = createTabButton('Appearance');
    const whisparrTabButton = createTabButton('Discovery');
    tabBar.appendChild(layoutTabButton);
    tabBar.appendChild(filtersTabButton);
    tabBar.appendChild(contentTabButton);
    tabBar.appendChild(whisparrTabButton);
    modal.appendChild(tabBar);

    const contentWrapper = document.createElement('div');
    contentWrapper.style.flex = '1 1 auto';
    contentWrapper.style.overflowY = 'auto';
    contentWrapper.style.paddingRight = '4px';
    contentWrapper.style.marginRight = '-4px';

    const layoutContent = document.createElement('div');
    const filtersContent = document.createElement('div');
    filtersContent.style.display = 'none';
    const contentTabContent = document.createElement('div');
    contentTabContent.style.display = 'none';
    const whisparrContent = document.createElement('div');
    whisparrContent.style.display = 'none';

    const setActiveTab = (active: 'layout' | 'filters' | 'content' | 'whisparr') => {
      layoutContent.style.display     = active === 'layout'   ? 'block' : 'none';
      filtersContent.style.display    = active === 'filters'  ? 'block' : 'none';
      contentTabContent.style.display = active === 'content'  ? 'block' : 'none';
      whisparrContent.style.display   = active === 'whisparr' ? 'block' : 'none';

      const tabs = [
        { btn: layoutTabButton,   key: 'layout'   },
        { btn: filtersTabButton,  key: 'filters'  },
        { btn: contentTabButton,  key: 'content'  },
        { btn: whisparrTabButton, key: 'whisparr' },
      ];
      for (const { btn, key } of tabs) {
        const on = active === key;
        btn.style.background  = on ? THEME.colors.accentPrimary        : THEME.colors.backgroundSecondary;
        btn.style.color       = on ? THEME.colors.textPrimary          : THEME.colors.textSecondary;
        btn.style.borderColor = on ? THEME.colors.accentPrimary        : THEME.colors.border;
      }
    };

    layoutTabButton.addEventListener('click',   () => setActiveTab('layout'));
    filtersTabButton.addEventListener('click',  () => setActiveTab('filters'));
    contentTabButton.addEventListener('click',  () => setActiveTab('content'));
    whisparrTabButton.addEventListener('click', () => setActiveTab('whisparr'));
    setActiveTab('layout');

    contentWrapper.appendChild(layoutContent);
    contentWrapper.appendChild(filtersContent);
    contentWrapper.appendChild(contentTabContent);
    contentWrapper.appendChild(whisparrContent);
    modal.appendChild(contentWrapper);

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
      {
        id: 'refract-lite',
        label: 'Refract Lite',
        colors: {
          background: '#0a0a0a',
          primary: '#111111',
          secondary: '#1c1c1c',
          accent: '#f97316',
        },
      },
    ];

    const buildInfoLabel = (labelText: string, tooltipText: string, important = false): HTMLElement => {
      const labelContainer = document.createElement('div');
      labelContainer.style.cssText = 'display: flex; align-items: center; gap: 6px;';
      const label = document.createElement('span');
      label.textContent = labelText;
      label.style.cssText = `color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody}; cursor: help;`;
      labelContainer.appendChild(label);
      this.attachTooltip(label, tooltipText);
      if (important) {
        // Visible "read me" badge so it's obvious there's guidance behind the tooltip.
        const badge = document.createElement('span');
        badge.textContent = 'ⓘ Read';
        badge.setAttribute('aria-label', 'Important: read before enabling');
        badge.style.cssText = `display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; color: ${THEME.colors.accentPrimary}; border: 1px solid ${THEME.colors.accentPrimary}; cursor: help; white-space: nowrap;`;
        labelContainer.appendChild(badge);
        this.attachTooltip(badge, tooltipText);
      }
      return labelContainer;
    };

    const createLabelledRow = (labelText: string, tooltipText: string): HTMLDivElement => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.marginBottom = '16px';
      row.appendChild(buildInfoLabel(labelText, tooltipText));
      return row;
    };

    const buildThemePresetRow = (labelText: string, tooltipText: string): { row: HTMLElement; select: HTMLSelectElement } => {
      const row = createLabelledRow(labelText, tooltipText);

      const select = document.createElement('select');
      select.style.minWidth = '200px';
      select.style.padding = '8px 12px';
      this.applySelectBaseStyle(select);
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

    const buildThemeRow = (
      labelText: string,
      value: string,
      tooltipText: string
    ): { row: HTMLElement; input: HTMLInputElement; valueLabel: HTMLElement } => {
      const row = createLabelledRow(labelText, tooltipText);

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

    const presetRow = buildThemePresetRow(
      'Theme preset',
      'Applies a predefined palette to background, surfaces, and accents.'
    );

    const backgroundRow = buildThemeRow(
      'Background',
      backgroundValue,
      'Sets the main app background behind cards and panels.'
    );
    const primaryRow = buildThemeRow(
      'Primary',
      primaryValue,
      'Sets the main card surface color.'
    );
    const secondaryRow = buildThemeRow(
      'Secondary',
      secondaryValue,
      'Sets secondary surfaces like inputs and panels.'
    );
    const accentRow = buildThemeRow(
      'Accent',
      accentValue,
      'Sets highlight color for icons and emphasis.'
    );

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

    const applyThemeColors = (colors: { background: string; primary: string; secondary: string; accent: string }) => {
      backgroundRow.input.value = colors.background;
      primaryRow.input.value = colors.primary;
      secondaryRow.input.value = colors.secondary;
      accentRow.input.value = colors.accent;
      updateThemeLabel(backgroundRow.input, backgroundRow.valueLabel);
      updateThemeLabel(primaryRow.input, primaryRow.valueLabel);
      updateThemeLabel(secondaryRow.input, secondaryRow.valueLabel);
      updateThemeLabel(accentRow.input, accentRow.valueLabel);
      setPresetSelectValue();
      this.saveSettings();
    };

    const applyThemePreset = (preset: typeof themePresets[number]) => {
      applyThemeColors(preset.colors);
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
      applyThemeColors({
        background: THEME_DEFAULTS.backgroundPrimary,
        primary: THEME_DEFAULTS.surface,
        secondary: THEME_DEFAULTS.backgroundSecondary,
        accent: THEME_DEFAULTS.accentPrimary
      });
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

    contentTabContent.appendChild(themeSection);

    // Layout Settings Section
    const layoutSection = document.createElement('div');
    layoutSection.style.marginBottom = '24px';
    layoutSection.style.border = `1px solid ${THEME.colors.border}`;
    layoutSection.style.borderRadius = THEME.radius.card;
    layoutSection.style.padding = '16px';

    const layoutSectionTitle = document.createElement('h3');
    layoutSectionTitle.textContent = 'Post';
    layoutSectionTitle.style.margin = '0 0 16px 0';
    layoutSectionTitle.style.color = THEME.colors.textPrimary;
    layoutSectionTitle.style.fontSize = THEME.typography.sizeTitle;
    layoutSectionTitle.style.fontWeight = THEME.typography.weightTitle;
    layoutSection.appendChild(layoutSectionTitle);


    const reelAutoScrollContainer = document.createElement('div');
    reelAutoScrollContainer.style.display = 'flex';
    reelAutoScrollContainer.style.justifyContent = 'space-between';
    reelAutoScrollContainer.style.alignItems = 'center';
    reelAutoScrollContainer.style.marginBottom = '16px';
    reelAutoScrollContainer.appendChild(
      buildInfoLabel(
        'Auto-Scroll',
        'Automatically advance to the next post when the current video loops.'
      )
    );
    const { container: reelAutoScrollToggleContainer, input: reelAutoScrollToggle } = this.createToggleSwitch(
      this.settings.reelAutoScroll === true,
      () => this.saveSettings()
    );
    reelAutoScrollContainer.appendChild(reelAutoScrollToggleContainer);
    (this as any).reelAutoScrollToggle = reelAutoScrollToggle;

    const autoHideSearchBarContainer = document.createElement('div');
    autoHideSearchBarContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
    autoHideSearchBarContainer.appendChild(buildInfoLabel(
      'Auto-Hide Search Bar',
      'Hides the search bar when scrolling down, and reveals it when scrolling up.'
    ));
    const { container: autoHideSearchBarToggleContainer, input: autoHideSearchBarToggle } = this.createToggleSwitch(
      this.settings.autoHideSearchBar !== false,
      () => this.saveSettings()
    );
    autoHideSearchBarContainer.appendChild(autoHideSearchBarToggleContainer);
    (this as any).autoHideSearchBarToggle = autoHideSearchBarToggle;

    // Marker title search toggle (search-bar feature — lives alongside Auto-Hide Search Bar)
    const { container: searchMarkersByNameToggleContainer, input: searchMarkersByNameToggle } = this.createToggleSwitch(
      this.settings.searchMarkersByName === true,
      () => this.saveSettings()
    );
    const searchMarkersByNameRow = document.createElement('div');
    searchMarkersByNameRow.style.display = 'flex';
    searchMarkersByNameRow.style.justifyContent = 'space-between';
    searchMarkersByNameRow.style.alignItems = 'center';
    searchMarkersByNameRow.style.marginBottom = '16px';
    searchMarkersByNameRow.appendChild(buildInfoLabel('Marker Title Search', 'Show a Title section in the search bar so you can find markers by title. When enabled, marker posts also display the marker\'s title instead of its tags.'));
    searchMarkersByNameRow.appendChild(searchMarkersByNameToggleContainer);

    const hdVideoContainer = document.createElement('div');
    hdVideoContainer.style.display = 'flex';
    hdVideoContainer.style.justifyContent = 'space-between';
    hdVideoContainer.style.alignItems = 'center';
    hdVideoContainer.style.marginBottom = '16px';

    hdVideoContainer.appendChild(
      buildInfoLabel(
        'HD Video',
        'Loads full scene videos directly from Stash instead of pre-rendered preview clips.\n\nEnables seek-to-marker, random start positions, and full resolution — but uses more bandwidth and may load slower on slow connections.'
      )
    );

    const { container: hdVideoToggleContainer, input: hdVideoToggle } = this.createToggleSwitch(
      this.settings.hdMode !== false,
      () => this.saveSettings()
    );
    hdVideoContainer.appendChild(hdVideoToggleContainer);
    (this as any).hdVideoToggle = hdVideoToggle;

    const verifiedCheckmarksContainer = document.createElement('div');
    verifiedCheckmarksContainer.style.display = 'flex';
    verifiedCheckmarksContainer.style.justifyContent = 'space-between';
    verifiedCheckmarksContainer.style.alignItems = 'center';
    verifiedCheckmarksContainer.style.marginBottom = '16px';

    verifiedCheckmarksContainer.appendChild(
      buildInfoLabel(
        'Display Verified Badge',
        'Shows a verified badge on performer chips when they have a Stash ID.'
      )
    );

    const { container: verifiedCheckmarksToggleContainer, input: verifiedCheckmarksToggle } = this.createToggleSwitch(
      this.settings.showVerifiedCheckmarks !== false,
      () => this.saveSettings()
    );
    verifiedCheckmarksContainer.appendChild(verifiedCheckmarksToggleContainer);
    layoutSection.appendChild(verifiedCheckmarksContainer);
    (this as any).showVerifiedCheckmarksToggle = verifiedCheckmarksToggle;

    const productionAgeContainer = document.createElement('div');
    productionAgeContainer.style.display = 'flex';
    productionAgeContainer.style.justifyContent = 'space-between';
    productionAgeContainer.style.alignItems = 'center';
    productionAgeContainer.style.marginBottom = '16px';

    productionAgeContainer.appendChild(
      buildInfoLabel(
        'Performer Age',
        'Shows the performer\'s age next to their name. Shows age at time of production (marked with *) when a date is available, otherwise current age.'
      )
    );

    const { container: productionAgeToggleContainer, input: productionAgeToggle } = this.createToggleSwitch(
      this.settings.showProductionAge === true,
      () => this.saveSettings()
    );
    productionAgeContainer.appendChild(productionAgeToggleContainer);

    layoutSection.appendChild(productionAgeContainer);
    (this as any).showProductionAgeToggle = productionAgeToggle;

    const studioChipsContainer = document.createElement('div');
    studioChipsContainer.style.display = 'flex';
    studioChipsContainer.style.justifyContent = 'space-between';
    studioChipsContainer.style.alignItems = 'center';
    studioChipsContainer.style.marginBottom = '16px';

    studioChipsContainer.appendChild(
      buildInfoLabel(
        'Studio Chips',
        'Shows the studio logo and name alongside performer chips.'
      )
    );

    const { container: studioChipsToggleContainer, input: studioChipsToggle } = this.createToggleSwitch(
      this.settings.showStudioChips !== false,
      () => this.saveSettings()
    );
    studioChipsContainer.appendChild(studioChipsToggleContainer);
    layoutSection.appendChild(studioChipsContainer);
    (this as any).showStudioChipsToggle = studioChipsToggle;

    const performerEmbellishmentContainer = document.createElement('div');
    performerEmbellishmentContainer.style.display = 'flex';
    performerEmbellishmentContainer.style.justifyContent = 'space-between';
    performerEmbellishmentContainer.style.alignItems = 'center';
    performerEmbellishmentContainer.style.marginBottom = '16px';

    performerEmbellishmentContainer.appendChild(
      buildInfoLabel(
        'Performer Tier Badges',
        'Shows a laurel-wreath tier badge on performer avatars, based on their rating.'
      )
    );

    const { container: performerEmbellishmentToggleContainer, input: performerEmbellishmentToggle } = this.createToggleSwitch(
      this.settings.showPerformerEmbellishment === true,
      () => this.saveSettings()
    );
    performerEmbellishmentContainer.appendChild(performerEmbellishmentToggleContainer);
    layoutSection.appendChild(performerEmbellishmentContainer);
    (this as any).showPerformerEmbellishmentToggle = performerEmbellishmentToggle;

    const sceneTitleContainer = document.createElement('div');
    sceneTitleContainer.style.display = 'flex';
    sceneTitleContainer.style.justifyContent = 'space-between';
    sceneTitleContainer.style.alignItems = 'center';
    sceneTitleContainer.style.marginBottom = '16px';

    sceneTitleContainer.appendChild(
      buildInfoLabel(
        'Scene Title',
        'Shows the scene or image title above performers in each post.'
      )
    );

    const { container: sceneTitleToggleContainer, input: sceneTitleToggle } = this.createToggleSwitch(
      this.settings.showSceneTitle === true,
      () => this.saveSettings()
    );
    sceneTitleContainer.appendChild(sceneTitleToggleContainer);
    layoutSection.appendChild(sceneTitleContainer);
    (this as any).sceneTitleToggle = sceneTitleToggle;

    const tagLimitRow = document.createElement('div');
    tagLimitRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    tagLimitRow.appendChild(buildInfoLabel('Tag Limit', 'Max number of tags shown per post before collapsing into a • • • button.'));
    const tagDisplayLimitInput = document.createElement('input');
    tagDisplayLimitInput.type = 'number';
    tagDisplayLimitInput.value = String(this.settings.tagDisplayLimit ?? 10);
    tagDisplayLimitInput.min = '1';
    tagDisplayLimitInput.max = '100';
    tagDisplayLimitInput.style.cssText = `width: 64px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; text-align: right; box-sizing: border-box;`;
    tagDisplayLimitInput.addEventListener('input', () => {
      clearTimeout((tagDisplayLimitInput as any).saveTimeout);
      (tagDisplayLimitInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    tagLimitRow.appendChild(tagDisplayLimitInput);
    layoutSection.appendChild(tagLimitRow);
    (this as any).tagDisplayLimitInput = tagDisplayLimitInput;

    const performerLimitRow = document.createElement('div');
    performerLimitRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    performerLimitRow.appendChild(buildInfoLabel('Performer Limit', 'Max number of performers shown with full name before collapsing into a • • • button; expanding shows the rest as portrait-only chips.'));
    const performerDisplayLimitInput = document.createElement('input');
    performerDisplayLimitInput.type = 'number';
    performerDisplayLimitInput.value = String(this.settings.performerDisplayLimit ?? 3);
    performerDisplayLimitInput.min = '1';
    performerDisplayLimitInput.max = '100';
    performerDisplayLimitInput.style.cssText = `width: 64px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; text-align: right; box-sizing: border-box;`;
    performerDisplayLimitInput.addEventListener('input', () => {
      clearTimeout((performerDisplayLimitInput as any).saveTimeout);
      (performerDisplayLimitInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    performerLimitRow.appendChild(performerDisplayLimitInput);
    layoutSection.appendChild(performerLimitRow);
    (this as any).performerDisplayLimitInput = performerDisplayLimitInput;

    const appendButtonToggle = (labelText: string, tooltip: string, checked: boolean, refKey: string): void => {
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.justifyContent = 'space-between';
      container.style.alignItems = 'center';
      container.style.marginBottom = '16px';
      container.appendChild(buildInfoLabel(labelText, tooltip));
      const { container: toggleContainer, input } = this.createToggleSwitch(checked, () => this.saveSettings());
      container.appendChild(toggleContainer);
      layoutSection.appendChild(container);
      (this as any)[refKey] = input;
    };
    appendButtonToggle(
      'Show Bookmark Button',
      'Show a bookmark button to add the scene to your "Stashgifs bookmark" tag in Stash.',
      this.settings.showBookmarkButton === true,
      'showBookmarkToggle',
    );
    appendButtonToggle(
      'Show O-Count Button',
      'Show the O-count button in the post button group.',
      this.settings.showOCountButton !== false,
      'showOCountToggle',
    );
    appendButtonToggle(
      'Show View Count',
      'Show the view-count badge in the post button group.',
      this.settings.showViewCountBadge !== false,
      'showViewCountToggle',
    );
    appendButtonToggle(
      'Show Rating Button',
      'Show the star rating control in the post button group.',
      this.settings.showRatingButton !== false,
      'showRatingToggle',
    );

    // ── Content Types Section ──────────────────────────────────────────────
    const contentTypesSection = document.createElement('div');
    contentTypesSection.style.marginBottom = '24px';
    contentTypesSection.style.border = `1px solid ${THEME.colors.border}`;
    contentTypesSection.style.borderRadius = THEME.radius.card;
    contentTypesSection.style.padding = '16px';

    const contentTypesTitleRow = document.createElement('div');
    contentTypesTitleRow.style.display = 'flex';
    contentTypesTitleRow.style.alignItems = 'center';
    contentTypesTitleRow.style.marginBottom = '16px';

    const contentTypesTitle = document.createElement('h3');
    contentTypesTitle.textContent = 'Content Types';
    contentTypesTitle.style.margin = '0';
    contentTypesTitle.style.color = THEME.colors.textPrimary;
    contentTypesTitle.style.fontSize = THEME.typography.sizeTitle;
    contentTypesTitle.style.fontWeight = THEME.typography.weightTitle;
    contentTypesTitle.style.cursor = 'help';
    this.attachTooltip(contentTypesTitle,
      'Select which content types appear in your feed.\n\n' +
      'Markers — Scene marker clips from your Stash library.\n' +
      'Random — Full scenes played from a random position. Tag filters and search do not apply.\n' +
      'Short-Form — Full scenes shorter than a set length (default 120 seconds).\n' +
      'Images — Images and image-video files (GIFs, MP4s, etc.).\n' +
      'Scene Previews — Short hover-preview clips generated for each scene.'
    );
    contentTypesTitleRow.appendChild(contentTypesTitle);
    contentTypesSection.appendChild(contentTypesTitleRow);

    // Markers toggle
    const { container: markersToggleContainer, input: includeMarkersToggle } = this.createToggleSwitch(
      this.settings.includeMarkersInFeed !== false,
      () => this.saveSettings()
    );
    const markersRow = document.createElement('div');
    markersRow.style.display = 'flex';
    markersRow.style.justifyContent = 'space-between';
    markersRow.style.alignItems = 'center';
    markersRow.style.marginBottom = '12px';
    markersRow.appendChild(buildInfoLabel('Markers', 'Scene marker clips from your Stash library.'));
    markersRow.appendChild(markersToggleContainer);
    contentTypesSection.appendChild(markersRow);

    // Short-Form toggle
    const { container: shortFormIncludeToggleContainer, input: shortFormIncludeToggle } = this.createToggleSwitch(
      this.settings.includeShortForm !== false,
      () => this.saveSettings()
    );
    const shortFormRow = document.createElement('div');
    shortFormRow.style.display = 'flex';
    shortFormRow.style.justifyContent = 'space-between';
    shortFormRow.style.alignItems = 'center';
    shortFormRow.appendChild(buildInfoLabel('Short-Form', 'Full scenes shorter than a set length (default 120 seconds).'));
    shortFormRow.appendChild(shortFormIncludeToggleContainer);

    const shortFormMaxDurationRow = document.createElement('div');
    shortFormMaxDurationRow.style.cssText = `margin-top: 6px; padding: 6px 8px 6px 12px; background: ${THEME.colors.backgroundSecondary}; border-radius: ${THEME.radius.card}; display: flex; justify-content: space-between; align-items: center;`;
    const maxDurationLabel = document.createElement('span');
    maxDurationLabel.textContent = 'Max duration (seconds)';
    maxDurationLabel.style.cssText = `color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody};`;
    shortFormMaxDurationRow.appendChild(maxDurationLabel);
    const maxDurationInput = document.createElement('input');
    maxDurationInput.type = 'number';
    maxDurationInput.value = String(this.settings.shortFormMaxDuration || 120);
    maxDurationInput.min = '1';
    maxDurationInput.max = '600';
    maxDurationInput.style.cssText = `width: 72px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; text-align: right; box-sizing: border-box;`;
    maxDurationInput.addEventListener('input', () => {
      clearTimeout((maxDurationInput as any).saveTimeout);
      (maxDurationInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    shortFormMaxDurationRow.appendChild(maxDurationInput);

    const shortFormWrapper = document.createElement('div');
    shortFormWrapper.style.marginBottom = '12px';
    shortFormWrapper.appendChild(shortFormRow);
    shortFormWrapper.appendChild(shortFormMaxDurationRow);
    contentTypesSection.appendChild(shortFormWrapper);

    // Images toggle
    const { container: includeImagesToggleContainer, input: includeImagesToggle } = this.createToggleSwitch(
      this.settings.includeImagesInFeed !== false,
      () => this.saveSettings()
    );
    const imagesRow = document.createElement('div');
    imagesRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    imagesRow.appendChild(buildInfoLabel('Images', 'Images and image-video files from your Stash library. Supports: jpg, png, gif, mp4, m4v, webm, etc.'));
    imagesRow.appendChild(includeImagesToggleContainer);

    // Random toggle
    const { container: includeRandomToggleContainer, input: includeRandomToggle } = this.createToggleSwitch(
      this.settings.includeRandomInFeed === true,
      () => this.saveSettings()
    );
    const randomWrapper = document.createElement('div');

    const randomRow = document.createElement('div');
    randomRow.style.display = 'flex';
    randomRow.style.justifyContent = 'space-between';
    randomRow.style.alignItems = 'center';
    randomRow.appendChild(buildInfoLabel('Random', 'Full scenes from your library played from a random position. Tag filters and search do not apply.'));
    randomRow.appendChild(includeRandomToggleContainer);

    const randomMarkersRow = document.createElement('div');
    randomMarkersRow.style.display = 'flex';
    randomMarkersRow.style.justifyContent = 'space-between';
    randomMarkersRow.style.alignItems = 'center';
    randomMarkersRow.style.marginTop = '6px';
    randomMarkersRow.style.padding = '8px 0 8px 12px';
    randomMarkersRow.style.background = THEME.colors.backgroundSecondary;
    randomMarkersRow.style.borderRadius = THEME.radius.card;
    const { container: randomIncludeScenesWithMarkersContainer, input: randomIncludeScenesWithMarkersToggle } = this.createToggleSwitch(
      this.settings.randomIncludeScenesWithMarkers === true,
      () => this.saveSettings()
    );
    randomMarkersRow.appendChild(buildInfoLabel('Marked scenes', 'Also include scenes that have markers, played from a random position.'));
    randomMarkersRow.appendChild(randomIncludeScenesWithMarkersContainer);
    (this as any).randomIncludeScenesWithMarkersToggle = randomIncludeScenesWithMarkersToggle;

    const randomSnippetDurationRow = document.createElement('div');
    randomSnippetDurationRow.style.cssText = `margin-top: 6px; padding: 6px 8px 6px 12px; background: ${THEME.colors.backgroundSecondary}; border-radius: ${THEME.radius.card}; display: flex; justify-content: space-between; align-items: center;`;
    const randomSnippetDurationLabel = document.createElement('span');
    randomSnippetDurationLabel.textContent = 'Snippet duration (seconds)';
    randomSnippetDurationLabel.style.cssText = `color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody};`;
    randomSnippetDurationRow.appendChild(randomSnippetDurationLabel);
    const randomSnippetDurationInput = document.createElement('input');
    randomSnippetDurationInput.type = 'number';
    randomSnippetDurationInput.value = String(this.settings.randomSnippetDuration || 20);
    randomSnippetDurationInput.min = '1';
    randomSnippetDurationInput.max = '600';
    randomSnippetDurationInput.style.cssText = `width: 72px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; text-align: right; box-sizing: border-box;`;
    randomSnippetDurationInput.addEventListener('input', () => {
      clearTimeout((randomSnippetDurationInput as any).saveTimeout);
      (randomSnippetDurationInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    randomSnippetDurationRow.appendChild(randomSnippetDurationInput);
    (this as any).randomSnippetDurationInput = randomSnippetDurationInput;

    randomWrapper.appendChild(randomRow);
    randomWrapper.appendChild(randomMarkersRow);
    randomWrapper.appendChild(randomSnippetDurationRow);
    contentTypesSection.appendChild(randomWrapper);

    // Scene Previews toggle
    const { container: includeScenePreviewsToggleContainer, input: includeScenePreviewsToggle } = this.createToggleSwitch(
      this.settings.includeScenePreviews === true,
      () => this.saveSettings()
    );
    const scenePreviewsRow = document.createElement('div');
    scenePreviewsRow.style.display = 'flex';
    scenePreviewsRow.style.justifyContent = 'space-between';
    scenePreviewsRow.style.alignItems = 'center';
    scenePreviewsRow.style.marginTop = '12px';
    scenePreviewsRow.appendChild(buildInfoLabel('Scene Previews', 'Short hover-preview clips generated for each scene.'));
    scenePreviewsRow.appendChild(includeScenePreviewsToggleContainer);
    contentTypesSection.appendChild(scenePreviewsRow);

    const behaviorSection = document.createElement('div');
    behaviorSection.style.cssText = `margin-bottom: 24px; border: 1px solid ${THEME.colors.border}; border-radius: ${THEME.radius.card}; padding: 16px;`;
    const behaviorTitle = document.createElement('h3');
    behaviorTitle.textContent = 'Behavior';
    behaviorTitle.style.cssText = `margin: 0 0 16px 0; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeTitle}; font-weight: ${THEME.typography.weightTitle};`;
    behaviorSection.appendChild(behaviorTitle);
    hdVideoContainer.style.marginBottom = '16px';
    behaviorSection.appendChild(hdVideoContainer);

    layoutContent.appendChild(behaviorSection);
    layoutContent.appendChild(contentTypesSection);
    contentTabContent.appendChild(layoutSection);

    // ── StashDB Discovery Section ──────────────────────────────────────────
    const discoverySection = document.createElement('div');
    discoverySection.style.cssText = `margin-bottom: 24px; border: 1px solid ${THEME.colors.border}; border-radius: ${THEME.radius.card}; padding: 16px;`;

    const discoverySectionTitle = document.createElement('h3');
    discoverySectionTitle.textContent = 'StashDB Discovery';
    discoverySectionTitle.style.cssText = `margin: 0 0 16px 0; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeTitle}; font-weight: ${THEME.typography.weightTitle};`;
    discoverySection.appendChild(discoverySectionTitle);

    const discoveryPanelContainer = document.createElement('div');
    discoveryPanelContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
    discoveryPanelContainer.appendChild(buildInfoLabel(
      'Enable Discovery Panel',
      'Shows a pull-out sidebar with new scenes from StashDB for the performer currently in view. Requires a StashDB stash-box configured in Stash settings.'
    ));
    const { container: discoveryPanelToggleContainer, input: discoveryPanelToggle } = this.createToggleSwitch(
      this.settings.enableDiscoveryPanel === true,
      () => this.saveSettings()
    );
    discoveryPanelContainer.appendChild(discoveryPanelToggleContainer);
    discoverySection.appendChild(discoveryPanelContainer);
    (this as any).discoveryPanelToggle = discoveryPanelToggle;

    const discoverySizeContainer = document.createElement('div');
    discoverySizeContainer.style.cssText = 'margin-bottom: 16px;';
    discoverySizeContainer.appendChild(buildInfoLabel('Panel Width', 'Width of the discovery sidebar.'));
    const currentSize = this.settings.discoveryPanelSize ?? 260;
    const discoverySizeSlider = document.createElement('input');
    discoverySizeSlider.type = 'range';
    discoverySizeSlider.min = '40';
    discoverySizeSlider.max = '440';
    discoverySizeSlider.value = String(Math.min(440, Math.max(40, currentSize)));
    discoverySizeSlider.style.cssText = 'width: 100%; cursor: pointer; margin-top: 6px;';
    discoverySizeSlider.addEventListener('input', () => this.saveSettings());
    discoverySizeContainer.appendChild(discoverySizeSlider);
    discoverySection.appendChild(discoverySizeContainer);
    (this as any).discoverySizeSlider = discoverySizeSlider;

    const discoveryOrderContainer = document.createElement('div');
    discoveryOrderContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    discoveryOrderContainer.appendChild(buildInfoLabel('Scene Order', 'Show the latest scenes from StashDB, or pick randomly.'));
    const discoveryOrderSelect = document.createElement('select');
    discoveryOrderSelect.style.cssText = `padding: 6px 10px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; cursor: pointer;`;
    for (const [val, label] of [['latest', 'Latest'], ['random', 'Random'], ['trending', 'Trending']] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if ((this.settings.discoverySceneOrder ?? 'latest') === val) opt.selected = true;
      discoveryOrderSelect.appendChild(opt);
    }
    discoveryOrderSelect.addEventListener('change', () => this.saveSettings());
    discoveryOrderContainer.appendChild(discoveryOrderSelect);
    discoverySection.appendChild(discoveryOrderContainer);
    (this as any).discoveryOrderSelect = discoveryOrderSelect;

    whisparrContent.appendChild(discoverySection);


    // ── Images ──────────────────────────────────────────────────────
    // File types sub-row (under Images toggle)
    const fileTypesSubRow = document.createElement('div');
    fileTypesSubRow.style.cssText = `margin-top: 6px; padding: 6px 8px 6px 12px; background: ${THEME.colors.backgroundSecondary}; border-radius: ${THEME.radius.card}; display: flex; justify-content: space-between; align-items: center;`;
    const fileTypesLabel = document.createElement('span');
    fileTypesLabel.textContent = 'File types';
    fileTypesLabel.style.cssText = `color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody}; cursor: help;`;
    this.attachTooltip(fileTypesLabel, 'Image and video formats to include.\nComma-separated, e.g. jpg, png, gif, mp4, m4v, webm.\nLeaving blank uses the default set.');
    fileTypesSubRow.appendChild(fileTypesLabel);
    const fileTypesInput = document.createElement('input');
    fileTypesInput.type = 'text';
    fileTypesInput.value = (this.settings.enabledFileTypes || ['.jpg', '.png', '.gif', '.mp4', '.m4v', '.webm'])
      .map(ext => ext.replace(/^\./, '')).join(', ');
    fileTypesInput.placeholder = 'jpg, png, gif, mp4';
    fileTypesInput.style.cssText = `width: 160px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; box-sizing: border-box;`;
    fileTypesInput.addEventListener('input', () => {
      clearTimeout((fileTypesInput as any).saveTimeout);
      (fileTypesInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    fileTypesSubRow.appendChild(fileTypesInput);

    // Gallery only sub-row
    const galleryOnlySubRow = document.createElement('div');
    galleryOnlySubRow.style.cssText = `margin-top: 6px; padding: 8px 0 8px 12px; background: ${THEME.colors.backgroundSecondary}; border-radius: ${THEME.radius.card}; display: flex; justify-content: space-between; align-items: center;`;
    galleryOnlySubRow.appendChild(buildInfoLabel('Gallery only', 'Only show images that belong to a Stash gallery.'));
    const { container: galleryOnlyToggleContainer, input: galleryOnlyToggle } = this.createToggleSwitch(
      this.settings.imagesInGalleryOnly === true,
      (checked) => {
        gallerySelectorWrapper.style.display = checked ? 'block' : 'none';
        this.saveSettings();
      }
    );
    galleryOnlySubRow.appendChild(galleryOnlyToggleContainer);

    // Gallery selector (shown when toggle is on)
    const gallerySelectorWrapper = document.createElement('div');
    gallerySelectorWrapper.style.cssText = `margin-top: 6px; padding: 6px 8px 6px 12px; background: ${THEME.colors.backgroundSecondary}; border-radius: ${THEME.radius.card};`;
    gallerySelectorWrapper.style.display = this.settings.imagesInGalleryOnly ? 'block' : 'none';

    // Chip container — styled like a text input
    const galleryChipContainer = document.createElement('div');
    galleryChipContainer.style.display = 'flex';
    galleryChipContainer.style.flexWrap = 'wrap';
    galleryChipContainer.style.gap = '4px';
    galleryChipContainer.style.padding = '6px 8px';
    galleryChipContainer.style.border = `1px solid ${THEME.colors.border}`;
    galleryChipContainer.style.borderRadius = THEME.radius.button;
    galleryChipContainer.style.backgroundColor = THEME.colors.surface;
    galleryChipContainer.style.cursor = 'text';
    galleryChipContainer.style.minHeight = '38px';
    galleryChipContainer.style.alignItems = 'center';
    galleryChipContainer.style.boxSizing = 'border-box';
    galleryChipContainer.style.width = '100%';

    // Search input inside chip container
    const gallerySearchInput = document.createElement('input');
    gallerySearchInput.type = 'text';
    gallerySearchInput.placeholder = 'Add gallery...';
    gallerySearchInput.style.border = 'none';
    gallerySearchInput.style.outline = 'none';
    gallerySearchInput.style.background = 'transparent';
    gallerySearchInput.style.color = THEME.colors.textPrimary;
    gallerySearchInput.style.fontSize = THEME.typography.sizeBody;
    gallerySearchInput.style.flex = '1';
    gallerySearchInput.style.minWidth = '120px';
    gallerySearchInput.style.padding = '2px 4px';
    galleryChipContainer.appendChild(gallerySearchInput);

    gallerySelectorWrapper.appendChild(galleryChipContainer);

    // Dropdown — fixed positioned, appended to modal overlay to escape overflow clipping
    const galleryDropdown = document.createElement('div');
    galleryDropdown.style.position = 'fixed';
    galleryDropdown.style.zIndex = '10002';
    galleryDropdown.style.backgroundColor = THEME.colors.surface;
    galleryDropdown.style.border = `1px solid ${THEME.colors.border}`;
    galleryDropdown.style.borderRadius = THEME.radius.button;
    galleryDropdown.style.maxHeight = '200px';
    galleryDropdown.style.overflowY = 'auto';
    galleryDropdown.style.display = 'none';
    galleryDropdown.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    this.container.appendChild(galleryDropdown);

    // State
    const selectedGalleryIds = new Set<string>(this.settings.galleryIds ?? []);
    let allGalleries: Array<{ id: string; title?: string; folder?: { path?: string } }> = [];

    const getLabel = (id: string): string => {
      const g = allGalleries.find(g => g.id === id);
      return g ? (g.title || g.folder?.path || g.id) : id;
    };

    const renderChips = () => {
      [...galleryChipContainer.children].forEach(child => {
        if (child !== gallerySearchInput) child.remove();
      });
      for (const id of selectedGalleryIds) {
        const chip = document.createElement('span');
        chip.style.display = 'inline-flex';
        chip.style.alignItems = 'center';
        chip.style.gap = '4px';
        chip.style.padding = '2px 8px';
        chip.style.borderRadius = THEME.radius.tag;
        chip.style.backgroundColor = THEME.colors.accentPrimary;
        chip.style.color = THEME.colors.textPrimary;
        chip.style.fontSize = THEME.typography.sizeMeta;
        chip.style.fontWeight = THEME.typography.weightBodyStrong;
        chip.style.whiteSpace = 'nowrap';

        const label = document.createElement('span');
        label.textContent = getLabel(id);
        chip.appendChild(label);

        const removeBtn = document.createElement('span');
        removeBtn.textContent = '×';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.lineHeight = '1';
        removeBtn.style.fontWeight = 'bold';
        removeBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectedGalleryIds.delete(id);
          renderChips();
          renderDropdown(gallerySearchInput.value);
          this.saveSettings();
        });
        chip.appendChild(removeBtn);

        gallerySearchInput.before(chip);
      }
    };

    const positionDropdown = () => {
      const rect = galleryChipContainer.getBoundingClientRect();
      galleryDropdown.style.top = `${rect.bottom + 4}px`;
      galleryDropdown.style.left = `${rect.left}px`;
      galleryDropdown.style.width = `${rect.width}px`;
    };

    const renderDropdown = (filter: string) => {
      galleryDropdown.innerHTML = '';
      const filtered = allGalleries.filter(g => {
        if (selectedGalleryIds.has(g.id)) return false;
        if (!filter) return true;
        const label = g.title || g.folder?.path || g.id;
        return label.toLowerCase().includes(filter.toLowerCase());
      });

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = allGalleries.length === 0 ? 'Loading...' : 'No matching galleries';
        empty.style.padding = '8px 12px';
        empty.style.color = THEME.colors.textMuted;
        empty.style.fontSize = THEME.typography.sizeBody;
        galleryDropdown.appendChild(empty);
        return;
      }

      for (const gallery of filtered) {
        const item = document.createElement('div');
        item.textContent = gallery.title || gallery.folder?.path || gallery.id;
        item.style.padding = '8px 12px';
        item.style.cursor = 'pointer';
        item.style.fontSize = THEME.typography.sizeBody;
        item.style.color = THEME.colors.textPrimary;
        item.addEventListener('mouseenter', () => { item.style.backgroundColor = THEME.colors.surfaceHover; });
        item.addEventListener('mouseleave', () => { item.style.backgroundColor = ''; });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectedGalleryIds.add(gallery.id);
          gallerySearchInput.value = '';
          renderChips();
          renderDropdown('');
          positionDropdown();
          this.saveSettings();
        });
        galleryDropdown.appendChild(item);
      }
    };

    galleryChipContainer.addEventListener('click', () => gallerySearchInput.focus());

    gallerySearchInput.addEventListener('focus', () => {
      positionDropdown();
      galleryDropdown.style.display = 'block';
      renderDropdown(gallerySearchInput.value);
    });

    gallerySearchInput.addEventListener('blur', () => {
      setTimeout(() => { galleryDropdown.style.display = 'none'; }, 150);
    });

    gallerySearchInput.addEventListener('input', () => {
      renderDropdown(gallerySearchInput.value);
      positionDropdown();
    });

    gallerySearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && gallerySearchInput.value === '' && selectedGalleryIds.size > 0) {
        const arr = [...selectedGalleryIds];
        const last = arr[arr.length - 1];
        selectedGalleryIds.delete(last);
        renderChips();
        renderDropdown('');
        this.saveSettings();
      }
    });

    renderChips();

    if (this.findGalleries) {
      this.findGalleries().then((galleries) => {
        allGalleries = galleries;
        renderChips();
      }).catch(() => {
        // allGalleries stays empty; search will show "No matching galleries"
      });
    }

    // Assemble images wrapper and insert before random in Content Types
    const imagesWrapper = document.createElement('div');
    imagesWrapper.style.marginBottom = '12px';
    imagesWrapper.appendChild(imagesRow);
    imagesWrapper.appendChild(fileTypesSubRow);
    imagesWrapper.appendChild(galleryOnlySubRow);
    imagesWrapper.appendChild(gallerySelectorWrapper);
    randomWrapper.before(imagesWrapper);

    (this as any).fileTypesInput = fileTypesInput;
    (this as any).galleryOnlyToggle = galleryOnlyToggle;
    (this as any).gallerySelectedIds = selectedGalleryIds;

    // ── Filters Section ────────────────────────────────────────────────────
    const filtersSection = document.createElement('div');
    filtersSection.style.marginBottom = '24px';
    filtersSection.style.border = `1px solid ${THEME.colors.border}`;
    filtersSection.style.borderRadius = THEME.radius.card;
    filtersSection.style.padding = '16px';

    // Orientation toggles
    const orientationFilter = this.settings.orientationFilter ?? [];
    const hasOrientationFilter = orientationFilter.length > 0;
    const portraitEnabled = !hasOrientationFilter || orientationFilter.includes('portrait');
    const landscapeEnabled = !hasOrientationFilter || orientationFilter.includes('landscape');

    const portraitContainer = document.createElement('div');
    portraitContainer.style.display = 'flex';
    portraitContainer.style.justifyContent = 'space-between';
    portraitContainer.style.alignItems = 'center';
    portraitContainer.style.marginBottom = '12px';
    portraitContainer.appendChild(buildInfoLabel('Portrait', 'Include portrait-oriented content in the feed.'));
    const { container: portraitToggleContainer, input: portraitToggle } = this.createToggleSwitch(
      portraitEnabled, () => this.saveSettings()
    );
    portraitContainer.appendChild(portraitToggleContainer);
    filtersSection.appendChild(portraitContainer);

    const landscapeContainer = document.createElement('div');
    landscapeContainer.style.display = 'flex';
    landscapeContainer.style.justifyContent = 'space-between';
    landscapeContainer.style.alignItems = 'center';
    landscapeContainer.style.marginBottom = '16px';
    landscapeContainer.appendChild(buildInfoLabel('Landscape', 'Include landscape-oriented content in the feed.'));
    const { container: landscapeToggleContainer, input: landscapeToggle } = this.createToggleSwitch(
      landscapeEnabled, () => this.saveSettings()
    );
    landscapeContainer.appendChild(landscapeToggleContainer);
    filtersSection.appendChild(landscapeContainer);

    // Excluded Tags
    const excludedTagsContainer = document.createElement('div');
    excludedTagsContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
    excludedTagsContainer.appendChild(buildInfoLabel('Excluded Tags', 'Hide any content that contains one of these tags.'));
    const excludedTagsInput = document.createElement('input');
    excludedTagsInput.type = 'text';
    excludedTagsInput.value = (this.settings.excludedTagNames || []).join(', ');
    excludedTagsInput.style.cssText = `width: 160px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; box-sizing: border-box;`;
    excludedTagsInput.placeholder = 'VR, POV';
    excludedTagsContainer.appendChild(excludedTagsInput);
    excludedTagsInput.addEventListener('input', () => {
      clearTimeout((excludedTagsInput as any).saveTimeout);
      (excludedTagsInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    filtersSection.appendChild(excludedTagsContainer);

    // Include Subtags
    const includeSubtagsContainer = document.createElement('div');
    includeSubtagsContainer.style.display = 'flex';
    includeSubtagsContainer.style.justifyContent = 'space-between';
    includeSubtagsContainer.style.alignItems = 'center';
    includeSubtagsContainer.style.marginBottom = '16px';
    includeSubtagsContainer.appendChild(buildInfoLabel('Include Sub-hierarchy', 'When searching by tag or studio, also include content from descendant subtags and child studios.'));
    const { container: includeSubtagsToggleContainer, input: includeSubtagsToggle } = this.createToggleSwitch(
      this.settings.includeSubtags ?? false, () => this.saveSettings()
    );
    includeSubtagsContainer.appendChild(includeSubtagsToggleContainer);
    filtersSection.appendChild(includeSubtagsContainer);

    // Scene / Image tag matching (also shows the tags on posts)
    const showSceneTagsContainer = document.createElement('div');
    showSceneTagsContainer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    showSceneTagsContainer.appendChild(buildInfoLabel('Scene / Image Tags', 'Also match a scene\'s tags when filtering, and show them on marker posts.\n\nEach tag matches one source only. Priority: marker → scene → performer (images: image → performer).', true));
    const { container: showSceneTagsToggleContainer, input: showSceneTagsToggle } = this.createToggleSwitch(
      this.settings.showSceneTags === true, () => this.saveSettings()
    );
    showSceneTagsContainer.appendChild(showSceneTagsToggleContainer);
    filtersSection.appendChild(showSceneTagsContainer);
    (this as any).showSceneTagsToggle = showSceneTagsToggle;

    // Performer tag matching (also shows the tags on posts)
    const showPerformerTagsContainer = document.createElement('div');
    showPerformerTagsContainer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    showPerformerTagsContainer.appendChild(buildInfoLabel('Performer Tags', 'Also match performers\' tags when filtering, and show them on posts.\n\nEach tag matches one source only. Priority: marker → scene → performer. Performer is lowest, so shared tags match elsewhere first.', true));
    const { container: showPerformerTagsToggleContainer, input: showPerformerTagsToggle } = this.createToggleSwitch(
      this.settings.showPerformerTags === true, () => this.saveSettings()
    );
    showPerformerTagsContainer.appendChild(showPerformerTagsToggleContainer);
    filtersSection.appendChild(showPerformerTagsContainer);
    (this as any).showPerformerTagsToggle = showPerformerTagsToggle;

    // Watch History
    const { container: trackWatchHistoryContainer, input: trackWatchHistoryToggle } = this.createToggleSwitch(
      this.settings.trackWatchHistory !== false,
      () => this.saveSettings()
    );
    const trackWatchHistoryRow = document.createElement('div');
    trackWatchHistoryRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
    trackWatchHistoryRow.appendChild(buildInfoLabel(
      'Watch History',
      'Report watch progress to Stash (updates play count and resume time).\nDisable to browse without affecting history.'
    ));
    trackWatchHistoryRow.appendChild(trackWatchHistoryContainer);
    filtersSection.appendChild(trackWatchHistoryRow);
    (this as any).trackWatchHistoryToggle = trackWatchHistoryToggle;

    // Recency Bias
    const seenHistoryContainer = document.createElement('div');
    seenHistoryContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
    seenHistoryContainer.appendChild(buildInfoLabel(
      'Recency Bias',
      'Tracks up to this many recently seen items and hides them from the feed.\nSet to 0 to disable. Default: 500.'
    ));
    const seenHistorySizeInput = document.createElement('input');
    seenHistorySizeInput.type = 'number';
    seenHistorySizeInput.value = String(this.settings.seenHistorySize ?? 500);
    seenHistorySizeInput.min = '0';
    seenHistorySizeInput.max = '2000';
    seenHistorySizeInput.style.cssText = `width: 80px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; text-align: right; box-sizing: border-box;`;
    seenHistorySizeInput.addEventListener('input', () => {
      clearTimeout((seenHistorySizeInput as any).saveTimeout);
      (seenHistorySizeInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    seenHistoryContainer.appendChild(seenHistorySizeInput);
    filtersSection.appendChild(seenHistoryContainer);
    (this as any).seenHistorySizeInput = seenHistorySizeInput;

    // Content Limit
    const contentLimitContainer = document.createElement('div');
    contentLimitContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    contentLimitContainer.appendChild(buildInfoLabel(
      'Content Limit',
      'Maximum items per content type to paginate through.\nLower values improve performance for large libraries. Default: 5000.'
    ));
    const contentLimitInput = document.createElement('input');
    contentLimitInput.type = 'number';
    contentLimitInput.value = String(this.settings.contentLimit ?? 5000);
    contentLimitInput.min = '100';
    contentLimitInput.max = '50000';
    contentLimitInput.style.cssText = `width: 80px; padding: 4px 8px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; text-align: right; box-sizing: border-box;`;
    contentLimitInput.addEventListener('input', () => {
      clearTimeout((contentLimitInput as any).saveTimeout);
      (contentLimitInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    contentLimitContainer.appendChild(contentLimitInput);
    filtersSection.appendChild(contentLimitContainer);
    (this as any).contentLimitInput = contentLimitInput;

    (this as any).portraitToggle = portraitToggle;
    (this as any).landscapeToggle = landscapeToggle;
    (this as any).excludedTagsInput = excludedTagsInput;
    (this as any).includeSubtagsToggle = includeSubtagsToggle;

    filtersContent.appendChild(filtersSection);
    behaviorSection.appendChild(reelAutoScrollContainer);
    behaviorSection.appendChild(autoHideSearchBarContainer);
    searchMarkersByNameRow.style.marginBottom = '0';
    behaviorSection.appendChild(searchMarkersByNameRow);

    // Whisparr tab content
    whisparrContent.appendChild(this.buildWhisparrSection(buildInfoLabel));

    // Version footer
    const versionFooter = document.createElement('div');
    versionFooter.style.marginTop = '32px';
    versionFooter.style.paddingTop = '24px';
    versionFooter.style.borderTop = `1px solid ${THEME.colors.border}`;
    versionFooter.style.textAlign = 'center';

    const versionText = document.createElement('div');
    versionText.textContent = `Version ${version.VERSION} (${version.BUILD_HASH ?? 'dev'})`;
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
      createFooterLink('💻 Codeberg', 'https://codeberg.org/surging9143/stashgifs')
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

    layoutContent.appendChild(versionFooter);

    // Store references to inputs for saveSettings method
    (this as any).maxDurationInput = maxDurationInput;
    (this as any).includeMarkersToggle = includeMarkersToggle;
    (this as any).includeRandomToggle = includeRandomToggle;
    (this as any).includeImagesToggle = includeImagesToggle;
    (this as any).searchMarkersByNameToggle = searchMarkersByNameToggle;
    (this as any).shortFormIncludeToggle = shortFormIncludeToggle;
    (this as any).includeScenePreviewsToggle = includeScenePreviewsToggle;

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

  private saveWhisparrPartial(partial: Partial<FeedSettings>): void {
    if (this.onSave) this.onSave(partial);
  }

  private styleTextInput(input: HTMLInputElement): void {
    input.style.width = '100%';
    input.style.padding = '12px';
    input.style.borderRadius = THEME.radius.button;
    input.style.border = `1px solid ${THEME.colors.border}`;
    input.style.backgroundColor = THEME.colors.surface;
    input.style.color = THEME.colors.textPrimary;
    input.style.fontSize = THEME.typography.sizeBody;
    input.style.boxSizing = 'border-box';
  }

  private styleSelect(select: HTMLSelectElement): void {
    select.style.width = '100%';
    select.style.padding = '10px 12px';
    this.applySelectBaseStyle(select);
    select.style.boxSizing = 'border-box';
  }

  /** The border/background/color/size styling common to all settings selects. */
  private applySelectBaseStyle(select: HTMLSelectElement): void {
    select.style.borderRadius = THEME.radius.button;
    select.style.border = `1px solid ${THEME.colors.border}`;
    select.style.backgroundColor = THEME.colors.surface;
    select.style.color = THEME.colors.textPrimary;
    select.style.fontSize = THEME.typography.sizeBody;
  }

  private buildWhisparrSection(
    buildInfoLabel: (labelText: string, tooltipText: string) => HTMLElement
  ): HTMLElement {
    const section = document.createElement('div');
    section.style.marginTop = '24px';
    section.style.marginBottom = '24px';
    section.style.border = `1px solid ${THEME.colors.border}`;
    section.style.borderRadius = THEME.radius.card;
    section.style.padding = '16px';

    const title = document.createElement('h3');
    title.textContent = 'Whisparr';
    title.style.margin = '0 0 8px 0';
    title.style.color = THEME.colors.textPrimary;
    title.style.fontSize = THEME.typography.sizeTitle;
    title.style.fontWeight = THEME.typography.weightTitle;
    section.appendChild(title);

    const description = document.createElement('p');
    description.textContent = 'Configure Whisparr to enable an "Add to Whisparr" button on each StashDB discovery card. Test the connection to populate root folder and quality profile.';
    description.style.margin = '0 0 16px 0';
    description.style.color = THEME.colors.textMuted;
    description.style.fontSize = THEME.typography.sizeMeta;
    section.appendChild(description);

    // URL
    const urlContainer = document.createElement('div');
    urlContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
    urlContainer.appendChild(buildInfoLabel('Whisparr URL', 'Base URL of your Whisparr instance, e.g. http://localhost:6969'));
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'http://localhost:6969';
    urlInput.value = this.settings.whisparrBaseUrl ?? '';
    this.styleTextInput(urlInput);
    urlInput.style.width = '200px';
    urlInput.style.padding = '4px 8px';
    urlInput.addEventListener('input', () => {
      clearTimeout((urlInput as any).saveTimeout);
      (urlInput as any).saveTimeout = setTimeout(() => {
        this.saveWhisparrPartial({ whisparrBaseUrl: urlInput.value.trim() || undefined });
      }, 500);
    });
    urlContainer.appendChild(urlInput);
    section.appendChild(urlContainer);

    // API Key
    const apiKeyContainer = document.createElement('div');
    apiKeyContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
    apiKeyContainer.appendChild(buildInfoLabel('API Key', 'Whisparr API key. Found in Whisparr → Settings → General.'));
    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'password';
    apiKeyInput.autocomplete = 'off';
    apiKeyInput.value = this.settings.whisparrApiKey ?? '';
    this.styleTextInput(apiKeyInput);
    apiKeyInput.style.width = '200px';
    apiKeyInput.style.padding = '4px 8px';
    apiKeyInput.addEventListener('input', () => {
      clearTimeout((apiKeyInput as any).saveTimeout);
      (apiKeyInput as any).saveTimeout = setTimeout(() => {
        this.saveWhisparrPartial({ whisparrApiKey: apiKeyInput.value.trim() || undefined });
      }, 500);
    });
    apiKeyContainer.appendChild(apiKeyInput);
    section.appendChild(apiKeyContainer);

    // Test connection button + status
    const testRow = document.createElement('div');
    testRow.style.display = 'flex';
    testRow.style.alignItems = 'center';
    testRow.style.gap = '12px';
    testRow.style.marginBottom = '12px';

    const testButton = document.createElement('button');
    testButton.type = 'button';
    testButton.textContent = 'Test Connection';
    testButton.style.padding = '10px 16px';
    testButton.style.borderRadius = THEME.radius.button;
    testButton.style.border = `1px solid ${THEME.colors.accentPrimary}`;
    testButton.style.background = THEME.colors.accentPrimary;
    testButton.style.color = THEME.colors.textPrimary;
    testButton.style.cursor = 'pointer';
    testButton.style.fontSize = THEME.typography.sizeBody;
    testButton.style.fontWeight = THEME.typography.weightBodyStrong;

    const testStatus = document.createElement('span');
    testStatus.style.color = THEME.colors.textMuted;
    testStatus.style.fontSize = THEME.typography.sizeMeta;

    testRow.appendChild(testButton);
    testRow.appendChild(testStatus);
    section.appendChild(testRow);

    // Root folder select
    const rootFolderContainer = document.createElement('div');
    rootFolderContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
    rootFolderContainer.appendChild(buildInfoLabel('Root Folder', 'Where Whisparr should download scenes added from StashGifs.'));
    const rootFolderSelect = document.createElement('select');
    this.styleSelect(rootFolderSelect);
    rootFolderSelect.style.width = '200px';
    rootFolderSelect.disabled = true;
    const placeholderRoot = document.createElement('option');
    placeholderRoot.value = '';
    placeholderRoot.textContent = this.settings.whisparrRootFolderPath
      ? this.settings.whisparrRootFolderPath
      : '— Test connection to populate —';
    rootFolderSelect.appendChild(placeholderRoot);
    rootFolderContainer.appendChild(rootFolderSelect);
    section.appendChild(rootFolderContainer);

    // Quality profile select
    const qualityContainer = document.createElement('div');
    qualityContainer.appendChild(buildInfoLabel('Quality Profile', 'Whisparr quality profile to use for scenes added from StashGifs.'));
    const qualitySelect = document.createElement('select');
    this.styleSelect(qualitySelect);
    qualitySelect.style.width = '200px';
    qualitySelect.disabled = true;
    const placeholderQuality = document.createElement('option');
    placeholderQuality.value = '';
    placeholderQuality.textContent = typeof this.settings.whisparrQualityProfileId === 'number'
      ? `Profile #${this.settings.whisparrQualityProfileId}`
      : '— Test connection to populate —';
    qualitySelect.appendChild(placeholderQuality);
    qualityContainer.appendChild(qualitySelect);
    section.appendChild(qualityContainer);

    rootFolderSelect.addEventListener('change', () => {
      this.saveWhisparrPartial({ whisparrRootFolderPath: rootFolderSelect.value || undefined });
    });
    qualitySelect.addEventListener('change', () => {
      const v = Number.parseInt(qualitySelect.value, 10);
      this.saveWhisparrPartial({ whisparrQualityProfileId: Number.isNaN(v) ? undefined : v });
    });

    testButton.addEventListener('click', async () => {
      const baseUrl = urlInput.value.trim();
      const apiKey = apiKeyInput.value.trim();
      if (!baseUrl || !apiKey) {
        testStatus.textContent = 'Enter URL and API key first.';
        testStatus.style.color = '#e57373';
        return;
      }
      testButton.disabled = true;
      testStatus.textContent = 'Testing…';
      testStatus.style.color = THEME.colors.textMuted;
      try {
        const client = new WhisparrClient({ baseUrl, apiKey });
        const [folders, profiles] = await Promise.all([
          client.getRootFolders(),
          client.getQualityProfiles(),
        ]);
        rootFolderSelect.innerHTML = '';
        for (const folder of folders) {
          const opt = document.createElement('option');
          opt.value = folder.path;
          opt.textContent = folder.path;
          rootFolderSelect.appendChild(opt);
        }
        rootFolderSelect.disabled = folders.length === 0;
        if (this.settings.whisparrRootFolderPath
            && folders.some((f) => f.path === this.settings.whisparrRootFolderPath)) {
          rootFolderSelect.value = this.settings.whisparrRootFolderPath;
        } else if (folders.length > 0) {
          rootFolderSelect.value = folders[0].path;
          this.saveWhisparrPartial({ whisparrRootFolderPath: folders[0].path });
        }

        qualitySelect.innerHTML = '';
        for (const profile of profiles) {
          const opt = document.createElement('option');
          opt.value = String(profile.id);
          opt.textContent = profile.name;
          qualitySelect.appendChild(opt);
        }
        qualitySelect.disabled = profiles.length === 0;
        const existingId = this.settings.whisparrQualityProfileId;
        if (typeof existingId === 'number' && profiles.some((p) => p.id === existingId)) {
          qualitySelect.value = String(existingId);
        } else if (profiles.length > 0) {
          qualitySelect.value = String(profiles[0].id);
          this.saveWhisparrPartial({ whisparrQualityProfileId: profiles[0].id });
        }

        testStatus.textContent = `Connected · ${folders.length} folder(s), ${profiles.length} profile(s)`;
        testStatus.style.color = THEME.colors.accentPrimary;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        testStatus.textContent = `Failed: ${message}`;
        testStatus.style.color = '#e57373';
      } finally {
        testButton.disabled = false;
      }
    });

    return section;
  }

  /**
   * Save settings automatically when toggles/inputs change
   */
  private getFormInput(name: string): HTMLInputElement | undefined {
    return (this as any)[name] as HTMLInputElement | undefined;
  }

  private collectFormInputs(): Record<string, HTMLInputElement> | undefined {
    const inputNames = [
      'fileTypesInput', 'maxDurationInput', 'includeMarkersToggle', 'includeRandomToggle', 'randomIncludeScenesWithMarkersToggle', 'randomSnippetDurationInput', 'includeImagesToggle', 'searchMarkersByNameToggle',
      'shortFormIncludeToggle', 'includeScenePreviewsToggle', 'reelAutoScrollToggle', 'autoHideSearchBarToggle', 'hdVideoToggle',
      'portraitToggle', 'landscapeToggle',
      'themeBackgroundInput', 'themePrimaryInput', 'themeSecondaryInput', 'themeAccentInput',
      'showVerifiedCheckmarksToggle', 'showProductionAgeToggle', 'showStudioChipsToggle', 'showPerformerEmbellishmentToggle', 'sceneTitleToggle', 'showSceneTagsToggle', 'showPerformerTagsToggle',
      'showBookmarkToggle', 'showOCountToggle', 'showRatingToggle', 'showViewCountToggle',
      'discoveryPanelToggle', 'excludedTagsInput',
      'includeSubtagsToggle', 'trackWatchHistoryToggle', 'seenHistorySizeInput', 'contentLimitInput', 'tagDisplayLimitInput',
      'performerDisplayLimitInput',
    ];
    const inputs: Record<string, HTMLInputElement> = {};
    for (const name of inputNames) {
      const el = this.getFormInput(name);
      if (!el) return undefined;
      inputs[name] = el;
    }
    return inputs;
  }

  private parseOrientationFilter(portraitChecked: boolean, landscapeChecked: boolean): Array<'portrait' | 'landscape'> | undefined {
    const selected: Array<'portrait' | 'landscape'> = [];
    if (portraitChecked) selected.push('portrait');
    if (landscapeChecked) selected.push('landscape');
    return selected.length === 0 || selected.length === 2 ? undefined : selected;
  }

  private saveSettings(): void {
    const inputs = this.collectFormInputs();
    if (!inputs) return;

    const extensions = inputs.fileTypesInput.value
      .split(',')
      .map(ext => ext.trim())
      .filter(ext => ext.length > 0)
      .map(ext => ext.startsWith('.') ? ext : `.${ext}`);

    const maxDuration = Number.parseInt(inputs.maxDurationInput.value, 10);
    const validMaxDuration = !Number.isNaN(maxDuration) && maxDuration > 0 ? maxDuration : 120;

    const randomSnippetDuration = Number.parseInt(inputs.randomSnippetDurationInput.value, 10);
    const validRandomSnippetDuration = !Number.isNaN(randomSnippetDuration) && randomSnippetDuration > 0 ? randomSnippetDuration : 20;

    const excludedTagNames = inputs.excludedTagsInput.value
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    const galleryOnlyToggle = this.getFormInput('galleryOnlyToggle');
    const gallerySelectedIds = (this as any).gallerySelectedIds as Set<string> | undefined;

    const newSettings: Partial<FeedSettings> = {
      hdMode: inputs.hdVideoToggle.checked,
      includeMarkersInFeed: inputs.includeMarkersToggle.checked,
      includeRandomInFeed: inputs.includeRandomToggle.checked,
      randomIncludeScenesWithMarkers: inputs.randomIncludeScenesWithMarkersToggle.checked,
      randomSnippetDuration: validRandomSnippetDuration,
      includeImagesInFeed: inputs.includeImagesToggle.checked,
      searchMarkersByName: inputs.searchMarkersByNameToggle.checked,
      enabledFileTypes: extensions.length > 0 ? extensions : ['.jpg', '.png', '.gif', '.mp4', '.m4v', '.webm'],
      includeShortForm: inputs.shortFormIncludeToggle.checked,
      shortFormMaxDuration: validMaxDuration,
      includeScenePreviews: inputs.includeScenePreviewsToggle.checked,
      reelAutoScroll: inputs.reelAutoScrollToggle.checked,
      autoHideSearchBar: inputs.autoHideSearchBarToggle.checked,
      orientationFilter: this.parseOrientationFilter(inputs.portraitToggle.checked, inputs.landscapeToggle.checked),
      themeBackground: inputs.themeBackgroundInput.value,
      themePrimary: inputs.themePrimaryInput.value,
      themeSecondary: inputs.themeSecondaryInput.value,
      themeAccent: inputs.themeAccentInput.value,
      showVerifiedCheckmarks: inputs.showVerifiedCheckmarksToggle.checked,
      showProductionAge: inputs.showProductionAgeToggle.checked,
      showStudioChips: inputs.showStudioChipsToggle.checked,
      showPerformerEmbellishment: inputs.showPerformerEmbellishmentToggle.checked,
      showSceneTitle: inputs.sceneTitleToggle.checked,
      showSceneTags: inputs.showSceneTagsToggle.checked,
      showPerformerTags: inputs.showPerformerTagsToggle.checked,
      showBookmarkButton: inputs.showBookmarkToggle.checked,
      showOCountButton: inputs.showOCountToggle.checked,
      showRatingButton: inputs.showRatingToggle.checked,
      showViewCountBadge: inputs.showViewCountToggle.checked,
      enableDiscoveryPanel: inputs.discoveryPanelToggle.checked,
      discoveryPanelSize: Number(((this as any).discoverySizeSlider as HTMLInputElement)?.value ?? 260),
      discoverySceneOrder: ((this as any).discoveryOrderSelect as HTMLSelectElement)?.value as 'latest' | 'random' | 'trending' ?? 'latest',
      excludedTagNames,
      includeSubtags: inputs.includeSubtagsToggle.checked,
      imagesInGalleryOnly: galleryOnlyToggle?.checked ?? false,
      galleryIds: gallerySelectedIds ? [...gallerySelectedIds] : [],
      trackWatchHistory: inputs.trackWatchHistoryToggle.checked,
      seenHistorySize: Math.max(0, Math.min(2000, Number.parseInt(inputs.seenHistorySizeInput.value, 10) || 0)),
      contentLimit: Math.max(100, Math.min(50000, Number.parseInt(inputs.contentLimitInput.value, 10) || 5000)),
      tagDisplayLimit: Math.max(1, Math.min(100, Number.parseInt(inputs.tagDisplayLimitInput.value, 10) || 10)),
      performerDisplayLimit: Math.max(1, Math.min(100, Number.parseInt(inputs.performerDisplayLimitInput.value, 10) || 3)),
    };

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
