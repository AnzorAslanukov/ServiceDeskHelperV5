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
    },
    onSwitchToAssignment: () => {
      debugLog('[MAIN] - Switched to assignment mode callback');
      attachAssignmentEventListeners();
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
    },
    () => {
      debugLog('[MAIN] - Multiple tickets mode selected');
      // Batch button listeners will be attached when batch buttons are created
      setTimeout(attachBatchButtonListeners, 0);
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

    // Get the selected support group from the support group radio buttons (name starts with sg-selector-batch)
    const sgRadioName = `sg-selector-batch-${ticket.index}`;
    const selectedSGRadio = recommendationsContainer.querySelector(`input[name="${sgRadioName}"]:checked`);
    const selectedSupportGroup = selectedSGRadio ? selectedSGRadio.value : null;

    // Get the selected priority from the priority radio buttons (name starts with priority-selector-batch)
    const priorityRadioName = `priority-selector-batch-${ticket.index}`;
    const selectedPriorityRadio = recommendationsContainer.querySelector(`input[name="${priorityRadioName}"]:checked`);
    const selectedPriority = selectedPriorityRadio ? selectedPriorityRadio.value : null;

    // Convert priority string to numeric value for Athena API
    // High = 1, Medium = 2, Low = 3 (or whatever mapping is appropriate)
    let priorityValue = null;
    if (selectedPriority) {
      switch (selectedPriority) {
        case 'High':
          priorityValue = 1;
          break;
        case 'Medium':
          priorityValue = 2;
          break;
        case 'Low':
          priorityValue = 3;
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

console.log('Main script loaded and initialized.');
