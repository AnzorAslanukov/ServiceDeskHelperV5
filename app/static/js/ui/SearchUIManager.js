/**
 * SearchUIManager - Manages search toggle buttons (phone, match, semantic, ticket) and search input
 */
class SearchUIManager {
  /**
   * Create a SearchUIManager instance
   * @param {string} containerId - ID of the container element for toggle buttons
   * @param {string} inputId - ID of the search input element
   */
  constructor(containerId, inputId) {
    this.containerId = containerId;
    this.inputId = inputId;
    this.toggles = {};
    this.currentMode = CONSTANTS.MODES.PHONE;
  }

  /**
   * Initialize the search UI manager
   * @returns {Object} Object containing all toggle instances
   */
  initialize() {
    debugLog('[SEARCH_UI] - Initializing SearchUIManager');

    // Create toggle buttons
    this.createToggleButtons();

    // Load preferences and create toggle instances
    this.toggles.phone = this._createToggle(
      true,
      CONSTANTS.STORAGE_KEYS.PHONE_ON,
      CONSTANTS.ICONS.PHONE,
      CONSTANTS.SELECTORS.PHONE_ICON,
      CONSTANTS.SELECTORS.PHONE_TOGGLE
    );

    this.toggles.match = this._createToggle(
      false,
      CONSTANTS.STORAGE_KEYS.MATCH_ON,
      CONSTANTS.ICONS.MATCH,
      CONSTANTS.SELECTORS.MATCH_ICON,
      CONSTANTS.SELECTORS.MATCH_TOGGLE
    );

    this.toggles.semantic = this._createToggle(
      false,
      CONSTANTS.STORAGE_KEYS.SEMANTIC_ON,
      CONSTANTS.ICONS.SEMANTIC,
      CONSTANTS.SELECTORS.SEMANTIC_ICON,
      CONSTANTS.SELECTORS.SEMANTIC_TOGGLE
    );

    this.toggles.ticket = this._createToggle(
      false,
      CONSTANTS.STORAGE_KEYS.TICKET_ON,
      CONSTANTS.ICONS.TICKET,
      CONSTANTS.SELECTORS.TICKET_ICON,
      CONSTANTS.SELECTORS.TICKET_TOGGLE
    );

    // Determine current mode from loaded preferences
    this.currentMode = this._determineCurrentMode();
    this.updatePlaceholder(this.currentMode);

    // Attach event listeners
    this._attachEventListeners();

    // Listen for theme changes
    document.addEventListener('themeChanged', (e) => {
      const isDark = e.detail.isDark;
      Object.values(this.toggles).forEach(toggle => {
        if (toggle) toggle.applyIcon(isDark);
      });
    });

    debugLog('[SEARCH_UI] - SearchUIManager initialization complete');
    return this.toggles;
  }

  /**
   * Create the toggle button HTML elements
   */
  createToggleButtons() {
    debugLog('[SEARCH_UI] - Creating search toggle buttons');
    const container = document.getElementById(this.containerId);
    if (!container) {
      debugLog('[SEARCH_UI] - Container not found:', this.containerId);
      return;
    }

    // First, remove any existing search toggle buttons to prevent duplicates
    this._removeExistingToggleButtons();

    // Create the flex container div
    const toggleDiv = document.createElement('div');
    toggleDiv.id = 'search-toggle-container';
    toggleDiv.className = 'd-flex justify-content-center align-items-center';

    // Define button configurations
    const buttonConfigs = [
      {
        id: CONSTANTS.SELECTORS.PHONE_TOGGLE,
        className: 'btn phone-btn rounded-circle',
        ariaLabel: 'Phone Toggle',
        tooltip: CONSTANTS.TOOLTIPS.PHONE,
        imgId: CONSTANTS.SELECTORS.PHONE_ICON,
        imgSrc: '/static/images/phone_icon_on_light.svg',
        imgAlt: 'Phone Toggle',
        marginLeft: ''
      },
      {
        id: CONSTANTS.SELECTORS.MATCH_TOGGLE,
        className: 'btn match-btn rounded-circle',
        ariaLabel: 'Match Toggle',
        tooltip: CONSTANTS.TOOLTIPS.MATCH,
        imgId: CONSTANTS.SELECTORS.MATCH_ICON,
        imgSrc: '/static/images/sentence_match_icon_off_light.svg',
        imgAlt: 'Match Toggle',
        marginLeft: 'margin-left: 0.5rem;'
      },
      {
        id: CONSTANTS.SELECTORS.SEMANTIC_TOGGLE,
        className: 'btn semantic-btn rounded-circle',
        ariaLabel: 'Semantic Toggle',
        tooltip: CONSTANTS.TOOLTIPS.SEMANTIC,
        imgId: CONSTANTS.SELECTORS.SEMANTIC_ICON,
        imgSrc: '/static/images/abc_icon_off_light.svg',
        imgAlt: 'Semantic Toggle',
        marginLeft: 'margin-left: 0.5rem;'
      },
      {
        id: CONSTANTS.SELECTORS.TICKET_TOGGLE,
        className: 'btn ticket-btn rounded-circle',
        ariaLabel: 'Ticket Toggle',
        tooltip: CONSTANTS.TOOLTIPS.TICKET,
        imgId: CONSTANTS.SELECTORS.TICKET_ICON,
        imgSrc: '/static/images/ticket_icon_off_light.svg',
        imgAlt: 'Ticket Toggle',
        marginLeft: 'margin-left: 0.5rem;'
      }
    ];

    // Create and append each button
    buttonConfigs.forEach(config => {
      debugLog('[SEARCH_UI] - Creating button:', config.id);
      const button = document.createElement('button');
      button.id = config.id;
      button.className = config.className;
      button.setAttribute('aria-label', config.ariaLabel);
      button.setAttribute('data-bs-toggle', 'tooltip');
      button.setAttribute('data-bs-placement', 'top');
      button.setAttribute('data-bs-title', config.tooltip);
      button.style.cssText = config.marginLeft;

      const img = document.createElement('img');
      img.id = config.imgId;
      img.src = config.imgSrc;
      img.alt = config.imgAlt;
      img.className = 'img-fluid';

      button.appendChild(img);
      toggleDiv.appendChild(button);
    });

    // Add to container
    container.appendChild(toggleDiv);

    // Initialize Bootstrap tooltips for the newly created buttons
    initializeTooltips('[data-bs-toggle="tooltip"]');
    debugLog('[SEARCH_UI] - Toggle buttons creation completed with tooltips');
  }

  /**
   * Set the active search mode (mutually exclusive)
   * @param {string} mode - Mode to activate ('phone', 'match', 'semantic', 'ticket')
   */
  setActiveMode(mode) {
    debugLog('[SEARCH_UI] - Setting active mode:', mode);

    // Turn off all modes first
    Object.keys(this.toggles).forEach(key => {
      if (this.toggles[key]) {
        this.toggles[key].isOn = false;
      }
    });

    // Turn on selected mode
    if (this.toggles[mode]) {
      this.toggles[mode].isOn = true;
    }

    this.currentMode = mode;

    // Apply icons and save preferences
    const isDark = ToggleButton.currentThemeIsDark();
    Object.values(this.toggles).forEach(toggle => {
      if (toggle) {
        toggle.applyIcon(isDark);
        toggle.savePreference();
      }
    });

    // Update placeholder
    this.updatePlaceholder(mode);
  }

  /**
   * Get the currently active search mode
   * @returns {string} Current mode ('phone', 'match', 'semantic', 'ticket')
   */
  getActiveMode() {
    return this.currentMode;
  }

  /**
   * Update the search input placeholder based on active mode
   * @param {string} mode - The active mode
   */
  updatePlaceholder(mode) {
    const searchInput = document.getElementById(this.inputId);
    if (!searchInput) return;

    const placeholders = {
      [CONSTANTS.MODES.PHONE]: CONSTANTS.PLACEHOLDERS.PHONE,
      [CONSTANTS.MODES.MATCH]: CONSTANTS.PLACEHOLDERS.MATCH,
      [CONSTANTS.MODES.SEMANTIC]: CONSTANTS.PLACEHOLDERS.SEMANTIC,
      [CONSTANTS.MODES.TICKET]: CONSTANTS.PLACEHOLDERS.TICKET
    };

    searchInput.placeholder = placeholders[mode] || CONSTANTS.PLACEHOLDERS.PHONE;
  }

  /**
   * Show the search toggle buttons
   */
  show() {
    const searchDiv = document.getElementById(CONSTANTS.SELECTORS.PHONE_TOGGLE)?.closest('.d-flex');
    if (searchDiv) {
      searchDiv.classList.remove('d-none');
      searchDiv.classList.add('d-flex');
      // Re-initialize tooltips in case they were lost
      initializeTooltips('[data-bs-toggle="tooltip"]');
    } else {
      // Buttons don't exist, recreate them
      debugLog('[SEARCH_UI] - Search toggle buttons not found, recreating');
      this.createToggleButtons();
      // Re-attach event listeners after recreation
      this._attachEventListeners();
    }
  }

  /**
   * Hide the search toggle buttons
   */
  hide() {
    const searchDiv = document.getElementById(CONSTANTS.SELECTORS.PHONE_TOGGLE)?.closest('.d-flex');
    if (searchDiv) {
      searchDiv.classList.remove('d-flex');
      searchDiv.classList.add('d-none');
    }
  }

  /**
   * Create a ToggleButton instance with loaded preference
   * @private
   */
  _createToggle(defaultState, storageKey, iconBaseName, elementId, buttonId) {
    return ToggleButton.loadPreference(defaultState, storageKey, iconBaseName, elementId, buttonId);
  }

  /**
   * Determine the current mode from loaded toggle states
   * @private
   */
  _determineCurrentMode() {
    if (this.toggles.phone?.isOn) return CONSTANTS.MODES.PHONE;
    if (this.toggles.match?.isOn) return CONSTANTS.MODES.MATCH;
    if (this.toggles.semantic?.isOn) return CONSTANTS.MODES.SEMANTIC;
    if (this.toggles.ticket?.isOn) return CONSTANTS.MODES.TICKET;
    return CONSTANTS.MODES.PHONE; // Default
  }

  /**
   * Remove existing search toggle buttons to prevent duplicates
   * @private
   */
  _removeExistingToggleButtons() {
    // Try to find by our custom ID first
    const containerById = document.getElementById('search-toggle-container');
    if (containerById) {
      containerById.remove();
      return;
    }

    // Fallback: find by looking for the phone toggle button
    const phoneToggle = document.getElementById(CONSTANTS.SELECTORS.PHONE_TOGGLE);
    if (phoneToggle) {
      const toggleDiv = phoneToggle.closest('.d-flex');
      if (toggleDiv) {
        toggleDiv.remove();
      }
    }
  }

  /**
   * Attach click event listeners to toggle buttons
   * @private
   */
  _attachEventListeners() {
    const modes = [
      { id: CONSTANTS.SELECTORS.PHONE_TOGGLE, mode: CONSTANTS.MODES.PHONE },
      { id: CONSTANTS.SELECTORS.MATCH_TOGGLE, mode: CONSTANTS.MODES.MATCH },
      { id: CONSTANTS.SELECTORS.SEMANTIC_TOGGLE, mode: CONSTANTS.MODES.SEMANTIC },
      { id: CONSTANTS.SELECTORS.TICKET_TOGGLE, mode: CONSTANTS.MODES.TICKET }
    ];

    modes.forEach(({ id, mode }) => {
      const button = document.getElementById(id);
      if (button) {
        button.addEventListener('click', () => {
          if (this.currentMode !== mode) {
            this.setActiveMode(mode);
          }
        });
      }
    });
  }
}
