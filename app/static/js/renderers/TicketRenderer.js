/**
 * TicketRenderer - Centralizes all HTML generation for tickets, accordions, and recommendations
 */
class TicketRenderer {
  /**
   * Render search results
   * @param {Object} data - Search results data
   * @param {string} searchValue - The search query
   * @param {string} searchType - Type of search performed
   */
  static renderSearchResults(data, searchValue, searchType) {
    debugLog('[RENDERER] - Displaying search results for', searchType, 'searchValue:', searchValue, 'result count:', data.resultCount);
    const container = ensureContentArea();

    // Result counter
    let html = `<h4 class="mb-3">Found ${data.resultCount} result(s) for ${searchType} "${searchValue}"</h4>`;

    // Accordion for tickets
    html += '<div class="accordion" id="ticketsAccordion">';

    data.result.forEach((ticket, index) => {
      html += this._renderAccordionItem(ticket, `collapse${ticket.id}`, {
        showResolutionNotes: searchType !== 'phone number',
        showContactMethod: searchType === 'phone number'
      });
    });

    html += '</div>';
    container.innerHTML = html;

    initializeTooltips();
    debugLog('[RENDERER] - Search results display completed');
  }

  /**
   * Render similar tickets
   * @param {Array} tickets - Array of similar ticket objects
   */
  static renderSimilarTickets(tickets) {
    debugLog('[RENDERER] - Displaying similar tickets, count:', tickets.length);
    const container = ensureContentArea();

    // Add visual separator and label for similar tickets
    let html = '<div class="mt-5 pt-4 border-top text-start"><h4>Similar Tickets Used for Assignment Analysis</h4></div>';

    // Accordion for similar tickets
    html += '<div class="accordion" id="similarTicketsAccordion">';

    tickets.forEach((ticket, index) => {
      html += this._renderAccordionItem(ticket, `collapseSimilar${index}`);
    });

    html += '</div>';
    container.innerHTML += html;

    initializeTooltips();
  }

  /**
   * Render validation tickets with expand/collapse controls and checkboxes
   * @param {Object} data - Validation tickets data including tickets array and count
   */
  static renderValidationTickets(data) {
    debugLog('[RENDERER] - Displaying validation tickets, count:', data.count);
    const container = ensureContentArea();

    const count = data.count || 0;

    // Display section header with expand/collapse toggle and select all checkbox
    let html = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h4 class="mb-0">Validation Tickets (${count})</h4>
        <div class="d-flex gap-2 align-items-center">
          <div id="${CONSTANTS.SELECTORS.SELECTED_TICKETS_CONTAINER}" class="d-none align-items-center me-2">
            <input type="checkbox" id="${CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX}" class="form-check-input me-2">
            <label for="${CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX}" class="form-check-label me-2">Select All</label>
            <span id="${CONSTANTS.SELECTORS.SELECTED_TICKETS_COUNT}" class="badge bg-primary">0 selected</span>
          </div>
          <button id="${CONSTANTS.SELECTORS.VALIDATION_TOGGLE_ALL_BTN}" class="btn btn-outline-secondary" type="button">
            <i class="bi bi-chevron-down me-1"></i>Expand All
          </button>
          <div id="${CONSTANTS.SELECTORS.BATCH_PROGRESS_INDICATOR}" class="d-none align-items-center">
            <span id="${CONSTANTS.SELECTORS.BATCH_PROGRESS_TEXT}"></span>
          </div>
        </div>
      </div>
    `;

    if (data.error) {
      html += getAlertHTML(`<h5>Error</h5><p>${data.error}</p>`, 'danger');
    } else if (!data.tickets || data.tickets.length === 0) {
      html += getAlertHTML('No validation tickets found.', 'info');
    } else {
      // Create accordion structure for tickets
      html += `<div class="accordion" id="${CONSTANTS.SELECTORS.VALIDATION_ACCORDION}">`;

      data.tickets.forEach((ticket, index) => {
        html += this._renderValidationAccordionItem(ticket, index);
      });

      html += '</div>';
    }

    container.innerHTML = html;

    // Initialize expand/collapse all toggle button
    this._initializeExpandCollapseButton();

    // Initialize select all checkbox functionality
    this._initializeSelectAllCheckbox();

    initializeTooltips();
    debugLog('[RENDERER] - Validation tickets display completed');
  }

  /**
   * Initialize the container for streaming validation tickets
   * Sets up the header and empty accordion ready to receive tickets
   * @param {number} expectedCount - Total number of tickets expected (or null if unknown)
   * @returns {HTMLElement} The accordion container element
   */
  static renderValidationTicketsStreamingInit(expectedCount = null) {
    debugLog('[RENDERER] - Initializing streaming validation tickets container');
    const container = ensureContentArea();

    const countText = expectedCount !== null ? `0/${expectedCount}` : 'loading...';
    const loadingHtml = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h4 class="mb-0">Validation Tickets (${countText})</h4>
        <div class="d-flex gap-2 align-items-center">
          <div id="${CONSTANTS.SELECTORS.SELECTED_TICKETS_CONTAINER}" class="d-none align-items-center me-2">
            <input type="checkbox" id="${CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX}" class="form-check-input me-2">
            <label for="${CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX}" class="form-check-label me-2">Select All</label>
            <span id="${CONSTANTS.SELECTORS.SELECTED_TICKETS_COUNT}" class="badge bg-primary">0 selected</span>
          </div>
          <span id="streaming-progress" class="text-muted small">
            <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Loading tickets...
          </span>
          <button id="${CONSTANTS.SELECTORS.VALIDATION_TOGGLE_ALL_BTN}" class="btn btn-outline-secondary" type="button" disabled>
            <i class="bi bi-chevron-down me-1"></i>Expand All
          </button>
          <div id="${CONSTANTS.SELECTORS.BATCH_PROGRESS_INDICATOR}" class="d-none align-items-center">
            <span id="${CONSTANTS.SELECTORS.BATCH_PROGRESS_TEXT}"></span>
          </div>
        </div>
      </div>
      <div class="accordion" id="${CONSTANTS.SELECTORS.VALIDATION_ACCORDION}"></div>
    `;

    container.innerHTML = loadingHtml;
    initializeTooltips();

    return document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
  }

  /**
   * Update the streaming progress indicator
   * @param {number} loadedCount - Number of tickets loaded so far
   * @param {number} totalCount - Total number of tickets expected
   * @param {boolean} isComplete - Whether loading is complete
   */
  static updateStreamingProgress(loadedCount, totalCount, isComplete = false) {
    const header = document.querySelector('.main-content h4.mb-0');
    const progressSpan = document.getElementById('streaming-progress');
    const toggleBtn = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_TOGGLE_ALL_BTN);

    if (header) {
      header.textContent = `Validation Tickets (${loadedCount}/${totalCount})`;
    }

    if (progressSpan) {
      if (isComplete) {
        progressSpan.innerHTML = `<i class="bi bi-check-circle text-success me-2"></i>${loadedCount} tickets loaded`;
        progressSpan.classList.remove('text-muted');
        progressSpan.classList.add('text-success');
      } else {
        progressSpan.innerHTML = `
          <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
          Loading ticket ${loadedCount + 1} of ${totalCount}...
        `;
      }
    }

    if (toggleBtn && isComplete) {
      toggleBtn.disabled = false;
      this._initializeExpandCollapseButton();
    }
  }

  /**
   * Append a single validation ticket to the accordion (for streaming mode)
   * @param {Object} ticket - Ticket data
   * @param {number} index - Ticket index
   */
  static appendValidationTicket(ticket, index) {
    const accordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
    if (!accordion) {
      debugLog('[RENDERER] - Validation accordion not found, cannot append ticket');
      return;
    }

    const ticketHtml = this._renderValidationAccordionItem(ticket, index);
    accordion.insertAdjacentHTML('beforeend', ticketHtml);

    // Initialize tooltips for the new ticket
    initializeTooltips();
    debugLog('[RENDERER] - Appended validation ticket', index, ticket.id);
  }

  /**
   * Render OneNote documents
   * @param {Array} docs - Array of OneNote document objects
   */
  static renderOnenoteDocuments(docs) {
    debugLog('[RENDERER] - Displaying OneNote documents, count:', docs.length);
    const container = ensureContentArea();

    // Add visual separator
    let html = '<div class="mt-5 pt-4 border-top text-start"><h4>OneNote Documentation Referenced</h4></div>';

    html += '<div class="accordion" id="onenoteAccordion">';

    docs.forEach((doc, index) => {
      const contentPreview = doc.content
        ? truncateText(doc.content, CONSTANTS.DEFAULTS.CONTENT_PREVIEW_LENGTH)
        : 'No content available';

      html += `
        <div class="accordion-item">
          ${TicketAccordionHeader.generate({
            id: doc.title || 'Untitled Document',
            title: doc.title || 'Untitled Document',
            accordionTarget: `#collapseOneNote${index}`,
            copyTooltip: "Copy document title"
          })}
          <div id="collapseOneNote${index}" class="accordion-collapse collapse">
            <div class="accordion-body">
              <div class="row">
                <div class="col-md-6">
                  <p><strong>Notebook:</strong> ${doc.notebook || 'N/A'}</p>
                  <p><strong>Section:</strong> ${doc.section || 'N/A'}</p>
                  <p><strong>Similarity Score:</strong> ${doc.similarity ? parseFloat(doc.similarity).toFixed(4) : 'N/A'}</p>
                </div>
                <div class="col-md-6">
                  <p><strong>Content Preview:</strong></p>
                  <div class="border-start border-secondary border-2 ps-2">
                    <p class="mb-0 text-muted">${contentPreview}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML += html;
  }

  /**
   * Render the original ticket being analyzed
   * @param {Object} ticket - The original ticket data
   */
  static renderOriginalTicket(ticket) {
    debugLog('[RENDERER] - Displaying original ticket');
    const container = ensureContentArea();

    // Display header indicating this is the main ticket being analyzed
    let html = '<div class="mt-5 pt-4 border-top text-start"><h4>Ticket for Assignment Analysis</h4></div>';

    // Accordion for the single original ticket
    html += '<div class="accordion" id="originalTicketAccordion">';
    html += this._renderDetailedAccordionItem(ticket, 'collapseOriginal');
    html += '</div>';

    container.innerHTML += html;

    initializeTooltips();
  }

  /**
   * Render AI assignment recommendations
   * @param {Object} data - Recommendations data from API
   * @param {boolean} [isBatch=false] - Whether this is for batch display (compact format)
   * @param {number} [ticketIndex] - Ticket index for batch mode container
   */
  static renderRecommendations(data, isBatch = false, ticketIndex = null) {
    if (isBatch && ticketIndex !== null) {
      this._renderBatchRecommendations(data, ticketIndex);
      return;
    }

    debugLog('[RENDERER] - Displaying assignment recommendations');
    const container = ensureContentArea();

    // Display section header for AI recommendations
    let html = '<h4 class="mb-3">AI Assignment Recommendations</h4>';

    // Check if there's an error response
    if (data.error) {
      html += getAlertHTML(`<h5>AI Analysis Error</h5><p>${data.error}</p>`, 'danger');
    } else {
      // Display the AI recommendations in a card format with static labels for single ticket mode
      const firstChoice = data.recommended_support_group || 'N/A';
      const secondChoice = data.second_choice_support_group || 'N/A';
      const thirdChoice = data.third_choice_support_group || 'N/A';
      
      html += `
        <div class="card mb-4">
          <div class="card-body">
            <div class="row">
              <div class="col-md-6">
                <h6 class="card-title">AI Recommended Support Groups</h6>
                <div class="mb-3">
                  <p class="mb-1"><span class="badge bg-primary">1st Choice</span> <strong>${firstChoice}</strong></p>
                  <p class="mb-1"><span class="badge bg-secondary">2nd Choice</span> ${secondChoice}</p>
                  <p class="mb-1"><span class="badge bg-secondary">3rd Choice</span> ${thirdChoice}</p>
                </div>
                <h6 class="card-title mt-3">Recommended Priority Level</h6>
                <p class="h5 text-warning">${data.recommended_priority_level || 'N/A'}</p>
              </div>
              <div class="col-md-6">
                <h6 class="card-title">Detailed AI Analysis</h6>
                <div class="border-start border-primary border-3 ps-3">
                  <div id="recommendation-explanation"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Process Markdown formatting for the explanation
    const explanationContainer = container.querySelector('#recommendation-explanation');
    if (explanationContainer) {
      ExplanationRenderer.render(
        explanationContainer,
        data.detailed_explanation,
        CONSTANTS.DEFAULTS.TRUNCATE_LENGTH_LONG
      );
    }

    debugLog('[RENDERER] - Assignment recommendations display completed');
  }

  /**
   * Render the three-way support group selector
   * @param {Object} data - Recommendations data containing support groups
   * @param {string} selectorId - Unique ID for this selector instance
   * @returns {string} HTML string for the selector
   * @private
   */
  static _renderSupportGroupSelector(data, selectorId) {
    const firstChoice = data.recommended_support_group || 'N/A';
    const secondChoice = data.second_choice_support_group || 'N/A';
    const thirdChoice = data.third_choice_support_group || 'N/A';

    return `
      <div class="support-group-selector">
        <span class="support-group-selector-label">Select Support Group for Assignment:</span>
        <div class="support-group-options">
          <div class="support-group-option">
            <input type="radio" id="${selectorId}-1" name="${selectorId}" value="${firstChoice}" checked>
            <label for="${selectorId}-1">
              <span class="option-rank">1st Choice</span>
              <span class="option-name">${firstChoice}</span>
            </label>
          </div>
          <div class="support-group-option">
            <input type="radio" id="${selectorId}-2" name="${selectorId}" value="${secondChoice}">
            <label for="${selectorId}-2">
              <span class="option-rank">2nd Choice</span>
              <span class="option-name">${secondChoice}</span>
            </label>
          </div>
          <div class="support-group-option">
            <input type="radio" id="${selectorId}-3" name="${selectorId}" value="${thirdChoice}">
            <label for="${selectorId}-3">
              <span class="option-rank">3rd Choice</span>
              <span class="option-name">${thirdChoice}</span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the compact three-way support group selector for batch mode
   * @param {Object} data - Recommendations data containing support groups
   * @param {string} selectorId - Unique ID for this selector instance
   * @returns {string} HTML string for the selector
   * @private
   */
  static _renderSupportGroupSelectorCompact(data, selectorId) {
    const firstChoice = data.recommended_support_group || 'N/A';
    const secondChoice = data.second_choice_support_group || 'N/A';
    const thirdChoice = data.third_choice_support_group || 'N/A';

    return `
      <div class="support-group-selector support-group-selector-compact">
        <span class="support-group-selector-label">Select Support Group:</span>
        <div class="support-group-options">
          <div class="support-group-option">
            <input type="radio" id="${selectorId}-1" name="${selectorId}" value="${firstChoice}" checked>
            <label for="${selectorId}-1">
              <span class="option-rank">1st</span>
              <span class="option-name">${firstChoice}</span>
            </label>
          </div>
          <div class="support-group-option">
            <input type="radio" id="${selectorId}-2" name="${selectorId}" value="${secondChoice}">
            <label for="${selectorId}-2">
              <span class="option-rank">2nd</span>
              <span class="option-name">${secondChoice}</span>
            </label>
          </div>
          <div class="support-group-option">
            <input type="radio" id="${selectorId}-3" name="${selectorId}" value="${thirdChoice}">
            <label for="${selectorId}-3">
              <span class="option-rank">3rd</span>
              <span class="option-name">${thirdChoice}</span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the priority selector (High/Medium/Low) with AI recommendation pre-selected
   * @param {string} recommendedPriority - The AI recommended priority level (High/Medium/Low)
   * @param {string} selectorId - Unique ID for this selector instance
   * @returns {string} HTML string for the selector
   * @private
   */
  static _renderPrioritySelector(recommendedPriority, selectorId) {
    // Normalize the recommended priority to ensure valid values
    const normalizedPriority = ['High', 'Medium', 'Low'].includes(recommendedPriority) 
      ? recommendedPriority 
      : 'Medium';

    const priorities = ['High', 'Medium', 'Low'];
    
    let html = `
      <div class="priority-selector priority-selector-compact">
        <span class="priority-selector-label">Select Priority:</span>
        <div class="priority-options">
    `;

    priorities.forEach((priority) => {
      const isChecked = priority === normalizedPriority ? 'checked' : '';
      const priorityClass = priority.toLowerCase();
      html += `
          <div class="priority-option">
            <input type="radio" id="${selectorId}-${priority}" name="${selectorId}" value="${priority}" ${isChecked}>
            <label for="${selectorId}-${priority}" class="priority-${priorityClass}">
              <span class="priority-name">${priority}</span>
            </label>
          </div>
        `;
    });

    html += `
        </div>
      </div>
    `;

    return html;
  }

  /**
   * Get the selected priority from a priority selector
   * @param {string} selectorId - The ID of the selector
   * @returns {string|null} The selected priority (High/Medium/Low), or null if not found
   */
  static getSelectedPriority(selectorId) {
    const selectedRadio = document.querySelector(`input[name="${selectorId}"]:checked`);
    return selectedRadio ? selectedRadio.value : null;
  }

  /**
   * Get the selected support group from a selector
   * @param {string} selectorId - The ID of the selector (or container element for batch mode)
   * @param {boolean} [isBatch=false] - Whether this is for batch mode
   * @returns {string|null} The selected support group name, or null if not found
   */
  static getSelectedSupportGroup(selectorId, isBatch = false) {
    if (isBatch && typeof selectorId === 'object') {
      // For batch mode, selectorId is the container element
      const container = selectorId;
      const selectedRadio = container.querySelector('input[type="radio"]:checked');
      return selectedRadio ? selectedRadio.value : null;
    }
    
    // For single ticket mode
    const selectedRadio = document.querySelector(`input[name="${selectorId}"]:checked`);
    return selectedRadio ? selectedRadio.value : null;
  }

  /**
   * Render batch recommendations for a specific ticket
   * @param {Object} data - Recommendations data
   * @param {number} ticketIndex - Index of the ticket
   * @private
   */
  static _renderBatchRecommendations(data, ticketIndex) {
    debugLog(`[RENDERER] - Displaying batch recommendations for ticket index ${ticketIndex}`);
    const container = document.getElementById(`recommendations-${ticketIndex}`);

    if (!container) {
      debugLog(`[RENDERER] - Container recommendations-${ticketIndex} not found`);
      return;
    }

    let html = '';

    if (data.error) {
      html += getAlertHTML(`<h6>AI Analysis Error</h6><p>${data.error}</p>`, 'danger');
    } else {
      // Use compact selectors for batch mode
      const sgSelectorId = `sg-selector-batch-${ticketIndex}`;
      const sgSelectorHtml = this._renderSupportGroupSelectorCompact(data, sgSelectorId);
      
      const prioritySelectorId = `priority-selector-batch-${ticketIndex}`;
      const prioritySelectorHtml = this._renderPrioritySelector(data.recommended_priority_level, prioritySelectorId);
      
      html += `
        <div class="card mt-3">
          <div class="card-header">
            <h6 class="card-title mb-0">AI Recommendations</h6>
          </div>
          <div class="card-body">
            <div class="row">
              <div class="col-md-6">
                ${sgSelectorHtml}
                <div class="mt-2">
                  ${prioritySelectorHtml}
                </div>
              </div>
              <div class="col-md-6">
                <p><strong>Analysis:</strong></p>
                <div class="border-start border-primary border-2 ps-2">
                  <div id="batch-explanation-${ticketIndex}"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
    container.style.display = 'block';

    // Process Markdown formatting for the explanation
    const explanationContainer = container.querySelector(`#batch-explanation-${ticketIndex}`);
    if (explanationContainer) {
      ExplanationRenderer.render(
        explanationContainer,
        data.detailed_explanation,
        CONSTANTS.DEFAULTS.TRUNCATE_LENGTH_SHORT
      );
    }

    debugLog(`[RENDERER] - Batch recommendations display completed for ticket ${ticketIndex}`);
  }

  /**
   * Render a loading state in the content area
   */
  static renderLoading() {
    const container = ensureContentArea();
    container.innerHTML = getLoadingSpinnerHTML();
  }

  /**
   * Render a loading state with progress indication for ticket advice
   * @param {number} [step=1] - Current step number (1-5)
   * @param {string} [message='Loading...'] - Progress message to display
   */
  static renderLoadingWithProgress(step = 1, message = 'Loading...') {
    const container = ensureContentArea();
    const progressPercent = Math.min(step * 20, 100);
    container.innerHTML = `
      <div class="d-flex flex-column align-items-center my-5" id="advice-loading-container">
        <div class="d-flex align-items-center gap-3 mb-3">
          <div class="spinner-border text-primary" role="status" style="width: 2rem; height: 2rem;"></div>
          <span id="loading-step-text" class="text-primary fs-5 fw-semibold">${message}</span>
        </div>
        <div class="progress w-50" style="height: 6px; max-width: 400px;">
          <div id="loading-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-primary" 
               style="width: ${progressPercent}%; transition: width 0.3s ease;"></div>
        </div>
        <small id="loading-step-counter" class="text-muted mt-2">Step ${step} of 5</small>
      </div>
    `;
  }

  /**
   * Update the loading progress UI
   * @param {number} step - Current step number (1-5)
   * @param {string} message - Progress message to display
   */
  static updateLoadingProgress(step, message) {
    const textEl = document.getElementById('loading-step-text');
    const barEl = document.getElementById('loading-progress-bar');
    const counterEl = document.getElementById('loading-step-counter');
    const progressPercent = Math.min(step * 20, 100);
    
    if (textEl) textEl.textContent = message;
    if (barEl) barEl.style.width = `${progressPercent}%`;
    if (counterEl) counterEl.textContent = `Step ${step} of 5`;
  }

  /**
   * Render an error message
   * @param {string} message - Error message to display
   */
  static renderError(message) {
    const container = ensureContentArea();
    container.innerHTML = getAlertHTML(message, 'danger');
  }

  /**
   * Clear the content area
   */
  static clear() {
    const container = ensureContentArea();
    container.innerHTML = '';
  }

  /**
   * Render a standard accordion item for a ticket
   * @param {Object} ticket - Ticket data
   * @param {string} collapseId - ID for the collapse element
   * @param {Object} [options={}] - Rendering options
   * @returns {string} HTML string
   * @private
   */
  static _renderAccordionItem(ticket, collapseId, options = {}) {
    const createdDate = formatDate(ticket.createdDate);
    const completedDate = formatDate(ticket.completedDate);

    return `
      <div class="accordion-item">
        ${TicketAccordionHeader.generate({
          id: ticket.id,
          title: `${ticket.id} - ${ticket.title}`,
          accordionTarget: `#${collapseId}`
        })}
        <div id="${collapseId}" class="accordion-collapse collapse">
          <div class="accordion-body">
            <div class="row">
              <div class="col-md-6">
                <p><strong>Description:</strong> ${ticket.description}</p>
                <p><strong>Status:</strong> <span class="badge bg-${getStatusBadgeClass(ticket.statusValue)}">${ticket.statusValue}</span></p>
                <p><strong>Priority:</strong> <span class="badge bg-info">${ticket.priorityValue}</span></p>
                <p><strong>Assignee:</strong> ${ticket.assignedTo_DisplayName || 'Unassigned'}</p>
                <p><strong>Affected User:</strong> ${ticket.affectedUser_DisplayName || 'N/A'}</p>
              </div>
              <div class="col-md-6">
                <p><strong>Created:</strong> ${createdDate}</p>
                <p><strong>Completed:</strong> ${completedDate}</p>
                <p><strong>Location:</strong> ${ticket.locationValue || 'N/A'}</p>
                <p><strong>Source:</strong> ${ticket.sourceValue || 'N/A'}</p>
                <p><strong>Support Group:</strong> ${ticket.supportGroupValue || 'N/A'}</p>
                ${options.showContactMethod
                  ? `<p><strong>Contact Method:</strong> ${ticket.contactMethod || 'N/A'}</p>`
                  : `<p><strong>Resolution Notes:</strong> ${ticket.resolutionNotes || 'N/A'}</p>`
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render a validation ticket accordion item with recommendations container, checkbox, and clipboard button
   * @param {Object} ticket - Ticket data
   * @param {number} index - Ticket index
   * @returns {string} HTML string
   * @private
   */
  static _renderValidationAccordionItem(ticket, index) {
    const createdDate = formatDate(ticket.created_at);
    const checkboxId = `${CONSTANTS.SELECTORS.TICKET_CHECKBOX_PREFIX}${index}`;

    return `
      <div class="accordion-item" data-ticket-id="${ticket.id}" data-ticket-index="${index}">
        <div class="accordion-header d-flex align-items-center">
          <input type="checkbox" id="${checkboxId}" class="form-check-input ticket-checkbox ms-3 me-2 ticket-checkbox-hidden" 
                 data-ticket-id="${ticket.id}" data-ticket-index="${index}" style="cursor: pointer; z-index: 10;" disabled>
          <button class="btn btn-sm btn-outline-primary me-2 clipboard-btn" onclick="handleCopy('${ticket.id}', this)" 
                  data-bs-toggle="tooltip" data-bs-placement="top" title="Copy ticket number">
            <i class="bi bi-clipboard"></i>
          </button>
          <button class="accordion-button collapsed flex-grow-1" type="button" 
                  data-bs-toggle="collapse" data-bs-target="#validationCollapse${index}" 
                  aria-expanded="false" aria-controls="validationCollapse${index}">
            <span class="ticket-title">${ticket.id} - ${ticket.title || 'N/A'}</span>
          </button>
        </div>
        <div id="validationCollapse${index}" class="accordion-collapse collapse">
          <div class="accordion-body">
            <div class="row">
              <div class="col-md-6">
                <p><strong>Description:</strong> ${ticket.full_description || ticket.description || 'N/A'}</p>
                <p><strong>Status:</strong> ${ticket.status || 'N/A'}</p>
                <p><strong>Priority:</strong> ${ticket.priority || 'N/A'}</p>
                <p><strong>Assigned To:</strong> ${ticket.assigned_to || 'Unassigned'}</p>
                <p><strong>Affected User:</strong> ${ticket.affected_user || 'N/A'}</p>
              </div>
              <div class="col-md-6">
                <p><strong>Created:</strong> ${createdDate}</p>
                <p><strong>Location:</strong> ${ticket.location || 'N/A'}</p>
                <p><strong>Source:</strong> ${ticket.source || 'N/A'}</p>
                <p><strong>Support Group:</strong> ${ticket.support_group || 'N/A'}</p>
                <p><strong>Resolution Notes:</strong> ${ticket.resolution_notes || 'N/A'}</p>
              </div>
            </div>
            <div id="recommendations-${index}" class="recommendations-container mt-3" style="display: none;"
                 data-ticket-id="${ticket.id}" data-ticket-index="${index}"></div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render a detailed accordion item with all ticket fields
   * @param {Object} ticket - Ticket data
   * @param {string} collapseId - ID for the collapse element
   * @returns {string} HTML string
   * @private
   */
  static _renderDetailedAccordionItem(ticket, collapseId) {
    const createdDate = formatDate(ticket.created_at);
    const completedDate = formatDate(ticket.completed_at);

    return `
      <div class="accordion-item">
        ${TicketAccordionHeader.generate({
          id: ticket.id,
          title: `${ticket.id} - ${ticket.title}`,
          accordionTarget: `#${collapseId}`
        })}
        <div id="${collapseId}" class="accordion-collapse collapse">
          <div class="accordion-body">
            <div class="row">
              <div class="col-md-6">
                <p><strong>Description:</strong> ${ticket.description}</p>
                <p><strong>Status:</strong> <span class="badge bg-${getStatusBadgeClass(ticket.status)}">${ticket.status}</span></p>
                <p><strong>Priority:</strong> <span class="badge bg-${getPriorityBadgeClass(ticket.priority)}">${ticket.priority}</span></p>
                <p><strong>Impact:</strong> <span class="badge bg-info">${ticket.impact || 'N/A'}</span></p>
                <p><strong>Urgency:</strong> <span class="badge bg-info">${ticket.urgency || 'N/A'}</span></p>
                <p><strong>Assigned To:</strong> ${ticket.assigned_to || 'Unassigned'}</p>
                <p><strong>Affected User:</strong> ${ticket.affected_user || 'N/A'}</p>
                <p><strong>Affected User Department:</strong> ${ticket.affected_user_department || 'N/A'}</p>
              </div>
              <div class="col-md-6">
                <p><strong>Created:</strong> ${createdDate}</p>
                <p><strong>Completed:</strong> ${completedDate}</p>
                <p><strong>Location:</strong> ${ticket.location || 'N/A'}</p>
                <p><strong>Source:</strong> ${ticket.source || 'N/A'}</p>
                <p><strong>Current Support Group:</strong> ${ticket.support_group || 'N/A'}</p>
                <p><strong>Contact Method:</strong> ${ticket.contact_method || 'N/A'}</p>
                <p><strong>Escalated:</strong> ${ticket.escalated ? 'Yes' : 'No'}</p>
                <p><strong>Classification:</strong> ${ticket.classification || 'N/A'}</p>
                <p><strong>Created By:</strong> ${ticket.created_by || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Initialize the expand/collapse all button for validation tickets
   * @private
   */
  static _initializeExpandCollapseButton() {
    const toggleAllBtn = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_TOGGLE_ALL_BTN);
    if (!toggleAllBtn) return;

    // Remove any existing click listeners by cloning and replacing
    const newToggleBtn = toggleAllBtn.cloneNode(true);
    toggleAllBtn.parentNode.replaceChild(newToggleBtn, toggleAllBtn);

    newToggleBtn.addEventListener('click', function() {
      const accordions = document.querySelectorAll(`#${CONSTANTS.SELECTORS.VALIDATION_ACCORDION} .accordion-collapse`);
      if (accordions.length === 0) return;

      // Get current state from data attribute (default to false if not set)
      const isExpanded = newToggleBtn.getAttribute('data-is-expanded') === 'true';

      if (isExpanded) {
        // Collapse all
        accordions.forEach(collapse => {
          const bsCollapse = bootstrap.Collapse.getInstance(collapse);
          if (bsCollapse) {
            bsCollapse.hide();
          } else {
            // If no instance exists, create one and hide it
            new bootstrap.Collapse(collapse, { toggle: false }).hide();
          }
          const button = collapse.previousElementSibling?.querySelector('.accordion-button');
          if (button) {
            button.classList.add('collapsed');
            button.setAttribute('aria-expanded', 'false');
          }
        });
        newToggleBtn.innerHTML = '<i class="bi bi-chevron-down me-1"></i>Expand All';
        newToggleBtn.setAttribute('data-is-expanded', 'false');
      } else {
        // Expand all
        accordions.forEach(collapse => {
          const bsCollapse = bootstrap.Collapse.getInstance(collapse);
          if (bsCollapse) {
            bsCollapse.show();
          } else {
            // If no instance exists, create one and show it
            new bootstrap.Collapse(collapse, { toggle: false }).show();
          }
          const button = collapse.previousElementSibling?.querySelector('.accordion-button');
          if (button) {
            button.classList.remove('collapsed');
            button.setAttribute('aria-expanded', 'true');
          }
        });
        newToggleBtn.innerHTML = '<i class="bi bi-chevron-up me-1"></i>Collapse All';
        newToggleBtn.setAttribute('data-is-expanded', 'true');
      }
    });
  }

  /**
   * Initialize the select all checkbox functionality
   * Called after recommendations are loaded to enable ticket selection
   * Uses event delegation for cleaner event handling
   * @private
   */
  static _initializeSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById(CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX);
    const selectedTicketsContainer = document.getElementById(CONSTANTS.SELECTORS.SELECTED_TICKETS_CONTAINER);
    const validationAccordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
    
    if (!selectAllCheckbox || !selectedTicketsContainer) return;

    // Remove any existing click listener on select all checkbox by cloning
    const newSelectAllCheckbox = selectAllCheckbox.cloneNode(true);
    selectAllCheckbox.parentNode.replaceChild(newSelectAllCheckbox, selectAllCheckbox);

    // Select all checkbox change handler
    newSelectAllCheckbox.addEventListener('change', function() {
      const isChecked = this.checked;
      // Clear indeterminate state when explicitly clicked
      this.indeterminate = false;
      
      const ticketCheckboxes = document.querySelectorAll('.ticket-checkbox:not([disabled])');
      ticketCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
      });
      
      TicketRenderer._updateSelectedCount();
    });

    // Use event delegation for individual checkboxes
    // Remove any existing delegated listener first
    if (validationAccordion && validationAccordion._checkboxChangeHandler) {
      validationAccordion.removeEventListener('change', validationAccordion._checkboxChangeHandler);
    }

    // Create delegated event handler for individual checkboxes
    const checkboxChangeHandler = function(event) {
      // Only handle changes from ticket checkboxes
      if (event.target.classList.contains('ticket-checkbox') && !event.target.disabled) {
        TicketRenderer._updateSelectAllCheckboxState();
        TicketRenderer._updateSelectedCount();
      }
    };

    // Store reference to handler so we can remove it later if needed
    if (validationAccordion) {
      validationAccordion._checkboxChangeHandler = checkboxChangeHandler;
      validationAccordion.addEventListener('change', checkboxChangeHandler);
    }

    // Initial state update
    TicketRenderer._updateSelectAllCheckboxState();
    TicketRenderer._updateSelectedCount();
  }

  /**
   * Update the select all checkbox state based on individual checkbox states
   * @private
   */
  static _updateSelectAllCheckboxState() {
    const selectAllCheckbox = document.getElementById(CONSTANTS.SELECTORS.SELECT_ALL_TICKETS_CHECKBOX);
    if (!selectAllCheckbox) return;

    const allCheckboxes = document.querySelectorAll('.ticket-checkbox:not([disabled])');
    const checkedCount = document.querySelectorAll('.ticket-checkbox:not([disabled]):checked').length;
    const totalCount = allCheckboxes.length;

    if (totalCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === totalCount) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    }
  }

  /**
   * Update the selected tickets count display
   * @private
   */
  static _updateSelectedCount() {
    const selectedCountEl = document.getElementById(CONSTANTS.SELECTORS.SELECTED_TICKETS_COUNT);
    if (!selectedCountEl) return;

    const checkedCount = document.querySelectorAll('.ticket-checkbox:checked').length;
    const totalCount = document.querySelectorAll('.ticket-checkbox').length;
    
    selectedCountEl.textContent = `${checkedCount}/${totalCount} selected`;
    
    // Dispatch event to notify other components of selection change
    document.dispatchEvent(new CustomEvent('ticketSelectionChanged', {
      detail: { selectedCount: checkedCount, totalCount: totalCount }
    }));
  }

  /**
   * Get all selected tickets with their data
   * Returns array of selected ticket objects with id, index, and recommendation data
   * @returns {Array} Array of selected ticket objects
   */
  static getSelectedTickets() {
    const selectedTickets = [];
    const checkedCheckboxes = document.querySelectorAll('.ticket-checkbox:checked');

    checkedCheckboxes.forEach(checkbox => {
      const ticketId = checkbox.getAttribute('data-ticket-id');
      const ticketIndex = parseInt(checkbox.getAttribute('data-ticket-index'));
      
      // Get recommendation data from the recommendations container
      const recommendationsContainer = document.getElementById(`recommendations-${ticketIndex}`);
      let recommendationData = null;
      
      if (recommendationsContainer) {
        // Extract recommendation data from the rendered content
        const supportGroupEl = recommendationsContainer.querySelector('.text-primary');
        const priorityEl = recommendationsContainer.querySelector('.text-warning');
        
        if (supportGroupEl && priorityEl) {
          recommendationData = {
            recommended_support_group: supportGroupEl.textContent.trim(),
            recommended_priority_level: priorityEl.textContent.trim()
          };
        }
      }

      selectedTickets.push({
        id: ticketId,
        index: ticketIndex,
        checkbox: checkbox,
        recommendation: recommendationData
      });
    });

    debugLog('[RENDERER] - Selected tickets:', selectedTickets.length);
    return selectedTickets;
  }

  /**
   * Store recommendation data for a specific ticket
   * This allows retrieval when implementing assignments
   * @param {number} ticketIndex - Index of the ticket
   * @param {Object} recommendationData - The AI recommendation data
   */
  static storeRecommendationData(ticketIndex, recommendationData) {
    const recommendationsContainer = document.getElementById(`recommendations-${ticketIndex}`);
    if (recommendationsContainer) {
      recommendationsContainer.dataset.recommendationData = JSON.stringify(recommendationData);
    }
  }

  /**
   * Get recommendation data for a specific ticket
   * @param {number} ticketIndex - Index of the ticket
   * @returns {Object|null} The recommendation data or null if not found
   */
  static getRecommendationData(ticketIndex) {
    const recommendationsContainer = document.getElementById(`recommendations-${ticketIndex}`);
    if (recommendationsContainer && recommendationsContainer.dataset.recommendationData) {
      try {
        return JSON.parse(recommendationsContainer.dataset.recommendationData);
      } catch (e) {
        debugLog('[RENDERER] - Error parsing recommendation data:', e);
        return null;
      }
    }
    return null;
  }

  /**
   * Show all ticket checkboxes and enable them
   * Called after the first AI recommendation is received
   */
  static showTicketCheckboxes() {
    debugLog('[RENDERER] - Showing and enabling ticket checkboxes');
    
    // Show individual ticket checkboxes
    const checkboxes = document.querySelectorAll('.ticket-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.classList.remove('ticket-checkbox-hidden');
      checkbox.classList.add('ticket-checkbox-visible');
      checkbox.disabled = false;
    });
    
    // Show the select all container
    const selectAllContainer = document.getElementById(CONSTANTS.SELECTORS.SELECTED_TICKETS_CONTAINER);
    if (selectAllContainer) {
      selectAllContainer.classList.remove('d-none');
      selectAllContainer.classList.add('d-flex');
    }
    
    // Re-initialize select all checkbox functionality
    this._initializeSelectAllCheckbox();
    
    debugLog('[RENDERER] - Ticket checkboxes are now visible and enabled');
  }

  /**
   * Hide all ticket checkboxes and disable them
   * Used when resetting the workflow
   */
  static hideTicketCheckboxes() {
    debugLog('[RENDERER] - Hiding and disabling ticket checkboxes');
    
    // Hide individual ticket checkboxes
    const checkboxes = document.querySelectorAll('.ticket-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.classList.remove('ticket-checkbox-visible');
      checkbox.classList.add('ticket-checkbox-hidden');
      checkbox.disabled = true;
      checkbox.checked = false;
    });
    
    // Hide the select all container
    const selectAllContainer = document.getElementById(CONSTANTS.SELECTORS.SELECTED_TICKETS_CONTAINER);
    if (selectAllContainer) {
      selectAllContainer.classList.remove('d-flex');
      selectAllContainer.classList.add('d-none');
    }
    
    debugLog('[RENDERER] - Ticket checkboxes are now hidden and disabled');
  }

  /**
   * Render assignment implementation results
   * @param {Object} result - Assignment results from backend
   */
  static renderAssignmentResults(result) {
    debugLog('[RENDERER] - Displaying assignment results');
    const container = ensureContentArea();

    // Create results HTML
    let html = '<div class="mt-4"><h4>Assignment Implementation Results</h4></div>';

    // Summary card
    const successCount = result.results ? result.results.filter(r => r.success).length : 0;
    const failedCount = result.results ? result.results.filter(r => !r.success).length : 0;
    
    html += `
      <div class="card mb-4">
        <div class="card-header bg-primary text-white">
          <h5 class="mb-0">Implementation Summary</h5>
        </div>
        <div class="card-body">
          <div class="row text-center">
            <div class="col-md-4">
              <h3 class="text-success">${successCount}</h3>
              <p class="text-muted">Successful</p>
            </div>
            <div class="col-md-4">
              <h3 class="text-danger">${failedCount}</h3>
              <p class="text-muted">Failed</p>
            </div>
            <div class="col-md-4">
              <h3>${result.results ? result.results.length : 0}</h3>
              <p class="text-muted">Total Processed</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Detailed results table
    if (result.results && result.results.length > 0) {
      html += `
        <div class="card">
          <div class="card-header">
            <h5 class="mb-0">Detailed Results</h5>
          </div>
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-striped mb-0">
                <thead>
                  <tr>
                    <th>Ticket ID</th>
                    <th>Status</th>
                    <th>Support Group</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
      `;

      result.results.forEach(item => {
        const statusBadge = item.success 
          ? '<span class="badge bg-success">Success</span>' 
          : '<span class="badge bg-danger">Failed</span>';
        
        html += `
          <tr>
            <td><strong>${item.ticket_id}</strong></td>
            <td>${statusBadge}</td>
            <td>${item.support_group || 'N/A'}</td>
            <td>${item.message || 'N/A'}</td>
          </tr>
        `;
      });

      html += `
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // If there are errors, show them
    if (result.errors && result.errors.length > 0) {
      html += `
        <div class="alert alert-warning mt-3">
          <h6>Warnings:</h6>
          <ul class="mb-0">
            ${result.errors.map(err => `<li>${err}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    container.innerHTML += html;
    debugLog('[RENDERER] - Assignment results display completed');
  }
}
