/**
 * AssignmentUIManager - Pure renderer of server-driven button state.
 *
 * The three workflow buttons ("Get validation tickets", "Get ticket
 * recommendations", "Implement ticket assignment") are rendered EXCLUSIVELY
 * by applyUIState(), which receives its data from the server via SSE
 * ui-state-update events.  No method in this class computes button
 * properties (disabled, label, style) locally.
 *
 * The server's button_rules.py is the single source of truth.
 */
class AssignmentUIManager {
  constructor(mainContentSelector = CONSTANTS.SELECTORS.MAIN_CONTENT) {
    this.mainContentSelector = mainContentSelector;
    this.toggles = {};
    this.currentMode = CONSTANTS.MODES.SINGLE_TICKET;
    this.batchButtonsContainer = null;

    // Local tracking (read-only mirrors of server state for click handlers)
    this.recommendationToggleActive = false;

    // ── Consensus state (mirrors of server state) ────────────────────────
    this._consensusActive = false;
    this._consensusAgreed = 0;
    this._consensusRequired = 0;
    this._presenceCount = 0;
    this._myConsensusVote = false;

    // ── Consensus banner state ───────────────────────────────────────────
    this._consensusBannerVisible = false;
    this._consensusBannerShowDisagree = false;

    // ── Recommendation complete guard ────────────────────────────────────
    this._recommendationCompleteShown = false;
  }

  // ── Initialization ─────────────────────────────────────────────────────

  initialize(insertAfterElement = null) {
    debugLog('[ASSIGNMENT_UI] - Initializing AssignmentUIManager');
    this.remove();
    this._createToggleButtons(insertAfterElement);

    this.toggles.single = this._createToggle(
      true, CONSTANTS.STORAGE_KEYS.SINGLE_TICKET_ON,
      CONSTANTS.ICONS.SINGLE_TICKET, CONSTANTS.SELECTORS.SINGLE_TICKET_ICON,
      CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE
    );
    this.toggles.multiple = this._createToggle(
      false, CONSTANTS.STORAGE_KEYS.MULTIPLE_TICKETS_ON,
      CONSTANTS.ICONS.MULTIPLE_TICKETS, CONSTANTS.SELECTORS.MULTIPLE_TICKETS_ICON,
      CONSTANTS.SELECTORS.MULTIPLE_TICKETS_TOGGLE
    );

    this.currentMode = this.toggles.single?.isOn
      ? CONSTANTS.MODES.SINGLE_TICKET : CONSTANTS.MODES.MULTIPLE_TICKETS;

    document.addEventListener('themeChanged', (e) => {
      Object.values(this.toggles).forEach(t => { if (t) t.applyIcon(e.detail.isDark); });
    });

    debugLog('[ASSIGNMENT_UI] - Initialization complete');
    return this.toggles;
  }

  // ── Mode management ────────────────────────────────────────────────────

  setMode(mode) {
    debugLog('[ASSIGNMENT_UI] - Setting mode:', mode);
    if (this.currentMode === mode) return;

    this.toggles.single.isOn = (mode === CONSTANTS.MODES.SINGLE_TICKET);
    this.toggles.multiple.isOn = (mode === CONSTANTS.MODES.MULTIPLE_TICKETS);
    this.currentMode = mode;

    const isDark = ToggleButton.currentThemeIsDark();
    Object.values(this.toggles).forEach(t => {
      if (t) { t.applyIcon(isDark); t.savePreference(); }
    });

    if (mode === CONSTANTS.MODES.SINGLE_TICKET) {
      this.showSearchInput();
      this.hideBatchButtons();
      this._removeConsensusBanner();
      this.hideRecommendationProgress();
      this.recommendationToggleActive = false;
    } else {
      this.hideSearchInput();
      this.showBatchButtons();
    }
  }

  getMode() { return this.currentMode; }
  isRecommendationToggleActive() { return this.recommendationToggleActive; }

  // ── UI visibility helpers ──────────────────────────────────────────────

  showSearchInput() {
    const g = document.querySelector(CONSTANTS.SELECTORS.INPUT_GROUP);
    if (g) g.style.display = 'flex';
  }

  hideSearchInput() {
    const g = document.querySelector(CONSTANTS.SELECTORS.INPUT_GROUP);
    if (g) g.style.display = 'none';
  }

  showBatchButtons() {
    if (!this.batchButtonsContainer) this._createBatchButtons();
    if (this.batchButtonsContainer) this.batchButtonsContainer.style.display = 'flex';
  }

  hideBatchButtons() {
    if (this.batchButtonsContainer) {
      this.batchButtonsContainer.remove();
      this.batchButtonsContainer = null;
    }
  }

  // ── Presence ───────────────────────────────────────────────────────────

  setPresenceCount(count) { this._presenceCount = count; }
  getPresenceCount() { return this._presenceCount; }

  renderPresenceIndicators(sessions, mySessionId) {
    const PRESENCE_VISIBLE_LIMIT = 8;
    const container = document.getElementById('presence-indicators');
    if (!container) return;

    const existingBadge = container.querySelector('.presence-overflow-badge');
    if (existingBadge) {
      const p = bootstrap.Popover.getInstance(existingBadge);
      if (p) p.dispose();
    }

    if (!sessions || sessions.length === 0) { container.innerHTML = ''; return; }

    const visible = sessions.slice(0, PRESENCE_VISIBLE_LIMIT);
    const overflow = sessions.slice(PRESENCE_VISIBLE_LIMIT);
    let html = '';

    visible.forEach(session => {
      const isMe = session.session_id === mySessionId;
      const meClass = isMe ? ' presence-indicator-me' : '';
      const label = `${session.label}${isMe ? ' (you)' : ''}`;
      html += `<div class="presence-indicator${meClass}" style="background-color: ${session.color};" data-bs-toggle="tooltip" data-bs-placement="bottom" title="${label}"><i class="bi bi-person-fill"></i></div>`;
    });

    let popoverContent = '';
    if (overflow.length > 0) {
      popoverContent = overflow.map(s => {
        const isMe = s.session_id === mySessionId;
        const label = `${s.label}${isMe ? ' (you)' : ''}`;
        return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color};margin-right:6px;vertical-align:middle;"></span>${label}`;
      }).join('<br>');
      html += `<div class="presence-overflow-badge" role="button" tabindex="0" data-bs-toggle="popover" data-bs-trigger="click" data-bs-placement="bottom" data-bs-html="true" title="${overflow.length} more viewer${overflow.length > 1 ? 's' : ''}">+${overflow.length}</div>`;
    }

    container.innerHTML = html;

    if (overflow.length > 0) {
      const badgeEl = container.querySelector('.presence-overflow-badge');
      if (badgeEl) badgeEl.setAttribute('data-bs-content', popoverContent);
    }

    initializeTooltips('#presence-indicators [data-bs-toggle="tooltip"]');

    const badge = container.querySelector('.presence-overflow-badge');
    if (badge) {
      const pop = new bootstrap.Popover(badge, { html: true });
      const outsideClickHandler = (e) => {
        if (!badge.contains(e.target) && !document.querySelector('.popover')?.contains(e.target)) pop.hide();
      };
      document.addEventListener('click', outsideClickHandler);
      badge.addEventListener('hidden.bs.popover', () => {
        document.removeEventListener('click', outsideClickHandler);
      }, { once: true });
    }
  }

  clearPresenceIndicators() {
    const container = document.getElementById('presence-indicators');
    if (container) {
      const badge = container.querySelector('.presence-overflow-badge');
      if (badge) { const p = bootstrap.Popover.getInstance(badge); if (p) p.dispose(); }
      container.innerHTML = '';
    }
  }

  // ── Recommendation progress ────────────────────────────────────────────

  showRecommendationProgress(current, total, ticketId = null) {
    // New recommendation cycle starting — reset the completion guard
    this._recommendationCompleteShown = false;

    const batchBtns = document.getElementById(CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS);
    if (!batchBtns) return;

    let pc = document.getElementById('recommendation-progress-container');
    if (!pc) {
      pc = document.createElement('div');
      pc.id = 'recommendation-progress-container';
      pc.className = 'd-flex align-items-center gap-2 ms-3';
      pc.innerHTML = `<div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div><span id="recommendation-progress-text" class="text-muted small"></span>`;
      batchBtns.appendChild(pc);
    }

    const pt = document.getElementById('recommendation-progress-text');
    if (pt) {
      const info = ticketId ? ` (${ticketId})` : '';
      pt.textContent = `Processing ticket ${current}/${total}${info}...`;
    }
    pc.classList.remove('d-none');
  }

  hideRecommendationProgress() {
    const pc = document.getElementById('recommendation-progress-container');
    if (pc) pc.classList.add('d-none');
  }

  showRecommendationComplete(total) {
    // Guard: only show the completion message once per recommendation cycle.
    // Prevents repeated calls from ui-state-update SSE events from restarting
    // the animation and keeping the label visible indefinitely.
    if (this._recommendationCompleteShown) return;
    this._recommendationCompleteShown = true;

    const pc = document.getElementById('recommendation-progress-container');
    if (!pc) return;

    if (pc._recommendationHideTimeout) {
      clearTimeout(pc._recommendationHideTimeout);
      pc._recommendationHideTimeout = null;
      pc.style.transition = '';
      pc.style.opacity = '1';
    }

    pc.classList.remove('expiry-timer-bar');
    pc.innerHTML = `<i class="bi bi-check-circle text-success"></i><span class="text-success small">${total} recommendations complete</span>`;
    pc.classList.remove('d-none');
    void pc.offsetWidth;
    pc.classList.add('expiry-timer-bar');

    pc._recommendationHideTimeout = setTimeout(() => {
      pc.style.transition = 'opacity 0.6s ease';
      pc.style.opacity = '0';
      setTimeout(() => {
        pc.innerHTML = '';
        pc.classList.add('d-none');
        pc.classList.remove('expiry-timer-bar');
        pc.style.transition = '';
        pc.style.opacity = '1';
        pc._recommendationHideTimeout = null;
      }, 650);
    }, 10000);
  }

  // ══════════════════════════════════════════════════════════════════════
  // ██  applyUIState — THE ONLY METHOD THAT SETS BUTTON DOM PROPERTIES ██
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Apply a UI state snapshot received from the server.
   *
   * This is the **only** method that sets button labels, disabled states,
   * and CSS classes for the three workflow buttons.  The server's
   * button_rules.py is the single source of truth.
   *
   * @param {Object} state - The full ui-state-update payload from the server
   */
  applyUIState(state) {
    if (!state || !state.buttons) return;
    debugLog('[ASSIGNMENT_UI] - applyUIState:', state);

    // ── 1. Get validation tickets ────────────────────────────────────
    this._applyGetValidationTicketsButton(state.buttons.get_validation_tickets);

    // ── 2. Get recommendations ───────────────────────────────────────
    this._applyGetRecommendationsButton(state.buttons.get_recommendations);

    // ── 3. Implement assignment ──────────────────────────────────────
    this._applyImplementButton(state.buttons.implement_assignment);

    // ── 4. Consensus banner ──────────────────────────────────────────
    this._applyConsensusBanner(state);

    // ── 5. Countdown visibility ──────────────────────────────────────
    // Handled by main.js based on state.countdown_visible

    // ── 6. Sync local mirrors ────────────────────────────────────────
    this.recommendationToggleActive = !!state.recommendations_toggle_on;

    // ── 7. Recommendation progress ───────────────────────────────────
    if (state.recommendation_progress) {
      const prog = state.recommendation_progress;
      if (prog.complete_message) {
        this.showRecommendationComplete(prog.total || 0);
      } else if (prog.visible) {
        this.showRecommendationProgress(prog.current, prog.total, prog.current_ticket_id);
      }
    }
  }

  /** @private */
  _applyGetValidationTicketsButton(gvt) {
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN);
    if (!btn || !gvt) return;

    // Tear down existing tooltip
    const tip = bootstrap.Tooltip.getInstance(btn);
    if (tip) tip.dispose();
    btn.removeAttribute('data-bs-toggle');
    btn.removeAttribute('data-bs-placement');
    btn.removeAttribute('title');

    // Strip all toggle classes
    btn.classList.remove('btn-primary', 'btn-secondary',
      'recommendation-toggle-off', 'recommendation-toggle-on',
      'recommendation-toggle-disabled', 'validation-toggle-on', 'validation-toggle-off');

    btn.disabled = gvt.disabled;
    btn.innerHTML = gvt.label;

    if (gvt.style === 'toggle-on') {
      btn.classList.add('validation-toggle-on');
    } else {
      btn.classList.add('validation-toggle-off');
    }

    if (gvt.tooltip) {
      btn.setAttribute('data-bs-toggle', 'tooltip');
      btn.setAttribute('data-bs-placement', 'top');
      btn.setAttribute('title', gvt.tooltip);
      new bootstrap.Tooltip(btn);
    }
  }

  /** @private */
  _applyGetRecommendationsButton(rec) {
    const btn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    if (!btn || !rec) return;

    const tip = bootstrap.Tooltip.getInstance(btn);
    if (tip) tip.dispose();

    btn.classList.remove('btn-primary', 'btn-secondary',
      'recommendation-toggle-off', 'recommendation-toggle-on',
      'recommendation-toggle-disabled');

    btn.disabled = rec.disabled;

    switch (rec.style) {
      case 'disabled':
        btn.classList.add('recommendation-toggle-disabled');
        btn.innerHTML = rec.label;
        btn.removeAttribute('data-bs-toggle');
        btn.removeAttribute('data-bs-placement');
        btn.removeAttribute('title');
        break;
      case 'toggle-off':
        btn.classList.add('recommendation-toggle-off');
        btn.innerHTML = rec.label;
        if (rec.tooltip) {
          btn.setAttribute('data-bs-toggle', 'tooltip');
          btn.setAttribute('data-bs-placement', 'top');
          btn.setAttribute('title', rec.tooltip);
          new bootstrap.Tooltip(btn);
        }
        break;
      case 'toggle-on':
        btn.classList.add('recommendation-toggle-on');
        btn.innerHTML = rec.label;
        if (rec.tooltip) {
          btn.setAttribute('data-bs-toggle', 'tooltip');
          btn.setAttribute('data-bs-placement', 'top');
          btn.setAttribute('title', rec.tooltip);
          new bootstrap.Tooltip(btn);
        }
        break;
    }
  }

  /** @private */
  _applyImplementButton(imp) {
    const btn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
    if (!btn || !imp) return;

    const tip = bootstrap.Tooltip.getInstance(btn);
    if (tip) tip.dispose();
    btn.removeAttribute('data-bs-toggle');
    btn.removeAttribute('data-bs-placement');
    btn.removeAttribute('title');

    btn.classList.remove('btn-success', 'btn-secondary', 'btn-consensus',
      'consensus-on', 'consensus-off', 'consensus-unlocking');
    btn.style.pointerEvents = '';
    btn.style.cursor = '';

    const mode = imp.mode || 'unclickable';

    switch (mode) {
      case 'unclickable':
        btn.disabled = true;
        btn.classList.add('btn-secondary');
        btn.innerHTML = imp.label;
        break;

      case 'limited_assignment':
      case 'full_assignment':
        btn.disabled = false;
        btn.classList.add('btn-success');
        btn.innerHTML = imp.label;
        if (imp.tooltip) {
          btn.setAttribute('data-bs-toggle', 'tooltip');
          btn.setAttribute('data-bs-placement', 'top');
          btn.setAttribute('title', imp.tooltip);
          new bootstrap.Tooltip(btn);
        }
        break;

      case 'consensus':
        // The implement button itself is the consensus toggle
        btn.disabled = false;  // Clickable — clicking toggles the user's vote
        btn.classList.add('btn-consensus');
        btn.style.pointerEvents = 'auto';

        // Build progress bar inside button
        const agreed = imp.consensus_agreed || 0;
        const required = imp.consensus_required || 1;
        const pct = required > 0 ? (agreed / required) * 100 : 0;

        btn.innerHTML = `
          <div class="consensus-progress-bar" style="width: ${pct}%"></div>
          <span class="consensus-btn-label">${imp.label}</span>
        `;

        // Apply on/off visual based on style
        if (imp.style === 'consensus-on') {
          btn.classList.add('consensus-on');
        } else {
          btn.classList.add('consensus-off');
        }

        if (imp.tooltip) {
          btn.setAttribute('data-bs-toggle', 'tooltip');
          btn.setAttribute('data-bs-placement', 'top');
          btn.setAttribute('title', imp.tooltip);
          new bootstrap.Tooltip(btn);
        }
        break;

      case 'loading':
        btn.disabled = true;
        btn.classList.add('btn-secondary');
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>${imp.label}`;
        break;
    }

    // Update local mirrors
    this._consensusActive = (mode === 'consensus');
  }

  // ── Consensus banner ───────────────────────────────────────────────────

  /** @private */
  _applyConsensusBanner(state) {
    const visible = !!state.consensus_banner_visible;
    const showDisagree = !!state.consensus_banner_show_disagree;

    if (!visible) {
      this._removeConsensusBanner();
      this._consensusBannerVisible = false;
      return;
    }

    this._consensusBannerVisible = true;
    this._consensusBannerShowDisagree = showDisagree;

    let banner = document.getElementById('consensus-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'consensus-banner';
      banner.className = 'consensus-banner alert alert-warning d-flex align-items-center gap-3 mb-3';

      // Insert before the validation accordion or at the end of batch buttons
      const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
      if (accordion) {
        accordion.parentNode.insertBefore(banner, accordion);
      } else {
        const batchBtns = document.getElementById(CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS);
        if (batchBtns) batchBtns.insertAdjacentElement('afterend', banner);
      }
    }

    // Build banner content
    const imp = state.buttons?.implement_assignment || {};
    const agreed = imp.consensus_agreed || 0;
    const required = imp.consensus_required || 0;

    let html = `
      <i class="bi bi-shield-lock fs-5"></i>
      <div class="flex-grow-1">
        <strong>Consensus required</strong> — More than ${CONSTANTS.DEFAULTS.CONSENSUS_TICKET_THRESHOLD} tickets selected with multiple users present.
        All users must agree before bulk assignment can proceed.
        <span class="fw-bold">${agreed}/${required} users have agreed.</span>
      </div>
    `;

    if (showDisagree) {
      html += `<button id="consensus-banner-disagree-btn" class="btn btn-outline-danger btn-sm">
        <i class="bi bi-hand-thumbs-down me-1"></i>Disagree
      </button>`;
    }

    banner.innerHTML = html;
  }

  /** @private */
  _removeConsensusBanner() {
    const banner = document.getElementById('consensus-banner');
    if (banner) banner.remove();
  }

  // ── Consensus accessors (read-only mirrors) ────────────────────────────

  isConsensusActive() { return this._consensusActive; }

  // ── DOM creation ───────────────────────────────────────────────────────

  /** @private */
  _createBatchButtons() {
    const mainContent = document.querySelector(this.mainContentSelector);
    const toggleButtons = document.getElementById('assignment-toggle-container')
      || mainContent?.querySelector('#assignment-toggle-container');
    if (!toggleButtons) return;

    this.batchButtonsContainer = document.createElement('div');
    this.batchButtonsContainer.id = CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS;
    this.batchButtonsContainer.className = 'd-flex justify-content-center align-items-center gap-3 mb-4';

    // Buttons are created with minimal content — applyUIState() will set
    // the correct labels, styles, and disabled states from the server.
    this.batchButtonsContainer.innerHTML = `
      <span id="${CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN_WRAPPER}" style="display: inline-block;">
        <button id="${CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN}" class="btn btn-lg validation-toggle-off" type="button">
          Get validation tickets
        </button>
      </span>
      <button id="${CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN}" class="btn btn-lg recommendation-toggle-disabled" type="button" disabled>
        Get ticket recommendations
      </button>
      <button id="${CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN}" class="btn btn-secondary btn-lg" type="button" disabled>
        Implement ticket assignment
      </button>
    `;

    toggleButtons.insertAdjacentElement('afterend', this.batchButtonsContainer);

    // Immediately fetch the authoritative UI state from the server
    // so buttons are rendered correctly from the start.
    this._fetchAndApplyUIState();
  }

  /** @private */
  async _fetchAndApplyUIState() {
    try {
      const sessionId = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID) || '';
      const url = sessionId
        ? `${CONSTANTS.API.UI_STATE}?session_id=${encodeURIComponent(sessionId)}`
        : CONSTANTS.API.UI_STATE;
      const response = await fetch(url);
      if (response.ok) {
        const state = await response.json();
        this.applyUIState(state);
      }
    } catch (err) {
      debugLog('[ASSIGNMENT_UI] - Error fetching initial UI state:', err);
    }
  }

  /** @private */
  _createToggleButtons(insertAfterElement) {
    this._removeToggleButtonsOnly();

    const div = document.createElement('div');
    div.id = 'assignment-toggle-container';
    div.className = 'd-flex justify-content-between align-items-center mb-4';
    div.innerHTML = `
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

    const target = insertAfterElement || document.querySelector(this.mainContentSelector);
    if (target) {
      if (insertAfterElement) {
        insertAfterElement.insertAdjacentElement('afterend', div);
      } else {
        const inputGroup = target.querySelector(CONSTANTS.SELECTORS.INPUT_GROUP);
        if (inputGroup) inputGroup.insertAdjacentElement('afterend', div);
        else target.appendChild(div);
      }
    }

    initializeTooltips('[data-bs-toggle="tooltip"]');
    this._attachTooltipHideListeners();
  }

  /** @private */
  _attachTooltipHideListeners() {
    const singleBtn = document.getElementById(CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE);
    const multipleBtn = document.getElementById(CONSTANTS.SELECTORS.MULTIPLE_TICKETS_TOGGLE);
    const hide = (b) => { if (b) { const t = bootstrap.Tooltip.getInstance(b); if (t) t.hide(); } };

    [singleBtn, multipleBtn].forEach(b => {
      if (b) {
        b.addEventListener('click', () => hide(b));
        b.addEventListener('mouseleave', () => hide(b));
        b.addEventListener('blur', () => hide(b));
      }
    });
  }

  /** @private */
  _removeToggleButtonsOnly() {
    const c = document.getElementById('assignment-toggle-container');
    if (c) { c.remove(); return; }
    const s = document.getElementById(CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE);
    if (s) {
      const d = s.closest('.d-flex');
      if (d && d.id !== CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS) d.remove();
    }
  }

  /** @private */
  _createToggle(defaultState, storageKey, iconBaseName, elementId, buttonId) {
    return ToggleButton.loadPreference(defaultState, storageKey, iconBaseName, elementId, buttonId);
  }

  // ── Event listener attachment ──────────────────────────────────────────

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

  attachBatchButtonListeners(callbacks) {
    const gvtBtn = document.getElementById(CONSTANTS.SELECTORS.GET_VALIDATION_TICKETS_BTN);
    const recBtn = document.getElementById(CONSTANTS.SELECTORS.GET_RECOMMENDATIONS_BTN);
    const impBtn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);

    if (gvtBtn && callbacks.onGetValidationTickets) gvtBtn.addEventListener('click', callbacks.onGetValidationTickets);
    if (recBtn && callbacks.onGetRecommendations) recBtn.addEventListener('click', callbacks.onGetRecommendations);
    if (impBtn && callbacks.onImplementAssignment) impBtn.addEventListener('click', callbacks.onImplementAssignment);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  remove() {
    const c = document.getElementById('assignment-toggle-container');
    if (c) c.remove();
    else {
      const t = document.getElementById(CONSTANTS.SELECTORS.SINGLE_TICKET_TOGGLE)?.closest('.d-flex');
      if (t && t.id !== CONSTANTS.SELECTORS.BATCH_WORKFLOW_BUTTONS) t.remove();
    }
    this.hideBatchButtons();
    this._removeConsensusBanner();
  }
}