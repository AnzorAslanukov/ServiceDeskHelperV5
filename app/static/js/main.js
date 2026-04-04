/**
 * Main entry point - Service Desk Helper Application
 * 
 * This file initializes all managers and handles high-level application logic.
 * Button state is driven EXCLUSIVELY by the server via ui-state-update SSE
 * events.  No function in this file computes button properties locally.
 */

debugLog('[MAIN] - Service Desk Helper script loaded. ToggleButton available:', typeof ToggleButton);

// Global manager instances
let searchUIManager;
let assignmentUIManager;
let navigationManager;
// ─── Validation queue polling state ──────────────────────────────────────────
let validationPollingInterval = null;
let validationAlignmentTimeout = null;
let validationCountdownInterval = null;
let validationCountdownSeconds = 0;
let nextPendingTicketIndex = 10000;
// ─────────────────────────────────────────────────────────────────────────────

// ─── Validation broadcast state ───────────────────────────────────────────────
let validationBroadcastSource = null;
// ─────────────────────────────────────────────────────────────────────────────

// ─── Presence heartbeat state ─────────────────────────────────────────────────
let presenceHeartbeatInterval = null;
let mySessionId = null;
let myPresenceColor = null;
let myDisplayName = null;

// ─── Support group names cache ───────────────────────────────────────────────
let _supportGroupNamesCache = null;

async function getSupportGroupNames() {
  if (_supportGroupNamesCache) return _supportGroupNamesCache;
  try {
    const response = await fetch(CONSTANTS.API.SUPPORT_GROUP_NAMES);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    _supportGroupNamesCache = await response.json();
    debugLog('[MAIN] - Loaded', _supportGroupNamesCache.length, 'support group names');
    return _supportGroupNamesCache;
  } catch (error) {
    debugLog('[MAIN] - Error fetching support group names:', error);
    return [];
  }
}

function generateSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  debugLog('[MAIN] - DOMContentLoaded event fired, starting initialization');
  initializeManagers();
  attachEventListeners();
  debugLog('[MAIN] - Application initialization complete');
});

function initializeManagers() {
  debugLog('[MAIN] - Initializing managers');

  searchUIManager = new SearchUIManager(
    CONSTANTS.SELECTORS.SEARCH_TOGGLES_CONTAINER,
    CONSTANTS.SELECTORS.SEARCH_INPUT
  );
  searchUIManager.initialize();

  assignmentUIManager = new AssignmentUIManager();

  navigationManager = new NavigationManager(searchUIManager, assignmentUIManager);
  navigationManager.initialize({
    onSwitchToSearch: () => {
      debugLog('[MAIN] - Switched to search mode callback');
      stopValidationPolling();
      stopPresenceHeartbeat();
      stopValidationBroadcastListener();
    },
    onSwitchToAssignment: () => {
      debugLog('[MAIN] - Switched to assignment mode callback');
      attachAssignmentEventListeners();
      startValidationBroadcastListener();
    }
  });

  debugLog('[MAIN] - Managers initialized');
}

function attachEventListeners() {
  debugLog('[MAIN] - Attaching event listeners');

  const searchInput = document.getElementById(CONSTANTS.SELECTORS.SEARCH_INPUT);
  if (searchInput) {
    searchInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        const searchButton = document.getElementById(CONSTANTS.SELECTORS.SEARCH_BUTTON);
        if (searchButton) searchButton.click();
      }
    });
  }

  const searchButton = document.getElementById(CONSTANTS.SELECTORS.SEARCH_BUTTON);
  if (searchButton) searchButton.addEventListener('click', handleSearchButtonClick);

  // Consensus banner disagree button (delegated)
  document.addEventListener('click', (e) => {
    const disagreeBtn = e.target.closest('#consensus-banner-disagree-btn');
    if (disagreeBtn && mySessionId) {
      sendConsensusBannerDisagree();
    }
  });

  debugLog('[MAIN] - Event listeners attached');
}

function attachAssignmentEventListeners() {
  debugLog('[MAIN] - Attaching assignment event listeners');

  assignmentUIManager.attachToggleListeners(
    () => {
      debugLog('[MAIN] - Single ticket mode selected');
      stopValidationPolling();
      stopPresenceHeartbeat();
      stopValidationBroadcastListener();
      TicketRenderer.clear();
    },
    () => {
      debugLog('[MAIN] - Multiple tickets mode selected');
      setTimeout(attachBatchButtonListeners, 0);
      startPresenceHeartbeat();
      startValidationBroadcastListener();
    }
  );

  if (assignmentUIManager.getMode() === CONSTANTS.MODES.MULTIPLE_TICKETS) {
    attachBatchButtonListeners();
    startValidationBroadcastListener();
  }
}

function attachBatchButtonListeners() {
  debugLog('[MAIN] - Attaching batch button listeners');

  assignmentUIManager.attachBatchButtonListeners({
    onGetValidationTickets: handleGetValidationTicketsToggle,
    onGetRecommendations: handleGetRecommendations,
    onImplementAssignment: handleImplementAssignment
  });
}

// ─── Search handling ─────────────────────────────────────────────────────────

async function handleSearchButtonClick() {
  const searchInput = document.getElementById(CONSTANTS.SELECTORS.SEARCH_INPUT);
  const searchButton = document.getElementById(CONSTANTS.SELECTORS.SEARCH_BUTTON);
  if (!searchInput || !searchButton) return;

  const searchValue = searchInput.value.trim();
  if (!searchValue) { alert('Please enter search text'); return; }

  if (navigationManager.getCurrentSection() === 'assignment' && 
      assignmentUIManager.getMode() === CONSTANTS.MODES.SINGLE_TICKET) {
    await handleSingleTicketAssignment(searchValue, searchButton);
    return;
  }

  await handleTicketSearch(searchValue, searchButton);
}

async function handleTicketSearch(searchValue, searchButton) {
  debugLog('[MAIN] - Handling ticket search:', searchValue);
  searchButton.disabled = true;
  searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
  TicketRenderer.renderLoading();

  try {
    const mode = searchUIManager.getActiveMode();
    let bodyObj, searchType;

    switch (mode) {
      case CONSTANTS.MODES.PHONE:
        bodyObj = { contactMethod: searchValue, contains: true }; searchType = 'phone number'; break;
      case CONSTANTS.MODES.MATCH:
        bodyObj = { description: searchValue, contains: true }; searchType = 'exact match'; break;
      case CONSTANTS.MODES.SEMANTIC:
        bodyObj = { semanticDescription: searchValue }; searchType = 'semantic similarity'; break;
      case CONSTANTS.MODES.TICKET:
        bodyObj = { ticketId: searchValue }; searchType = 'ticket-based vector search'; break;
      default:
        bodyObj = { description: searchValue, contains: true }; searchType = 'description';
    }

    const response = await fetch(CONSTANTS.API.SEARCH_TICKETS, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    TicketRenderer.renderSearchResults(data, searchValue, searchType);
  } catch (error) {
    debugLog('[MAIN] - Search error:', error);
    TicketRenderer.renderError('Error searching tickets: ' + error.message);
  } finally {
    searchButton.disabled = false;
    searchButton.innerHTML = '<i class="bi bi-search"></i>';
  }
}

function handleSingleTicketAssignment(ticketId, searchButton) {
  debugLog('[MAIN] - Handling single ticket assignment with SSE:', ticketId);
  searchButton.disabled = true;
  searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
  TicketRenderer.renderLoadingWithProgress(1, 'Fetching ticket data...');

  const eventSource = new EventSource(
    `${CONSTANTS.API.GET_TICKET_ADVICE_STREAM}?ticketId=${encodeURIComponent(ticketId)}`
  );
  let hasReceivedData = false;

  eventSource.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    TicketRenderer.updateLoadingProgress(data.step, data.message);
  });

  eventSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    hasReceivedData = true;
    if (data.recommended_support_group || data.recommended_priority_level || data.detailed_explanation)
      TicketRenderer.renderRecommendations(data);
    if (data.original_data) TicketRenderer.renderOriginalTicket(data.original_data);
    if (data.similar_tickets && data.similar_tickets.length > 0)
      TicketRenderer.renderSimilarTickets(data.similar_tickets);
    if (data.onenote_documentation && data.onenote_documentation.length > 0)
      TicketRenderer.renderOnenoteDocuments(data.onenote_documentation);
    eventSource.close();
    searchButton.disabled = false;
    searchButton.innerHTML = '<i class="bi bi-search"></i>';
  });

  eventSource.addEventListener('error', (event) => {
    let errorMessage = 'Error getting advice';
    try { const data = JSON.parse(event.data); errorMessage = data.message || errorMessage; }
    catch (e) { if (!hasReceivedData) errorMessage = 'Connection error while getting ticket advice.'; }
    TicketRenderer.renderError('Error getting advice: ' + errorMessage);
    eventSource.close();
    searchButton.disabled = false;
    searchButton.innerHTML = '<i class="bi bi-search"></i>';
  });

  eventSource.onerror = (error) => {
    if (!hasReceivedData) {
      TicketRenderer.renderError('Connection error while getting ticket advice. Please try again.');
      searchButton.disabled = false;
      searchButton.innerHTML = '<i class="bi bi-search"></i>';
    }
    eventSource.close();
  };
}

// ─── Workflow button handlers (server-driven) ────────────────────────────────

/**
 * Handle "Get validation tickets" toggle click.
 * POSTs to server; button visual updated by ui-state-update SSE.
 */
async function handleGetValidationTicketsToggle() {
  debugLog('[MAIN] - Get validation tickets toggle clicked');
  startValidationBroadcastListener();

  try {
    const response = await fetch(CONSTANTS.API.TOGGLE_VALIDATION, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    debugLog('[MAIN] - Toggle validation response:', result);

    if (result.active) {
      // Toggle ON: load tickets if none in view, start polling
      const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
      if (!accordion || accordion.children.length === 0) {
        const loadResp = await fetch(CONSTANTS.API.TRIGGER_VALIDATION_LOAD, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (loadResp.ok) {
          const lr = await loadResp.json();
          if (lr.status === 'loading' || lr.status === 'loading_started') {
            if (!document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION))
              TicketRenderer.renderValidationTicketsStreamingInit();
          }
        }
      }
      startValidationPolling();
    } else {
      stopValidationPolling();
    }
  } catch (error) {
    debugLog('[MAIN] - Error toggling validation:', error);
    TicketRenderer.renderError('Error toggling validation tickets: ' + error.message);
  }
}

/**
 * Handle "Get recommendations" toggle click.
 * POSTs to server; button visual updated by ui-state-update SSE.
 */
async function handleGetRecommendations() {
  debugLog('[MAIN] - Get ticket recommendations toggle clicked');

  const isActive = assignmentUIManager.isRecommendationToggleActive();

  try {
    const response = await fetch(CONSTANTS.API.TOGGLE_RECOMMENDATIONS, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !isActive })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    debugLog('[MAIN] - Toggle recommendations response:', result);

    if (!result.active) {
      // Toggled OFF: resume polling
      assignmentUIManager.hideRecommendationProgress();
      startValidationPolling();
    } else {
      // Toggled ON: stop polling while processing
      stopValidationPolling();
      TicketRenderer.showPollingPausedMessage();
    }
    // Button visual is updated by ui-state-update SSE event
  } catch (error) {
    debugLog('[MAIN] - Error toggling recommendations:', error);
    alert('Error toggling recommendations: ' + error.message);
  }
}

/**
 * Handle "Implement ticket assignment" click.
 * In consensus mode, this toggles the user's vote.
 * In action mode, this assigns tickets.
 */
async function handleImplementAssignment() {
  debugLog('[MAIN] - Implement ticket assignment clicked');

  // Check if we're in consensus mode — if so, toggle vote
  if (assignmentUIManager.isConsensusActive()) {
    // Toggle the user's consensus vote
    const currentlyAgreed = assignmentUIManager._myConsensusVote || false;
    await sendConsensusVote(!currentlyAgreed);
    return;
  }

  // Normal action mode — assign tickets
  const selectedTickets = TicketRenderer.getSelectedTickets();
  if (selectedTickets.length === 0) {
    alert('Please select at least one ticket to assign.');
    return;
  }

  const assignments = [];
  const ticketsWithoutRecommendations = [];

  for (const ticket of selectedTickets) {
    const recommendationsContainer = document.getElementById(`recommendations-${ticket.index}`);
    if (!recommendationsContainer) { ticketsWithoutRecommendations.push(ticket.id); continue; }

    const isFacilitiesTicket = recommendationsContainer.dataset.isFacilitiesTicket === 'true';
    const resolutionComment = recommendationsContainer.dataset.resolutionComment;

    if (isFacilitiesTicket && resolutionComment) {
      assignments.push({ ticket_id: ticket.id, status: 'resolved', resolution_comment: resolutionComment });
      continue;
    }

    const manualSgInput = recommendationsContainer.querySelector(`input[name="manual-sg-batch-${ticket.index}"]`);
    const manualSgValue = manualSgInput ? manualSgInput.value.trim() : '';

    let selectedSupportGroup;
    if (manualSgValue) {
      selectedSupportGroup = manualSgValue;
    } else {
      const sgRadioName = `sg-selector-batch-${ticket.index}`;
      const selectedSGRadio = recommendationsContainer.querySelector(`input[name="${sgRadioName}"]:checked`);
      selectedSupportGroup = selectedSGRadio ? selectedSGRadio.value : null;
    }

    const priorityRadioName = `priority-selector-batch-${ticket.index}`;
    const selectedPriorityRadio = recommendationsContainer.querySelector(`input[name="${priorityRadioName}"]:checked`);
    const selectedPriority = selectedPriorityRadio ? selectedPriorityRadio.value : null;

    let priorityValue = null;
    if (selectedPriority) {
      switch (selectedPriority) {
        case 'High': priorityValue = 2; break;
        case 'Medium': case 'Low': priorityValue = 3; break;
      }
    }

    if (selectedSupportGroup && selectedSupportGroup !== 'N/A') {
      assignments.push({ ticket_id: ticket.id, support_group: selectedSupportGroup, priority: priorityValue });
    } else {
      ticketsWithoutRecommendations.push(ticket.id);
    }
  }

  if (assignments.length === 0) {
    alert('No selected tickets have valid AI recommendations. Please get recommendations first.');
    return;
  }

  debugLog('[MAIN] - Implementing assignments for', assignments.length, 'tickets');

  // No local button manipulation — server drives button state via SSE

  try {
    const response = await fetch('/api/implement-assignments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments })
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    debugLog('[MAIN] - Assignment implementation result:', result);
    // Server broadcasts implement-complete via SSE to all clients
  } catch (error) {
    debugLog('[MAIN] - Error implementing assignments:', error);
    TicketRenderer.renderError('Error implementing assignments: ' + error.message);
  }
}

// ─── Presence heartbeat ───────────────────────────────────────────────────────

function startPresenceHeartbeat() {
  const storedName = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_DISPLAY_NAME);
  if (!storedName) {
    showNamePromptModal(
      (name) => { myDisplayName = name; _startPresenceHeartbeatCore(); },
      () => {
        if (assignmentUIManager) assignmentUIManager.setMode(CONSTANTS.MODES.SINGLE_TICKET);
        stopPresenceHeartbeat();
      }
    );
    return;
  }
  myDisplayName = storedName;
  _startPresenceHeartbeatCore();
}

function _startPresenceHeartbeatCore() {
  if (!mySessionId) {
    mySessionId = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID);
    if (!mySessionId) {
      mySessionId = generateSessionId();
      localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID, mySessionId);
    }
    myPresenceColor = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_COLOR) || null;
  }

  stopPresenceHeartbeat();
  sendPresenceHeartbeat();
  presenceHeartbeatInterval = setInterval(sendPresenceHeartbeat, CONSTANTS.DEFAULTS.PRESENCE_HEARTBEAT_INTERVAL);
  window.addEventListener('beforeunload', sendPresenceLeave);
  document.addEventListener('visibilitychange', _onVisibilityChange);
  debugLog('[MAIN] - Presence heartbeat started, session:', mySessionId);
}

function showNamePromptModal(onConfirm, onCancel) {
  const existingModal = document.getElementById('presenceNameModal');
  if (existingModal) existingModal.remove();

  const modalEl = document.createElement('div');
  modalEl.id = 'presenceNameModal';
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.setAttribute('aria-labelledby', 'presenceNameModalLabel');
  modalEl.setAttribute('aria-modal', 'true');
  modalEl.setAttribute('role', 'dialog');
  modalEl.setAttribute('data-bs-backdrop', 'static');
  modalEl.setAttribute('data-bs-keyboard', 'false');

  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="presenceNameModalLabel"><i class="bi bi-person-badge me-2"></i>Identify yourself</h5>
        </div>
        <div class="modal-body">
          <p class="mb-3">To use the multiple-ticket view, please enter your name.</p>
          <p class="text-muted small mb-3">To change your name later, clear your browser's local storage for this site.</p>
          <input type="text" id="presenceNameInput" class="form-control" placeholder="Your name (e.g. Jane Smith)" maxlength="60" autocomplete="name" />
        </div>
        <div class="modal-footer">
          <button type="button" id="presenceNameGoBack" class="btn btn-secondary">Go back</button>
          <button type="button" id="presenceNameContinue" class="btn btn-primary" disabled>Continue</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);
  const bsModal = new bootstrap.Modal(modalEl);
  const nameInput = modalEl.querySelector('#presenceNameInput');
  const continueBtn = modalEl.querySelector('#presenceNameContinue');
  const goBackBtn = modalEl.querySelector('#presenceNameGoBack');

  nameInput.addEventListener('input', () => { continueBtn.disabled = nameInput.value.trim().length === 0; });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !continueBtn.disabled) continueBtn.click(); });

  continueBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_DISPLAY_NAME, name);
    bsModal.hide();
    modalEl.addEventListener('hidden.bs.modal', () => { modalEl.remove(); if (onConfirm) onConfirm(name); }, { once: true });
  });

  goBackBtn.addEventListener('click', () => {
    bsModal.hide();
    modalEl.addEventListener('hidden.bs.modal', () => { modalEl.remove(); if (onCancel) onCancel(); }, { once: true });
  });

  bsModal.show();
  modalEl.addEventListener('shown.bs.modal', () => { nameInput.focus(); }, { once: true });
}

function stopPresenceHeartbeat() {
  if (presenceHeartbeatInterval !== null) { clearInterval(presenceHeartbeatInterval); presenceHeartbeatInterval = null; }
  sendPresenceLeave();
  window.removeEventListener('beforeunload', sendPresenceLeave);
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  if (assignmentUIManager) assignmentUIManager.clearPresenceIndicators();
  debugLog('[MAIN] - Presence heartbeat stopped');
}

function _onVisibilityChange() {
  if (document.visibilityState === 'visible' && mySessionId) sendPresenceHeartbeat();
}

async function sendPresenceHeartbeat() {
  if (!mySessionId) return;
  try {
    const response = await fetch(CONSTANTS.API.PRESENCE_HEARTBEAT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: mySessionId, display_name: myDisplayName || null })
    });
    if (response.ok) {
      const data = await response.json();
      if (!myPresenceColor && data.sessions) {
        const mySession = data.sessions.find(s => s.session_id === mySessionId);
        if (mySession && mySession.color) {
          myPresenceColor = mySession.color;
          localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_COLOR, myPresenceColor);
        }
      }
      handlePresenceUpdate(data.sessions);
    }
  } catch (error) { debugLog('[MAIN] - Presence heartbeat error:', error); }
}

function sendPresenceLeave() {
  if (!mySessionId) return;
  try {
    navigator.sendBeacon(CONSTANTS.API.PRESENCE_LEAVE, new Blob([JSON.stringify({ session_id: mySessionId })], { type: 'application/json' }));
  } catch (e) { /* sendBeacon may not be available */ }
}

function handlePresenceUpdate(sessions) {
  if (!assignmentUIManager) return;
  assignmentUIManager.setPresenceCount(sessions.length);
  assignmentUIManager.renderPresenceIndicators(sessions, mySessionId);
}

// ─── Consensus ───────────────────────────────────────────────────────────────

async function sendConsensusVote(agree) {
  if (!mySessionId) return;
  try {
    const response = await fetch(CONSTANTS.API.CONSENSUS_VOTE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: mySessionId, agree })
    });
    if (response.ok) {
      const state = await response.json();
      debugLog('[MAIN] - Consensus vote response:', state);
      // Update local vote tracking
      assignmentUIManager._myConsensusVote = agree;
      // Button state is updated by ui-state-update SSE event
    }
  } catch (error) { debugLog('[MAIN] - Error sending consensus vote:', error); }
}

async function sendConsensusBannerDisagree() {
  if (!mySessionId) return;
  try {
    const response = await fetch(CONSTANTS.API.CONSENSUS_DISAGREE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: mySessionId })
    });
    if (response.ok) {
      const state = await response.json();
      debugLog('[MAIN] - Consensus banner disagree response:', state);
      assignmentUIManager._myConsensusVote = false;
    }
  } catch (error) { debugLog('[MAIN] - Error sending consensus disagree:', error); }
}

// ─── Validation queue polling ────────────────────────────────────────────────

function startValidationPolling() {
  stopValidationPolling();
  const interval = CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL;
  const msUntilNextTick = interval - (Date.now() % interval);
  const secondsUntilNextTick = Math.max(1, Math.round(msUntilNextTick / 1000));

  debugLog('[MAIN] - Starting validation polling (interval:', interval, 'ms)');
  startCountdownTimer(secondsUntilNextTick);

  const nextPollAt = Date.now() + msUntilNextTick;
  syncPollTimer(nextPollAt);

  validationAlignmentTimeout = setTimeout(() => {
    validationAlignmentTimeout = null;
    handleValidationPoll();
    validationPollingInterval = setInterval(handleValidationPoll, interval);
  }, msUntilNextTick);
}

function stopValidationPolling() {
  if (validationAlignmentTimeout !== null) { clearTimeout(validationAlignmentTimeout); validationAlignmentTimeout = null; }
  if (validationPollingInterval !== null) { clearInterval(validationPollingInterval); validationPollingInterval = null; }
  stopCountdownTimer();
}

function startCountdownTimer(initialSeconds) {
  stopCountdownTimer();
  const totalSeconds = (initialSeconds !== undefined) ? initialSeconds : Math.round(CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL / 1000);
  validationCountdownSeconds = totalSeconds;
  TicketRenderer.updateCountdownDisplay(validationCountdownSeconds);
  validationCountdownInterval = setInterval(() => {
    validationCountdownSeconds = Math.max(0, validationCountdownSeconds - 1);
    TicketRenderer.updateCountdownDisplay(validationCountdownSeconds);
  }, 1000);
}

function stopCountdownTimer() {
  if (validationCountdownInterval !== null) { clearInterval(validationCountdownInterval); validationCountdownInterval = null; }
  TicketRenderer.updateCountdownDisplay(null);
}

async function handleValidationPoll() {
  debugLog('[MAIN] - Running validation ticket poll');
  TicketRenderer.removeLeftQueueTickets();
  TicketRenderer.clearNewTicketBadges();

  const displayedIds = TicketRenderer.getDisplayedTicketIds();
  if (displayedIds.size === 0) return;

  const idsParam = Array.from(displayedIds).join(',');

  try {
    const response = await fetch(`${CONSTANTS.API.CHECK_VALIDATION_TICKETS}?ids=${encodeURIComponent(idsParam)}`);
    if (!response.ok) return;
    const data = await response.json();

    if (data.left_queue && data.left_queue.length > 0) TicketRenderer.markTicketsLeftQueue(data.left_queue);
    if (data.new_in_queue && data.new_in_queue.length > 0) {
      for (const ticketId of data.new_in_queue) {
        const pendingIndex = nextPendingTicketIndex++;
        TicketRenderer.addPendingTicket(ticketId, pendingIndex);
        fetchAndHydrateTicket(ticketId, pendingIndex);
      }
    }

    TicketRenderer.updateLastCheckedTime(new Date());
    const nextPollAt = Date.now() + CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL;
    startCountdownTimer(Math.round(CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL / 1000));
    syncPollTimer(nextPollAt);
  } catch (error) { debugLog('[MAIN] - Poll error:', error); }
}

async function fetchAndHydrateTicket(ticketId, pendingIndex) {
  try {
    const response = await fetch(`${CONSTANTS.API.GET_SINGLE_VALIDATION_TICKET}?id=${encodeURIComponent(ticketId)}`);
    if (!response.ok) return;
    const ticketData = await response.json();
    TicketRenderer.hydrateTicket(ticketId, ticketData, pendingIndex);
  } catch (error) { debugLog('[MAIN] - Error hydrating ticket', ticketId, ':', error); }
}

// ─── Validation broadcast listener ───────────────────────────────────────────

function startValidationBroadcastListener() {
  if (validationBroadcastSource && validationBroadcastSource.readyState !== EventSource.CLOSED) return;

  if (!mySessionId) {
    mySessionId = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID);
    if (!mySessionId) { mySessionId = generateSessionId(); localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID, mySessionId); }
  }
  if (!myPresenceColor) myPresenceColor = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_COLOR) || null;
  if (!myDisplayName) myDisplayName = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_DISPLAY_NAME) || null;

  const url = `${CONSTANTS.API.VALIDATION_BROADCAST}?session_id=${encodeURIComponent(mySessionId)}`;
  debugLog('[MAIN] - Opening validation broadcast listener:', url);
  validationBroadcastSource = new EventSource(url);

  let totalCount = 0;
  let loadedCount = 0;

  const WATCHDOG_MS = 30_000;
  let watchdogTimer = null;
  let completionFallbackTimer = null;

  function _resetWatchdog() { if (watchdogTimer !== null) { clearTimeout(watchdogTimer); watchdogTimer = null; } }
  function _startWatchdog() {
    _resetWatchdog();
    watchdogTimer = setTimeout(() => {
      debugLog('[MAIN] - Watchdog fired — reconnecting');
      if (validationBroadcastSource) { validationBroadcastSource.close(); validationBroadcastSource = null; }
      startValidationBroadcastListener();
    }, WATCHDOG_MS);
  }

  function _scheduleCompletionFallback() {
    if (completionFallbackTimer !== null) return;
    completionFallbackTimer = setTimeout(() => {
      completionFallbackTimer = null;
      debugLog('[MAIN] - Completion fallback triggered');
      _resetWatchdog();
      try { TicketRenderer.updateStreamingProgress(loadedCount, totalCount, true); } catch (e) {}
      startValidationPolling();
    }, 5000);
  }

  // ── SSE event handlers ─────────────────────────────────────────────────

  validationBroadcastSource.addEventListener('state', (event) => {
    const data = JSON.parse(event.data);
    if (data.state === 'loading') {
      const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
      if (!accordion) TicketRenderer.renderValidationTicketsStreamingInit();
      loadedCount = 0; totalCount = 0;
      if (completionFallbackTimer !== null) { clearTimeout(completionFallbackTimer); completionFallbackTimer = null; }
      _startWatchdog();
    }
  });

  validationBroadcastSource.addEventListener('count', (event) => {
    const data = JSON.parse(event.data);
    totalCount = data.count;
    if (totalCount === 0) { _resetWatchdog(); TicketRenderer.renderError('No validation tickets found.'); }
    else {
      const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
      if (!accordion) TicketRenderer.renderValidationTicketsStreamingInit();
      TicketRenderer.updateStreamingProgress(0, totalCount, false);
      _startWatchdog();
    }
  });

  validationBroadcastSource.addEventListener('ticket', (event) => {
    const ticket = JSON.parse(event.data);
    TicketRenderer.appendValidationTicket(ticket, ticket.index);
    loadedCount++;
    TicketRenderer.updateStreamingProgress(loadedCount, totalCount, false);
    _startWatchdog();
    if (totalCount > 0 && loadedCount >= totalCount) _scheduleCompletionFallback();
  });

  validationBroadcastSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    _resetWatchdog();
    if (completionFallbackTimer !== null) { clearTimeout(completionFallbackTimer); completionFallbackTimer = null; }
    try { TicketRenderer.updateStreamingProgress(loadedCount, totalCount, true); } catch (e) {}
    startValidationPolling();
  });

  validationBroadcastSource.addEventListener('error', (event) => {
    try {
      const errorData = JSON.parse(event.data);
      if (errorData.ticket_id) { loadedCount++; _startWatchdog(); }
      else { _resetWatchdog(); TicketRenderer.renderError('Error loading validation tickets: ' + errorData.message); }
    } catch (e) {}
  });

  // ── Sync events ────────────────────────────────────────────────────────

  validationBroadcastSource.addEventListener('consensus-state', (event) => {
    try {
      const state = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast consensus-state:', state);
      // Consensus state is now handled by ui-state-update via button_rules
      // Update local vote tracking
      if (mySessionId && state.agreed) {
        assignmentUIManager._myConsensusVote = state.agreed.includes(mySessionId);
      }
    } catch (e) {}
  });

  validationBroadcastSource.addEventListener('checkbox-sync', (event) => {
    try { _applySyncedCheckboxState(JSON.parse(event.data)); } catch (e) {}
  });

  validationBroadcastSource.addEventListener('assignment-selection-sync', (event) => {
    try { _applySyncedAssignmentSelection(JSON.parse(event.data)); } catch (e) {}
  });

  validationBroadcastSource.addEventListener('poll-timer-sync', (event) => {
    try { _applySyncedPollTimer(JSON.parse(event.data)); } catch (e) {}
  });

  validationBroadcastSource.addEventListener('implement-complete', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.assigned_ticket_ids && data.assigned_ticket_ids.length > 0)
        TicketRenderer.removeAssignedTickets(data.assigned_ticket_ids);
      if (data.results) TicketRenderer.renderAssignmentResults(data);
      // Button state driven by ui-state-update SSE
    } catch (e) {}
  });

  validationBroadcastSource.addEventListener('recommendation-toggle', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.active) {
        stopValidationPolling();
        TicketRenderer.showPollingPausedMessage();
      } else {
        assignmentUIManager.hideRecommendationProgress();
        startValidationPolling();
      }
      // Button visual driven by ui-state-update SSE
    } catch (e) {}
  });

  validationBroadcastSource.addEventListener('recommendation-start', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (assignmentUIManager && data.ticket_id) {
        const ticketItems = document.querySelectorAll(`#${CONSTANTS.SELECTORS.VALIDATION_ACCORDION} > .accordion-item[data-ticket-id]`);
        const total = ticketItems.length;
        const completedSoFar = document.querySelectorAll('.recommendations-container[style*="display: block"]').length;
        assignmentUIManager.showRecommendationProgress(completedSoFar + 1, total, data.ticket_id);
      }
    } catch (e) {}
  });

  validationBroadcastSource.addEventListener('recommendation-complete', (event) => {
    try {
      const data = JSON.parse(event.data);
      const ticketItem = document.querySelector(`[data-ticket-id="${data.ticket_id}"]`);
      if (!ticketItem) return;
      const index = parseInt(ticketItem.dataset.ticketIndex);
      TicketRenderer.renderRecommendations(data.data, true, index);
      TicketRenderer.storeRecommendationData(index, data.data);
      TicketRenderer.showTicketCheckboxes();
    } catch (e) {}
  });

  validationBroadcastSource.addEventListener('recommendation-error', (event) => {
    try {
      const data = JSON.parse(event.data);
      const ticketItem = document.querySelector(`[data-ticket-id="${data.ticket_id}"]`);
      if (ticketItem) {
        const index = ticketItem.dataset.ticketIndex;
        TicketRenderer.renderRecommendations({ error: data.error }, true, parseInt(index));
      }
    } catch (e) {}
  });

  validationBroadcastSource.addEventListener('recommendation-progress', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (assignmentUIManager && assignmentUIManager.isRecommendationToggleActive()) {
        if (data.completed > 0 && data.completed >= data.total) {
          assignmentUIManager.showRecommendationComplete(data.total);
          startValidationPolling();
        }
      }
    } catch (e) {}
  });

  validationBroadcastSource.addEventListener('sync-state-burst', (event) => {
    try { _applySyncStateBurst(JSON.parse(event.data)); } catch (e) {}
  });

  // ── ticket-header-update: SERVER-DRIVEN HEADER STATE ───────────────────
  validationBroadcastSource.addEventListener('ticket-header-update', (event) => {
    try {
      const headerState = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast ticket-header-update:', headerState.ticket_id, headerState.header_style);
      TicketRenderer.applyServerHeaderState(headerState);
    } catch (e) {}
  });

  // ── ui-state-update: THE SINGLE SOURCE OF TRUTH FOR BUTTON STATE ───────
  validationBroadcastSource.addEventListener('ui-state-update', (event) => {
    try {
      const state = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast ui-state-update:', state);
      if (assignmentUIManager) assignmentUIManager.applyUIState(state);

      // Handle countdown visibility from server state
      if (state.countdown_visible === false) {
        stopCountdownTimer();
      }
    } catch (e) {}
  });

  validationBroadcastSource.onerror = (err) => {
    debugLog('[MAIN] - Broadcast connection error (will auto-reconnect):', err);
  };
}

function stopValidationBroadcastListener() {
  if (validationBroadcastSource) { validationBroadcastSource.close(); validationBroadcastSource = null; }
}

// ─── Cross-client sync handlers ──────────────────────────────────────────────

let _applyingSyncedCheckbox = false;
let _applyingSyncedAssignment = false;

function _applySyncedCheckboxState(data) {
  _applyingSyncedCheckbox = true;
  try {
    if (data.select_all !== undefined) {
      const selectAllCb = document.getElementById(CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX);
      if (selectAllCb) { selectAllCb.checked = data.checked; selectAllCb.indeterminate = false; }
      document.querySelectorAll('.ticket-checkbox:not([disabled])').forEach(cb => { cb.checked = data.checked; });
    } else if (data.ticket_id) {
      const ticketItem = document.querySelector(`[data-ticket-id="${data.ticket_id}"]`);
      if (ticketItem) { const cb = ticketItem.querySelector('.ticket-checkbox'); if (cb) cb.checked = data.checked; }
    }
    if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectAllCheckboxState) TicketRenderer._updateSelectAllCheckboxState();
    if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectedCount) TicketRenderer._updateSelectedCount();
  } finally { _applyingSyncedCheckbox = false; }
}

function _applySyncedAssignmentSelection(data) {
  _applyingSyncedAssignment = true;
  try {
    const { ticket_id, field, value } = data;
    const ticketItem = document.querySelector(`[data-ticket-id="${ticket_id}"]`);
    if (!ticketItem) return;
    const index = ticketItem.dataset.ticketIndex;
    const container = document.getElementById(`recommendations-${index}`);
    if (!container) return;

    if (field === 'support_group_radio') {
      const radios = container.querySelectorAll(`input[name="sg-selector-batch-${index}"]`);
      radios.forEach(r => { r.checked = (r.value === value); });
      const manualInput = container.querySelector(`input[name="manual-sg-batch-${index}"]`);
      if (manualInput && manualInput.value) {
        manualInput.value = '';
        const searchInput = container.querySelector(`.manual-sg-search`);
        if (searchInput) { searchInput.value = ''; searchInput.readOnly = false; searchInput.classList.remove('manual-sg-selected'); }
        const clearBtn = container.querySelector(`.manual-sg-clear`);
        if (clearBtn) clearBtn.style.display = 'none';
        if (typeof TicketRenderer !== 'undefined' && TicketRenderer._setAiRadiosDisabled) TicketRenderer._setAiRadiosDisabled(parseInt(index), false);
        // Header styling is driven EXCLUSIVELY by the server via
        // 'ticket-header-update' SSE events.  Do NOT manipulate header
        // classes locally.
      }
    } else if (field === 'manual_support_group') {
      const manualInput = container.querySelector(`input[name="manual-sg-batch-${index}"]`);
      const searchInput = container.querySelector(`.manual-sg-search`);
      if (value) {
        if (manualInput) manualInput.value = value;
        if (searchInput) { searchInput.value = value; searchInput.readOnly = true; searchInput.classList.add('manual-sg-selected'); }
        const clearBtn = container.querySelector(`.manual-sg-clear`); if (clearBtn) clearBtn.style.display = '';
        if (typeof TicketRenderer !== 'undefined' && TicketRenderer._setAiRadiosDisabled) TicketRenderer._setAiRadiosDisabled(parseInt(index), true);
        // Header styling is driven EXCLUSIVELY by the server via
        // 'ticket-header-update' SSE events.  Do NOT manipulate header
        // classes locally.
      } else {
        if (manualInput) manualInput.value = '';
        if (searchInput) { searchInput.value = ''; searchInput.readOnly = false; searchInput.classList.remove('manual-sg-selected'); }
        const clearBtn = container.querySelector(`.manual-sg-clear`); if (clearBtn) clearBtn.style.display = 'none';
        if (typeof TicketRenderer !== 'undefined' && TicketRenderer._setAiRadiosDisabled) TicketRenderer._setAiRadiosDisabled(parseInt(index), false);
        const firstRadio = container.querySelector(`input[name="sg-selector-batch-${index}"]`); if (firstRadio) firstRadio.checked = true;
        // Header styling is driven EXCLUSIVELY by the server via
        // 'ticket-header-update' SSE events.  Do NOT manipulate header
        // classes locally.
      }
    } else if (field === 'priority_radio') {
      const radios = container.querySelectorAll(`input[name="priority-selector-batch-${index}"]`);
      radios.forEach(r => { r.checked = (r.value === value); });
    }

    // Editor attribution is now handled by the server via 'ticket-header-update'
    // SSE events.  No client-side editor state management needed here.
  } finally { _applyingSyncedAssignment = false; }
}

function _applySyncedPollTimer(data) {
  if (!data.next_poll_at) return;
  const secondsRemaining = Math.max(0, Math.round((data.next_poll_at - Date.now()) / 1000));
  startCountdownTimer(secondsRemaining);
}

function _applySyncStateBurst(data) {
  if (data.checkboxes) {
    _applyingSyncedCheckbox = true;
    try {
      for (const [ticketId, checked] of Object.entries(data.checkboxes)) {
        const ticketItem = document.querySelector(`[data-ticket-id="${ticketId}"]`);
        if (ticketItem) { const cb = ticketItem.querySelector('.ticket-checkbox'); if (cb) cb.checked = checked; }
      }
      if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectAllCheckboxState) TicketRenderer._updateSelectAllCheckboxState();
      if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectedCount) TicketRenderer._updateSelectedCount();
    } finally { _applyingSyncedCheckbox = false; }
  }

  if (data.assignments) {
    _applyingSyncedAssignment = true;
    try {
      for (const [ticketId, selections] of Object.entries(data.assignments)) {
        for (const [field, value] of Object.entries(selections)) {
          _applySyncedAssignmentSelection({ ticket_id: ticketId, field, value });
        }
      }
    } finally { _applyingSyncedAssignment = false; }
  }

  // Apply server-computed header states (single source of truth)
  if (data.headers) {
    for (const [ticketId, headerState] of Object.entries(data.headers)) {
      TicketRenderer.applyServerHeaderState({ ticket_id: ticketId, ...headerState });
    }
  }

  if (data.next_poll_at) _applySyncedPollTimer(data);
}

function syncCheckboxState(ticketId, checked, isSelectAll = false) {
  if (_applyingSyncedCheckbox) return;
  const body = isSelectAll ? { select_all: true, checked } : { ticket_id: ticketId, checked };
  fetch(CONSTANTS.API.SYNC_CHECKBOX, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(err => debugLog('[MAIN] - Error syncing checkbox:', err));
}

function syncAssignmentSelection(ticketId, field, value) {
  if (_applyingSyncedAssignment) return;

  // Send the actual value to the server — the server is the single source
  // of truth for determining whether a value matches the original AI
  // recommendation.  The server computes and broadcasts the authoritative
  // header state via the 'ticket-header-update' SSE event.
  fetch(CONSTANTS.API.SYNC_ASSIGNMENT_SELECTION, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: ticketId, field, value, session_id: mySessionId || '' })
  }).catch(err => debugLog('[MAIN] - Error syncing assignment selection:', err));
}

function syncPollTimer(nextPollAtMs) {
  fetch(CONSTANTS.API.SYNC_POLL_TIMER, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ next_poll_at: nextPollAtMs })
  }).catch(err => debugLog('[MAIN] - Error syncing poll timer:', err));
}

debugLog('[MAIN] - Main script loaded and initialized.');
