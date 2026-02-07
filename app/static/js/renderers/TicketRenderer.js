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
   * Render validation tickets with expand/collapse controls
   * @param {Object} data - Validation tickets data including tickets array and count
   */
  static renderValidationTickets(data) {
    debugLog('[RENDERER] - Displaying validation tickets, count:', data.count);
    const container = ensureContentArea();

    const count = data.count || 0;

    // Display section header with expand/collapse toggle
    let html = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h4 class="mb-0">Validation Tickets (${count})</h4>
        <div class="d-flex gap-2">
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

    initializeTooltips();
    debugLog('[RENDERER] - Validation tickets display completed');
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
      // Display the AI recommendations in a card format
      html += `
        <div class="card mb-4">
          <div class="card-body">
            <div class="row">
              <div class="col-md-6">
                <h6 class="card-title">Recommended Support Group</h6>
                <p class="h5 text-primary">${data.recommended_support_group || 'N/A'}</p>
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
      html += `
        <div class="card mt-3">
          <div class="card-header">
            <h6 class="card-title mb-0">AI Recommendations</h6>
          </div>
          <div class="card-body">
            <div class="row">
              <div class="col-md-6">
                <p><strong>Support Group:</strong> <span class="text-primary">${data.recommended_support_group || 'N/A'}</span></p>
                <p><strong>Priority:</strong> <span class="text-warning">${data.recommended_priority_level || 'N/A'}</span></p>
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
   * Render a validation ticket accordion item with recommendations container
   * @param {Object} ticket - Ticket data
   * @param {number} index - Ticket index
   * @returns {string} HTML string
   * @private
   */
  static _renderValidationAccordionItem(ticket, index) {
    const createdDate = formatDate(ticket.created_at);

    return `
      <div class="accordion-item">
        ${TicketAccordionHeader.generate({
          id: ticket.id,
          title: `${ticket.id} - ${ticket.title || 'N/A'}`,
          accordionTarget: `#validationCollapse${index}`,
          ariaControls: `validationCollapse${index}`
        })}
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
            <div id="recommendations-${index}" class="recommendations-container mt-3" style="display: none;"></div>
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

    let isExpanded = false;
    toggleAllBtn.addEventListener('click', function() {
      const accordions = document.querySelectorAll(`#${CONSTANTS.SELECTORS.VALIDATION_ACCORDION} .accordion-collapse`);

      if (isExpanded) {
        // Collapse all
        accordions.forEach(collapse => {
          const bsCollapse = new bootstrap.Collapse(collapse, { hide: true });
          const button = collapse.previousElementSibling.querySelector('.accordion-button');
          if (button) {
            button.classList.add('collapsed');
            button.setAttribute('aria-expanded', 'false');
          }
        });
        this.innerHTML = '<i class="bi bi-chevron-down me-1"></i>Expand All';
        isExpanded = false;
      } else {
        // Expand all
        accordions.forEach(collapse => {
          const bsCollapse = new bootstrap.Collapse(collapse, { show: true });
          const button = collapse.previousElementSibling.querySelector('.accordion-button');
          if (button) {
            button.classList.remove('collapsed');
            button.setAttribute('aria-expanded', 'true');
          }
        });
        this.innerHTML = '<i class="bi bi-chevron-up me-1"></i>Collapse All';
        isExpanded = true;
      }
    });
  }
}
