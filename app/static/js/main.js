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
let validationCountdownInterval = null;
let validationCountdownSeconds = 0;
// Counter for unique indices assigned to newly-discovered (pending) tickets.
// Starting at 10000 keeps them well clear of the initial 0-based stream indices.
let nextPendingTicketIndex = 10000;
// ─────────────────────────────────────────────────────────────────────────────

// ─── Presence heartbeat state ─────────────────────────────────────────────────
let presenceHeartbeatInterval = null;
let mySessionId = null;
let myPresenceColor = null;
let myDisplayName = null;

/** Palette of 8 distinct colors for presence circles */
const PRESENCE_COLORS = [
  '#0d6efd', '#198754', '#fd7e14', '#6f42c1',
  '#0dcaf0', '#dc3545', '#6610f2', '#d63384'
];

/** Generate a UUID-v4-like random string */
function generateSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/** Pick a random color from the presence palette */
function getRandomPresenceColor() {
  return PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)];
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
      stopValidationPolling(); // Stop polling when leaving assignment/validation view
      stopPresenceHeartbeat(); // Stop presence when leaving assignment view
    },
    onSwitchToAssignment: () => {
      debugLog('[MAIN] - Switched to assignment mode callback');
      attachAssignmentEventListeners();
      // Presence is started only when the user switches to Multiple Tickets mode
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
      stopPresenceHeartbeat(); // Leave the validation/batch view → stop presence
    },
    () => {
      debugLog('[MAIN] - Multiple tickets mode selected');
      // Batch button listeners will be attached when batch buttons are created
      setTimeout(attachBatchButtonListeners, 0);
      // startPresenceHeartbeat handles the name-prompt gate internally
      startPresenceHeartbeat();
    }
  );

  // If in multiple mode, attach batch listeners immediately
  if (assignmentUIManager.getMode() === CONSTANTS.MODES.MULTIPLE_TICKETS) {
    attachBatchButtonListeners();
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
 * Handle get validation tickets button click with streaming (SSE)
 * Tickets are displayed one-by-one as they are fetched from the backend
 */
function handleGetValidationTicketsStream() {
  debugLog('[MAIN] - Get validation tickets (streaming) clicked');

  // Set workflow state to loading
  assignmentUIManager.setWorkflowState('tickets-loading');

  // Initialize the streaming container
  TicketRenderer.renderValidationTicketsStreamingInit();

  // Create EventSource for SSE
  const eventSource = new EventSource(CONSTANTS.API.GET_VALIDATION_TICKETS_STREAM);
  
  let totalCount = 0;
  let loadedCount = 0;
  let hasError = false;

  eventSource.addEventListener('count', (event) => {
    const data = JSON.parse(event.data);
    totalCount = data.count;
    debugLog('[MAIN] - Expected ticket count:', totalCount);
    
    if (totalCount === 0) {
      TicketRenderer.renderError('No validation tickets found.');
      assignmentUIManager.setWorkflowState('idle');
      eventSource.close();
    } else {
      // Update header with expected count
      TicketRenderer.updateStreamingProgress(0, totalCount, false);
    }
  });

  eventSource.addEventListener('ticket', (event) => {
    const ticket = JSON.parse(event.data);
    debugLog('[MAIN] - Received ticket:', ticket.id);
    
    // Append the ticket to the accordion
    TicketRenderer.appendValidationTicket(ticket, ticket.index);
    
    // Update progress
    loadedCount++;
    TicketRenderer.updateStreamingProgress(loadedCount, totalCount, false);
  });

  eventSource.addEventListener('error', (event) => {
    const errorData = JSON.parse(event.data);
    debugLog('[MAIN] - Stream error:', errorData);
    
    // Log error but continue processing other tickets
    if (errorData.ticket_id) {
      console.warn(`Error loading ticket ${errorData.ticket_id}: ${errorData.message}`);
    } else {
      // Fatal error
      hasError = true;
      TicketRenderer.renderError('Error loading validation tickets: ' + errorData.message);
      assignmentUIManager.setWorkflowState('idle');
      eventSource.close();
    }
  });

  eventSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    debugLog('[MAIN] - Stream complete:', data);
    
    // Update final progress
    TicketRenderer.updateStreamingProgress(loadedCount, totalCount, true);
    
    // Set workflow state to tickets-loaded
    assignmentUIManager.setWorkflowState('tickets-loaded', { totalTickets: loadedCount });
    
    eventSource.close();

    // Start background polling so the list stays in sync with the live queue
    startValidationPolling();
  });

  // Handle connection errors
  eventSource.onerror = (error) => {
    debugLog('[MAIN] - EventSource connection error:', error);
    if (!hasError && loadedCount === 0) {
      TicketRenderer.renderError('Connection error while loading validation tickets. Please try again.');
      assignmentUIManager.setWorkflowState('idle');
    }
    eventSource.close();
  };
}

/**
 * Handle get ticket recommendations button click (batch processing)
 */
async function handleGetRecommendations() {
  debugLog('[MAIN] - Get ticket recommendations clicked');

  // Check if validation tickets are displayed
  const validationAccordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
  if (!validationAccordion) {
    alert('Please fetch validation tickets first by clicking "Get validation tickets".');
    return;
  }

  // Collect ticket IDs and indices from displayed tickets
  const ticketItems = BatchProcessor.collectTicketItems();

  if (ticketItems.length === 0) {
    alert('No tickets found to process.');
    return;
  }

  debugLog('[MAIN] - Found', ticketItems.length, 'tickets to process');

  // Set workflow state to recommendations-loading
  assignmentUIManager.setWorkflowState('recommendations-loading');
  
  // Track if checkboxes have been shown (show after first recommendation)
  let checkboxesShown = false;

  // Show initial progress
  assignmentUIManager.showRecommendationProgress(1, ticketItems.length, ticketItems[0].id);

  // Process tickets in batches
  let completedCount = 0;
  
  await batchProcessor.processTickets(ticketItems, {
    onTicketStart: (item, current, total) => {
      // Update progress when starting a new ticket
      assignmentUIManager.showRecommendationProgress(current, total, item.id);
    },
    onProgress: (completed, total) => {
      // Progress is now handled in onTicketStart for better UX
      debugLog('[MAIN] - Progress:', completed, 'of', total);
    },
    onTicketComplete: (item, data) => {
      completedCount++;
      
      // Render the recommendation immediately when received
      TicketRenderer.renderRecommendations(data, true, item.index);
      
      // Store the recommendation data for later use when implementing assignments
      TicketRenderer.storeRecommendationData(item.index, data);
      
      // Show checkboxes after the first recommendation is received
      if (!checkboxesShown) {
        TicketRenderer.showTicketCheckboxes();
        checkboxesShown = true;
      }
      
      // Update workflow progress
      assignmentUIManager.updateRecommendationProgress(completedCount, ticketItems.length);
      
      debugLog('[MAIN] - Rendered and stored recommendation for ticket', item.id);
    },
    onError: (item, error) => {
      completedCount++;
      const errorData = { error: error.message || 'Failed to get recommendations' };
      TicketRenderer.renderRecommendations(errorData, true, item.index);
      
      // Still update progress even on error
      assignmentUIManager.updateRecommendationProgress(completedCount, ticketItems.length);
      
      // Show checkboxes even if there was an error (so user can select other tickets)
      if (!checkboxesShown) {
        TicketRenderer.showTicketCheckboxes();
        checkboxesShown = true;
      }
    },
    onComplete: () => {
      // Show completion message
      assignmentUIManager.showRecommendationComplete(ticketItems.length);
      
      debugLog('[MAIN] - All recommendations complete');
    }
  });
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

    // Get the selected support group from the support group radio buttons (name starts with sg-selector-batch)
    const sgRadioName = `sg-selector-batch-${ticket.index}`;
    const selectedSGRadio = recommendationsContainer.querySelector(`input[name="${sgRadioName}"]:checked`);
    const selectedSupportGroup = selectedSGRadio ? selectedSGRadio.value : null;

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
      implementBtn.innerHTML = 'Implement ticket assignment';
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
    myPresenceColor = localStorage.getItem(CONSTANTS.STORAGE_KEYS.PRESENCE_COLOR);
    if (!myPresenceColor) {
      myPresenceColor = getRandomPresenceColor();
      localStorage.setItem(CONSTANTS.STORAGE_KEYS.PRESENCE_COLOR, myPresenceColor);
    }
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
 */
function stopPresenceHeartbeat() {
  if (presenceHeartbeatInterval !== null) {
    clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = null;
  }
  sendPresenceLeave();
  window.removeEventListener('beforeunload', sendPresenceLeave);
  document.removeEventListener('visibilitychange', _onVisibilityChange);
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
        color: myPresenceColor,
        display_name: myDisplayName || null
      })
    });

    if (response.ok) {
      const data = await response.json();
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
 * @param {Array} sessions - Array of { session_id, color, label } objects
 */
function handlePresenceUpdate(sessions) {
  if (assignmentUIManager) {
    assignmentUIManager.renderPresenceIndicators(sessions, mySessionId);
  }
}

// ─── End presence heartbeat ───────────────────────────────────────────────────

// ─── Validation queue real-time polling ──────────────────────────────────────

/**
 * Start the background polling loop that checks for queue changes every
 * VALIDATION_POLL_INTERVAL milliseconds.
 * Also starts the 1-second countdown timer displayed in the header.
 * Safe to call multiple times — clears any existing intervals first.
 */
function startValidationPolling() {
  stopValidationPolling();
  debugLog('[MAIN] - Starting validation ticket polling (interval:', CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL, 'ms)');
  validationPollingInterval = setInterval(handleValidationPoll, CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL);
  startCountdownTimer();
}

/**
 * Stop the background polling loop and the countdown timer.
 */
function stopValidationPolling() {
  if (validationPollingInterval !== null) {
    clearInterval(validationPollingInterval);
    validationPollingInterval = null;
    debugLog('[MAIN] - Stopped validation ticket polling');
  }
  stopCountdownTimer();
}

/**
 * Start (or restart) the 1-second countdown timer.
 * Resets the counter to the full poll interval and ticks down each second.
 */
function startCountdownTimer() {
  stopCountdownTimer();
  const totalSeconds = Math.round(CONSTANTS.DEFAULTS.VALIDATION_POLL_INTERVAL / 1000);
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

    // Update the "Last checked" timestamp and reset the countdown
    TicketRenderer.updateLastCheckedTime(new Date());
    startCountdownTimer();

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

console.log('Main script loaded and initialized.');
