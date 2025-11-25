/**
 * Settings Page Component
 * Allows users to configure file types and image feed settings
 */

import { FeedSettings } from './types.js';

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
    slider.style.backgroundColor = checked ? '#4CAF50' : 'rgba(255, 255, 255, 0.3)';
    slider.style.transition = 'background-color 0.3s ease';
    slider.style.borderRadius = '28px';
    slider.style.cursor = 'pointer';

    const thumb = document.createElement('span');
    thumb.style.position = 'absolute';
    thumb.style.height = '22px';
    thumb.style.width = '22px';
    thumb.style.left = checked ? '26px' : '3px';
    thumb.style.top = '3px';
    thumb.style.backgroundColor = '#FFFFFF';
    thumb.style.borderRadius = '50%';
    thumb.style.transition = 'left 0.3s ease, box-shadow 0.3s ease';
    thumb.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    thumb.style.cursor = 'pointer';

    const updateVisualState = () => {
      const isChecked = input.checked;
      slider.style.backgroundColor = isChecked ? '#4CAF50' : 'rgba(255, 255, 255, 0.3)';
      thumb.style.left = isChecked ? '26px' : '3px';
    };

    // Add hover effect
    container.addEventListener('mouseenter', () => {
      if (!input.checked) {
        slider.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
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
    this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    this.container.style.zIndex = '10000';
    this.container.style.display = 'flex';
    this.container.style.alignItems = 'center';
    this.container.style.justifyContent = 'center';
    this.container.style.padding = '20px';
    this.container.style.boxSizing = 'border-box';
    this.container.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

    const modal = document.createElement('div');
    modal.style.backgroundColor = '#1C1C1E';
    modal.style.borderRadius = '16px';
    modal.style.padding = '24px';
    modal.style.maxWidth = '600px';
    modal.style.width = '100%';
    modal.style.maxHeight = '90vh';
    modal.style.overflowY = 'auto';
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
    title.style.color = '#FFFFFF';
    title.style.fontSize = '24px';
    title.style.fontWeight = '600';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '✕';
    closeButton.style.background = 'transparent';
    closeButton.style.border = 'none';
    closeButton.style.color = '#FFFFFF';
    closeButton.style.fontSize = '24px';
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

    // Image Feed Settings Section
    const imageSection = document.createElement('div');
    imageSection.style.marginBottom = '32px';

    const imageSectionTitle = document.createElement('h3');
    imageSectionTitle.textContent = 'Image feed';
    imageSectionTitle.style.margin = '0 0 16px 0';
    imageSectionTitle.style.color = '#FFFFFF';
    imageSectionTitle.style.fontSize = '18px';
    imageSectionTitle.style.fontWeight = '600';
    imageSection.appendChild(imageSectionTitle);

    // Include images toggle
    const includeImagesContainer = document.createElement('div');
    includeImagesContainer.style.display = 'flex';
    includeImagesContainer.style.justifyContent = 'space-between';
    includeImagesContainer.style.alignItems = 'center';
    includeImagesContainer.style.marginBottom = '16px';

    const includeImagesLabel = document.createElement('span');
    includeImagesLabel.textContent = 'Include images in feed';
    includeImagesLabel.style.color = '#FFFFFF';
    includeImagesLabel.style.fontSize = '14px';
    includeImagesContainer.appendChild(includeImagesLabel);

    const { container: includeImagesToggleContainer, input: includeImagesToggle } = this.createToggleSwitch(
      this.settings.includeImagesInFeed !== false,
      () => this.saveSettings()
    );
    includeImagesContainer.appendChild(includeImagesToggleContainer);

    imageSection.appendChild(includeImagesContainer);

    // Images only toggle
    const imagesOnlyContainer = document.createElement('div');
    imagesOnlyContainer.style.display = 'flex';
    imagesOnlyContainer.style.justifyContent = 'space-between';
    imagesOnlyContainer.style.alignItems = 'center';
    imagesOnlyContainer.style.marginBottom = '16px';

    const imagesOnlyLabel = document.createElement('span');
    imagesOnlyLabel.textContent = 'Only load images (skip videos)';
    imagesOnlyLabel.style.color = '#FFFFFF';
    imagesOnlyLabel.style.fontSize = '14px';
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

    // File types input
    const fileTypesContainer = document.createElement('div');
    fileTypesContainer.style.marginBottom = '16px';

    const fileTypesLabel = document.createElement('label');
    fileTypesLabel.textContent = 'File extensions (comma-separated)';
    fileTypesLabel.style.display = 'block';
    fileTypesLabel.style.color = '#FFFFFF';
    fileTypesLabel.style.fontSize = '14px';
    fileTypesLabel.style.marginBottom = '8px';
    fileTypesLabel.style.fontWeight = '500';
    fileTypesContainer.appendChild(fileTypesLabel);

    const fileTypesInput = document.createElement('input');
    fileTypesInput.type = 'text';
    fileTypesInput.value = (this.settings.enabledFileTypes || ['.gif']).join(', ');
    fileTypesInput.style.width = '100%';
    fileTypesInput.style.padding = '12px';
    fileTypesInput.style.borderRadius = '8px';
    fileTypesInput.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    fileTypesInput.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    fileTypesInput.style.color = '#FFFFFF';
    fileTypesInput.style.fontSize = '14px';
    fileTypesInput.style.boxSizing = 'border-box';
    fileTypesInput.placeholder = '.gif, .webm, .mp4';
    fileTypesContainer.appendChild(fileTypesInput);

    // Regex preview
    const regexPreview = document.createElement('div');
    regexPreview.style.marginTop = '8px';
    regexPreview.style.padding = '8px';
    regexPreview.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    regexPreview.style.borderRadius = '6px';
    regexPreview.style.fontSize = '12px';
    regexPreview.style.color = 'rgba(255, 255, 255, 0.7)';
    regexPreview.style.fontFamily = 'monospace';
    fileTypesContainer.appendChild(regexPreview);

    const updateRegexPreview = () => {
      const extensions = fileTypesInput.value
        .split(',')
        .map(ext => ext.trim())
        .filter(ext => ext.length > 0);
      
      if (extensions.length === 0) {
        regexPreview.textContent = String.raw`Regex: \.(gif)$`;
        return;
      }

      const cleanExtensions = extensions
        .map(ext => ext.replace(/^\./, '').toLowerCase())
        .filter(ext => /^[a-z0-9]+$/i.test(ext));
      
      if (cleanExtensions.length === 0) {
        regexPreview.textContent = String.raw`Regex: \.(gif)$`;
        return;
      }

      const regex = String.raw`\.(${cleanExtensions.join('|')})$`;
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

    modal.appendChild(imageSection);

    // Short Form Content Settings Section
    const shortFormSection = document.createElement('div');
    shortFormSection.style.marginBottom = '32px';

    const shortFormSectionTitle = document.createElement('h3');
    shortFormSectionTitle.textContent = 'Short form content';
    shortFormSectionTitle.style.margin = '0 0 16px 0';
    shortFormSectionTitle.style.color = '#FFFFFF';
    shortFormSectionTitle.style.fontSize = '18px';
    shortFormSectionTitle.style.fontWeight = '600';
    shortFormSection.appendChild(shortFormSectionTitle);

    // Include in HD mode toggle
    const shortFormHDContainer = document.createElement('div');
    shortFormHDContainer.style.display = 'flex';
    shortFormHDContainer.style.justifyContent = 'space-between';
    shortFormHDContainer.style.alignItems = 'center';
    shortFormHDContainer.style.marginBottom = '16px';

    const shortFormHDLabel = document.createElement('span');
    shortFormHDLabel.textContent = 'Include in HD mode';
    shortFormHDLabel.style.color = '#FFFFFF';
    shortFormHDLabel.style.fontSize = '14px';
    shortFormHDContainer.appendChild(shortFormHDLabel);

    const { container: shortFormHDToggleContainer, input: shortFormHDToggle } = this.createToggleSwitch(
      this.settings.shortFormInHDMode === true,
      () => this.saveSettings()
    );
    shortFormHDContainer.appendChild(shortFormHDToggleContainer);

    shortFormSection.appendChild(shortFormHDContainer);

    // Include in non-HD mode toggle
    const shortFormNonHDContainer = document.createElement('div');
    shortFormNonHDContainer.style.display = 'flex';
    shortFormNonHDContainer.style.justifyContent = 'space-between';
    shortFormNonHDContainer.style.alignItems = 'center';
    shortFormNonHDContainer.style.marginBottom = '16px';

    const shortFormNonHDLabel = document.createElement('span');
    shortFormNonHDLabel.textContent = 'Include in non-HD mode';
    shortFormNonHDLabel.style.color = '#FFFFFF';
    shortFormNonHDLabel.style.fontSize = '14px';
    shortFormNonHDContainer.appendChild(shortFormNonHDLabel);

    const { container: shortFormNonHDToggleContainer, input: shortFormNonHDToggle } = this.createToggleSwitch(
      this.settings.shortFormInNonHDMode !== false,
      () => this.saveSettings()
    );
    shortFormNonHDContainer.appendChild(shortFormNonHDToggleContainer);

    shortFormSection.appendChild(shortFormNonHDContainer);

    // Max duration input
    const maxDurationContainer = document.createElement('div');
    maxDurationContainer.style.marginBottom = '16px';

    const maxDurationLabel = document.createElement('label');
    maxDurationLabel.textContent = 'Maximum duration (seconds)';
    maxDurationLabel.style.display = 'block';
    maxDurationLabel.style.color = '#FFFFFF';
    maxDurationLabel.style.fontSize = '14px';
    maxDurationLabel.style.marginBottom = '8px';
    maxDurationLabel.style.fontWeight = '500';
    maxDurationContainer.appendChild(maxDurationLabel);

    const maxDurationInput = document.createElement('input');
    maxDurationInput.type = 'number';
    maxDurationInput.value = String(this.settings.shortFormMaxDuration || 120);
    maxDurationInput.min = '1';
    maxDurationInput.max = '600';
    maxDurationInput.style.width = '100%';
    maxDurationInput.style.padding = '12px';
    maxDurationInput.style.borderRadius = '8px';
    maxDurationInput.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    maxDurationInput.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    maxDurationInput.style.color = '#FFFFFF';
    maxDurationInput.style.fontSize = '14px';
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
    shortFormOnlyLabel.textContent = 'Only load short form content (skip regular videos)';
    shortFormOnlyLabel.style.color = '#FFFFFF';
    shortFormOnlyLabel.style.fontSize = '14px';
    shortFormOnlyContainer.appendChild(shortFormOnlyLabel);

    const { container: shortFormOnlyToggleContainer, input: shortFormOnlyToggle } = this.createToggleSwitch(
      this.settings.shortFormOnly === true,
      (checked) => {
        if (checked) {
          // When "only load short form content" is enabled, enable both HD and non-HD modes
          shortFormHDToggle.checked = true;
          shortFormHDToggle.dispatchEvent(new Event('change'));
          shortFormNonHDToggle.checked = true;
          shortFormNonHDToggle.dispatchEvent(new Event('change'));
        }
        this.saveSettings();
      }
    );
    shortFormOnlyContainer.appendChild(shortFormOnlyToggleContainer);

    shortFormSection.appendChild(shortFormOnlyContainer);

    modal.appendChild(shortFormSection);

    // Scrolling Settings Section
    const scrollingSection = document.createElement('div');
    scrollingSection.style.marginBottom = '32px';

    const scrollingSectionTitle = document.createElement('h3');
    scrollingSectionTitle.textContent = 'Scrolling';
    scrollingSectionTitle.style.margin = '0 0 16px 0';
    scrollingSectionTitle.style.color = '#FFFFFF';
    scrollingSectionTitle.style.fontSize = '18px';
    scrollingSectionTitle.style.fontWeight = '600';
    scrollingSection.appendChild(scrollingSectionTitle);

    // Snap to cards toggle
    const snapToCardsContainer = document.createElement('div');
    snapToCardsContainer.style.display = 'flex';
    snapToCardsContainer.style.justifyContent = 'space-between';
    snapToCardsContainer.style.alignItems = 'center';
    snapToCardsContainer.style.marginBottom = '16px';

    const snapToCardsLabel = document.createElement('span');
    snapToCardsLabel.textContent = 'Snap to cards';
    snapToCardsLabel.style.color = '#FFFFFF';
    snapToCardsLabel.style.fontSize = '14px';
    snapToCardsContainer.appendChild(snapToCardsLabel);

    const { container: snapToCardsToggleContainer, input: snapToCardsToggle } = this.createToggleSwitch(
      this.settings.snapToCards === true,
      () => this.saveSettings()
    );
    snapToCardsContainer.appendChild(snapToCardsToggleContainer);

    scrollingSection.appendChild(snapToCardsContainer);

    modal.appendChild(scrollingSection);

    // Store references to inputs for saveSettings method
    (this as any).fileTypesInput = fileTypesInput;
    (this as any).maxDurationInput = maxDurationInput;
    (this as any).includeImagesToggle = includeImagesToggle;
    (this as any).imagesOnlyToggle = imagesOnlyToggle;
    (this as any).shortFormHDToggle = shortFormHDToggle;
    (this as any).shortFormNonHDToggle = shortFormNonHDToggle;
    (this as any).shortFormOnlyToggle = shortFormOnlyToggle;
    (this as any).snapToCardsToggle = snapToCardsToggle;

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
    const shortFormHDToggle = (this as any).shortFormHDToggle as HTMLInputElement | undefined;
    const shortFormNonHDToggle = (this as any).shortFormNonHDToggle as HTMLInputElement | undefined;
    const shortFormOnlyToggle = (this as any).shortFormOnlyToggle as HTMLInputElement | undefined;
    const snapToCardsToggle = (this as any).snapToCardsToggle as HTMLInputElement | undefined;

    if (!fileTypesInput || !maxDurationInput || !includeImagesToggle || !imagesOnlyToggle || 
        !shortFormHDToggle || !shortFormNonHDToggle || !shortFormOnlyToggle || !snapToCardsToggle) {
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
      enabledFileTypes: extensions.length > 0 ? extensions : ['.gif'],
      imagesOnly: imagesOnlyToggle.checked,
      shortFormInHDMode: shortFormHDToggle.checked,
      shortFormInNonHDMode: shortFormNonHDToggle.checked,
      shortFormMaxDuration: validMaxDuration,
      shortFormOnly: shortFormOnlyToggle.checked,
      snapToCards: snapToCardsToggle.checked,
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

