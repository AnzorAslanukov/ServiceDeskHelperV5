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
    
    // Workflow state management
    this.workflowState = 'idle'; // 'idle' | 'tickets-loaded' | 'recommendations-complete'
    this.totalTickets = 0;
    this.completedRecommendations = 0;

    // Recommendation toggle state
    this.recommendationToggleActive = false;

    // Whether the workflow has reached a state where the Implement button is allowed
    this._implementButtonAllowed = false;

    // ── Consensus state ──────────────────────────────────────────────────────
    this._consensusActive = false;       // whether consensus mode is currently active
    this._consensusAgreed = 0;           // how many users have agreed
    this._consensusRequired = 0;         // total users required
    this._consensusUnlocked = false;     // whether consensus has been achieved
    this._presenceCount = 0;             // current number of active users
    this._myConsensusVote = false;       // whether the current user has agreed
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
   * Enable the recommendations button in its current toggle visual state.
   * If the toggle is active (ON), shows the ON visual; otherwise shows OFF visual.
   */
  enableRecommendationsButton() {
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    if (!btn) return;
    btn.disabled = false;
    this._applyRecommendationToggleVisual(btn);
  }

  /**
   * Disable the recommendations button (grayed out, not clickable).
   * Resets the toggle state to OFF.
   */
  disableRecommendationsButton() {
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    if (!btn) return;
    btn.disabled = true;
    this.recommendationToggleActive = false;
    // Remove all toggle classes and apply disabled style
    btn.classList.remove('btn-primary', 'btn-secondary',
      'recommendation-toggle-off', 'recommendation-toggle-on');
    btn.classList.add('recommendation-toggle-disabled');
    btn.innerHTML = 'Get ticket recommendations';
    this._updateRecommendationTooltip(btn, 'disabled');
  }

  /**
   * Get whether the recommendation toggle is currently active (ON).
   * @returns {boolean}
   */
  isRecommendationToggleActive() {
    return this.recommendationToggleActive;
  }

  /**
   * Set the recommendation toggle to a specific state and update visuals.
   * @param {boolean} active - Whether the toggle should be ON (true) or OFF (false)
   */
  setRecommendationToggleState(active) {
    this.recommendationToggleActive = active;
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    if (!btn || btn.disabled) return;
    this._applyRecommendationToggleVisual(btn);
  }

  /**
   * Apply the correct CSS class and tooltip to the recommendation button
   * based on the current toggle state.
   * @param {HTMLElement} btn - The recommendation button element
   * @private
   */
  _applyRecommendationToggleVisual(btn) {
    // Strip all possible state classes
    btn.classList.remove('btn-primary', 'btn-secondary',
      'recommendation-toggle-off', 'recommendation-toggle-on',
      'recommendation-toggle-disabled');

    if (this.recommendationToggleActive) {
      btn.classList.add('recommendation-toggle-on');
      this._updateRecommendationTooltip(btn, 'on');
    } else {
      btn.classList.add('recommendation-toggle-off');
      this._updateRecommendationTooltip(btn, 'off');
    }
  }

  /**
   * Update the Bootstrap tooltip on the recommendation toggle button.
   *
   * @param {HTMLElement} btn - The recommendation button element
   * @param {'on'|'off'|'disabled'} state - Current toggle state
   * @private
   */
  _updateRecommendationTooltip(btn, state) {
    // Dispose any existing tooltip first
    const existing = bootstrap.Tooltip.getInstance(btn);
    if (existing) existing.dispose();

    let title = '';
    switch (state) {
      case 'off':
        title = 'Click to enable AI-generated recommendations for validation tickets';
        break;
      case 'on':
        title = 'Click to turn off AI-generated recommendations for validation tickets';
        break;
      case 'disabled':
        title = '';
        // Remove tooltip attributes when disabled — no tooltip needed
        btn.removeAttribute('data-bs-toggle');
        btn.removeAttribute('data-bs-placement');
        btn.removeAttribute('title');
        return;
    }

    btn.setAttribute('data-bs-toggle', 'tooltip');
    btn.setAttribute('data-bs-placement', 'top');
    btn.setAttribute('title', title);
    new bootstrap.Tooltip(btn);
  }

  /**
   * Enable the implement assignment button.
   * Instead of unconditionally enabling, this re-evaluates the current
   * checkbox selection state and delegates to updateImplementButtonState()
   * so the correct label and enabled/disabled state are applied.
   */
  enableImplementButton() {
    // Mark the button as "allowed" by the workflow — the actual enabled/disabled
    // state and label are determined by the checkbox selection counts.
    this._implementButtonAllowed = true;
    this.refreshImplementButtonLabel();
  }

  /**
   * Disable the implement assignment button unconditionally.
   * Used by workflow states that should never allow assignment (e.g. idle,
   * tickets-loading).
   */
  disableImplementButton() {
    this._implementButtonAllowed = false;
    const btn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
    if (btn) {
      btn.disabled = true;
      btn.classList.remove('btn-success');
      btn.classList.add('btn-secondary');
      btn.innerHTML = 'Implement ticket assignment';
    }
  }

  /**
   * Update the Implement button's enabled/disabled state and label based on
   * the current ticket checkbox selection.
   *
   * Three visual states:
   *   1. selectedCount === 0        → disabled, label: "Implement ticket assignment"
   *   2. 0 < selectedCount < total  → enabled,  label: "Implement X/Y ticket assignment"
   *   3. selectedCount === total     → enabled,  label: "Implement ticket assignment"
   *
   * This method is a no-op if the workflow has not yet allowed the button
   * (i.e. recommendations have not started arriving).
   *
   * @param {number} selectedCount - Number of checked ticket checkboxes
   * @param {number} totalCount    - Total number of enabled ticket checkboxes
   */
  updateImplementButtonState(selectedCount, totalCount) {
    // Only act if the workflow has reached a state where the button is allowed
    if (!this._implementButtonAllowed) return;

    const btn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
    if (!btn) return;

    if (selectedCount === 0) {
      // No tickets selected — disable
      btn.disabled = true;
      btn.classList.remove('btn-success');
      btn.classList.add('btn-secondary');
      btn.innerHTML = 'Implement ticket assignment';
    } else if (selectedCount < totalCount) {
      // Partial selection
      btn.disabled = false;
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-success');
      btn.innerHTML = `Implement ${selectedCount}/${totalCount} ticket assignment`;
    } else {
      // All tickets selected
      btn.disabled = false;
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-success');
      btn.innerHTML = 'Implement ticket assignment';
    }
  }

  /**
   * Re-read the current checkbox counts from the DOM and update the Implement
   * button label accordingly.  Convenience wrapper around
   * updateImplementButtonState() for callers that don't already have the counts.
   */
  refreshImplementButtonLabel() {
    if (!this._implementButtonAllowed) return;

    const checkedCount = document.querySelectorAll('.ticket-checkbox:not([disabled]):checked').length;
    const totalCount = document.querySelectorAll('.ticket-checkbox:not([disabled])').length;
    this.updateImplementButtonState(checkedCount, totalCount);
  }

  /**
   * Set the current workflow state and update button states accordingly
   * @param {string} state - Workflow state ('idle' | 'tickets-loading' | 'tickets-loaded' | 'recommendations-loading' | 'recommendations-complete')
   * @param {Object} [data] - Optional data for state transitions
   */
  setWorkflowState(state, data = {}) {
    debugLog('[ASSIGNMENT_UI] - Setting workflow state:', state);
    this.workflowState = state;

    switch (state) {
      case 'idle':
        // Initial state - only Get Validation Tickets is enabled
        this._setGetValidationTicketsButtonState(true);
        this.disableRecommendationsButton();
        this.disableImplementButton();
        break;

      case 'tickets-loading':
        // Loading validation tickets - disable Get Validation Tickets with spinner
        this._setGetValidationTicketsButtonState(false, true);
        this.disableRecommendationsButton();
        this.disableImplementButton();
        break;

      case 'tickets-loaded':
        // Tickets are in memory — lock the fetch button permanently until the view resets
        this._setGetValidationTicketsButtonState(false, false, true);
        this.enableRecommendationsButton();
        this.disableImplementButton();
        this.totalTickets = data.totalTickets || 0;
        this.completedRecommendations = 0;
        break;

      case 'recommendations-loading':
        // Processing recommendations — keep fetch button locked
        // Toggle is ON and button stays enabled (user can click to toggle OFF)
        this._setGetValidationTicketsButtonState(false, false, true);
        this.recommendationToggleActive = true;
        this._setGetRecommendationsButtonState(true, true);
        this.disableImplementButton();
        break;

      case 'recommendations-complete':
        // All recommendations complete — keep fetch button locked, enable Implement Assignment
        // Toggle stays ON; button stays enabled (user can click to toggle OFF)
        this._setGetValidationTicketsButtonState(false, false, true);
        this.recommendationToggleActive = true;
        this._setGetRecommendationsButtonState(true, false);
        this.enableImplementButton();
        break;

      default:
        debugLog('[ASSIGNMENT_UI] - Unknown workflow state:', state);
    }
  }

  /**
   * Update recommendation progress and check if complete
   * @param {number} completed - Number of completed recommendations
   * @param {number} total - Total number of tickets
   */
  updateRecommendationProgress(completed, total) {
    this.completedRecommendations = completed;
    this.totalTickets = total;

    if (completed >= total && total > 0) {
      this.setWorkflowState('recommendations-complete');
    }
  }

  /**
   * Get current workflow state
   * @returns {string} Current workflow state
   */
  getWorkflowState() {
    return this.workflowState;
  }

  /**
   * Set Get Validation Tickets button state.
   *
   * Three mutually-exclusive modes:
   *   enabled=true            → normal interactive button
   *   loading=true            → disabled with a spinner (tickets are being fetched)
   *   loaded=true             → disabled permanently; wrapper shows not-allowed cursor
   *                             and a Bootstrap tooltip explaining why it is locked
   *
   * @param {boolean} enabled  - Whether the button should be interactive
   * @param {boolean} loading  - Show a loading spinner (takes priority over loaded)
   * @param {boolean} loaded   - Tickets already in memory; show not-allowed cursor + tooltip
   * @private
   */
  _setGetValidationTicketsButtonState(enabled, loading = false, loaded = false) {
    const btn     = document.getElementById(CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN);
    const wrapper = document.getElementById(CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN_WRAPPER);
    if (!btn) return;

    // Tear down any existing tooltip on the button itself first.
    // Bootstrap 5 attaches tooltips to the element, so we must dispose before
    // removing attributes to avoid orphaned tooltip DOM nodes.
    const existingBtnTooltip = bootstrap.Tooltip.getInstance(btn);
    if (existingBtnTooltip) existingBtnTooltip.dispose();
    btn.removeAttribute('data-bs-toggle');
    btn.removeAttribute('data-bs-placement');
    btn.removeAttribute('title');

    // Also clean up any wrapper-level tooltip from a previous implementation.
    if (wrapper) {
      const existingWrapperTooltip = bootstrap.Tooltip.getInstance(wrapper);
      if (existingWrapperTooltip) existingWrapperTooltip.dispose();
      wrapper.removeAttribute('data-bs-toggle');
      wrapper.removeAttribute('data-bs-placement');
      wrapper.removeAttribute('title');
      wrapper.style.cursor = '';
    }

    // Reset button style overrides
    btn.style.pointerEvents = '';
    btn.style.cursor = '';

    if (loading) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Loading...';
    } else if (loaded) {
      // Tickets are in memory — lock the button until the view is reset.
      btn.disabled = true;

      // Bootstrap 5 CSS sets pointer-events:none on .btn:disabled, which would
      // prevent cursor changes and tooltip hover events.  An inline style has
      // higher specificity than any CSS rule, so setting pointer-events:auto
      // here restores hover events while the button remains functionally
      // disabled (HTML disabled attribute still blocks click events).
      btn.style.pointerEvents = 'auto';
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = 'Get validation tickets';

      // Attach the tooltip directly to the button — it now receives hover
      // events because pointer-events:auto is set above.
      btn.setAttribute('data-bs-toggle', 'tooltip');
      btn.setAttribute('data-bs-placement', 'top');
      btn.setAttribute('title', 'All validation tickets have been successfully loaded');
      new bootstrap.Tooltip(btn);

      // Mirror the not-allowed cursor on the wrapper span so the cursor is
      // consistent even in the small gap between the button and the span edge.
      if (wrapper) {
        wrapper.style.cursor = 'not-allowed';
      }
    } else {
      btn.disabled = !enabled;
      btn.innerHTML = 'Get validation tickets';
    }
  }

  /**
   * Set Get Recommendations button state with toggle-aware visuals.
   *
   * When enabled, the button uses the toggle visual (ON or OFF) based on
   * this.recommendationToggleActive.  When loading, a spinner is shown
   * inside the ON-state button.
   *
   * @param {boolean} enabled  - Whether the button should be clickable
   * @param {boolean} loading  - Show a spinner (button remains clickable so user can toggle OFF)
   * @private
   */
  _setGetRecommendationsButtonState(enabled, loading = false) {
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    if (!btn) return;

    btn.disabled = !enabled;

    if (loading) {
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Processing...';
    } else {
      btn.innerHTML = 'Get ticket recommendations';
    }

    // Apply the toggle visual (ON/OFF) whenever the button is enabled
    if (enabled) {
      this._applyRecommendationToggleVisual(btn);
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
   * Show completion message for recommendations.
   * The message is displayed for 10 seconds and then fades out automatically.
   * @param {number} total - Total number of tickets processed
   */
  showRecommendationComplete(total) {
    const progressContainer = document.getElementById('recommendation-progress-container');
    if (progressContainer) {
      // Cancel any pending fade-out from a previous completion cycle
      if (progressContainer._recommendationHideTimeout) {
        clearTimeout(progressContainer._recommendationHideTimeout);
        progressContainer._recommendationHideTimeout = null;
        progressContainer.style.transition = '';
        progressContainer.style.opacity = '1';
      }

      // Remove and re-add the expiry timer bar class to restart the CSS animation
      progressContainer.classList.remove('expiry-timer-bar');

      progressContainer.innerHTML = `
        <i class="bi bi-check-circle text-success"></i>
        <span class="text-success small">${total} recommendations complete</span>
      `;
      progressContainer.classList.remove('d-none');

      // Force a reflow so the animation restarts cleanly when the class is re-added
      void progressContainer.offsetWidth;
      progressContainer.classList.add('expiry-timer-bar');

      // Fade out and hide the message after 10 seconds
      progressContainer._recommendationHideTimeout = setTimeout(() => {
        progressContainer.style.transition = 'opacity 0.6s ease';
        progressContainer.style.opacity = '0';
        // Clear content after the fade animation completes
        setTimeout(() => {
          progressContainer.innerHTML = '';
          progressContainer.classList.add('d-none');
          progressContainer.classList.remove('expiry-timer-bar');
          progressContainer.style.transition = '';
          progressContainer.style.opacity = '1';
          progressContainer._recommendationHideTimeout = null;
        }, 650);
      }, 10000);
    }
  }

  /**
   * Render presence indicator circles in the toggle row.
   * The first PRESENCE_VISIBLE_LIMIT circles are shown normally.
   * If there are more, a "+N" overflow badge is appended that opens a
   * Bootstrap popover listing the hidden users' names.
   * The current user's circle gets a distinct outline ring.
   * @param {Array} sessions - Array of { session_id, color, label } objects
   * @param {string} mySessionId - The current user's session ID
   */
  renderPresenceIndicators(sessions, mySessionId) {
    const PRESENCE_VISIBLE_LIMIT = 8;
    const container = document.getElementById('presence-indicators');
    if (!container) return;

    // Destroy any existing popovers attached to the overflow badge before re-rendering
    const existingBadge = container.querySelector('.presence-overflow-badge');
    if (existingBadge) {
      const existingPopover = bootstrap.Popover.getInstance(existingBadge);
      if (existingPopover) existingPopover.dispose();
    }

    if (!sessions || sessions.length === 0) {
      container.innerHTML = '';
      return;
    }

    const visible = sessions.slice(0, PRESENCE_VISIBLE_LIMIT);
    const overflow = sessions.slice(PRESENCE_VISIBLE_LIMIT);

    let html = '';

    // Render the visible circles
    visible.forEach(session => {
      const isMe = session.session_id === mySessionId;
      const meClass = isMe ? ' presence-indicator-me' : '';
      const label = `${session.label}${isMe ? ' (you)' : ''}`;
      html += `
        <div class="presence-indicator${meClass}"
             style="background-color: ${session.color};"
             data-bs-toggle="tooltip"
             data-bs-placement="bottom"
             title="${label}">
          <i class="bi bi-person-fill"></i>
        </div>
      `;
    });

    // Render the overflow badge if needed.
    // NOTE: data-bs-content is intentionally omitted from the HTML template —
    // it is set via setAttribute() after innerHTML is assigned so that the
    // popover HTML string never needs to be escaped as an attribute value.
    let popoverContent = '';
    if (overflow.length > 0) {
      popoverContent = overflow.map(s => {
        const isMe = s.session_id === mySessionId;
        const label = `${s.label}${isMe ? ' (you)' : ''}`;
        return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color};margin-right:6px;vertical-align:middle;"></span>${label}`;
      }).join('<br>');

      html += `
        <div class="presence-overflow-badge"
             role="button"
             tabindex="0"
             data-bs-toggle="popover"
             data-bs-trigger="click"
             data-bs-placement="bottom"
             data-bs-html="true"
             title="${overflow.length} more viewer${overflow.length > 1 ? 's' : ''}">
          +${overflow.length}
        </div>
      `;
    }

    container.innerHTML = html;

    // Set the popover content attribute programmatically so the HTML string
    // does not need to be entity-encoded for use inside an attribute value.
    if (overflow.length > 0) {
      const badgeEl = container.querySelector('.presence-overflow-badge');
      if (badgeEl) {
        badgeEl.setAttribute('data-bs-content', popoverContent);
      }
    }

    // Initialise tooltips on the visible circles
    initializeTooltips('#presence-indicators [data-bs-toggle="tooltip"]');

    // Initialise the overflow popover (if present) and auto-dismiss on outside click
    const badge = container.querySelector('.presence-overflow-badge');
    if (badge) {
      const pop = new bootstrap.Popover(badge, { html: true });

      // Dismiss popover when clicking anywhere outside it
      const outsideClickHandler = (e) => {
        if (!badge.contains(e.target) && !document.querySelector('.popover')?.contains(e.target)) {
          pop.hide();
        }
      };
      document.addEventListener('click', outsideClickHandler);

      // Clean up the outside-click listener when the popover is fully hidden
      badge.addEventListener('hidden.bs.popover', () => {
        document.removeEventListener('click', outsideClickHandler);
      }, { once: true });
    }

    debugLog('[ASSIGNMENT_UI] - Rendered', visible.length, 'visible +', overflow.length, 'overflow presence indicator(s)');
  }

  // ── Consensus-based implement button methods ─────────────────────────────

  /**
   * Update the stored presence count.
   * Called from the heartbeat handler in main.js.
   * @param {number} count - Number of active users
   */
  setPresenceCount(count) {
    this._presenceCount = count;
  }

  /**
   * Get the current presence count.
   * @returns {number}
   */
  getPresenceCount() {
    return this._presenceCount;
  }

  /**
   * Check whether consensus mode should be active based on the current
   * checkbox selection and presence count.
   * @param {number} selectedCount - Number of checked ticket checkboxes
   * @returns {boolean} true if consensus mode should be active
   */
  shouldRequireConsensus(selectedCount) {
    return this._presenceCount >= 2 &&
           selectedCount > CONSTANTS.DEFAULTS.CONSENSUS_TICKET_THRESHOLD;
  }

  /**
   * Enter consensus mode: lock the implement button, show caution-tape UI,
   * flag extension, tooltip, and agree toggle widget.
   *
   * @param {number} agreed   - Number of users who have agreed
   * @param {number} required - Total number of users required
   * @param {string[]} agreedList - Session IDs that have agreed
   * @param {string} mySessionId - The current user's session ID
   */
  enterConsensusMode(agreed, required, agreedList = [], mySessionId = '') {
    this._consensusActive = true;
    this._consensusAgreed = agreed;
    this._consensusRequired = required;
    this._consensusUnlocked = false;
    this._myConsensusVote = agreedList.includes(mySessionId);

    const btn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
    if (!btn) return;

    // Disable the button
    btn.disabled = true;
    btn.style.pointerEvents = 'auto'; // Allow hover for tooltip

    // Remove normal button classes
    btn.classList.remove('btn-success', 'btn-secondary');
    btn.classList.add('btn-consensus');

    // Set the button label
    btn.innerHTML = `
      <div class="consensus-progress-bar" style="width: ${required > 0 ? (agreed / required) * 100 : 0}%"></div>
      <span class="consensus-btn-label">${agreed}/${required} agree</span>
    `;

    // Update tooltip
    this._updateConsensusTooltip(btn, agreed, required);

    // Create or update the flag extension
    this._renderConsensusFlag(btn);

    // Create or update the agree toggle widget
    this._renderConsensusAgreeToggle(btn, mySessionId);

    debugLog('[ASSIGNMENT_UI] - Entered consensus mode:', agreed, '/', required);
  }

  /**
   * Update the consensus progress bar and label without re-creating the entire UI.
   *
   * @param {number} agreed   - Number of users who have agreed
   * @param {number} required - Total number of users required
   * @param {string[]} agreedList - Session IDs that have agreed
   * @param {string} mySessionId - The current user's session ID
   */
  updateConsensusProgress(agreed, required, agreedList = [], mySessionId = '') {
    this._consensusAgreed = agreed;
    this._consensusRequired = required;
    this._myConsensusVote = agreedList.includes(mySessionId);

    const btn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
    if (!btn) return;

    // Update progress bar width
    const progressBar = btn.querySelector('.consensus-progress-bar');
    if (progressBar) {
      progressBar.style.width = `${required > 0 ? (agreed / required) * 100 : 0}%`;
    }

    // Update label
    const label = btn.querySelector('.consensus-btn-label');
    if (label) {
      label.textContent = `${agreed}/${required} agree`;
    }

    // Update tooltip
    this._updateConsensusTooltip(btn, agreed, required);

    // Update agree button visual
    const agreeBtn = document.getElementById('consensus-agree-btn');
    if (agreeBtn) {
      if (this._myConsensusVote) {
        agreeBtn.classList.add('agreed');
        agreeBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Agreed';
      } else {
        agreeBtn.classList.remove('agreed');
        agreeBtn.innerHTML = '<i class="bi bi-hand-thumbs-up me-1"></i>Agree';
      }
    }
  }

  /**
   * Unlock the implement button after consensus is achieved.
   * Plays the unlock animation, then transitions to the normal green state.
   */
  unlockFromConsensus() {
    this._consensusUnlocked = true;

    const btn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
    if (!btn) return;

    // Play the unlock animation
    btn.classList.add('consensus-unlocking');

    // After the animation completes, remove consensus UI and restore normal state
    setTimeout(() => {
      this.exitConsensusMode();
      // Re-enable the button with normal styling
      this.refreshImplementButtonLabel();
    }, 900); // slightly longer than the 0.8s animation

    debugLog('[ASSIGNMENT_UI] - Consensus unlocked, transitioning to normal state');
  }

  /**
   * Exit consensus mode: remove all consensus UI elements and restore
   * the implement button to its normal state.
   */
  exitConsensusMode() {
    this._consensusActive = false;
    this._consensusAgreed = 0;
    this._consensusRequired = 0;
    this._consensusUnlocked = false;
    this._myConsensusVote = false;

    const btn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
    if (btn) {
      // Remove consensus classes
      btn.classList.remove('btn-consensus', 'consensus-unlocking');
      btn.style.pointerEvents = '';

      // Dispose tooltip
      const tooltip = bootstrap.Tooltip.getInstance(btn);
      if (tooltip) tooltip.dispose();
      btn.removeAttribute('data-bs-toggle');
      btn.removeAttribute('data-bs-placement');
      btn.removeAttribute('title');
    }

    // Remove flag extension
    const flag = document.getElementById('consensus-flag');
    if (flag) flag.remove();

    // Remove agree toggle
    const agreeToggle = document.getElementById('consensus-agree-container');
    if (agreeToggle) agreeToggle.remove();

    debugLog('[ASSIGNMENT_UI] - Exited consensus mode');
  }

  /**
   * Whether consensus mode is currently active.
   * @returns {boolean}
   */
  isConsensusActive() {
    return this._consensusActive;
  }

  /**
   * Whether consensus has been achieved (unlocked).
   * @returns {boolean}
   */
  isConsensusUnlocked() {
    return this._consensusUnlocked;
  }

  /**
   * Update the Bootstrap tooltip on the implement button during consensus mode.
   * @param {HTMLElement} btn
   * @param {number} agreed
   * @param {number} required
   * @private
   */
  _updateConsensusTooltip(btn, agreed, required) {
    const existing = bootstrap.Tooltip.getInstance(btn);
    if (existing) existing.dispose();

    const remaining = required - agreed;
    const title = remaining > 0
      ? `Consensus mode: ${remaining} more user${remaining > 1 ? 's' : ''} must agree to unlock bulk assignment (${agreed}/${required})`
      : 'All users have agreed — unlocking...';

    btn.setAttribute('data-bs-toggle', 'tooltip');
    btn.setAttribute('data-bs-placement', 'top');
    btn.setAttribute('title', title);
    new bootstrap.Tooltip(btn);
  }

  /**
   * Render the flag-like extension next to the implement button.
   * @param {HTMLElement} btn - The implement button element
   * @private
   */
  _renderConsensusFlag(btn) {
    let flag = document.getElementById('consensus-flag');
    if (!flag) {
      flag = document.createElement('span');
      flag.id = 'consensus-flag';
      flag.className = 'consensus-flag';
      // Insert right after the button
      btn.insertAdjacentElement('afterend', flag);
    }
    flag.innerHTML = '<i class="bi bi-shield-lock"></i> Consensus required';
  }

  /**
   * Render the agree/disagree toggle widget next to the implement button area.
   * @param {HTMLElement} btn - The implement button element
   * @param {string} mySessionId - The current user's session ID
   * @private
   */
  _renderConsensusAgreeToggle(btn, mySessionId) {
    let container = document.getElementById('consensus-agree-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'consensus-agree-container';
      container.className = 'consensus-agree-toggle';

      const agreeBtn = document.createElement('button');
      agreeBtn.id = 'consensus-agree-btn';
      agreeBtn.type = 'button';
      agreeBtn.className = 'consensus-agree-btn';

      container.appendChild(agreeBtn);

      // Insert after the flag (or after the button if flag doesn't exist)
      const flag = document.getElementById('consensus-flag');
      const insertAfter = flag || btn;
      insertAfter.insertAdjacentElement('afterend', container);
    }

    // Update the agree button visual
    const agreeBtn = document.getElementById('consensus-agree-btn');
    if (agreeBtn) {
      if (this._myConsensusVote) {
        agreeBtn.classList.add('agreed');
        agreeBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Agreed';
      } else {
        agreeBtn.classList.remove('agreed');
        agreeBtn.innerHTML = '<i class="bi bi-hand-thumbs-up me-1"></i>Agree';
      }
    }
  }

  // ── End consensus methods ────────────────────────────────────────────────

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
    // Use justify-content-between so the toggle buttons stay centred and
    // the presence indicators sit flush to the right edge.
    assignmentToggleDiv.className = 'd-flex justify-content-between align-items-center mb-4';
    assignmentToggleDiv.innerHTML = `
      <div class="flex-grow-1"></div>
      <div class="d-flex align-items-center gap-2">
        <button id="${CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE}" class="btn single-ticket-btn rounded-circle" aria-label="Single Ticket Toggle" data-bs-toggle="tooltip" data-bs-placement="top" data-bs-title="${CONSTANTS.TOOLTIPS.SINGLE_TICKET}">
          <img id="${CONSTANTS.SELECTORS.SINGLE_TICKET_ICON}" src="/static/images/single_ticket_icon_on_light.svg" alt="Single Ticket Toggle" class="img-fluid">
        </button>
        <button id="${CONSTANTS.SELECTORS.MULTIPLE_TICKETS_TOGGLE}" class="btn multiple-tickets-btn rounded-circle" aria-label="Multiple Tickets Toggle" style="margin-left: 0.5rem;" data-bs-toggle="tooltip" data-bs-placement="top" data-bs-title="${CONSTANTS.TOOLTIPS.MULTIPLE_TICKETS}">
          <img id="${CONSTANTS.SELECTORS.MULTIPLE_TICKETS_ICON}" src="/static/images/multiple_tickets_icon_off_light.svg" alt="Multiple Tickets Toggle" class="img-fluid">
        </button>
      </div>
      <div id="presence-indicators" class="d-flex align-items-center gap-1 flex-grow-1 justify-content-end pe-1"></div>
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

    // Initialize Bootstrap tooltips for the newly created buttons
    initializeTooltips('[data-bs-toggle="tooltip"]');

    // Add event listeners to hide tooltips on click and mouse leave
    this._attachTooltipHideListeners();
  }

  /**
   * Attach event listeners to hide tooltips when buttons are clicked or mouse leaves
   * @private
   */
  _attachTooltipHideListeners() {
    const singleBtn = document.getElementById(CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE);
    const multipleBtn = document.getElementById(CONSTANTS.SELECTORS.MULTIPLE_TICKETS_TOGGLE);

    const hideTooltip = (button) => {
      if (button) {
        const tooltip = bootstrap.Tooltip.getInstance(button);
        if (tooltip) {
          tooltip.hide();
        }
      }
    };

    if (singleBtn) {
      singleBtn.addEventListener('click', () => hideTooltip(singleBtn));
      singleBtn.addEventListener('mouseleave', () => hideTooltip(singleBtn));
      singleBtn.addEventListener('blur', () => hideTooltip(singleBtn));
    }

    if (multipleBtn) {
      multipleBtn.addEventListener('click', () => hideTooltip(multipleBtn));
      multipleBtn.addEventListener('mouseleave', () => hideTooltip(multipleBtn));
      multipleBtn.addEventListener('blur', () => hideTooltip(multipleBtn));
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
   * Create the batch workflow buttons.
   *
   * The "Get validation tickets" button is wrapped in a <span> so that a
   * Bootstrap tooltip can be attached to the wrapper when the button is
   * disabled (disabled elements do not receive pointer events, so tooltips
   * must be placed on a sighted parent element instead).
   * @private
   */
  _createBatchButtons() {
    const mainContent = document.querySelector(this.mainContentSelector);
    // The toggle container now uses justify-content-between, so look for it by ID
    const toggleButtons = document.getElementById('assignment-toggle-container')
      || mainContent?.querySelector('#assignment-toggle-container');

    if (!toggleButtons) return;

    this.batchButtonsContainer = document.createElement('div');
    this.batchButtonsContainer.id = CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS;
    this.batchButtonsContainer.className = 'd-flex justify-content-center align-items-center gap-3 mb-4';
    this.batchButtonsContainer.innerHTML = `
      <span id="${CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN_WRAPPER}" style="display: inline-block;">
        <button id="${CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN}" class="btn btn-primary btn-lg" type="button">
          Get validation tickets
        </button>
      </span>
      <button id="${CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN}" class="btn btn-secondary btn-lg" type="button" disabled>
        Get ticket recommendations
      </button>
      <button id="${CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN}" class="btn btn-secondary btn-lg" type="button" disabled>
        Implement ticket assignment
      </button>
    `;

    toggleButtons.insertAdjacentElement('afterend', this.batchButtonsContainer);
    
    // Initialize workflow state after creating buttons.
    // If the validation accordion already contains tickets (e.g. loaded by
    // another user while this client was in Single Ticket mode, or cached
    // from a previous session), jump straight to 'tickets-loaded' so the
    // "Get validation tickets" button is correctly locked.
    const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
    if (accordion && accordion.children.length > 0) {
      this.setWorkflowState('tickets-loaded', { totalTickets: accordion.children.length });
    } else {
      this.setWorkflowState('idle');
    }
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
