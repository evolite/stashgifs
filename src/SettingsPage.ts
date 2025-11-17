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
    imageSectionTitle.textContent = 'Image Feed Settings';
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

    const includeImagesLabel = document.createElement('label');
    includeImagesLabel.textContent = 'Include images in feed';
    includeImagesLabel.style.color = '#FFFFFF';
    includeImagesLabel.style.fontSize = '14px';
    includeImagesLabel.style.cursor = 'pointer';
    includeImagesContainer.appendChild(includeImagesLabel);

    const includeImagesToggle = document.createElement('input');
    includeImagesToggle.type = 'checkbox';
    includeImagesToggle.checked = this.settings.includeImagesInFeed !== false;
    includeImagesToggle.style.cursor = 'pointer';
    includeImagesContainer.appendChild(includeImagesToggle);

    imageSection.appendChild(includeImagesContainer);

    // Images only toggle
    const imagesOnlyContainer = document.createElement('div');
    imagesOnlyContainer.style.display = 'flex';
    imagesOnlyContainer.style.justifyContent = 'space-between';
    imagesOnlyContainer.style.alignItems = 'center';
    imagesOnlyContainer.style.marginBottom = '16px';

    const imagesOnlyLabel = document.createElement('label');
    imagesOnlyLabel.textContent = 'Only load images (skip videos)';
    imagesOnlyLabel.style.color = '#FFFFFF';
    imagesOnlyLabel.style.fontSize = '14px';
    imagesOnlyLabel.style.cursor = 'pointer';
    imagesOnlyContainer.appendChild(imagesOnlyLabel);

    const imagesOnlyToggle = document.createElement('input');
    imagesOnlyToggle.type = 'checkbox';
    imagesOnlyToggle.checked = this.settings.imagesOnly === true;
    imagesOnlyToggle.style.cursor = 'pointer';
    imagesOnlyToggle.addEventListener('change', () => {
      if (imagesOnlyToggle.checked) {
        includeImagesToggle.checked = true;
      }
    });
    imagesOnlyContainer.appendChild(imagesOnlyToggle);

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

      const regex = `\\.(${cleanExtensions.join('|')})$`;
      regexPreview.textContent = `Regex: ${regex}`;
    };

    fileTypesInput.addEventListener('input', updateRegexPreview);
    updateRegexPreview();

    imageSection.appendChild(fileTypesContainer);

    modal.appendChild(imageSection);

    // Save button
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save Settings';
    saveButton.style.width = '100%';
    saveButton.style.padding = '12px';
    saveButton.style.borderRadius = '8px';
    saveButton.style.border = 'none';
    saveButton.style.backgroundColor = '#F5C518';
    saveButton.style.color = '#000000';
    saveButton.style.fontSize = '16px';
    saveButton.style.fontWeight = '600';
    saveButton.style.cursor = 'pointer';
    saveButton.style.transition = 'background-color 0.2s ease';
    saveButton.addEventListener('mouseenter', () => {
      saveButton.style.backgroundColor = '#FFD700';
    });
    saveButton.addEventListener('mouseleave', () => {
      saveButton.style.backgroundColor = '#F5C518';
    });
    saveButton.addEventListener('click', () => {
      const extensions = fileTypesInput.value
        .split(',')
        .map(ext => ext.trim())
        .filter(ext => ext.length > 0)
        .map(ext => ext.startsWith('.') ? ext : `.${ext}`);

      const newSettings: Partial<FeedSettings> = {
        includeImagesInFeed: includeImagesToggle.checked,
        enabledFileTypes: extensions.length > 0 ? extensions : ['.gif'],
        imagesOnly: imagesOnlyToggle.checked,
      };

      if (this.onSave) {
        this.onSave(newSettings);
      }

      // Save to localStorage
      try {
        const savedSettings = localStorage.getItem('stashgifs-settings');
        const currentSettings = savedSettings ? JSON.parse(savedSettings) : {};
        const updatedSettings = { ...currentSettings, ...newSettings };
        localStorage.setItem('stashgifs-settings', JSON.stringify(updatedSettings));
      } catch (error) {
        console.error('Failed to save settings to localStorage', error);
      }

      this.close();
      
      // Refresh the page to apply settings
      globalThis.location.reload();
    });

    modal.appendChild(saveButton);

    this.container.appendChild(modal);

    // Close on background click
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.close();
      }
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

  private close(): void {
    if (this.onClose) {
      this.onClose();
    }
    this.container.innerHTML = '';
    this.container.style.display = 'none';
  }
}

