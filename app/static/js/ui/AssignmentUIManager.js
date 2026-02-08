/**
 * AssignmentUIManager - Manages assignment mode (single vs multiple tickets) and batch workflow buttons
 */
class AssignmentUIManager {
  /**
   * Create an AssignmentUIManager instance
   * @param {string} mainContentSelector - CSS selector for the main content container
   */
  constructor(mainContentSelector = CONSTANTS.SELECTORS.MAIN_CONTENT) {
    this.mainContentSelector = mainContentSelector;
    this.toggles = {};
    this.currentMode = CONSTANTS.MODES.SINGLE_TICKET;
    this.batchButtonsContainer = null;
  }

  /**
   * Initialize the assignment UI manager
   * @param {HTMLElement} [insertAfterElement] - Element to insert toggle buttons after
   * @returns {Object} Object containing toggle instances
   */
  initialize(insertAfterElement = null) {
    debugLog('[ASSIGNMENT_UI] - Initializing AssignmentUIManager');

    // Check if already initialized - remove existing buttons first to prevent duplicates
    this.remove();

    // Create toggle buttons
    this._createToggleButtons(insertAfterElement);

    // Load preferences and create toggle instances
    this.toggles.single = this._createToggle(
      true,
      CONSTANTS.STORAGE_KEYS.SINGLE_TICKET_ON,
      CONSTANTS.ICONS.SINGLE_TICKET,
      CONSTANTS.SELECTORS.SINGLE_TICKET_ICON,
      CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE
    );

    this.toggles.multiple = this._createToggle(
      false,
      CONSTANTS.STORAGE_KEYS.MULTIPLE_TICKETS_ON,
      CONSTANTS.ICONS.MULTIPLE_TICKETS,
      CONSTANTS.SELECTORS.MULTIPLE_TICKETS_ICON,
      CONSTANTS.SELECTORS.MULTIPLE_TICKETS_TOGGLE
    );

    // Determine current mode
    this.currentMode = this.toggles.single?.isOn ? CONSTANTS.MODES.SINGLE_TICKET : CONSTANTS.MODES.MULTIPLE_TICKETS;

    // Listen for theme changes
    document.addEventListener('themeChanged', (e) => {
      const isDark = e.detail.isDark;
      Object.values(this.toggles).forEach(toggle => {
        if (toggle) toggle.applyIcon(isDark);
      });
    });

    debugLog('[ASSIGNMENT_UI] - AssignmentUIManager initialization complete');
    return this.toggles;
  }

  /**
   * Set the assignment mode (single or multiple tickets)
   * @param {string} mode - Mode to set ('single' or 'multiple')
   */
  setMode(mode) {
    debugLog('[ASSIGNMENT_UI] - Setting assignment mode:', mode);

    if (this.currentMode === mode) {
      debugLog('[ASSIGNMENT_UI] - Mode already active, no change needed');
      return;
    }

    // Update toggle states
    this.toggles.single.isOn = (mode === CONSTANTS.MODES.SINGLE_TICKET);
    this.toggles.multiple.isOn = (mode === CONSTANTS.MODES.MULTIPLE_TICKETS);
    this.currentMode = mode;

    // Apply icons and save preferences
    const isDark = ToggleButton.currentThemeIsDark();
    Object.values(this.toggles).forEach(toggle => {
      if (toggle) {
        toggle.applyIcon(isDark);
        toggle.savePreference();
      }
    });

    // Update UI based on mode
    if (mode === CONSTANTS.MODES.SINGLE_TICKET) {
      this.showSearchInput();
      this.hideBatchButtons();
      this._updatePlaceholder(CONSTANTS.PLACEHOLDERS.SINGLE_TICKET);
    } else {
      this.hideSearchInput();
      this.showBatchButtons();
      this._updatePlaceholder(CONSTANTS.PLACEHOLDERS.MULTIPLE_TICKETS);
    }
  }

  /**
   * Get the current assignment mode
   * @returns {string} Current mode ('single' or 'multiple')
   */
  getMode() {
    return this.currentMode;
  }

  /**
   * Show the search input area
   */
  showSearchInput() {
    const inputGroup = document.querySelector(CONSTANTS.SELECTORS.INPUT_GROUP);
    if (inputGroup) {
      inputGroup.style.display = 'flex';
    }
  }

  /**
   * Hide the search input area
   */
  hideSearchInput() {
    const inputGroup = document.querySelector(CONSTANTS.SELECTORS.INPUT_GROUP);
    if (inputGroup) {
      inputGroup.style.display = 'none';
    }
  }

  /**
   * Show batch workflow buttons (create if needed)
   */
  showBatchButtons() {
    if (!this.batchButtonsContainer) {
      this._createBatchButtons();
    }

    if (this.batchButtonsContainer) {
      this.batchButtonsContainer.style.display = 'flex';
    }
  }

  /**
   * Hide batch workflow buttons
   */
  hideBatchButtons() {
    if (this.batchButtonsContainer) {
      this.batchButtonsContainer.remove();
      this.batchButtonsContainer = null;
    }
  }

  /**
   * Enable the recommendations button after validation tickets are loaded
   */
  enableRecommendationsButton() {
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
    }
  }

  /**
   * Disable the recommendations button
   */
  disableRecommendationsButton() {
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    if (btn) {
      btn.disabled = true;
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    }
  }

  /**
   * Update progress indicator text
   * @param {string} text - Progress text to display
   */
  updateProgress(text) {
    const progressIndicator = document.getElementById(CONSTANTS.SELECTORS.BATCH_PROGRESS_INDICATOR);
    const progressText = document.getElementById(CONSTANTS.SELECTORS.BATCH_PROGRESS_TEXT);

    if (progressIndicator && progressText) {
      progressIndicator.classList.remove('d-none');
      progressText.textContent = text;
    }
  }

  /**
   * Hide progress indicator
   */
  hideProgress() {
    const progressIndicator = document.getElementById(CONSTANTS.SELECTORS.BATCH_PROGRESS_INDICATOR);
    if (progressIndicator) {
      progressIndicator.classList.add('d-none');
    }
  }

  /**
   * Show recommendation processing progress with ticket info
   * @param {number} current - Current ticket number being processed
   * @param {number} total - Total number of tickets
   * @param {string} [ticketId] - Optional ticket ID being processed
   */
  showRecommendationProgress(current, total, ticketId = null) {
    const batchButtonsContainer = document.getElementById(CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS);
    if (!batchButtonsContainer) return;

    // Check if progress element exists, create if not
    let progressContainer = document.getElementById('recommendation-progress-container');
    
    if (!progressContainer) {
      progressContainer = document.createElement('div');
      progressContainer.id = 'recommendation-progress-container';
      progressContainer.className = 'd-flex align-items-center gap-2 ms-3';
      progressContainer.innerHTML = `
        <div class="spinner-border spinner-border-sm text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <span id="recommendation-progress-text" class="text-muted small"></span>
      `;
      batchButtonsContainer.appendChild(progressContainer);
    }

    const progressText = document.getElementById('recommendation-progress-text');
    if (progressText) {
      const ticketInfo = ticketId ? ` (${ticketId})` : '';
      progressText.textContent = `Processing ticket ${current}/${total}${ticketInfo}...`;
    }

    progressContainer.classList.remove('d-none');
  }

  /**
   * Hide recommendation processing progress
   */
  hideRecommendationProgress() {
    const progressContainer = document.getElementById('recommendation-progress-container');
    if (progressContainer) {
      progressContainer.classList.add('d-none');
    }
  }

  /**
   * Show completion message for recommendations
   * @param {number} total - Total number of tickets processed
   */
  showRecommendationComplete(total) {
    const progressContainer = document.getElementById('recommendation-progress-container');
    if (progressContainer) {
      progressContainer.innerHTML = `
        <i class="bi bi-check-circle text-success"></i>
        <span class="text-success small">${total} recommendations complete</span>
      `;
      progressContainer.classList.remove('d-none');
    }
  }

  /**
   * Remove assignment toggle buttons from DOM
   */
  remove() {
    const toggleDiv = document.getElementById(CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE)?.closest('.d-flex');
    if (toggleDiv && toggleDiv.id !== CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS) {
      toggleDiv.remove();
    }
    this.hideBatchButtons();
  }

  /**
   * Create the assignment toggle button HTML elements
   * @private
   */
  _createToggleButtons(insertAfterElement) {
    // First, ensure no existing assignment toggle buttons
    this._removeToggleButtonsOnly();

    const assignmentToggleDiv = document.createElement('div');
    assignmentToggleDiv.id = 'assignment-toggle-container';
    assignmentToggleDiv.className = 'd-flex justify-content-center align-items-center mb-4';
    assignmentToggleDiv.innerHTML = `
      <button id="${CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE}" class="btn single-ticket-btn rounded-circle" aria-label="Single Ticket Toggle">
        <img id="${CONSTANTS.SELECTORS.SINGLE_TICKET_ICON}" src="/static/images/single_ticket_icon_on_light.svg" alt="Single Ticket Toggle" class="img-fluid">
      </button>
      <button id="${CONSTANTS.SELECTORS.MULTIPLE_TICKETS_TOGGLE}" class="btn multiple-tickets-btn rounded-circle" aria-label="Multiple Tickets Toggle" style="margin-left: 0.5rem;">
        <img id="${CONSTANTS.SELECTORS.MULTIPLE_TICKETS_ICON}" src="/static/images/multiple_tickets_icon_off_light.svg" alt="Multiple Tickets Toggle" class="img-fluid">
      </button>
    `;

    const targetElement = insertAfterElement || document.querySelector(this.mainContentSelector);
    if (targetElement) {
      if (insertAfterElement) {
        insertAfterElement.insertAdjacentElement('afterend', assignmentToggleDiv);
      } else {
        const inputGroup = targetElement.querySelector(CONSTANTS.SELECTORS.INPUT_GROUP);
        if (inputGroup) {
          inputGroup.insertAdjacentElement('afterend', assignmentToggleDiv);
        } else {
          targetElement.appendChild(assignmentToggleDiv);
        }
      }
    }
  }

  /**
   * Remove only the toggle buttons (not batch buttons)
   * @private
   */
  _removeToggleButtonsOnly() {
    // Try to find by our custom ID first
    const containerById = document.getElementById('assignment-toggle-container');
    if (containerById) {
      containerById.remove();
      return;
    }

    // Fallback: find by looking for the single ticket toggle button
    const singleToggle = document.getElementById(CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE);
    if (singleToggle) {
      const toggleDiv = singleToggle.closest('.d-flex');
      if (toggleDiv && toggleDiv.id !== CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS) {
        toggleDiv.remove();
      }
    }
  }

  /**
   * Create the batch workflow buttons
   * @private
   */
  _createBatchButtons() {
    const mainContent = document.querySelector(this.mainContentSelector);
    const toggleButtons = mainContent?.querySelector('.d-flex.justify-content-center.align-items-center.mb-4');

    if (!toggleButtons) return;

    this.batchButtonsContainer = document.createElement('div');
    this.batchButtonsContainer.id = CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS;
    this.batchButtonsContainer.className = 'd-flex justify-content-center align-items-center gap-3 mb-4';
    this.batchButtonsContainer.innerHTML = `
      <button id="${CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN}" class="btn btn-primary btn-lg" type="button">
        Get validation tickets
      </button>
      <button id="${CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN}" class="btn btn-secondary btn-lg" type="button" disabled>
        Get ticket recommendations
      </button>
      <button id="${CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN}" class="btn btn-success btn-lg" type="button">
        Implement ticket assignment
      </button>
    `;

    toggleButtons.insertAdjacentElement('afterend', this.batchButtonsContainer);
  }

  /**
   * Update search input placeholder
   * @private
   */
  _updatePlaceholder(placeholder) {
    const searchInput = document.getElementById(CONSTANTS.SELECTORS.SEARCH_INPUT);
    if (searchInput) {
      searchInput.placeholder = placeholder;
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
   * Attach event listeners to toggle buttons
   * @param {Function} onSingleTicket - Callback for single ticket mode
   * @param {Function} onMultipleTickets - Callback for multiple tickets mode
   */
  attachToggleListeners(onSingleTicket, onMultipleTickets) {
    const singleBtn = document.getElementById(CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE);
    const multipleBtn = document.getElementById(CONSTANTS.SELECTORS.MULTIPLE_TICKETS_TOGGLE);

    if (singleBtn) {
      singleBtn.addEventListener('click', () => {
        if (this.currentMode !== CONSTANTS.MODES.SINGLE_TICKET) {
          this.setMode(CONSTANTS.MODES.SINGLE_TICKET);
          if (onSingleTicket) onSingleTicket();
        }
      });
    }

    if (multipleBtn) {
      multipleBtn.addEventListener('click', () => {
        if (this.currentMode !== CONSTANTS.MODES.MULTIPLE_TICKETS) {
          this.setMode(CONSTANTS.MODES.MULTIPLE_TICKETS);
          if (onMultipleTickets) onMultipleTickets();
        }
      });
    }
  }

  /**
   * Attach event listeners to batch workflow buttons
   * @param {Object} callbacks - Object containing callback functions
   * @param {Function} callbacks.onGetValidationTickets - Callback for get validation tickets button
   * @param {Function} callbacks.onGetRecommendations - Callback for get recommendations button
   * @param {Function} callbacks.onImplementAssignment - Callback for implement assignment button
   */
  attachBatchButtonListeners(callbacks) {
    const getValidationBtn = document.getElementById(CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN);
    const getRecommendationsBtn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    const implementBtn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);

    if (getValidationBtn && callbacks.onGetValidationTickets) {
      getValidationBtn.addEventListener('click', callbacks.onGetValidationTickets);
    }

    if (getRecommendationsBtn && callbacks.onGetRecommendations) {
      getRecommendationsBtn.addEventListener('click', callbacks.onGetRecommendations);
    }

    if (implementBtn && callbacks.onImplementAssignment) {
      implementBtn.addEventListener('click', callbacks.onImplementAssignment);
    }
  }
}
