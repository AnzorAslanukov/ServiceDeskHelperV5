/**
 * Main entry point - Service Desk Helper Application
 * 
 * This file initializes all managers and handles high-level application logic.
 * It replaces the monolithic script.js with a modular, organized architecture.
 */

console.log('Service Desk Helper - Main script loaded. ToggleButton available:', typeof ToggleButton);

// Global manager instances
let searchUIManager;
let assignmentUIManager;
let navigationManager;
let batchProcessor;

// ─── Validation queue polling state ──────────────────────────────────────────
let validationPollingInterval = null;
let validationAlignmentTimeout = null;  // one-shot timeout used to align to epoch boundary
let validationCountdownInterval = null;
let validationCountdownSeconds = 0;
// Counter for unique indices assigned to newly-discovered (pending) tickets.
// Starting at 10000 keeps them well clear of the initial 0-based stream indices.
let nextPendingTicketIndex = 10000;
// ─────────────────────────────────────────────────────────────────────────────

// ─── Validation broadcast state ───────────────────────────────────────────────
/** The long-lived EventSource subscribed to /api/validation-broadcast */
let validationBroadcastSource = null;
// ─────────────────────────────────────────────────────────────────────────────

// ─── Presence heartbeat state ─────────────────────────────────────────────────
let presenceHeartbeatInterval = null;
let mySessionId = null;
let myPresenceColor = null;
let myDisplayName = null;

/**
 * DEBUG: set to true to inject 16 synthetic presence sessions so the
 * overflow badge UI can be tested without needing 16 real browser tabs.
 * The mock sessions are injected in handlePresenceUpdate() before the
 * data reaches renderPresenceIndicators().
 * Set back to false (or leave false) for normal operation.
 */
const DEBUG_PRESENCE_MOCK = false;

/**
 * DEBUG: set to true to use dummy recommendation data instead of calling
 * the real LLM pipeline. This allows rapid UI testing of the "Get ticket
 * recommendations" workflow without waiting for the text generation model.
 * Requires tests/dummy_recommendations.js to be loaded (see index.html).
 * Set back to false for normal operation.
 */
const DEBUG_DUMMY_RECOMMENDATIONS = false;

/**
 * DEBUG: set to true to prevent the "Implement ticket assignment" button from
 * actually calling the Athena API to assign tickets.  When active, the button
 * still runs all client-side logic (collecting selections, building the
 * assignments array, rendering a results table) but the POST to
 * /api/implement-assignments is skipped and a mock result is shown instead.
 * This allows safe UI testing when recommendation data is inaccurate.
 * Set back to false for normal (real assignment) operation.
 */
const DEBUG_HARD_STOP_ASSIGNMENT = true;

// ─── Support group names cache ───────────────────────────────────────────────
let _supportGroupNamesCache = null;

/**
 * Fetch and cache the list of all support group names from the server.
 * Returns the cached array on subsequent calls.
 * @returns {Promise<string[]>} Sorted array of support group names
 */
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
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a UUID-v4-like random string */
function generateSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', function() {
  debugLog('[MAIN] - DOMContentLoaded event fired, starting initialization');

  // Initialize UI managers
  initializeManagers();

  // Attach event listeners
  attachEventListeners();

  debugLog('[MAIN] - Application initialization complete');
});

/**
 * Initialize all manager instances
 */
function initializeManagers() {
  debugLog('[MAIN] - Initializing managers');

  // Search UI Manager - handles search toggle buttons
  searchUIManager = new SearchUIManager(
    CONSTANTS.SELECTORS.SEARCH_TOGGLES_CONTAINER,
    CONSTANTS.SELECTORS.SEARCH_INPUT
  );
  searchUIManager.initialize();

  // Assignment UI Manager - handles assignment mode and batch buttons
  assignmentUIManager = new AssignmentUIManager();
  // Don't initialize assignment UI yet - it will be created when user switches to assignment mode

  // Navigation Manager - handles switching between search and assignment modes
  navigationManager = new NavigationManager(searchUIManager, assignmentUIManager);
  navigationManager.initialize({
    onSwitchToSearch: () => {
      debugLog('[MAIN] - Switched to search mode callback');
      stopValidationPolling();          // Stop polling when leaving assignment/validation view
      stopPresenceHeartbeat();          // Stop presence when leaving assignment view
      stopValidationBroadcastListener(); // Close the shared broadcast SSE connection
    },
    onSwitchToAssignment: () => {
      debugLog('[MAIN] - Switched to assignment mode callback');
      attachAssignmentEventListeners();
      // Open the broadcast listener immediately on entering the Assignment section
      // so that tickets pushed by another user are received even before the local
      // user clicks the Multiple Tickets toggle.
      startValidationBroadcastListener();
    }
  });

  // Batch Processor - handles concurrent API requests
  batchProcessor = new BatchProcessor(CONSTANTS.DEFAULTS.BATCH_SIZE);

  debugLog('[MAIN] - Managers initialized');
}

/**
 * Attach main event listeners (search input, search button)
 */
function attachEventListeners() {
  debugLog('[MAIN] - Attaching event listeners');

  // Search input - Enter key triggers search
  const searchInput = document.getElementById(CONSTANTS.SELECTORS.SEARCH_INPUT);
  if (searchInput) {
    searchInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        const searchButton = document.getElementById(CONSTANTS.SELECTORS.SEARCH_BUTTON);
        if (searchButton) {
          searchButton.click();
        }
      }
    });
  }

  // Search button - main search/assignment action
  const searchButton = document.getElementById(CONSTANTS.SELECTORS.SEARCH_BUTTON);
  if (searchButton) {
    searchButton.addEventListener('click', handleSearchButtonClick);
  }

  // Listen for ticket checkbox selection changes to update the Implement button
  // label and enabled/disabled state in real time.
  // Also checks whether consensus mode should be activated or deactivated.
  document.addEventListener('ticketSelectionChanged', (e) => {
    if (!assignmentUIManager) return;
    const { selectedCount, totalCount } = e.detail;
    assignmentUIManager.updateImplementButtonState(selectedCount, totalCount);

    // ── Consensus threshold detection ──────────────────────────────────────
    handleConsensusThresholdCheck(selectedCount);
  });

  // Listen for clicks on the consensus agree button (delegated)
  document.addEventListener('click', (e) => {
    const agreeBtn = e.target.closest('#consensus-agree-btn');
    if (!agreeBtn || !assignmentUIManager) return;
    // Toggle the user's vote
    const currentlyAgreed = assignmentUIManager._myConsensusVote;
    sendConsensusVote(!currentlyAgreed);
  });

  debugLog('[MAIN] - Event listeners attached');
}

/**
 * Attach assignment-specific event listeners
 * Called when switching to assignment mode
 */
function attachAssignmentEventListeners() {
  debugLog('[MAIN] - Attaching assignment event listeners');

  // Attach toggle listeners
  assignmentUIManager.attachToggleListeners(
    () => {
      debugLog('[MAIN] - Single ticket mode selected');
      stopPresenceHeartbeat();
      stopValidationBroadcastListener();
    },
    () => {
      debugLog('[MAIN] - Multiple tickets mode selected');
      // Batch button listeners will be attached when batch buttons are created
      setTimeout(attachBatchButtonListeners, 0);
      // startPresenceHeartbeat handles the name-prompt gate internally
      startPresenceHeartbeat();
      // Open the shared broadcast channel so this client receives tickets
      // pushed by any user who clicks "Get validation tickets"
      startValidationBroadcastListener();
    }
  );

  // If already in multiple mode when this runs, start the broadcast listener
  if (assignmentUIManager.getMode() === CONSTANTS.MODES.MULTIPLE_TICKETS) {
    attachBatchButtonListeners();
    startValidationBroadcastListener();
  }
}

/**
 * Attach batch workflow button listeners
 */
function attachBatchButtonListeners() {
  debugLog('[MAIN] - Attaching batch button listeners');

  assignmentUIManager.attachBatchButtonListeners({
    onGetValidationTickets: handleGetValidationTicketsStream,
    onGetRecommendations: handleGetRecommendations,
    onImplementAssignment: handleImplementAssignment
  });
}

/**
 * Handle search/assignment button click
 */
async function handleSearchButtonClick() {
  const searchInput = document.getElementById(CONSTANTS.SELECTORS.SEARCH_INPUT);
  const searchButton = document.getElementById(CONSTANTS.SELECTORS.SEARCH_BUTTON);

  if (!searchInput || !searchButton) return;

  const searchValue = searchInput.value.trim();
  if (!searchValue) {
    alert('Please enter search text');
    return;
  }

  // Check if we're in assignment mode (single ticket)
  if (navigationManager.getCurrentSection() === 'assignment' && 
      assignmentUIManager.getMode() === CONSTANTS.MODES.SINGLE_TICKET) {
    await handleSingleTicketAssignment(searchValue, searchButton);
    return;
  }

  // Regular search mode
  await handleTicketSearch(searchValue, searchButton);
}

/**
 * Handle ticket search (phone, match, semantic, ticket modes)
 */
async function handleTicketSearch(searchValue, searchButton) {
  debugLog('[MAIN] - Handling ticket search:', searchValue);

  // Disable button and show loading
  searchButton.disabled = true;
  searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
  TicketRenderer.renderLoading();

  try {
    const mode = searchUIManager.getActiveMode();
    let bodyObj, searchType;

    switch (mode) {
      case CONSTANTS.MODES.PHONE:
        bodyObj = { contactMethod: searchValue, contains: true };
        searchType = 'phone number';
        break;
      case CONSTANTS.MODES.MATCH:
        bodyObj = { description: searchValue, contains: true };
        searchType = 'exact match';
        break;
      case CONSTANTS.MODES.SEMANTIC:
        bodyObj = { semanticDescription: searchValue };
        searchType = 'semantic similarity';
        break;
      case CONSTANTS.MODES.TICKET:
        bodyObj = { ticketId: searchValue };
        searchType = 'ticket-based vector search';
        break;
      default:
        bodyObj = { description: searchValue, contains: true };
        searchType = 'description';
    }

    const response = await fetch(CONSTANTS.API.SEARCH_TICKETS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

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

/**
 * Handle single ticket assignment advice request using SSE for progress updates
 */
function handleSingleTicketAssignment(ticketId, searchButton) {
  debugLog('[MAIN] - Handling single ticket assignment with SSE:', ticketId);

  // Disable button and show initial loading with progress
  searchButton.disabled = true;
  searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
  TicketRenderer.renderLoadingWithProgress(1, 'Fetching ticket data...');

  // Create EventSource for SSE
  const eventSource = new EventSource(
    `${CONSTANTS.API.GET_TICKET_ADVICE_STREAM}?ticketId=${encodeURIComponent(ticketId)}`
  );

  let hasReceivedData = false;

  eventSource.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    debugLog('[MAIN] - Progress update:', data);
    TicketRenderer.updateLoadingProgress(data.step, data.message);
  });

  eventSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    debugLog('[MAIN] - Assignment complete:', data);
    hasReceivedData = true;

    // Display AI recommendations first
    if (data.recommended_support_group || data.recommended_priority_level || data.detailed_explanation) {
      TicketRenderer.renderRecommendations(data);
    }

    // Display original ticket
    if (data.original_data) {
      TicketRenderer.renderOriginalTicket(data.original_data);
    }

    // Display similar tickets
    if (data.similar_tickets && data.similar_tickets.length > 0) {
      TicketRenderer.renderSimilarTickets(data.similar_tickets);
    }

    // Display OneNote documentation
    if (data.onenote_documentation && data.onenote_documentation.length > 0) {
      const container = ensureContentArea();
      // container.innerHTML += '<div class="mt-5 pt-4 border-top text-start"><h4>OneNote Documentation Referenced</h4></div>';
      TicketRenderer.renderOnenoteDocuments(data.onenote_documentation);
    }

    // Clean up
    eventSource.close();
    searchButton.disabled = false;
    searchButton.innerHTML = '<i class="bi bi-search"></i>';
  });

  eventSource.addEventListener('error', (event) => {
    let errorMessage = 'Error getting advice';
    
    try {
      const data = JSON.parse(event.data);
      errorMessage = data.message || errorMessage;
    } catch (e) {
      // If we can't parse the error data, use default message
      if (!hasReceivedData) {
        errorMessage = 'Connection error while getting ticket advice. Please try again.';
      }
    }

    debugLog('[MAIN] - SSE error:', errorMessage);
    TicketRenderer.renderError('Error getting advice: ' + errorMessage);
    
    eventSource.close();
    searchButton.disabled = false;
    searchButton.innerHTML = '<i class="bi bi-search"></i>';
  });

  // Handle connection errors (when event.data is undefined)
  eventSource.onerror = (error) => {
    if (!hasReceivedData) {
      debugLog('[MAIN] - EventSource connection error:', error);
      TicketRenderer.renderError('Connection error while getting ticket advice. Please try again.');
      searchButton.disabled = false;
      searchButton.innerHTML = '<i class="bi bi-search"></i>';
    }
    eventSource.close();
  };
}

/**
 * Handle get validation tickets button click
 */
async function handleGetValidationTickets() {
  debugLog('[MAIN] - Get validation tickets clicked');

  TicketRenderer.renderLoading();
  assignmentUIManager.disableRecommendationsButton();

  try {
    const response = await fetch(CONSTANTS.API.GET_VALIDATION_TICKETS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    debugLog('[MAIN] - Validation tickets API response:', data);

    TicketRenderer.renderValidationTickets(data);

    // Enable the recommendations button
    assignmentUIManager.enableRecommendationsButton();

  } catch (error) {
    debugLog('[MAIN] - Error fetching validation tickets:', error);
    TicketRenderer.renderError('Error loading validation tickets: ' + error.message);
  }
}

/**
 * Handle get validation tickets button click.
 *
 * Instead of opening its own SSE stream, this function POSTs to
 * /api/trigger-validation-load.  The actual ticket data arrives via the
 * already-open /api/validation-broadcast connection (startValidationBroadcastListener).
 *
 * If the server reports the cache is already fresh (another user loaded tickets
 * recently), the broadcast connection will have already replayed the cached
 * tickets on connect, so nothing extra is needed.
 */
async function handleGetValidationTicketsStream() {
  debugLog('[MAIN] - Get validation tickets clicked (trigger mode)');

  // Ensure the broadcast listener is open before we trigger the load
  // (it may not be if the user navigated away and back)
  startValidationBroadcastListener();

  try {
    const response = await fetch(CONSTANTS.API.TRIGGER_VALIDATION_LOAD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    debugLog('[MAIN] - Trigger response:', result);

    if (result.status === 'loading' || result.status === 'loading_started') {
      // Guard: only set tickets-loading if the SSE 'complete' event hasn't
      // already advanced the workflow past this point.  Because the POST and
      // the SSE stream travel on separate connections, the 'complete' event
      // can arrive before the HTTP response when the load finishes quickly.
      const currentState = assignmentUIManager.getWorkflowState();
      if (currentState !== 'tickets-loaded' &&
          currentState !== 'recommendations-loading' &&
          currentState !== 'recommendations-complete') {
        assignmentUIManager.setWorkflowState('tickets-loading');
      }
      // Initialize the streaming UI immediately from the HTTP response.
      // This is the primary initializer for the user who clicked the button.
      // The SSE 'state: loading' event handles the same for OTHER connected
      // clients (who didn't click the button).
      // Guard: only initialize if the accordion doesn't already exist — this
      // prevents wiping tickets that may have already arrived via SSE before
      // the HTTP response was processed (extremely unlikely but safe to guard).
      const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
      if (!accordion) {
        TicketRenderer.renderValidationTicketsStreamingInit();
      }
    } else if (result.status === 'already_loaded') {
      // Cache is fresh; the broadcast connection replayed tickets on connect.
      // If the accordion is already populated, just ensure the workflow state is correct.
      debugLog('[MAIN] - Tickets already loaded from cache (', result.count, ')');
      // The broadcast listener's 'complete' handler will have already set the state;
      // guard against the edge case where it hasn't fired yet.
      if (assignmentUIManager.getWorkflowState() !== 'tickets-loaded' &&
          assignmentUIManager.getWorkflowState() !== 'recommendations-loading' &&
          assignmentUIManager.getWorkflowState() !== 'recommendations-complete') {
        assignmentUIManager.setWorkflowState('tickets-loading');
        TicketRenderer.renderValidationTicketsStreamingInit();
      }
    }
  } catch (error) {
    debugLog('[MAIN] - Error triggering validation load:', error);
    TicketRenderer.renderError('Error loading validation tickets: ' + error.message);
    assignmentUIManager.setWorkflowState('idle');
  }
}

// ─── Recommendation toggle cancellation flag ─────────────────────────────────
let _recommendationCancelled = false;
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle get ticket recommendations button click (toggle behavior).
 *
 * Acts as a push-button toggle:
 *   OFF → ON:  Calls the server-side recommendation engine which processes
 *              all loaded tickets and broadcasts results to ALL connected
 *              clients via SSE.
 *   ON  → OFF: Tells the server to stop processing new tickets. Existing
 *              recommendations are preserved. All clients are notified via SSE.
 *
 * In DEBUG_DUMMY_RECOMMENDATIONS mode, recommendations are generated locally
 * using dummy data (no server call, no cross-client sync). This is a
 * frontend-only debug tool for rapid UI testing.
 */
async function handleGetRecommendations() {
  debugLog('[MAIN] - Get ticket recommendations toggle clicked');

  // ── Dummy recommendation mode (local-only, no cross-client sync) ───────────
  if (DEBUG_DUMMY_RECOMMENDATIONS) {
    await _handleGetRecommendationsDummy();
    return;
  }
  // ── End dummy recommendation mode ──────────────────────────────────────────

  // ── Toggle OFF path ────────────────────────────────────────────────────────
  if (assignmentUIManager.isRecommendationToggleActive()) {
    debugLog('[MAIN] - Toggling recommendations OFF (server-side)');

    try {
      const response = await fetch(CONSTANTS.API.TOGGLE_RECOMMENDATIONS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      debugLog('[MAIN] - Toggle OFF response:', result);
      // The server broadcasts recommendation-toggle { active: false } to all
      // clients via SSE. The _applySyncedRecommendationToggle handler will
      // update the UI for this client and all others.
    } catch (error) {
      debugLog('[MAIN] - Error toggling recommendations off:', error);
      // Fallback: update local state directly if the server call fails
      assignmentUIManager.setRecommendationToggleState(false);
      assignmentUIManager.hideRecommendationProgress();
      startValidationPolling();
    }

    return;
  }

  // ── Toggle ON path ─────────────────────────────────────────────────────────
  debugLog('[MAIN] - Toggling recommendations ON (server-side)');

  // Check if validation tickets are displayed
  const validationAccordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
  if (!validationAccordion) {
    alert('Please fetch validation tickets first by clicking "Get validation tickets".');
    return;
  }

  try {
    const response = await fetch(CONSTANTS.API.TOGGLE_RECOMMENDATIONS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    debugLog('[MAIN] - Toggle ON response:', result);
    // The server broadcasts recommendation-toggle { active: true } to all
    // clients via SSE, then starts background LLM processing.
    // The _applySyncedRecommendationToggle handler will update the UI.
    // As each recommendation completes, recommendation-complete SSE events
    // arrive and are handled by _applySyncedRecommendationComplete.
  } catch (error) {
    debugLog('[MAIN] - Error toggling recommendations on:', error);
    alert('Error starting recommendations: ' + error.message);
  }
}

/**
 * Handle dummy recommendation mode (local-only, no cross-client sync).
 * This is a frontend-only debug tool for rapid UI testing without the LLM.
 * @private
 */
async function _handleGetRecommendationsDummy() {
  // ── Toggle OFF path (dummy) ────────────────────────────────────────────────
  if (assignmentUIManager.isRecommendationToggleActive()) {
    debugLog('[MAIN] - [DUMMY] Toggling recommendations OFF');
    _recommendationCancelled = true;
    assignmentUIManager.setRecommendationToggleState(false);
    assignmentUIManager.hideRecommendationProgress();
    startValidationPolling();

    const hasAnyRecommendation = document.querySelector(
      '[id^="recommendations-"] .card, [id^="recommendations-"] .support-group-selector'
    );
    if (hasAnyRecommendation) {
      assignmentUIManager.enableImplementButton();
      assignmentUIManager.workflowState = 'recommendations-complete';
    } else {
      assignmentUIManager.setWorkflowState('tickets-loaded');
    }
    return;
  }

  // ── Toggle ON path (dummy) ─────────────────────────────────────────────────
  debugLog('[MAIN] - [DUMMY] DEBUG_DUMMY_RECOMMENDATIONS active: using dummy data');

  const validationAccordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
  if (!validationAccordion) {
    alert('Please fetch validation tickets first by clicking "Get validation tickets".');
    return;
  }

  const ticketItems = BatchProcessor.collectTicketItems();
  if (ticketItems.length === 0) {
    alert('No tickets found to process.');
    return;
  }

  _recommendationCancelled = false;
  assignmentUIManager.setWorkflowState('recommendations-loading');
  stopValidationPolling();
  TicketRenderer.showPollingPausedMessage();

  let checkboxesShown = false;
  assignmentUIManager.showRecommendationProgress(1, ticketItems.length, ticketItems[0].id);

  const DUMMY_DELAY_MS = 150;

  for (let i = 0; i < ticketItems.length; i++) {
    if (_recommendationCancelled) {
      debugLog('[MAIN] - [DUMMY] Recommendation processing cancelled at ticket', i + 1);
      break;
    }

    const item = ticketItems[i];
    assignmentUIManager.showRecommendationProgress(i + 1, ticketItems.length, item.id);

    const dummyData = getDummyRecommendation(item.id, item.index);
    TicketRenderer.renderRecommendations(dummyData, true, item.index);
    TicketRenderer.storeRecommendationData(item.index, dummyData);

    if (!checkboxesShown) {
      TicketRenderer.showTicketCheckboxes();
      checkboxesShown = true;
    }

    assignmentUIManager.updateRecommendationProgress(i + 1, ticketItems.length);
    debugLog('[MAIN] - [DUMMY] Rendered recommendation for ticket', item.id);

    if (i < ticketItems.length - 1) {
      await new Promise(resolve => setTimeout(resolve, DUMMY_DELAY_MS));
    }
  }

  if (!_recommendationCancelled) {
    assignmentUIManager.showRecommendationComplete(ticketItems.length);
    startValidationPolling();
    debugLog('[MAIN] - [DUMMY] All dummy recommendations complete');
  }
}

/**
 * Handle implement ticket assignment button click
 * Implements assignments for selected tickets using AI recommendations
 * Uses the user-selected support group from the three-way selector
 * Uses the user-selected priority from the three-way priority selector
 */
async function handleImplementAssignment() {
  debugLog('[MAIN] - Implement ticket assignment clicked');

  // Get selected tickets from the UI
  const selectedTickets = TicketRenderer.getSelectedTickets();
  
  if (selectedTickets.length === 0) {
    alert('Please select at least one ticket to assign.');
    return;
  }

  // Get recommendations container for each ticket to read the selected support group and priority
  const assignments = [];
  const ticketsWithoutRecommendations = [];

  for (const ticket of selectedTickets) {
    const recommendationsContainer = document.getElementById(`recommendations-${ticket.index}`);
    
    if (!recommendationsContainer) {
      ticketsWithoutRecommendations.push(ticket.id);
      continue;
    }

    // Check if this is a facilities/maintenance ticket
    const isFacilitiesTicket = recommendationsContainer.dataset.isFacilitiesTicket === 'true';
    const resolutionComment = recommendationsContainer.dataset.resolutionComment;

    if (isFacilitiesTicket && resolutionComment) {
      // Facilities ticket - resolve with resolution comment
      assignments.push({
        ticket_id: ticket.id,
        status: 'resolved',
        resolution_comment: resolutionComment
      });
      continue;
    }

    // Check for manual support group selection first (takes priority over AI recommendations)
    const manualSgInput = recommendationsContainer.querySelector(`input[name="manual-sg-batch-${ticket.index}"]`);
    const manualSgValue = manualSgInput ? manualSgInput.value.trim() : '';

    let selectedSupportGroup;
    if (manualSgValue) {
      // Manual selection takes priority
      selectedSupportGroup = manualSgValue;
    } else {
      // Fall back to AI recommendation radio buttons
      const sgRadioName = `sg-selector-batch-${ticket.index}`;
      const selectedSGRadio = recommendationsContainer.querySelector(`input[name="${sgRadioName}"]:checked`);
      selectedSupportGroup = selectedSGRadio ? selectedSGRadio.value : null;
    }

    // Get the selected priority from the priority radio buttons (name starts with priority-selector-batch)
    const priorityRadioName = `priority-selector-batch-${ticket.index}`;
    const selectedPriorityRadio = recommendationsContainer.querySelector(`input[name="${priorityRadioName}"]:checked`);
    const selectedPriority = selectedPriorityRadio ? selectedPriorityRadio.value : null;

    // Convert priority string to numeric value for Athena API
    // P1 is excluded from automatic assignment (only users can assign P1)
    // High = P2 (2), Medium/Low = P3 (3)
    let priorityValue = null;
    if (selectedPriority) {
      switch (selectedPriority) {
        case 'High':
          priorityValue = 2; // P2
          break;
        case 'Medium':
          priorityValue = 3; // P3
          break;
        case 'Low':
          priorityValue = 3; // P3
          break;
        default:
          priorityValue = null;
      }
    }

    if (selectedSupportGroup && selectedSupportGroup !== 'N/A') {
      assignments.push({
        ticket_id: ticket.id,
        support_group: selectedSupportGroup,
        priority: priorityValue
      });
    } else {
      ticketsWithoutRecommendations.push(ticket.id);
    }
  }

  if (assignments.length === 0) {
    alert('No selected tickets have valid AI recommendations. Please get recommendations first.');
    return;
  }

  if (ticketsWithoutRecommendations.length > 0) {
    debugLog('[MAIN] - Some tickets skipped (no recommendations):', ticketsWithoutRecommendations);
  }

  debugLog('[MAIN] - Implementing assignments for', assignments.length, 'tickets');
  debugLog('[MAIN] - Assignments:', assignments);

  // Disable the implement button during processing
  const implementBtn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
  if (implementBtn) {
    implementBtn.disabled = true;
    implementBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Assigning...';
  }

  // ── Hard stop guard ──────────────────────────────────────────────────────
  // When DEBUG_HARD_STOP_ASSIGNMENT is true, skip the actual API call and
  // render a mock result instead.  All client-side logic (selection, building
  // the assignments array) still runs so the UI can be tested end-to-end.
  if (DEBUG_HARD_STOP_ASSIGNMENT) {
    debugLog('[MAIN] - DEBUG_HARD_STOP_ASSIGNMENT is ON — skipping actual assignment API call');
    debugLog('[MAIN] - Would have assigned:', assignments);

    TicketRenderer.renderAssignmentResults({
      results: assignments.map(a => ({
        ticket_id: a.ticket_id,
        success: true,
        support_group: a.support_group || 'N/A',
        message: '[DEBUG] Hard stop active — no actual assignment made'
      }))
    });

    if (implementBtn) {
      implementBtn.disabled = false;
      assignmentUIManager.refreshImplementButtonLabel();
    }
    return;
  }
  // ── End hard stop guard ──────────────────────────────────────────────────

  try {
    const response = await fetch('/api/implement-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: assignments })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    debugLog('[MAIN] - Assignment implementation result:', result);

    // Display results
    TicketRenderer.renderAssignmentResults(result);

  } catch (error) {
    debugLog('[MAIN] - Error implementing assignments:', error);
    TicketRenderer.renderError('Error implementing assignments: ' + error.message);
  } finally {
    if (implementBtn) {
      implementBtn.disabled = false;
      assignmentUIManager.refreshImplementButtonLabel();
    }
  }
}

// ─── Presence heartbeat ───────────────────────────────────────────────────────

/**
 * Start the presence heartbeat.
 *
 * If the user has not yet entered a display name (stored in localStorage),
 * a modal prompt is shown first. The actual heartbeat is only started after
 * the user confirms their name (or if a name is already stored).
 *
 * Session identity is persisted in localStorage so that multiple tabs on the
 * same browser/machine share the same session ID and appear as a single
 * presence circle to other users.
 */
function startPresenceHeartbeat() {
  // Resolve display name from localStorage
  const storedName = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_DISPLAY_NAME);

  if (!storedName) {
    // No name stored yet — show the prompt modal.
    // The modal's "Continue" callback will call _startPresenceHeartbeatCore().
    showNamePromptModal(
      (name) => {
        myDisplayName = name;
        _startPresenceHeartbeatCore();
      },
      () => {
        // User clicked "Go back" — revert to single-ticket mode
        if (assignmentUIManager) {
          assignmentUIManager.setMode(CONSTANTS.MODES.SINGLE_TICKET);
        }
        stopPresenceHeartbeat();
      }
    );
    return;
  }

  myDisplayName = storedName;
  _startPresenceHeartbeatCore();
}

/**
 * Internal: initialise session identity and start the heartbeat interval.
 * Called after the display name is confirmed to be available.
 * @private
 */
function _startPresenceHeartbeatCore() {
  // Initialise session identity — stored in localStorage so all tabs on the
  // same browser/machine share the same session ID (prevents duplicate circles).
  if (!mySessionId) {
    mySessionId = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID);
    if (!mySessionId) {
      mySessionId = generateSessionId();
      localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID, mySessionId);
    }
    // Color is now assigned server-side to prevent duplicates.
    // We cache the server-assigned color in localStorage after the first heartbeat.
    myPresenceColor = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_COLOR) || null;
  }

  stopPresenceHeartbeat();

  // Immediate heartbeat so the icon appears without waiting for the first interval
  sendPresenceHeartbeat();

  presenceHeartbeatInterval = setInterval(
    sendPresenceHeartbeat,
    CONSTANTS.DEFAULTS.PRESENCE_HEARTBEAT_INTERVAL
  );

  window.addEventListener('beforeunload', sendPresenceLeave);

  // Send an immediate heartbeat when the tab becomes visible again after being
  // hidden (e.g. user switches back to this tab). This recovers quickly from
  // browser timer throttling that may have delayed the regular interval while
  // the tab was in the background.
  document.addEventListener('visibilitychange', _onVisibilityChange);

  debugLog('[MAIN] - Presence heartbeat started, session:', mySessionId, 'name:', myDisplayName);
}

/**
 * Show a Bootstrap modal asking the user to enter their display name.
 * The name is saved to localStorage so the prompt only appears once per device.
 *
 * @param {Function} onConfirm - Called with the entered name when user clicks "Continue"
 * @param {Function} onCancel  - Called when user clicks "Go back"
 */
function showNamePromptModal(onConfirm, onCancel) {
  // Remove any existing instance
  const existingModal = document.getElementById('presenceNameModal');
  if (existingModal) existingModal.remove();

  const modalEl = document.createElement('div');
  modalEl.id = 'presenceNameModal';
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.setAttribute('aria-labelledby', 'presenceNameModalLabel');
  modalEl.setAttribute('aria-modal', 'true');
  modalEl.setAttribute('role', 'dialog');
  // Prevent dismissal by clicking the backdrop or pressing Escape
  modalEl.setAttribute('data-bs-backdrop', 'static');
  modalEl.setAttribute('data-bs-keyboard', 'false');

  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="presenceNameModalLabel">
            <i class="bi bi-person-badge me-2"></i>Identify yourself
          </h5>
        </div>
        <div class="modal-body">
          <p class="mb-3">
            To use the multiple-ticket view, please enter your name. This helps
            your colleagues see who is currently working in the queue.
            Your name will be saved on this device so you won't be asked again.
          </p>
          <p class="text-muted small mb-3">
            To change your name later, clear your browser's local storage for this site.
          </p>
          <input
            type="text"
            id="presenceNameInput"
            class="form-control"
            placeholder="Your name (e.g. Jane Smith)"
            maxlength="60"
            autocomplete="name"
          />
        </div>
        <div class="modal-footer">
          <button type="button" id="presenceNameGoBack" class="btn btn-secondary">
            Go back
          </button>
          <button type="button" id="presenceNameContinue" class="btn btn-primary" disabled>
            Continue
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  const bsModal = new bootstrap.Modal(modalEl);

  const nameInput = modalEl.querySelector('#presenceNameInput');
  const continueBtn = modalEl.querySelector('#presenceNameContinue');
  const goBackBtn = modalEl.querySelector('#presenceNameGoBack');

  // Enable Continue only when at least 1 non-whitespace character is typed
  nameInput.addEventListener('input', () => {
    continueBtn.disabled = nameInput.value.trim().length === 0;
  });

  // Allow Enter key to submit when Continue is enabled
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !continueBtn.disabled) {
      continueBtn.click();
    }
  });

  continueBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_DISPLAY_NAME, name);
    bsModal.hide();
    modalEl.addEventListener('hidden.bs.modal', () => {
      modalEl.remove();
      if (onConfirm) onConfirm(name);
    }, { once: true });
  });

  goBackBtn.addEventListener('click', () => {
    bsModal.hide();
    modalEl.addEventListener('hidden.bs.modal', () => {
      modalEl.remove();
      if (onCancel) onCancel();
    }, { once: true });
  });

  bsModal.show();

  // Autofocus the input after the modal animation completes
  modalEl.addEventListener('shown.bs.modal', () => {
    nameInput.focus();
  }, { once: true });
}

/**
 * Stop the presence heartbeat and notify the server that this viewer has left.
 * Also clears the presence indicator circles from the DOM so they don't
 * persist on other pages (e.g. Search, Single Ticket).
 */
function stopPresenceHeartbeat() {
  if (presenceHeartbeatInterval !== null) {
    clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = null;
  }
  sendPresenceLeave();
  window.removeEventListener('beforeunload', sendPresenceLeave);
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  // Clear presence indicator circles from the DOM so they don't remain
  // visible after navigating away from the validation manager.
  if (assignmentUIManager) {
    assignmentUIManager.clearPresenceIndicators();
  }
  debugLog('[MAIN] - Presence heartbeat stopped');
}

/**
 * Visibility change handler: send an immediate heartbeat whenever the tab
 * becomes visible. This compensates for browser timer throttling that can
 * delay the regular setInterval while the tab is in the background.
 */
function _onVisibilityChange() {
  if (document.visibilityState === 'visible' && mySessionId) {
    debugLog('[MAIN] - Tab became visible, sending immediate presence heartbeat');
    sendPresenceHeartbeat();
  }
}

/**
 * POST a heartbeat to the server and update the presence indicators with the
 * returned list of active sessions.
 */
async function sendPresenceHeartbeat() {
  if (!mySessionId) return;

  try {
    const response = await fetch(CONSTANTS.API.PRESENCE_HEARTBEAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: mySessionId,
        display_name: myDisplayName || null
        // Note: color is no longer sent by the client — it is assigned server-side
        // to guarantee uniqueness across all active sessions.
      })
    });

    if (response.ok) {
      const data = await response.json();

      // On the first successful heartbeat, read back the server-assigned color
      // for our own session and cache it in localStorage for stable display.
      if (!myPresenceColor && data.sessions) {
        const mySession = data.sessions.find(s => s.session_id === mySessionId);
        if (mySession && mySession.color) {
          myPresenceColor = mySession.color;
          localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_COLOR, myPresenceColor);
          debugLog('[MAIN] - Server assigned presence color:', myPresenceColor);
        }
      }

      handlePresenceUpdate(data.sessions);
    }
  } catch (error) {
    debugLog('[MAIN] - Presence heartbeat error:', error);
  }
}

/**
 * Notify the server that this viewer is leaving.
 * Uses sendBeacon for reliability during page unload.
 */
function sendPresenceLeave() {
  if (!mySessionId) return;

  const payload = JSON.stringify({ session_id: mySessionId });
  try {
    navigator.sendBeacon(
      CONSTANTS.API.PRESENCE_LEAVE,
      new Blob([payload], { type: 'application/json' })
    );
  } catch (e) {
    // sendBeacon may not be available in all environments; fail silently
  }
}

/**
 * Update the presence indicator UI with the latest session list.
 * When DEBUG_PRESENCE_MOCK is true, the real session list is replaced with
 * 16 synthetic sessions so the overflow badge can be tested visually.
 * @param {Array} sessions - Array of { session_id, color, label } objects
 */
function handlePresenceUpdate(sessions) {
  if (!assignmentUIManager) return;

  let displaySessions = sessions;

  if (DEBUG_PRESENCE_MOCK) {
    const mockColors = [
      '#0d6efd','#198754','#fd7e14','#6f42c1','#0dcaf0','#dc3545','#6610f2','#d63384',
      '#20c997','#ffc107','#0d9488','#7c3aed','#db2777','#ea580c','#16a34a','#2563eb'
    ];
    const mockNames = [
      'Alice Johnson','Bob Smith','Carol White','David Brown','Eve Davis',
      'Frank Miller','Grace Wilson','Henry Moore','Iris Taylor','Jack Anderson',
      'Karen Thomas','Liam Jackson','Mia Harris','Noah Martin','Olivia Lee','Paul Walker'
    ];
    displaySessions = mockNames.map((name, i) => ({
      session_id: `mock-session-${i}`,
      color: mockColors[i % mockColors.length],
      label: name
    }));
    // Keep the real session at index 0 so "(you)" still appears correctly
    if (mySessionId) {
      displaySessions[0] = {
        session_id: mySessionId,
        color: myPresenceColor || mockColors[0],
        label: myDisplayName || 'You'
      };
    }
    debugLog('[MAIN] - DEBUG_PRESENCE_MOCK active: injecting', displaySessions.length, 'mock sessions');
  }

  // Update the presence count in the assignment UI manager for consensus checks
  assignmentUIManager.setPresenceCount(displaySessions.length);

  assignmentUIManager.renderPresenceIndicators(displaySessions, mySessionId);
}

// ─── End presence heartbeat ───────────────────────────────────────────────────

// ─── Consensus-based implement button ─────────────────────────────────────────

/**
 * Check whether the consensus threshold has been crossed and activate or
 * deactivate consensus mode accordingly.
 *
 * Called from the ticketSelectionChanged event listener whenever the user
 * checks or unchecks a ticket checkbox.
 *
 * @param {number} selectedCount - Number of currently checked ticket checkboxes
 */
function handleConsensusThresholdCheck(selectedCount) {
  if (!assignmentUIManager || !mySessionId) return;

  const shouldRequire = assignmentUIManager.shouldRequireConsensus(selectedCount);

  if (shouldRequire && !assignmentUIManager.isConsensusActive()) {
    // Threshold crossed upward — activate consensus on the server
    activateConsensus();
  } else if (!shouldRequire && assignmentUIManager.isConsensusActive()) {
    // Threshold crossed downward — deactivate consensus
    deactivateConsensus();
  }
}

/**
 * POST to /api/consensus/activate to enter consensus mode.
 */
async function activateConsensus() {
  if (!mySessionId) return;
  try {
    const response = await fetch(CONSTANTS.API.CONSENSUS_ACTIVATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: mySessionId })
    });
    if (response.ok) {
      const state = await response.json();
      applyConsensusState(state);
    }
  } catch (error) {
    debugLog('[MAIN] - Error activating consensus:', error);
  }
}

/**
 * POST to /api/consensus/deactivate to leave consensus mode.
 */
async function deactivateConsensus() {
  if (!mySessionId) return;
  try {
    const response = await fetch(CONSTANTS.API.CONSENSUS_DEACTIVATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: mySessionId })
    });
    if (response.ok) {
      const state = await response.json();
      applyConsensusState(state);
    }
  } catch (error) {
    debugLog('[MAIN] - Error deactivating consensus:', error);
  }
}

/**
 * POST to /api/consensus/vote to record or remove the current user's vote.
 * @param {boolean} agree - true to agree, false to retract
 */
async function sendConsensusVote(agree) {
  if (!mySessionId) return;
  try {
    const response = await fetch(CONSTANTS.API.CONSENSUS_VOTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: mySessionId, agree })
    });
    if (response.ok) {
      const state = await response.json();
      applyConsensusState(state);
    }
  } catch (error) {
    debugLog('[MAIN] - Error sending consensus vote:', error);
  }
}

/**
 * Apply a consensus state object received from the server (either from an
 * API response or from an SSE broadcast event).
 *
 * @param {Object} state - { active, agreed, required, unlocked }
 */
function applyConsensusState(state) {
  if (!assignmentUIManager) return;

  const agreed = (state.agreed || []).length;
  const required = state.required || 0;
  const agreedList = state.agreed || [];

  if (state.active) {
    if (!assignmentUIManager.isConsensusActive()) {
      // Entering consensus mode
      assignmentUIManager.enterConsensusMode(agreed, required, agreedList, mySessionId);
    } else {
      // Already in consensus mode — update progress
      assignmentUIManager.updateConsensusProgress(agreed, required, agreedList, mySessionId);
    }

    // Check if consensus has been achieved
    if (state.unlocked && !assignmentUIManager.isConsensusUnlocked()) {
      assignmentUIManager.unlockFromConsensus();
    }
  } else {
    // Consensus is not active — exit if we were in it
    if (assignmentUIManager.isConsensusActive()) {
      assignmentUIManager.exitConsensusMode();
      // Restore the implement button to its normal state
      assignmentUIManager.refreshImplementButtonLabel();
    }
  }

  debugLog('[MAIN] - Consensus state applied:', state);
}

// ─── End consensus-based implement button ─────────────────────────────────────

// ─── Validation queue real-time polling ──────────────────────────────────────

/**
 * Start the background polling loop that checks for queue changes every
 * VALIDATION_POLL_INTERVAL milliseconds.
 *
 * The first poll is aligned to the Unix-epoch boundary so that all connected
 * clients fire at the same wall-clock second, regardless of when they joined.
 * Subsequent polls use a regular setInterval anchored to that aligned tick.
 *
 * Safe to call multiple times — clears any existing timers first.
 */
function startValidationPolling() {
  stopValidationPolling();

  const interval = CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL;

  // Calculate milliseconds until the next epoch-aligned tick.
  // All clients with a reasonably synchronised clock compute the same value.
  const msUntilNextTick = interval - (Date.now() % interval);
  const secondsUntilNextTick = Math.max(1, Math.round(msUntilNextTick / 1000));

  debugLog(
    '[MAIN] - Starting validation polling (interval:', interval, 'ms,' ,
    'first tick in:', msUntilNextTick, 'ms)'
  );

  // Start the countdown from the aligned offset so all clients show the same number
  startCountdownTimer(secondsUntilNextTick);

  // Broadcast the authoritative next-poll timestamp to all connected clients
  // so their countdown displays are synchronised regardless of clock skew.
  const nextPollAt = Date.now() + msUntilNextTick;
  syncPollTimer(nextPollAt);

  // Fire the first poll at the aligned tick, then switch to a regular interval
  validationAlignmentTimeout = setTimeout(() => {
    validationAlignmentTimeout = null;
    handleValidationPoll();
    // From here every subsequent poll is at exact multiples of `interval`
    validationPollingInterval = setInterval(handleValidationPoll, interval);
  }, msUntilNextTick);
}

/**
 * Stop the background polling loop and the countdown timer.
 */
function stopValidationPolling() {
  if (validationAlignmentTimeout !== null) {
    clearTimeout(validationAlignmentTimeout);
    validationAlignmentTimeout = null;
  }
  if (validationPollingInterval !== null) {
    clearInterval(validationPollingInterval);
    validationPollingInterval = null;
    debugLog('[MAIN] - Stopped validation ticket polling');
  }
  stopCountdownTimer();
}

/**
 * Start (or restart) the 1-second countdown timer.
 * @param {number} [initialSeconds] - Starting value in seconds.  Defaults to
 *   the full poll interval so callers that don't need alignment can omit it.
 */
function startCountdownTimer(initialSeconds) {
  stopCountdownTimer();
  const totalSeconds = (initialSeconds !== undefined)
    ? initialSeconds
    : Math.round(CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL / 1000);

  validationCountdownSeconds = totalSeconds;
  TicketRenderer.updateCountdownDisplay(validationCountdownSeconds);

  validationCountdownInterval = setInterval(() => {
    validationCountdownSeconds = Math.max(0, validationCountdownSeconds - 1);
    TicketRenderer.updateCountdownDisplay(validationCountdownSeconds);
  }, 1000);
}

/**
 * Stop the countdown timer and clear the display.
 */
function stopCountdownTimer() {
  if (validationCountdownInterval !== null) {
    clearInterval(validationCountdownInterval);
    validationCountdownInterval = null;
  }
  TicketRenderer.updateCountdownDisplay(null);
}

/**
 * One polling cycle:
 *  1. Collect the IDs currently shown in the accordion.
 *  2. Ask the server which have left the queue and which are new.
 *  3. Dim items that have left; add skeleton items for new ones and fetch their data.
 *  4. Update the "Last checked" timestamp.
 */
async function handleValidationPoll() {
  debugLog('[MAIN] - Running validation ticket poll');

  // Clean up state left by the previous poll cycle before fetching fresh data:
  // • Remove items that were already dimmed as "left queue" last cycle
  // • Strip "New" badges from tickets that were added last cycle
  TicketRenderer.removeLeftQueueTickets();
  TicketRenderer.clearNewTicketBadges();

  const displayedIds = TicketRenderer.getDisplayedTicketIds();
  if (displayedIds.size === 0) {
    debugLog('[MAIN] - No tickets displayed, skipping poll');
    return;
  }

  const idsParam = Array.from(displayedIds).join(',');

  try {
    const response = await fetch(
      `${CONSTANTS.API.CHECK_VALIDATION_TICKETS}?ids=${encodeURIComponent(idsParam)}`
    );

    if (!response.ok) {
      debugLog('[MAIN] - Poll request failed with status:', response.status);
      return;
    }

    const data = await response.json();
    debugLog('[MAIN] - Poll result — left:', data.left_queue?.length ?? 0,
             'new:', data.new_in_queue?.length ?? 0);

    // Dim tickets that have left the Validation queue
    if (data.left_queue && data.left_queue.length > 0) {
      TicketRenderer.markTicketsLeftQueue(data.left_queue);
    }

    // Add skeleton items for newly-arrived tickets and fetch their full data
    if (data.new_in_queue && data.new_in_queue.length > 0) {
      for (const ticketId of data.new_in_queue) {
        const pendingIndex = nextPendingTicketIndex++;
        TicketRenderer.addPendingTicket(ticketId, pendingIndex);
        fetchAndHydrateTicket(ticketId, pendingIndex);
      }
    }

    // Update the "Last checked" timestamp.
    // The countdown resets automatically on the next epoch-aligned tick
    // (startValidationPolling re-aligns after each poll fires via setInterval).
    TicketRenderer.updateLastCheckedTime(new Date());
    // Re-align the countdown for the next interval so all clients stay in sync
    const nextPollAt = Date.now() + CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL;
    startCountdownTimer(Math.round(CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL / 1000));
    syncPollTimer(nextPollAt);

  } catch (error) {
    debugLog('[MAIN] - Poll error:', error);
  }
}

/**
 * Fetch full ticket data for a single ID and replace its skeleton item.
 * @param {string} ticketId
 * @param {number} pendingIndex
 */
async function fetchAndHydrateTicket(ticketId, pendingIndex) {
  try {
    const response = await fetch(
      `${CONSTANTS.API.GET_SINGLE_VALIDATION_TICKET}?id=${encodeURIComponent(ticketId)}`
    );

    if (!response.ok) {
      debugLog('[MAIN] - Failed to fetch ticket data for', ticketId, '— status:', response.status);
      return;
    }

    const ticketData = await response.json();
    TicketRenderer.hydrateTicket(ticketId, ticketData, pendingIndex);

  } catch (error) {
    debugLog('[MAIN] - Error hydrating ticket', ticketId, ':', error);
  }
}

// ─── End validation queue real-time polling ───────────────────────────────────

// ─── Validation broadcast listener ───────────────────────────────────────────

/**
 * Open (or reuse) the long-lived SSE connection to /api/validation-broadcast.
 *
 * This connection is the single channel through which all validation ticket
 * events arrive for this client — whether triggered by this user or by any
 * other user on a different machine.
 *
 * Event handling mirrors the old per-client stream handler:
 *   state   → update UI to reflect server-side loading/idle/loaded state
 *   count   → initialise the streaming container with the expected count
 *   ticket  → append the ticket to the accordion
 *   complete→ mark loading done, enable "Get recommendations", start polling
 *   error   → log per-ticket errors or show a fatal error message
 */
function startValidationBroadcastListener() {
  // Already connected — nothing to do
  if (validationBroadcastSource &&
      validationBroadcastSource.readyState !== EventSource.CLOSED) {
    debugLog('[MAIN] - Broadcast listener already open');
    return;
  }

  // Ensure we have a session ID before connecting (needed as the queue key)
  if (!mySessionId) {
    mySessionId = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID);
    if (!mySessionId) {
      mySessionId = generateSessionId();
      localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_SESSION_ID, mySessionId);
    }
  }

  const url = `${CONSTANTS.API.VALIDATION_BROADCAST}?session_id=${encodeURIComponent(mySessionId)}`;
  debugLog('[MAIN] - Opening validation broadcast listener:', url);

  validationBroadcastSource = new EventSource(url);

  let totalCount = 0;
  let loadedCount = 0;

  // ── Watchdog timer ─────────────────────────────────────────────────────────
  // If no 'ticket' or 'complete' event arrives within WATCHDOG_MS milliseconds
  // after loading starts, the connection is considered stuck.  We close it and
  // reopen it so that the server's mid-load buffer is replayed from the point
  // we left off.  The deduplication guard in appendValidationTicket() ensures
  // tickets already in the accordion are not added a second time.
  const WATCHDOG_MS = 30_000;   // 30 s — reconnect quickly if events stop arriving
  let watchdogTimer = null;
  // Timer that fires if all expected tickets have arrived but 'complete' has not.
  // Guards against the 'complete' event being lost (e.g. due to a reconnect race).
  let completionFallbackTimer = null;

  function _resetWatchdog() {
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function _startWatchdog() {
    _resetWatchdog();
    watchdogTimer = setTimeout(() => {
      debugLog('[MAIN] - Watchdog fired: no ticket/complete event for', WATCHDOG_MS, 'ms — reconnecting');
      // Close the stale connection and reopen it.  The server will replay the
      // mid-load buffer so we catch up on any tickets we missed.
      if (validationBroadcastSource) {
        validationBroadcastSource.close();
        validationBroadcastSource = null;
      }
      startValidationBroadcastListener();
    }, WATCHDOG_MS);
  }
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Schedule a fallback completion if 'complete' doesn't arrive within 5 s of
   * all expected tickets being received.  This handles the case where the
   * 'complete' SSE event is lost due to a network drop or a server-side race
   * condition on reconnect.
   *
   * Safe to call multiple times — only one timer is ever pending at a time.
   * The timer is cancelled automatically when 'complete' arrives normally.
   */
  function _scheduleCompletionFallback() {
    if (completionFallbackTimer !== null) return;  // already scheduled
    completionFallbackTimer = setTimeout(() => {
      completionFallbackTimer = null;
      if (assignmentUIManager.getWorkflowState() === 'tickets-loading') {
        debugLog('[MAIN] - Completion fallback: forcing tickets-loaded (complete event was lost)');
        _resetWatchdog();
        try {
          TicketRenderer.updateStreamingProgress(loadedCount, totalCount, true);
        } catch (e) {
          debugLog('[MAIN] - Error in updateStreamingProgress during fallback:', e);
        }
        assignmentUIManager.setWorkflowState('tickets-loaded', { totalTickets: loadedCount });
        startValidationPolling();
      }
    }, 5000);
  }

  // ── state ──────────────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('state', (event) => {
    const data = JSON.parse(event.data);
    debugLog('[MAIN] - Broadcast state:', data.state);

    if (data.state === 'loading') {
      // Another user triggered a load while we were already connected,
      // OR this client reconnected while the server was mid-load.
      assignmentUIManager.setWorkflowState('tickets-loading');
      // Guard: only wipe the DOM if the accordion doesn't already exist.
      // On a watchdog-triggered reconnect the accordion may already contain
      // partially-loaded tickets; destroying it would cause the stuck-loading
      // loop where the same tickets are fetched and wiped repeatedly.
      const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
      if (!accordion) {
        TicketRenderer.renderValidationTicketsStreamingInit();
      }
      loadedCount = 0;
      totalCount = 0;
      // Cancel any completion fallback from a previous load cycle
      if (completionFallbackTimer !== null) {
        clearTimeout(completionFallbackTimer);
        completionFallbackTimer = null;
      }
      // Start watchdog — we expect ticket events to follow shortly
      _startWatchdog();
    }
    // 'idle' and 'loaded' are informational on connect; 'loaded' is followed
    // immediately by count/ticket/complete events from the cache replay.
  });

  // ── count ──────────────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('count', (event) => {
    const data = JSON.parse(event.data);
    totalCount = data.count;
    debugLog('[MAIN] - Broadcast count:', totalCount);

    if (totalCount === 0) {
      _resetWatchdog();
      TicketRenderer.renderError('No validation tickets found.');
      assignmentUIManager.setWorkflowState('idle');
    } else {
      // Initialise the streaming container if not already done
      // (may already be initialised if handleGetValidationTicketsStream ran first)
      const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
      if (!accordion) {
        TicketRenderer.renderValidationTicketsStreamingInit();
      }
      TicketRenderer.updateStreamingProgress(0, totalCount, false);
      // Start (or reset) the watchdog now that we know tickets are expected
      _startWatchdog();
    }
  });

  // ── ticket ─────────────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('ticket', (event) => {
    const ticket = JSON.parse(event.data);
    debugLog('[MAIN] - Broadcast ticket:', ticket.id);

    TicketRenderer.appendValidationTicket(ticket, ticket.index);
    loadedCount++;
    TicketRenderer.updateStreamingProgress(loadedCount, totalCount, false);
    // Each arriving ticket resets the watchdog deadline
    _startWatchdog();
    // If all expected tickets have arrived, schedule a fallback in case the
    // 'complete' event is lost (e.g. due to a server-side reconnect race).
    if (totalCount > 0 && loadedCount >= totalCount) {
      _scheduleCompletionFallback();
    }
  });

  // ── complete ───────────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    debugLog('[MAIN] - Broadcast complete:', data);

    // Loading finished — watchdog and completion fallback are no longer needed
    _resetWatchdog();
    if (completionFallbackTimer !== null) {
      clearTimeout(completionFallbackTimer);
      completionFallbackTimer = null;
    }

    try {
      TicketRenderer.updateStreamingProgress(loadedCount, totalCount, true);
    } catch (e) {
      debugLog('[MAIN] - Error in updateStreamingProgress during complete:', e);
    }
    assignmentUIManager.setWorkflowState('tickets-loaded', { totalTickets: loadedCount });

    // Start background polling so the list stays in sync with the live queue
    startValidationPolling();
  });

  // ── error ──────────────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('error', (event) => {
    try {
      const errorData = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast error event:', errorData);

      if (errorData.ticket_id) {
        // Per-ticket error — a ticket failed but loading continues; reset watchdog
        console.warn(`[BROADCAST] Error loading ticket ${errorData.ticket_id}: ${errorData.message}`);
        loadedCount++;
        _startWatchdog();
      } else {
        // Fatal server-side error
        _resetWatchdog();
        TicketRenderer.renderError('Error loading validation tickets: ' + errorData.message);
        assignmentUIManager.setWorkflowState('idle');
      }
    } catch (e) {
      // Unparseable error data — ignore
    }
  });

  // ── consensus-state ────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('consensus-state', (event) => {
    try {
      const state = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast consensus-state:', state);
      applyConsensusState(state);
    } catch (e) {
      debugLog('[MAIN] - Error parsing consensus-state event:', e);
    }
  });

  // ── checkbox-sync ──────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('checkbox-sync', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast checkbox-sync:', data);
      _applySyncedCheckboxState(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing checkbox-sync event:', e);
    }
  });

  // ── assignment-selection-sync ──────────────────────────────────────────────
  validationBroadcastSource.addEventListener('assignment-selection-sync', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast assignment-selection-sync:', data);
      _applySyncedAssignmentSelection(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing assignment-selection-sync event:', e);
    }
  });

  // ── poll-timer-sync ────────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('poll-timer-sync', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast poll-timer-sync:', data);
      _applySyncedPollTimer(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing poll-timer-sync event:', e);
    }
  });

  // ── implement-started ──────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('implement-started', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast implement-started:', data);
      _applySyncedImplementStarted(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing implement-started event:', e);
    }
  });

  // ── implement-complete ─────────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('implement-complete', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast implement-complete:', data);
      _applySyncedImplementComplete(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing implement-complete event:', e);
    }
  });

  // ── recommendation-toggle ──────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('recommendation-toggle', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast recommendation-toggle:', data);
      _applySyncedRecommendationToggle(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing recommendation-toggle event:', e);
    }
  });

  // ── recommendation-start ───────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('recommendation-start', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast recommendation-start:', data);
      // Show per-ticket progress indicator (e.g. "Processing ticket 3 of 20 (IR10256351)...")
      if (assignmentUIManager && data.ticket_id) {
        // Use the current completed count + 1 as the "current" position
        // The total is provided by recommendation-progress events
        // NOTE: Use the child combinator (>) to count only top-level accordion items.
        // Each ticket creates 3 elements with [data-ticket-id] (accordion-item, checkbox,
        // recommendations container), so a bare [data-ticket-id] selector would return 3×
        // the real ticket count.
        const ticketItems = document.querySelectorAll(`#${CONSTANTS.SELECTORS.VALIDATION_ACCORDION} > .accordion-item[data-ticket-id]`);
        const total = ticketItems.length;
        // Count how many recommendations have already been rendered by checking
        // which recommendation containers have been made visible (display: block).
        // _renderBatchRecommendations() sets container.style.display = 'block' after
        // rendering.  The previous selector counted .card AND .support-group-selector
        // inside each container, yielding 2× the real count for normal tickets.
        const completedSoFar = document.querySelectorAll('.recommendations-container[style*="display: block"]').length;
        assignmentUIManager.showRecommendationProgress(completedSoFar + 1, total, data.ticket_id);
      }
    } catch (e) {
      debugLog('[MAIN] - Error parsing recommendation-start event:', e);
    }
  });

  // ── recommendation-complete ────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('recommendation-complete', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast recommendation-complete:', data);
      _applySyncedRecommendationComplete(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing recommendation-complete event:', e);
    }
  });

  // ── recommendation-error ───────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('recommendation-error', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast recommendation-error:', data);
      // Render error card for the specific ticket
      const ticketItem = document.querySelector(`[data-ticket-id="${data.ticket_id}"]`);
      if (ticketItem) {
        const index = ticketItem.dataset.ticketIndex;
        TicketRenderer.renderRecommendations({ error: data.error }, true, parseInt(index));
      }
    } catch (e) {
      debugLog('[MAIN] - Error parsing recommendation-error event:', e);
    }
  });

  // ── recommendation-progress ────────────────────────────────────────────────
  validationBroadcastSource.addEventListener('recommendation-progress', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast recommendation-progress:', data);
      if (assignmentUIManager) {
        assignmentUIManager.updateRecommendationProgress(data.completed, data.total);

        // When all recommendations are complete, show the completion message
        // and resume polling
        if (data.completed > 0 && data.completed >= data.total) {
          assignmentUIManager.showRecommendationComplete(data.total);
          startValidationPolling();
          debugLog('[MAIN] - All server-side recommendations complete');
        }
      }
    } catch (e) {
      debugLog('[MAIN] - Error parsing recommendation-progress event:', e);
    }
  });

  // ── sync-state-burst (initial state for late-joining clients) ──────────────
  validationBroadcastSource.addEventListener('sync-state-burst', (event) => {
    try {
      const data = JSON.parse(event.data);
      debugLog('[MAIN] - Broadcast sync-state-burst:', data);
      _applySyncStateBurst(data);
    } catch (e) {
      debugLog('[MAIN] - Error parsing sync-state-burst event:', e);
    }
  });

  // ── connection error (EventSource.onerror) ─────────────────────────────────
  validationBroadcastSource.onerror = (err) => {
    // EventSource will auto-reconnect; only log, don't show UI error
    debugLog('[MAIN] - Broadcast connection error (will auto-reconnect):', err);
  };

  debugLog('[MAIN] - Validation broadcast listener started');
}

/**
 * Close the validation broadcast SSE connection.
 * Called when the user leaves Multiple Tickets mode or the assignment section.
 */
function stopValidationBroadcastListener() {
  if (validationBroadcastSource) {
    validationBroadcastSource.close();
    validationBroadcastSource = null;
    debugLog('[MAIN] - Validation broadcast listener stopped');
  }
}

// ─── End validation broadcast listener ───────────────────────────────────────

// ─── Cross-client state synchronisation handlers ─────────────────────────────

/**
 * Guard flag: set to true while applying a synced checkbox state from the
 * server to prevent the local change listener from re-posting to the server
 * (infinite loop prevention).
 */
let _applyingSyncedCheckbox = false;

/**
 * Guard flag: set to true while applying a synced assignment selection from
 * the server to prevent the local change listener from re-posting.
 */
let _applyingSyncedAssignment = false;

/**
 * Apply a checkbox-sync event received via SSE.
 * Updates the DOM checkboxes without re-triggering a sync POST.
 * @param {Object} data - { ticket_id, checked } or { select_all, checked }
 */
function _applySyncedCheckboxState(data) {
  _applyingSyncedCheckbox = true;
  try {
    if (data.select_all !== undefined) {
      // Select All / Deselect All
      const selectAllCb = document.getElementById(CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX);
      if (selectAllCb) {
        selectAllCb.checked = data.checked;
        selectAllCb.indeterminate = false;
      }
      // Update all individual ticket checkboxes
      document.querySelectorAll('.ticket-checkbox:not([disabled])').forEach(cb => {
        cb.checked = data.checked;
      });
    } else if (data.ticket_id) {
      // Individual ticket checkbox
      const ticketItem = document.querySelector(`[data-ticket-id="${data.ticket_id}"]`);
      if (ticketItem) {
        const cb = ticketItem.querySelector('.ticket-checkbox');
        if (cb) cb.checked = data.checked;
      }
    }
    // Update the Select All checkbox state and fire ticketSelectionChanged
    if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectAllCheckboxState) {
      TicketRenderer._updateSelectAllCheckboxState();
    }
    if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectedCount) {
      TicketRenderer._updateSelectedCount();
    }
  } finally {
    _applyingSyncedCheckbox = false;
  }
}

/**
 * Apply an assignment-selection-sync event received via SSE.
 * Updates the DOM radio buttons / manual selector without re-triggering a sync POST.
 * @param {Object} data - { ticket_id, field, value }
 */
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
      // Select the matching radio button
      const radios = container.querySelectorAll(`input[name="sg-selector-batch-${index}"]`);
      radios.forEach(r => { r.checked = (r.value === value); });
      // Clear manual selection if a radio is being selected
      const manualInput = container.querySelector(`input[name="manual-sg-batch-${index}"]`);
      if (manualInput && manualInput.value) {
        manualInput.value = '';
        const searchInput = container.querySelector(`.manual-sg-search`);
        if (searchInput) {
          searchInput.value = '';
          searchInput.readOnly = false;
          searchInput.classList.remove('manual-sg-selected');
        }
        const clearBtn = container.querySelector(`.manual-sg-clear`);
        if (clearBtn) clearBtn.style.display = 'none';
        // Re-enable AI radios
        if (typeof TicketRenderer !== 'undefined' && TicketRenderer._setAiRadiosDisabled) {
          TicketRenderer._setAiRadiosDisabled(parseInt(index), false);
        }
        // Remove amber header
        const header = ticketItem.querySelector('.accordion-header');
        if (header) header.classList.remove('manual-sg-header');
      }
    } else if (field === 'manual_support_group') {
      const manualInput = container.querySelector(`input[name="manual-sg-batch-${index}"]`);
      const searchInput = container.querySelector(`.manual-sg-search`);
      if (value) {
        // Apply manual selection
        if (manualInput) manualInput.value = value;
        if (searchInput) {
          searchInput.value = value;
          searchInput.readOnly = true;
          searchInput.classList.add('manual-sg-selected');
        }
        const clearBtn = container.querySelector(`.manual-sg-clear`);
        if (clearBtn) clearBtn.style.display = '';
        // Disable AI radios
        if (typeof TicketRenderer !== 'undefined' && TicketRenderer._setAiRadiosDisabled) {
          TicketRenderer._setAiRadiosDisabled(parseInt(index), true);
        }
        // Add amber header
        const header = ticketItem.querySelector('.accordion-header');
        if (header) header.classList.add('manual-sg-header');
      } else {
        // Clear manual selection
        if (manualInput) manualInput.value = '';
        if (searchInput) {
          searchInput.value = '';
          searchInput.readOnly = false;
          searchInput.classList.remove('manual-sg-selected');
        }
        const clearBtn = container.querySelector(`.manual-sg-clear`);
        if (clearBtn) clearBtn.style.display = 'none';
        // Re-enable AI radios and select 1st choice
        if (typeof TicketRenderer !== 'undefined' && TicketRenderer._setAiRadiosDisabled) {
          TicketRenderer._setAiRadiosDisabled(parseInt(index), false);
        }
        const firstRadio = container.querySelector(`input[name="sg-selector-batch-${index}"]`);
        if (firstRadio) firstRadio.checked = true;
        // Remove amber header
        const header = ticketItem.querySelector('.accordion-header');
        if (header) header.classList.remove('manual-sg-header');
      }
    } else if (field === 'priority_radio') {
      const radios = container.querySelectorAll(`input[name="priority-selector-batch-${index}"]`);
      radios.forEach(r => { r.checked = (r.value === value); });
    }
  } finally {
    _applyingSyncedAssignment = false;
  }
}

/**
 * Apply a poll-timer-sync event received via SSE.
 * Resets the local countdown timer to match the server's next poll timestamp.
 * @param {Object} data - { next_poll_at: <epoch_ms> }
 */
function _applySyncedPollTimer(data) {
  if (!data.next_poll_at) return;
  const secondsRemaining = Math.max(0, Math.round((data.next_poll_at - Date.now()) / 1000));
  startCountdownTimer(secondsRemaining);
}

/**
 * Apply an implement-started event received via SSE.
 * Shows a spinner on the implement button for all clients.
 * @param {Object} data - { session_id, ticket_ids }
 */
function _applySyncedImplementStarted(data) {
  const implementBtn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
  if (implementBtn) {
    implementBtn.disabled = true;
    implementBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Assigning...';
  }
}

/**
 * Apply an implement-complete event received via SSE.
 * Shows the results table for all clients.
 * @param {Object} data - { results: { ... } }
 */
function _applySyncedImplementComplete(data) {
  if (data.results) {
    TicketRenderer.renderAssignmentResults(data.results);
  }
  const implementBtn = document.getElementById(CONSTANTS.SELECTORS.IMPLEMENT_ASSIGNMENT_BTN);
  if (implementBtn) {
    implementBtn.disabled = false;
    if (assignmentUIManager) assignmentUIManager.refreshImplementButtonLabel();
  }
}

/**
 * Apply a recommendation-toggle event received via SSE.
 * Updates the toggle button visual for all clients.
 * @param {Object} data - { active: bool }
 */
function _applySyncedRecommendationToggle(data) {
  if (!assignmentUIManager) return;
  if (data.active) {
    assignmentUIManager.setRecommendationToggleState(true);
    assignmentUIManager.setWorkflowState('recommendations-loading');
    stopValidationPolling();
    TicketRenderer.showPollingPausedMessage();
  } else {
    assignmentUIManager.setRecommendationToggleState(false);
    assignmentUIManager.hideRecommendationProgress();
    // Check if any recommendations exist
    const hasAnyRecommendation = document.querySelector(
      '[id^="recommendations-"] .card, [id^="recommendations-"] .support-group-selector'
    );
    if (hasAnyRecommendation) {
      assignmentUIManager.enableImplementButton();
      assignmentUIManager.workflowState = 'recommendations-complete';
    } else {
      assignmentUIManager.setWorkflowState('tickets-loaded');
    }
    startValidationPolling();
  }
}

/**
 * Apply a recommendation-complete event received via SSE.
 * Renders the recommendation for the specific ticket.
 * @param {Object} data - { ticket_id, data: { ...recommendation } }
 */
function _applySyncedRecommendationComplete(data) {
  const ticketItem = document.querySelector(`[data-ticket-id="${data.ticket_id}"]`);
  if (!ticketItem) return;
  const index = parseInt(ticketItem.dataset.ticketIndex);

  // Render the recommendation
  TicketRenderer.renderRecommendations(data.data, true, index);
  TicketRenderer.storeRecommendationData(index, data.data);

  // Show checkboxes after first recommendation
  TicketRenderer.showTicketCheckboxes();
}

/**
 * Apply the full sync-state-burst received on SSE connect for late-joining clients.
 * Restores checkbox states, assignment selections, and poll timer.
 * @param {Object} data - { checkboxes, assignments, next_poll_at }
 */
function _applySyncStateBurst(data) {
  // Apply checkbox states
  if (data.checkboxes) {
    _applyingSyncedCheckbox = true;
    try {
      for (const [ticketId, checked] of Object.entries(data.checkboxes)) {
        const ticketItem = document.querySelector(`[data-ticket-id="${ticketId}"]`);
        if (ticketItem) {
          const cb = ticketItem.querySelector('.ticket-checkbox');
          if (cb) cb.checked = checked;
        }
      }
      if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectAllCheckboxState) {
        TicketRenderer._updateSelectAllCheckboxState();
      }
      if (typeof TicketRenderer !== 'undefined' && TicketRenderer._updateSelectedCount) {
        TicketRenderer._updateSelectedCount();
      }
    } finally {
      _applyingSyncedCheckbox = false;
    }
  }

  // Apply assignment selections
  if (data.assignments) {
    _applyingSyncedAssignment = true;
    try {
      for (const [ticketId, selections] of Object.entries(data.assignments)) {
        for (const [field, value] of Object.entries(selections)) {
          _applySyncedAssignmentSelection({ ticket_id: ticketId, field, value });
        }
      }
    } finally {
      _applyingSyncedAssignment = false;
    }
  }

  // Apply poll timer
  if (data.next_poll_at) {
    _applySyncedPollTimer(data);
  }
}

/**
 * POST a checkbox state change to the server for cross-client synchronisation.
 * Called from TicketRenderer when a checkbox is toggled by the local user.
 * @param {string} ticketId - The ticket ID, or null for select-all
 * @param {boolean} checked - Whether the checkbox is checked
 * @param {boolean} isSelectAll - Whether this is the Select All checkbox
 */
function syncCheckboxState(ticketId, checked, isSelectAll = false) {
  if (_applyingSyncedCheckbox) return; // Don't re-sync server-applied changes
  const body = isSelectAll
    ? { select_all: true, checked }
    : { ticket_id: ticketId, checked };
  fetch(CONSTANTS.API.SYNC_CHECKBOX, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(err => debugLog('[MAIN] - Error syncing checkbox:', err));
}

/**
 * POST an assignment selection change to the server for cross-client synchronisation.
 * Called from TicketRenderer when a radio button or manual selector changes.
 * @param {string} ticketId - The ticket ID
 * @param {string} field - 'support_group_radio' | 'manual_support_group' | 'priority_radio'
 * @param {string} value - The selected value
 */
function syncAssignmentSelection(ticketId, field, value) {
  if (_applyingSyncedAssignment) return; // Don't re-sync server-applied changes
  fetch(CONSTANTS.API.SYNC_ASSIGNMENT_SELECTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: ticketId, field, value })
  }).catch(err => debugLog('[MAIN] - Error syncing assignment selection:', err));
}

/**
 * POST the next poll timestamp to the server for cross-client timer synchronisation.
 * Called after each poll cycle completes.
 * @param {number} nextPollAtMs - Unix epoch milliseconds of the next poll
 */
function syncPollTimer(nextPollAtMs) {
  fetch(CONSTANTS.API.SYNC_POLL_TIMER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ next_poll_at: nextPollAtMs })
  }).catch(err => debugLog('[MAIN] - Error syncing poll timer:', err));
}

// ─── End cross-client state synchronisation handlers ─────────────────────────

console.log('Main script loaded and initialized.');
