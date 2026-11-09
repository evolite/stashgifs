/**
 * Settings Page Component
 * Allows users to configure file types and image feed settings
 */


import { FeedSettings, Tag } from './types.js';
import * as version from './version.js';
import { THEME, THEME_DEFAULTS, normalizeHexColor } from './utils.js';

// Fixed widths for right-aligned settings fields, so every row's control lines up.
const FIELD_WIDTH = '160px';
const NUMBER_WIDTH = '80px';

export class SettingsPage {
  private readonly container: HTMLElement;
  private readonly settings: FeedSettings;
  private readonly findGalleries?: (signal?: AbortSignal) => Promise<Array<{ id: string; title?: string; folder?: { path?: string } }>>;
  private readonly onSave?: (settings: Partial<FeedSettings>) => void;
  private readonly onClose?: () => void;
  private shortFormTags: Tag[];
  private modal!: HTMLElement;
  /** Close functions of open sub-pages, top-most last. */
  private pageStack: Array<() => void> = [];
  /** Re-render the "Options · …" summaries after any change. */
  private summaryRefreshers: Array<() => void> = [];

  constructor(
    container: HTMLElement,
    settings: FeedSettings,
    findGalleries?: (signal?: AbortSignal) => Promise<Array<{ id: string; title?: string; folder?: { path?: string } }>>,
    onSave?: (settings: Partial<FeedSettings>) => void,
    onClose?: () => void,
    private readonly findShortFormTags?: (query: string, signal: AbortSignal) => Promise<Tag[]>
  ) {
    this.container = container;
    this.settings = settings;
    this.findGalleries = findGalleries;
    this.onSave = onSave;
    this.onClose = onClose;
    this.shortFormTags = settings.shortFormTags ?? [];
    this.render();
  }

  /** Render the settings modal into `container`. It manages itself from there (save/close callbacks). */
  static mount(...args: ConstructorParameters<typeof SettingsPage>): SettingsPage {
    return new SettingsPage(...args);
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
    container.style.height = '44px'; // touch target; the visible track is 28px
    container.style.flexShrink = '0';
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
    slider.style.top = '8px';
    slider.style.left = '0';
    slider.style.right = '0';
    slider.style.bottom = '8px';
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
    this.container.classList.add('sg-settings-overlay');
    this.pageStack = [];
    this.summaryRefreshers = [];

    // Inline styles can't hold media queries, so the mobile overrides live here (hence !important).
    const responsiveStyle = document.createElement('style');
    responsiveStyle.textContent = `
      @media (max-width: 600px) {
        .sg-settings-overlay { padding: 0 !important; }
        .sg-settings-modal { max-width: none !important; height: 100% !important; max-height: none !important; border-radius: 0 !important; box-shadow: none !important; }
        .sg-settings-section { border: none !important; border-radius: 0 !important; border-bottom: 1px solid ${THEME.colors.border} !important; padding: 0 0 16px !important; margin: 0 0 16px !important; }
      }
      @media (max-width: 400px) {
        .sg-settings-modal div:has(> .sg-field-wide) { flex-wrap: wrap !important; row-gap: 6px; }
        .sg-field-wide { width: 100% !important; }
      }`;
    this.container.appendChild(responsiveStyle);

    const modal = document.createElement('div');
    this.modal = modal;
    modal.classList.add('sg-settings-modal');
    modal.style.position = 'relative';
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
    const postTabButton = createTabButton('Post');
    tabBar.appendChild(layoutTabButton);
    tabBar.appendChild(filtersTabButton);
    tabBar.appendChild(contentTabButton);
    tabBar.appendChild(postTabButton);
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
    const postContent = document.createElement('div');
    postContent.style.display = 'none';

    const setActiveTab = (active: 'layout' | 'filters' | 'content' | 'post') => {
      layoutContent.style.display     = active === 'layout'   ? 'block' : 'none';
      filtersContent.style.display    = active === 'filters'  ? 'block' : 'none';
      contentTabContent.style.display = active === 'content'  ? 'block' : 'none';
      postContent.style.display       = active === 'post'     ? 'block' : 'none';

      const tabs = [
        { btn: layoutTabButton,   key: 'layout'   },
        { btn: filtersTabButton,  key: 'filters'  },
        { btn: contentTabButton,  key: 'content'  },
        { btn: postTabButton,     key: 'post'     },
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
    postTabButton.addEventListener('click',     () => setActiveTab('post'));
    setActiveTab('layout');

    contentWrapper.appendChild(layoutContent);
    contentWrapper.appendChild(filtersContent);
    contentWrapper.appendChild(contentTabContent);
    contentWrapper.appendChild(postContent);
    modal.appendChild(contentWrapper);

    // Theme Section
    const themeSection = document.createElement('div');
    themeSection.classList.add('sg-settings-section');
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
      this.applyFieldStyle(select, FIELD_WIDTH);

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
      input.style.height = '44px';
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
    this.applyButtonStyle(resetButton);

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
    // ── Post tab: each group is its own bordered box ───────────────────────
    const createPostBox = (title: string): HTMLElement => {
      const box = document.createElement('div');
      box.classList.add('sg-settings-section');
      box.style.marginBottom = '24px';
      box.style.border = `1px solid ${THEME.colors.border}`;
      box.style.borderRadius = THEME.radius.card;
      box.style.padding = '16px';
      const heading = document.createElement('h3');
      heading.textContent = title;
      heading.style.margin = '0 0 16px 0';
      heading.style.color = THEME.colors.textPrimary;
      heading.style.fontSize = THEME.typography.sizeTitle;
      heading.style.fontWeight = THEME.typography.weightTitle;
      box.appendChild(heading);
      const body = document.createElement('div');
      body.style.marginBottom = '-16px'; // ponytail: cancels the last row's 16px gap so boxes end flush like the other sections
      box.appendChild(body);
      postContent.appendChild(box);
      return body;
    };
    const headerGroup = createPostBox('Header');
    const buttonsGroup = createPostBox('Actions');
    const performersGroup = createPostBox('Performers');

    // Indented sub-group (heading + indented rows, like Content Types nesting)
    const createSubGroup = (title: string, parent: HTMLElement): HTMLElement => {
      const group = document.createElement('div');
      group.style.marginBottom = '16px';
      const heading = document.createElement('div');
      heading.textContent = title;
      heading.style.color = THEME.colors.textSecondary;
      heading.style.fontSize = THEME.typography.sizeBody;
      heading.style.fontWeight = THEME.typography.weightTitle;
      heading.style.marginBottom = '8px';
      group.appendChild(heading);
      const body = document.createElement('div');
      body.style.paddingLeft = '12px';
      group.appendChild(body);
      parent.appendChild(group);
      return body;
    };


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
        'Verified Badge',
        'Shows a verified badge on performer chips when they have a Stash ID.'
      )
    );

    const { container: verifiedCheckmarksToggleContainer, input: verifiedCheckmarksToggle } = this.createToggleSwitch(
      this.settings.showVerifiedCheckmarks !== false,
      () => this.saveSettings()
    );
    verifiedCheckmarksContainer.appendChild(verifiedCheckmarksToggleContainer);
    performersGroup.appendChild(verifiedCheckmarksContainer);
    (this as any).showVerifiedCheckmarksToggle = verifiedCheckmarksToggle;

    const productionAgeContainer = document.createElement('div');
    productionAgeContainer.style.display = 'flex';
    productionAgeContainer.style.justifyContent = 'space-between';
    productionAgeContainer.style.alignItems = 'center';
    productionAgeContainer.style.marginBottom = '16px';

    productionAgeContainer.appendChild(
      buildInfoLabel(
        'Age',
        'Shows the performer\'s age next to their name. Shows age at time of production (marked with *) when a date is available, otherwise current age.'
      )
    );

    const { container: productionAgeToggleContainer, input: productionAgeToggle } = this.createToggleSwitch(
      this.settings.showProductionAge === true,
      () => this.saveSettings()
    );
    productionAgeContainer.appendChild(productionAgeToggleContainer);

    performersGroup.appendChild(productionAgeContainer);
    (this as any).showProductionAgeToggle = productionAgeToggle;

    const studioChipsContainer = document.createElement('div');
    studioChipsContainer.style.display = 'flex';
    studioChipsContainer.style.justifyContent = 'space-between';
    studioChipsContainer.style.alignItems = 'center';
    studioChipsContainer.style.marginBottom = '16px';

    studioChipsContainer.appendChild(
      buildInfoLabel(
        'Studio',
        'Shows the studio logo and name alongside performer chips.'
      )
    );

    const { container: studioChipsToggleContainer, input: studioChipsToggle } = this.createToggleSwitch(
      this.settings.showStudioChips !== false,
      () => this.saveSettings()
    );
    studioChipsContainer.appendChild(studioChipsToggleContainer);
    performersGroup.appendChild(studioChipsContainer);
    (this as any).showStudioChipsToggle = studioChipsToggle;

    const performerEmbellishmentContainer = document.createElement('div');
    performerEmbellishmentContainer.style.display = 'flex';
    performerEmbellishmentContainer.style.justifyContent = 'space-between';
    performerEmbellishmentContainer.style.alignItems = 'center';
    performerEmbellishmentContainer.style.marginBottom = '16px';

    performerEmbellishmentContainer.appendChild(
      buildInfoLabel(
        'Tier Badges',
        'Shows a laurel-wreath tier badge on performer avatars, based on their rating.'
      )
    );

    const { container: performerEmbellishmentToggleContainer, input: performerEmbellishmentToggle } = this.createToggleSwitch(
      this.settings.showPerformerEmbellishment === true,
      () => this.saveSettings()
    );
    performerEmbellishmentContainer.appendChild(performerEmbellishmentToggleContainer);
    performersGroup.appendChild(performerEmbellishmentContainer);
    (this as any).showPerformerEmbellishmentToggle = performerEmbellishmentToggle;

    const displayGroup = createSubGroup('Display', performersGroup);
    const genderToggles: Array<{ key: string; label: string; description: string; checked: boolean }> = [
      { key: 'showMalePerformersToggle', label: 'Male', description: 'Show name chips and badges for male performers.', checked: this.settings.showMalePerformers !== false },
      { key: 'showFemalePerformersToggle', label: 'Female', description: 'Show name chips and badges for female performers.', checked: this.settings.showFemalePerformers !== false },
      { key: 'showOtherGenderPerformersToggle', label: 'Other', description: 'Show name chips and badges for performers of other genders (trans, intersex, non-binary). Performers without a gender set are always shown.', checked: this.settings.showOtherGenderPerformers !== false },
    ];
    for (const { key, label, description, checked } of genderToggles) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.marginBottom = '16px';
      row.appendChild(buildInfoLabel(label, description));
      const { container: toggleContainer, input } = this.createToggleSwitch(checked, () => this.saveSettings());
      row.appendChild(toggleContainer);
      displayGroup.appendChild(row);
      (this as any)[key] = input;
    }

    const sceneTitleContainer = document.createElement('div');
    sceneTitleContainer.style.display = 'flex';
    sceneTitleContainer.style.justifyContent = 'space-between';
    sceneTitleContainer.style.alignItems = 'center';
    sceneTitleContainer.style.marginBottom = '16px';

    sceneTitleContainer.appendChild(
      buildInfoLabel(
        'Title',
        'Shows the scene or image title above performers in each post.'
      )
    );

    const { container: sceneTitleToggleContainer, input: sceneTitleToggle } = this.createToggleSwitch(
      this.settings.showSceneTitle === true,
      () => this.saveSettings()
    );
    sceneTitleContainer.appendChild(sceneTitleToggleContainer);
    headerGroup.appendChild(sceneTitleContainer);
    (this as any).sceneTitleToggle = sceneTitleToggle;

    const tagLimitRow = document.createElement('div');
    tagLimitRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    tagLimitRow.appendChild(buildInfoLabel('Tag Limit', 'Max number of tags shown per post before collapsing into a • • • button.'));
    const tagDisplayLimitInput = document.createElement('input');
    tagDisplayLimitInput.type = 'number';
    tagDisplayLimitInput.value = String(this.settings.tagDisplayLimit ?? 10);
    tagDisplayLimitInput.min = '1';
    tagDisplayLimitInput.max = '100';
    this.applyFieldStyle(tagDisplayLimitInput, NUMBER_WIDTH);
    tagDisplayLimitInput.addEventListener('input', () => {
      clearTimeout((tagDisplayLimitInput as any).saveTimeout);
      (tagDisplayLimitInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    tagLimitRow.appendChild(tagDisplayLimitInput);
    headerGroup.appendChild(tagLimitRow);
    (this as any).tagDisplayLimitInput = tagDisplayLimitInput;

    const performerLimitRow = document.createElement('div');
    performerLimitRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    performerLimitRow.appendChild(buildInfoLabel('Limit', 'Max number of performers shown with full name before collapsing into a • • • button; expanding shows the rest as portrait-only chips.'));
    const performerDisplayLimitInput = document.createElement('input');
    performerDisplayLimitInput.type = 'number';
    performerDisplayLimitInput.value = String(this.settings.performerDisplayLimit ?? 3);
    performerDisplayLimitInput.min = '1';
    performerDisplayLimitInput.max = '100';
    this.applyFieldStyle(performerDisplayLimitInput, NUMBER_WIDTH);
    performerDisplayLimitInput.addEventListener('input', () => {
      clearTimeout((performerDisplayLimitInput as any).saveTimeout);
      (performerDisplayLimitInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    performerLimitRow.appendChild(performerDisplayLimitInput);
    performersGroup.appendChild(performerLimitRow);
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
      buttonsGroup.appendChild(container);
      (this as any)[refKey] = input;
    };
    appendButtonToggle(
      'Bookmark',
      'Show a bookmark button to add the scene to your "Stashgifs bookmark" tag in Stash.',
      this.settings.showBookmarkButton === true,
      'showBookmarkToggle',
    );
    appendButtonToggle(
      'O-Count',
      'Show the O-count button in the post button group.',
      this.settings.showOCountButton !== false,
      'showOCountToggle',
    );
    appendButtonToggle(
      'View Count',
      'Show the view-count badge in the post button group.',
      this.settings.showViewCountBadge !== false,
      'showViewCountToggle',
    );
    appendButtonToggle(
      'Rating',
      'Show the star rating control in the post button group.',
      this.settings.showRatingButton !== false,
      'showRatingToggle',
    );
    appendButtonToggle(
      'Rating Hotkeys',
      'Press 1-5 (or 1-9 and 0 for 10 on a 10-point scale) to rate the current post; Backspace clears the rating.',
      this.settings.enableRatingHotkeys !== false,
      'ratingHotkeysToggle',
    );

    // ── Content Types Section ──────────────────────────────────────────────
    const contentTypesSection = document.createElement('div');
    contentTypesSection.classList.add('sg-settings-section');
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
    markersRow.appendChild(buildInfoLabel('Markers', 'Scene marker clips from your Stash library.'));
    markersRow.appendChild(markersToggleContainer);
    const markersWrapper = document.createElement('div');
    markersWrapper.style.marginBottom = '16px';
    markersWrapper.appendChild(markersRow);
    contentTypesSection.appendChild(markersWrapper);

    // Sub-options sit in a collapsible panel; rows inside share one right edge with the top-level toggles.
    const subRowStyle = 'padding: 4px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px;';
    // ponytail: breakpoint is read once per open; resizing across it needs a reopen of settings.
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    const buildOptionsGroup = (title: string, open: boolean, summarize: () => string, ...children: HTMLElement[]) => {
      const label = document.createElement('span');
      const refresh = () => {
        const summary = summarize();
        label.textContent = summary ? `Options · ${summary}` : 'Options';
      };
      this.summaryRefreshers.push(refresh);
      refresh();
      if (isMobile) {
        const page = this.createPage(title);
        page.body.append(...children);
        const button = this.buildDrillButton(label, page.open);
        button.style.marginTop = '6px';
        return button;
      }
      const details = document.createElement('details');
      details.open = open;
      details.style.cssText = `margin-top: 6px; padding: 0 0 4px 12px; background: ${THEME.colors.backgroundSecondary}; border-radius: ${THEME.radius.card};`;
      const summary = document.createElement('summary');
      summary.style.cssText = `min-height: 44px; box-sizing: border-box; padding: 13px 0; cursor: pointer; color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody};`;
      summary.appendChild(label);
      details.append(summary, ...children);
      return details;
    };
    const plural = (n: number, one: string, many = one + 's') => {
      if (n === 0) return '';
      return `${n} ${n === 1 ? one : many}`;
    };
    const summaryOf = (...parts: Array<string | false>) => parts.filter(Boolean).join(' · ');
    const buildContentOptionToggle = (label: string, help: string, checked: boolean) => {
      const row = document.createElement('div');
      row.style.cssText = subRowStyle;
      const toggle = this.createToggleSwitch(checked, () => this.saveSettings());
      toggle.input.setAttribute('aria-label', label);
      row.append(buildInfoLabel(label, help), toggle.container);
      return { row, input: toggle.input };
    };
    const markerPlayback = buildContentOptionToggle(
      'Play from marker to end',
      'Play the scene from the marker timestamp until the scene ends, even when HD Video is off.',
      this.settings.playMarkersToEnd === true,
    );
    markersWrapper.appendChild(buildOptionsGroup('Marker options', this.settings.playMarkersToEnd === true,
      () => summaryOf(markerPlayback.input.checked && 'play to end'),
      markerPlayback.row));

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
    shortFormMaxDurationRow.style.cssText = subRowStyle;
    const maxDurationLabel = document.createElement('span');
    maxDurationLabel.textContent = 'Max duration (seconds)';
    maxDurationLabel.style.cssText = `color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody};`;
    shortFormMaxDurationRow.appendChild(maxDurationLabel);
    const maxDurationInput = document.createElement('input');
    maxDurationInput.type = 'number';
    maxDurationInput.value = String(this.settings.shortFormMaxDuration || 120);
    maxDurationInput.min = '1';
    maxDurationInput.max = '600';
    this.applyFieldStyle(maxDurationInput, NUMBER_WIDTH);
    maxDurationInput.addEventListener('input', () => {
      clearTimeout((maxDurationInput as any).saveTimeout);
      (maxDurationInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    shortFormMaxDurationRow.appendChild(maxDurationInput);

    const shortFormWrapper = document.createElement('div');
    shortFormWrapper.style.marginBottom = '16px';
    shortFormWrapper.appendChild(shortFormRow);
    const shortFormScope = document.createElement('div');
    shortFormScope.style.cssText = 'display: grid; gap: 8px; padding: 4px 0;';
    const scopeHelp = document.createElement('span');
    scopeHelp.textContent = 'When set, these filters keep videos that match any selected tag or the folder. The duration limit still applies.';
    scopeHelp.style.color = THEME.colors.textMuted;
    scopeHelp.style.fontSize = THEME.typography.sizeMeta;
    const shortFormFolderLabel = document.createElement('label');
    shortFormFolderLabel.htmlFor = 'stashgifs-short-form-folder';
    shortFormFolderLabel.textContent = 'Short video folder';
    shortFormFolderLabel.style.cssText = `color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody};`;
    const shortFormFolderInput = document.createElement('input');
    shortFormFolderInput.id = shortFormFolderLabel.htmlFor;
    shortFormFolderInput.type = 'text';
    shortFormFolderInput.placeholder = '/media/shorts';
    shortFormFolderInput.value = this.settings.shortFormFolder ?? '';
    shortFormFolderInput.spellcheck = false;
    this.applyFieldStyle(shortFormFolderInput, '100%');
    shortFormFolderInput.addEventListener('change', () => this.saveSettings());
    shortFormFolderInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') shortFormFolderInput.blur();
    });
    const shortFormTagPicker = this.buildPicker({
      label: 'Short video tags',
      title: 'Short video tags',
      emptyText: 'None',
      getSelected: () => this.shortFormTags,
      setSelected: (tags) => {
        this.shortFormTags = tags.map(({ id, name }) => ({ id, name }));
        this.saveSettings();
      },
      search: async (query, signal) => await this.findShortFormTags?.(query, signal) ?? [],
    });
    shortFormScope.append(scopeHelp, shortFormTagPicker, shortFormFolderLabel, shortFormFolderInput);
    const shortFormScoped = (this.settings.shortFormTags?.length ?? 0) > 0 || !!this.settings.shortFormFolder;
    shortFormWrapper.appendChild(buildOptionsGroup('Short-Form options', shortFormScoped,
      () => summaryOf(
        `max ${maxDurationInput.value || 120}s`,
        plural(this.shortFormTags.length, 'tag'),
        shortFormFolderInput.value.trim() !== '' && 'folder',
      ),
      shortFormMaxDurationRow, shortFormScope));
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
    randomWrapper.style.marginBottom = '16px';

    const randomRow = document.createElement('div');
    randomRow.style.display = 'flex';
    randomRow.style.justifyContent = 'space-between';
    randomRow.style.alignItems = 'center';
    randomRow.appendChild(buildInfoLabel('Random', 'Full scenes from your library played from a random position. Tag filters and search do not apply.'));
    randomRow.appendChild(includeRandomToggleContainer);

    const randomMarkersRow = document.createElement('div');
    randomMarkersRow.style.cssText = subRowStyle;
    const { container: randomIncludeScenesWithMarkersContainer, input: randomIncludeScenesWithMarkersToggle } = this.createToggleSwitch(
      this.settings.randomIncludeScenesWithMarkers === true,
      () => this.saveSettings()
    );
    randomMarkersRow.appendChild(buildInfoLabel('Marked scenes', 'Also include scenes that have markers, played from a random position.'));
    randomMarkersRow.appendChild(randomIncludeScenesWithMarkersContainer);
    (this as any).randomIncludeScenesWithMarkersToggle = randomIncludeScenesWithMarkersToggle;

    const randomSnippetDurationRow = document.createElement('div');
    randomSnippetDurationRow.style.cssText = subRowStyle;
    const randomSnippetDurationLabel = document.createElement('span');
    randomSnippetDurationLabel.textContent = 'Snippet duration (seconds)';
    randomSnippetDurationLabel.style.cssText = `color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody};`;
    randomSnippetDurationRow.appendChild(randomSnippetDurationLabel);
    const randomSnippetDurationInput = document.createElement('input');
    randomSnippetDurationInput.type = 'number';
    randomSnippetDurationInput.value = String(this.settings.randomSnippetDuration || 20);
    randomSnippetDurationInput.min = '1';
    randomSnippetDurationInput.max = '600';
    this.applyFieldStyle(randomSnippetDurationInput, NUMBER_WIDTH);
    randomSnippetDurationInput.addEventListener('input', () => {
      clearTimeout((randomSnippetDurationInput as any).saveTimeout);
      (randomSnippetDurationInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    randomSnippetDurationRow.appendChild(randomSnippetDurationInput);
    (this as any).randomSnippetDurationInput = randomSnippetDurationInput;

    randomWrapper.appendChild(randomRow);
    const randomLongScenes = buildContentOptionToggle(
      'Long scenes only',
      'Offer scenes at or above the Short-Form duration limit for marker creation.',
      this.settings.randomLongScenesOnly === true,
    );
    const randomCustomised = this.settings.randomIncludeScenesWithMarkers === true || this.settings.randomLongScenesOnly === true;
    randomWrapper.appendChild(buildOptionsGroup('Random options', randomCustomised,
      () => summaryOf(
        `${randomSnippetDurationInput.value || 20}s clips`,
        randomIncludeScenesWithMarkersToggle.checked && 'marked scenes',
        randomLongScenes.input.checked && 'long only',
      ),
      randomMarkersRow, randomLongScenes.row, randomSnippetDurationRow));
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
    scenePreviewsRow.appendChild(buildInfoLabel('Scene Previews', 'Short hover-preview clips generated for each scene.'));
    scenePreviewsRow.appendChild(includeScenePreviewsToggleContainer);
    contentTypesSection.appendChild(scenePreviewsRow);

    const behaviorSection = document.createElement('div');
    behaviorSection.classList.add('sg-settings-section');
    behaviorSection.style.cssText = `margin-bottom: 24px; border: 1px solid ${THEME.colors.border}; border-radius: ${THEME.radius.card}; padding: 16px;`;
    const behaviorTitle = document.createElement('h3');
    behaviorTitle.textContent = 'Behavior';
    behaviorTitle.style.cssText = `margin: 0 0 16px 0; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeTitle}; font-weight: ${THEME.typography.weightTitle};`;
    behaviorSection.appendChild(behaviorTitle);
    hdVideoContainer.style.marginBottom = '16px';
    behaviorSection.appendChild(hdVideoContainer);

    const maxResolutionContainer = document.createElement('div');
    maxResolutionContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
    maxResolutionContainer.appendChild(buildInfoLabel(
      'Maximum Resolution',
      'Caps HD playback: scenes taller than this are streamed from Stash at the capped resolution (transcoded) instead of full 2K/4K/6K. Reduces buffering on high-res scenes. Does not affect preview clips.'
    ));
    const maxResolutionSelect = document.createElement('select');
    this.applyFieldStyle(maxResolutionSelect, FIELD_WIDTH);
    for (const [val, label] of [['0', 'Off'], ['2160', '2160p (4K)'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['240', '240p']] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (String(this.settings.maxResolution ?? 0) === val) opt.selected = true;
      maxResolutionSelect.appendChild(opt);
    }
    maxResolutionSelect.addEventListener('change', () => this.saveSettings());
    maxResolutionContainer.appendChild(maxResolutionSelect);
    behaviorSection.appendChild(maxResolutionContainer);
    (this as any).maxResolutionSelect = maxResolutionSelect;

    layoutContent.appendChild(behaviorSection);
    layoutContent.appendChild(contentTypesSection);

    // ── Images ──────────────────────────────────────────────────────
    // File types sub-row (under Images toggle)
    const fileTypesSubRow = document.createElement('div');
    fileTypesSubRow.style.cssText = subRowStyle;
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
    this.applyFieldStyle(fileTypesInput, FIELD_WIDTH);
    fileTypesInput.addEventListener('input', () => {
      clearTimeout((fileTypesInput as any).saveTimeout);
      (fileTypesInput as any).saveTimeout = setTimeout(() => { this.saveSettings(); }, 500);
    });
    fileTypesSubRow.appendChild(fileTypesInput);

    // Gallery only sub-row
    const galleryOnlySubRow = document.createElement('div');
    galleryOnlySubRow.style.cssText = subRowStyle;
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
    gallerySelectorWrapper.style.cssText = 'padding: 4px 0;';
    gallerySelectorWrapper.style.display = this.settings.imagesInGalleryOnly ? 'block' : 'none';

    const selectedGalleryIds = new Set<string>(this.settings.galleryIds ?? []);
    let allGalleries: Array<{ id: string; title?: string; folder?: { path?: string } }> = [];
    const galleryName = (g: { id: string; title?: string; folder?: { path?: string } }) => g.title || g.folder?.path || g.id;
    let galleriesLoad: Promise<void> | undefined;
    const loadGalleries = () => {
      galleriesLoad ??= (this.findGalleries?.() ?? Promise.resolve([]))
        .then((galleries) => { allGalleries = galleries; })
        .catch((error: unknown) => { galleriesLoad = undefined; throw error; });
      return galleriesLoad;
    };
    void loadGalleries().catch(() => { /* retried when the picker searches */ });

    gallerySelectorWrapper.appendChild(this.buildPicker({
      label: 'Galleries',
      title: 'Galleries',
      emptyText: 'Any gallery',
      getSelected: () => [...selectedGalleryIds].map((id) => {
        const gallery = allGalleries.find((g) => g.id === id);
        return { id, name: gallery ? galleryName(gallery) : id };
      }),
      setSelected: (items) => {
        selectedGalleryIds.clear();
        for (const item of items) selectedGalleryIds.add(item.id);
        this.saveSettings();
      },
      search: async (query) => {
        await loadGalleries();
        const needle = query.toLowerCase();
        return allGalleries
          .map((g) => ({ id: g.id, name: galleryName(g) }))
          .filter((item) => !needle || item.name.toLowerCase().includes(needle));
      },
    }));

    // Assemble images wrapper and insert before random in Content Types
    const imagesWrapper = document.createElement('div');
    imagesWrapper.style.marginBottom = '16px';
    imagesWrapper.appendChild(imagesRow);
    imagesWrapper.appendChild(buildOptionsGroup('Image options', this.settings.imagesInGalleryOnly === true,
      () => summaryOf(
        plural(fileTypesInput.value.split(',').filter((ext) => ext.trim()).length, 'type'),
        galleryOnlyToggle.checked && (plural(selectedGalleryIds.size, 'gallery', 'galleries') || 'gallery only'),
      ),
      fileTypesSubRow, galleryOnlySubRow, gallerySelectorWrapper));
    randomWrapper.before(imagesWrapper);

    (this as any).fileTypesInput = fileTypesInput;
    (this as any).galleryOnlyToggle = galleryOnlyToggle;
    (this as any).gallerySelectedIds = selectedGalleryIds;

    // ── Filters Section ────────────────────────────────────────────────────
    const filtersSection = document.createElement('div');
    filtersSection.classList.add('sg-settings-section');
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
    portraitContainer.style.marginBottom = '16px';
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
    this.applyFieldStyle(excludedTagsInput, FIELD_WIDTH);
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
      'Tracks up to this many recently seen items and hides them from the feed.\nNot applied when a saved filter is selected.\nSet to 0 to disable. Default: 500.'
    ));
    const seenHistorySizeInput = document.createElement('input');
    seenHistorySizeInput.type = 'number';
    seenHistorySizeInput.value = String(this.settings.seenHistorySize ?? 500);
    seenHistorySizeInput.min = '0';
    seenHistorySizeInput.max = '2000';
    this.applyFieldStyle(seenHistorySizeInput, NUMBER_WIDTH);
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
    this.applyFieldStyle(contentLimitInput, NUMBER_WIDTH);
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

    layoutContent.appendChild(versionFooter);

    // Store references to inputs for saveSettings method
    (this as any).maxDurationInput = maxDurationInput;
    (this as any).includeMarkersToggle = includeMarkersToggle;
    (this as any).playMarkersToEndToggle = markerPlayback.input;
    (this as any).includeRandomToggle = includeRandomToggle;
    (this as any).randomLongScenesOnlyToggle = randomLongScenes.input;
    (this as any).includeImagesToggle = includeImagesToggle;
    (this as any).searchMarkersByNameToggle = searchMarkersByNameToggle;
    (this as any).shortFormIncludeToggle = shortFormIncludeToggle;
    (this as any).shortFormFolderInput = shortFormFolderInput;
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
        const closeTopPage = this.pageStack.at(-1);
        if (closeTopPage) {
          closeTopPage();
          return;
        }
        this.close();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  }

  /**
   * One look for every settings field. 44px touch target; 16px text stops iOS zooming on focus.
   * Widths: FIELD_WIDTH for text/selects, NUMBER_WIDTH for numbers, '100%' for stacked fields.
   */
  private applyFieldStyle(field: HTMLInputElement | HTMLSelectElement, width: string): void {
    field.style.cssText = `width: ${width}; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 6px 10px; border-radius: ${THEME.radius.button}; border: 1px solid ${THEME.colors.border}; background: ${THEME.colors.surface}; color: ${THEME.colors.textPrimary}; font-size: 16px;`;
    field.classList.toggle('sg-field-wide', width === FIELD_WIDTH);
    if (field instanceof HTMLSelectElement) field.style.cursor = 'pointer';
    else if (field.type === 'number') field.style.textAlign = 'right';
  }

  /** Full-modal sub-page (drill-down options, pickers). Back or Escape closes the top-most one. */
  private createPage(title: string, onClose?: () => void): { body: HTMLElement; open: () => void } {
    const page = document.createElement('div');
    page.setAttribute('role', 'dialog');
    page.setAttribute('aria-modal', 'true');
    page.setAttribute('aria-label', title);
    page.style.cssText = `position: absolute; inset: 0; z-index: 1; display: none; flex-direction: column; box-sizing: border-box; padding: ${THEME.spacing.cardPadding}; background: ${THEME.colors.backgroundSecondary};`;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '‹ Back';
    back.setAttribute('aria-label', 'Back to settings');
    this.applyButtonStyle(back);
    const heading = document.createElement('h3');
    heading.textContent = title;
    heading.style.cssText = `margin: 0; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeTitle}; font-weight: ${THEME.typography.weightTitle};`;
    header.append(back, heading);

    const body = document.createElement('div');
    body.style.cssText = 'flex: 1 1 auto; min-height: 0; overflow-y: auto;';
    page.append(header, body);
    this.modal.appendChild(page);

    const close = () => {
      page.style.display = 'none';
      this.pageStack = this.pageStack.filter((entry) => entry !== close);
      onClose?.();
    };
    back.addEventListener('click', close);
    return {
      body,
      open: () => {
        page.style.display = 'flex';
        this.pageStack.push(close);
        back.focus();
      },
    };
  }

  /** Full-width 44px row that opens a sub-page: "<content> ›". */
  private buildDrillButton(content: HTMLElement, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = `width: 100%; min-height: 44px; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0 12px; box-sizing: border-box; cursor: pointer; text-align: left; border: none; border-radius: ${THEME.radius.card}; background: ${THEME.colors.surface}; color: ${THEME.colors.textSecondary}; font-size: ${THEME.typography.sizeBody};`;
    const chevron = document.createElement('span');
    chevron.textContent = '›';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.style.fontSize = '20px';
    button.append(content, chevron);
    button.addEventListener('click', onClick);
    return button;
  }

  /** Multi-select row ("Galleries  3 selected ›") that opens a searchable checkbox list. */
  private buildPicker(opts: {
    label: string;
    title: string;
    emptyText: string;
    getSelected: () => Tag[];
    setSelected: (items: Tag[]) => void;
    search: (query: string, signal: AbortSignal) => Promise<Tag[]>;
  }): HTMLButtonElement {
    let request: AbortController | undefined;
    const page = this.createPage(opts.title, () => request?.abort());

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search';
    search.setAttribute('aria-label', 'Search ' + opts.title.toLowerCase());
    this.applyFieldStyle(search, '100%');
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.style.cssText = `display: block; margin: 8px 0; color: ${THEME.colors.textMuted}; font-size: ${THEME.typography.sizeMeta};`;
    const list = document.createElement('ul');
    list.setAttribute('aria-label', opts.title);
    list.style.cssText = 'list-style: none; margin: 0; padding: 0;';
    page.body.append(search, status, list);

    const rowText = document.createElement('span');
    rowText.style.cssText = 'display: flex; justify-content: space-between; gap: 12px; flex: 1; min-width: 0;';
    const rowLabel = document.createElement('span');
    rowLabel.textContent = opts.label;
    const rowValue = document.createElement('span');
    rowValue.style.color = THEME.colors.textMuted;
    rowText.append(rowLabel, rowValue);
    const refreshRow = () => {
      const count = opts.getSelected().length;
      rowValue.textContent = count > 0 ? `${count} selected` : opts.emptyText;
    };
    refreshRow();

    let results: Tag[] = [];
    // Selected items first, then the search results; toggling doesn't re-sort so rows don't jump under the finger.
    const renderList = () => {
      const selected = opts.getSelected();
      const selectedIds = new Set(selected.map((item) => item.id));
      const items = [...selected, ...results.filter((item) => !selectedIds.has(item.id))];
      list.replaceChildren(...items.map((item) => {
        const entry = document.createElement('li');
        const label = document.createElement('label');
        label.style.cssText = `display: flex; align-items: center; gap: 12px; min-height: 44px; cursor: pointer; color: ${THEME.colors.textPrimary}; font-size: ${THEME.typography.sizeBody}; border-bottom: 1px solid ${THEME.colors.border};`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedIds.has(item.id);
        checkbox.style.cssText = `width: 20px; height: 20px; flex-shrink: 0; margin: 0; accent-color: ${THEME.colors.accentPrimary};`;
        checkbox.addEventListener('change', () => {
          const current = opts.getSelected();
          opts.setSelected(checkbox.checked ? [...current, item] : current.filter((other) => other.id !== item.id));
          refreshRow();
        });
        const name = document.createElement('span');
        name.textContent = item.name;
        name.style.overflowWrap = 'anywhere';
        label.append(checkbox, name);
        entry.appendChild(label);
        return entry;
      }));
    };

    const runSearch = () => {
      request?.abort();
      const current = new AbortController();
      request = current;
      status.textContent = 'Searching…';
      const timer = setTimeout(async () => {
        try {
          results = await opts.search(search.value.trim(), current.signal);
          if (current.signal.aborted) return;
          renderList();
          status.textContent = results.length === 0 ? 'No matches' : '';
        } catch {
          if (!current.signal.aborted) status.textContent = 'Could not load. Change the search to retry.';
        }
      }, 250);
      current.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    };
    search.addEventListener('input', runSearch);

    return this.buildDrillButton(rowText, () => {
      page.open();
      renderList();
      runSearch();
    });
  }

  private applyButtonStyle(button: HTMLButtonElement): void {
    button.style.cssText = `min-height: 44px; padding: 0 16px; border-radius: ${THEME.radius.button}; cursor: pointer; font-size: ${THEME.typography.sizeBody}; font-weight: ${THEME.typography.weightBodyStrong}; transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;`;
    button.style.border = `1px solid ${THEME.colors.border}`;
    button.style.background = THEME.colors.backgroundSecondary;
    button.style.color = THEME.colors.textSecondary;
  }

  private getFormInput(name: string): HTMLInputElement | undefined {
    return (this as any)[name] as HTMLInputElement | undefined;
  }

  private collectFormInputs(): Record<string, HTMLInputElement> | undefined {
    const inputNames = [
      'fileTypesInput', 'maxDurationInput', 'includeMarkersToggle', 'playMarkersToEndToggle', 'includeRandomToggle', 'randomLongScenesOnlyToggle',
      'randomIncludeScenesWithMarkersToggle', 'randomSnippetDurationInput', 'includeImagesToggle', 'searchMarkersByNameToggle',
      'shortFormIncludeToggle', 'shortFormFolderInput', 'includeScenePreviewsToggle', 'reelAutoScrollToggle', 'autoHideSearchBarToggle', 'hdVideoToggle',
      'portraitToggle', 'landscapeToggle',
      'themeBackgroundInput', 'themePrimaryInput', 'themeSecondaryInput', 'themeAccentInput',
      'showVerifiedCheckmarksToggle', 'showProductionAgeToggle', 'showStudioChipsToggle', 'showPerformerEmbellishmentToggle', 'sceneTitleToggle', 'showSceneTagsToggle', 'showPerformerTagsToggle',
      'showMalePerformersToggle', 'showFemalePerformersToggle', 'showOtherGenderPerformersToggle',
      'showBookmarkToggle', 'showOCountToggle', 'showRatingToggle', 'ratingHotkeysToggle', 'showViewCountToggle',
      'excludedTagsInput',
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
      maxResolution: Number(((this as any).maxResolutionSelect as HTMLSelectElement)?.value) || 0,
      includeMarkersInFeed: inputs.includeMarkersToggle.checked,
      playMarkersToEnd: inputs.playMarkersToEndToggle.checked,
      includeRandomInFeed: inputs.includeRandomToggle.checked,
      randomLongScenesOnly: inputs.randomLongScenesOnlyToggle.checked,
      randomIncludeScenesWithMarkers: inputs.randomIncludeScenesWithMarkersToggle.checked,
      randomSnippetDuration: validRandomSnippetDuration,
      includeImagesInFeed: inputs.includeImagesToggle.checked,
      searchMarkersByName: inputs.searchMarkersByNameToggle.checked,
      enabledFileTypes: extensions.length > 0 ? extensions : ['.jpg', '.png', '.gif', '.mp4', '.m4v', '.webm'],
      includeShortForm: inputs.shortFormIncludeToggle.checked,
      shortFormMaxDuration: validMaxDuration,
      shortFormTags: this.shortFormTags,
      shortFormFolder: inputs.shortFormFolderInput.value.trim(),
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
      showMalePerformers: inputs.showMalePerformersToggle.checked,
      showFemalePerformers: inputs.showFemalePerformersToggle.checked,
      showOtherGenderPerformers: inputs.showOtherGenderPerformersToggle.checked,
      showSceneTitle: inputs.sceneTitleToggle.checked,
      showSceneTags: inputs.showSceneTagsToggle.checked,
      showPerformerTags: inputs.showPerformerTagsToggle.checked,
      showBookmarkButton: inputs.showBookmarkToggle.checked,
      showOCountButton: inputs.showOCountToggle.checked,
      showRatingButton: inputs.showRatingToggle.checked,
      enableRatingHotkeys: inputs.ratingHotkeysToggle.checked,
      showViewCountBadge: inputs.showViewCountToggle.checked,
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
    for (const refresh of this.summaryRefreshers) refresh();
  }

  private close(): void {
    for (const closePage of this.pageStack) closePage();
    if (this.onClose) {
      this.onClose();
    }
    this.container.innerHTML = '';
    this.container.style.display = 'none';
  }
}
