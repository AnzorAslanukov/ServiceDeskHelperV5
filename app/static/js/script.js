console.log('Script loaded. ToggleButton available:', typeof ToggleButton);

function createSearchToggleButtons() {
    const container = document.getElementById('search-toggles-container');

    // Create the flex container div
    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'd-flex justify-content-center align-items-center';

    // Define button configurations
    const buttonConfigs = [
        {
            id: 'phone-toggle',
            className: 'btn phone-btn rounded-circle',
            ariaLabel: 'Phone Toggle',
            imgId: 'phone-icon',
            imgSrc: '/static/images/phone_icon_on_light.svg',
            imgAlt: 'Phone Toggle',
            marginLeft: ''
        },
        {
            id: 'match-toggle',
            className: 'btn match-btn rounded-circle',
            ariaLabel: 'Match Toggle',
            imgId: 'match-icon',
            imgSrc: '/static/images/sentence_match_icon_off_light.svg',
            imgAlt: 'Match Toggle',
            marginLeft: 'margin-left: 0.5rem;'
        },
        {
            id: 'semantic-toggle',
            className: 'btn semantic-btn rounded-circle',
            ariaLabel: 'Semantic Toggle',
            imgId: 'semantic-icon',
            imgSrc: '/static/images/abc_icon_off_light.svg',
            imgAlt: 'Semantic Toggle',
            marginLeft: 'margin-left: 0.5rem;'
        },
        {
            id: 'ticket-toggle',
            className: 'btn ticket-btn rounded-circle',
            ariaLabel: 'Ticket Toggle',
            imgId: 'ticket-icon',
            imgSrc: '/static/images/ticket_icon_off_light.svg',
            imgAlt: 'Ticket Toggle',
            marginLeft: 'margin-left: 0.5rem;'
        }
    ];

    // Create and append each button
    buttonConfigs.forEach(config => {
        const button = document.createElement('button');
        button.id = config.id;
        button.className = config.className;
        button.setAttribute('aria-label', config.ariaLabel);
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

    // Return the button elements for any initialization that needs them
    return {
        phoneBtn: container.querySelector('#phone-toggle'),
        matchBtn: container.querySelector('#match-toggle'),
        semanticBtn: container.querySelector('#semantic-toggle'),
        ticketBtn: container.querySelector('#ticket-toggle')
    };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Fallback for HTTP contexts
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    textArea.focus();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
}

async function handleCopy(ticketId, button) {
  try {
    await copyToClipboard(ticketId);

    // Hide tooltip immediately after successful copy
    const tooltip = bootstrap.Tooltip.getInstance(button);
    if (tooltip) tooltip.hide();

    // Change to check mark
    const icon = button.querySelector('i');
    icon.className = 'bi bi-check-lg';
    button.classList.remove('btn-outline-primary');
    button.classList.add('btn-success');

    // Revert after 3 seconds
    setTimeout(() => {
      icon.className = 'bi bi-clipboard';
      button.classList.remove('btn-success');
      button.classList.add('btn-outline-primary');
    }, 3000);
  } catch (err) {
    console.error('Copy failed:', err);
  }
  event?.stopPropagation();
}

function displaySearchResults(data, searchValue, searchType) {
  const container = document.getElementById('content-area');

  // Result counter
  let html = `<h4 class="mb-3">Found ${data.resultCount} result(s) for ${searchType} "${searchValue}"</h4>`;
  
  // Accordion for tickets
  html += '<div class="accordion" id="ticketsAccordion">';
  
  data.result.forEach((ticket, index) => {
    const createdDate = new Date(ticket.createdDate).toLocaleDateString();
    const completedDate = ticket.completedDate ? new Date(ticket.completedDate).toLocaleDateString() : 'N/A';
    
    html += `
      <div class="accordion-item">
        <h2 class="accordion-header" style="display: flex; align-items: center; padding-left: 0.5rem;">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="handleCopy('${ticket.id}', this)" data-bs-toggle="tooltip" data-bs-placement="top" title="Copy ticket number">
            <i class="bi bi-clipboard"></i>
          </button>
          <button class="accordion-button collapsed"
                  type="button" data-bs-toggle="collapse"
                  data-bs-target="#collapse${ticket.id}" aria-expanded="false" style="flex-grow: 1;">
            ${ticket.id} - ${ticket.title}
          </button>
        </h2>
        <div id="collapse${ticket.id}" class="accordion-collapse collapse">
          <div class="accordion-body">
            <div class="row">
              <div class="col-md-6">
                <p><strong>Description:</strong> ${ticket.description}</p>
                <p><strong>Status:</strong> <span class="badge bg-${ticket.statusValue === 'Closed' ? 'success' : ticket.statusValue === 'Open' ? 'danger' : 'warning'}">${ticket.statusValue}</span></p>
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
                ${searchType === 'phone number'
                  ? `<p><strong>Contact Method:</strong> ${ticket.contactMethod || 'N/A'}</p>`
                  : `<p><strong>Resolution Notes:</strong> ${ticket.resolutionNotes || 'N/A'}</p>`
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;

  // Initialize Bootstrap tooltips for copy buttons
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.forEach(tooltipTriggerEl => {
    new bootstrap.Tooltip(tooltipTriggerEl);
  });
}

function displayAssignmentRecommendations(data) {
  const container = document.getElementById('content-area');

  // Display section header for AI recommendations
  let html = '<h4 class="mb-3">AI Assignment Recommendations</h4>';

  // Check if there's an error response
  if (data.error) {
    html += `
      <div class="alert alert-danger">
        <h5>AI Analysis Error</h5>
        <p>${data.error}</p>
      </div>
    `;
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
                <p class="mb-0">${data.detailed_explanation || 'No detailed analysis available.'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function displaySimilarTickets(data) {
  const container = document.getElementById('content-area');

  // Append to existing content - similar tickets go after original ticket
  let html = '';

  // Accordion for similar tickets
  html += '<div class="accordion mt-5" id="similarTicketsAccordion">';

  data.forEach((ticket, index) => {
    const createdDate = new Date(ticket.createdDate).toLocaleDateString();
    const completedDate = ticket.completedDate ? new Date(ticket.completedDate).toLocaleDateString() : 'N/A';

    html += `
      <div class="accordion-item">
        <h2 class="accordion-header" style="display: flex; align-items: center; padding-left: 0.5rem;">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="handleCopy('${ticket.id}', this)" data-bs-toggle="tooltip" data-bs-placement="top" title="Copy ticket number">
            <i class="bi bi-clipboard"></i>
          </button>
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseSimilar${index}" aria-expanded="false" style="flex-grow: 1;">
            ${ticket.id} - ${ticket.title}
          </button>
        </h2>
        <div id="collapseSimilar${index}" class="accordion-collapse collapse">
          <div class="accordion-body">
            <div class="row">
              <div class="col-md-6">
                <p><strong>Description:</strong> ${ticket.description}</p>
                <p><strong>Status:</strong> <span class="badge bg-${ticket.statusValue === 'Closed' ? 'success' : ticket.statusValue === 'Open' || ticket.statusValue === 'Active' ? 'danger' : 'warning'}">${ticket.statusValue}</span></p>
                <p><strong>Priority:</strong> <span class="badge bg-info">${ticket.priorityValue}</span></p>
                <p><strong>Assigned To:</strong> ${ticket.assignedTo_DisplayName || 'Unassigned'}</p>
                <p><strong>Affected User:</strong> ${ticket.affectedUser_DisplayName || 'N/A'}</p>
              </div>
              <div class="col-md-6">
                <p><strong>Created:</strong> ${createdDate}</p>
                <p><strong>Completed:</strong> ${completedDate}</p>
                <p><strong>Location:</strong> ${ticket.locationValue || 'N/A'}</p>
                <p><strong>Source:</strong> ${ticket.sourceValue || 'N/A'}</p>
                <p><strong>Support Group:</strong> ${ticket.supportGroupValue || 'N/A'}</p>
                <p><strong>Resolution Notes:</strong> ${ticket.resolutionNotes || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML += html;

  // Initialize Bootstrap tooltips for copy buttons
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.forEach(tooltipTriggerEl => {
    new bootstrap.Tooltip(tooltipTriggerEl);
  });
}

function displayOriginalTicket(data) {
  const container = document.getElementById('content-area');

  // Display header indicating this is the main ticket being analyzed
  let html = '<h4 class="mb-3">Ticket for Assignment Analysis</h4>';

  // Accordion for the single original ticket
  html += '<div class="accordion" id="originalTicketAccordion">';

  const ticket = data;
  const createdDate = new Date(ticket.created_at).toLocaleDateString();
  const completedDate = ticket.completed_at ? new Date(ticket.completed_at).toLocaleDateString() : 'N/A';

  html += `
    <div class="accordion-item">
      <h2 class="accordion-header" style="display: flex; align-items: center; padding-left: 0.5rem;">
        <button class="btn btn-sm btn-outline-primary me-2" onclick="handleCopy('${ticket.id}', this)" data-bs-toggle="tooltip" data-bs-placement="top" title="Copy ticket number">
          <i class="bi bi-clipboard"></i>
        </button>
        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse"
                data-bs-target="#collapseOriginal" aria-expanded="false" style="flex-grow: 1;">
          ${ticket.id} - ${ticket.title}
        </button>
      </h2>
      <div id="collapseOriginal" class="accordion-collapse collapse">
        <div class="accordion-body">
          <div class="row">
            <div class="col-md-6">
              <p><strong>Description:</strong> ${ticket.description}</p>
              <p><strong>Status:</strong> <span class="badge bg-${ticket.status === 'Closed' ? 'success' : ticket.status === 'Active' || ticket.status === 'Open' && ticket.status !== 'Resolved' ? 'danger' : 'warning'}">${ticket.status}</span></p>
              <p><strong>Priority:</strong> <span class="badge bg-${ticket.priority === '1' || ticket.priority === 'High' ? 'danger' : ticket.priority === '2' || ticket.priority === 'Medium' ? 'warning' : 'secondary'}">${ticket.priority}</span></p>
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

  html += '</div>';
  container.innerHTML += html;

  // Initialize Bootstrap tooltips for copy buttons
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.forEach(tooltipTriggerEl => {
    new bootstrap.Tooltip(tooltipTriggerEl);
  });
}

// Initialize phone, match, semantic, and ticket on page load
document.addEventListener('DOMContentLoaded', function() {
  // Create and initialize search toggle buttons
  const searchButtons = createSearchToggleButtons();

  const phone = ToggleButton.loadPreference(true, 'phoneOn', 'phone_icon', 'phone-icon', 'phone-toggle');
  const match = ToggleButton.loadPreference(false, 'matchOn', 'sentence_match_icon', 'match-icon', 'match-toggle');
  const semantic = ToggleButton.loadPreference(false, 'semanticOn', 'abc_icon', 'semantic-icon', 'semantic-toggle');
  const ticket = ToggleButton.loadPreference(false, 'ticketOn', 'ticket_icon', 'ticket-icon', 'ticket-toggle');

  // Initialize assignment toggle buttons
  const singleTicket = ToggleButton.loadPreference(true, 'singleTicketOn', 'single_ticket_icon', 'single_ticket-icon', 'single_ticket-toggle');
  const multipleTickets = ToggleButton.loadPreference(false, 'multipleTicketsOn', 'multiple_tickets_icon', 'multiple_tickets-icon', 'multiple_tickets-toggle');

  // Set placeholder based on currently active toggle
  const searchInput = document.getElementById('ticket-search-input');
  if (searchInput) {
    if (phone.isOn) {
      searchInput.placeholder = 'Search tickets by phone number.';
    } else if (match.isOn) {
      searchInput.placeholder = 'Search tickets by exact sentence match.';
    } else if (semantic.isOn) {
      searchInput.placeholder = 'Search tickets by semantic description.';
    } else if (ticket.isOn) {
      searchInput.placeholder = 'Search for similar tickets using vectors.';
    } else if (singleTicket.isOn) {
      searchInput.placeholder = 'Get advice on ticket assignment. Enter a ticket number.';
    } else if (multipleTickets.isOn) {
      searchInput.placeholder = 'Batch ticket assignment will be available in a future update.';
    }
  }

  // Listen for theme changes to update icons
  document.addEventListener('themeChanged', function(e) {
    const isDark = e.detail.isDark;
    phone.applyIcon(isDark);
    match.applyIcon(isDark);
    semantic.applyIcon(isDark);
    ticket.applyIcon(isDark);
    singleTicket.applyIcon(isDark);
    multipleTickets.applyIcon(isDark);
  });

  // Phone toggle button functionality
  const phoneButton = document.getElementById('phone-toggle');
  if (phoneButton) {
    phoneButton.addEventListener('click', function() {
      if (phone.isOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on phone, turn off match and semantic and ticket
        phone.isOn = true;
        match.isOn = false;
        semantic.isOn = false;
        ticket.isOn = false;
        // Apply changes
        phone.applyIcon(ToggleButton.currentThemeIsDark());
        match.applyIcon(ToggleButton.currentThemeIsDark());
        semantic.applyIcon(ToggleButton.currentThemeIsDark());
        ticket.applyIcon(ToggleButton.currentThemeIsDark());
        // Save preferences
        phone.savePreference();
        match.savePreference();
        semantic.savePreference();
        ticket.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Search tickets by phone number.';
        }
      }
    });
  }

  // Match toggle button functionality
  const matchButton = document.getElementById('match-toggle');
  if (matchButton) {
    matchButton.addEventListener('click', function() {
      if (match.isOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on match, turn off phone and semantic and ticket
        match.isOn = true;
        phone.isOn = false;
        semantic.isOn = false;
        ticket.isOn = false;
        // Apply changes
        match.applyIcon(ToggleButton.currentThemeIsDark());
        phone.applyIcon(ToggleButton.currentThemeIsDark());
        semantic.applyIcon(ToggleButton.currentThemeIsDark());
        ticket.applyIcon(ToggleButton.currentThemeIsDark());
        // Save preferences
        match.savePreference();
        phone.savePreference();
        semantic.savePreference();
        ticket.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Search tickets by exact sentence match.';
        }
      }
    });
  }

  // Semantic toggle button functionality
  const semanticButton = document.getElementById('semantic-toggle');
  if (semanticButton) {
    semanticButton.addEventListener('click', function() {
      if (semantic.isOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on semantic, turn off phone and match and ticket
        semantic.isOn = true;
        phone.isOn = false;
        match.isOn = false;
        ticket.isOn = false;
        // Apply changes
        semantic.applyIcon(ToggleButton.currentThemeIsDark());
        phone.applyIcon(ToggleButton.currentThemeIsDark());
        match.applyIcon(ToggleButton.currentThemeIsDark());
        ticket.applyIcon(ToggleButton.currentThemeIsDark());
        // Save preferences
        semantic.savePreference();
        phone.savePreference();
        match.savePreference();
        ticket.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Search tickets by semantic description.';
        }
      }
    });
  }

  // Ticket toggle button functionality
  const ticketButton = document.getElementById('ticket-toggle');
  if (ticketButton) {
    ticketButton.addEventListener('click', function() {
      if (ticket.isOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on ticket, turn off phone and match and semantic
        ticket.isOn = true;
        phone.isOn = false;
        match.isOn = false;
        semantic.isOn = false;
        // Apply changes
        ticket.applyIcon(ToggleButton.currentThemeIsDark());
        phone.applyIcon(ToggleButton.currentThemeIsDark());
        match.applyIcon(ToggleButton.currentThemeIsDark());
        semantic.applyIcon(ToggleButton.currentThemeIsDark());
        // Save preferences
        ticket.savePreference();
        phone.savePreference();
        match.savePreference();
        semantic.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Search for similar tickets using vectors.';
        }
      }
    });
  }

  // Single ticket toggle button functionality
  const singleTicketButton = document.getElementById('single_ticket-toggle');
  if (singleTicketButton) {
    singleTicketButton.addEventListener('click', function() {
      if (singleTicket.isOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on single ticket, turn off multiple tickets
        singleTicket.isOn = true;
        multipleTickets.isOn = false;
        // Apply changes
        singleTicket.applyIcon(ToggleButton.currentThemeIsDark());
        multipleTickets.applyIcon(ToggleButton.currentThemeIsDark());
        // Save preferences
        singleTicket.savePreference();
        multipleTickets.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Get advice on ticket assignment. Enter a ticket number.';
        }
      }
    });
  }

  // Multiple tickets toggle button functionality
  const multipleTicketsButton = document.getElementById('multiple_tickets-toggle');
  if (multipleTicketsButton) {
    multipleTicketsButton.addEventListener('click', function() {
      if (multipleTickets.isOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on multiple tickets, turn off single ticket
        multipleTickets.isOn = true;
        singleTicket.isOn = false;
        // Apply changes
        multipleTickets.applyIcon(ToggleButton.currentThemeIsDark());
        singleTicket.applyIcon(ToggleButton.currentThemeIsDark());
        // Save preferences
        multipleTickets.savePreference();
        singleTicket.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Batch ticket assignment will be available in a future update.';
        }
      }
    });
  }

  // Ticket search button functionality
  const searchButton = document.getElementById('ticket-search-button');
  if (searchButton) {
    searchButton.addEventListener('click', async function() {
      const searchInputElement = document.getElementById('ticket-search-input');
      const searchValue = searchInputElement.value.trim();
      if (!searchValue) {
        alert('Please enter search text');
        return;
      }

      // Check for assignment mode
      if (searchInputElement.placeholder.includes('ticket assignment')) {
        // Disable search button and show loading state
        searchButton.disabled = true;
        searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

        // Ensure content area exists
        if (!document.getElementById('content-area')) {
          const contentArea = document.createElement('div');
          contentArea.id = 'content-area';
          contentArea.className = 'mt-4';
          const mainContent = document.querySelector('.main-content');
          mainContent.appendChild(contentArea);
        }

        // Show loading spinner in content area
        document.getElementById('content-area').innerHTML = '<div class="d-flex justify-content-center my-4"><div class="spinner-grow text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>';

        try {
          const bodyObj = { ticketId: searchValue };
          const response = await fetch('/api/get-ticket-advice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj)
          });
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();

          // Debug: Log the API response
          console.log("Assignment API response:", data);

          // Display AI recommendations first
          console.log("Checking for AI recommendation data:");
          console.log("recommended_support_group:", data.recommended_support_group);
          console.log("recommended_priority_level:", data.recommended_priority_level);
          console.log("detailed_explanation:", data.detailed_explanation);

          if (data.recommended_support_group || data.recommended_priority_level || data.detailed_explanation) {
            console.log("Displaying AI recommendations");
            displayAssignmentRecommendations(data);
          } else {
            console.log("No AI recommendation data found - skipping display");
          }

          displayOriginalTicket(data.original_data, searchValue);

          // Add visual separator and label for similar tickets
          const container = document.getElementById('content-area');
          container.innerHTML += '<div class="mt-5 pt-4 border-top text-start"><h4>Similar Tickets Used for Assignment Analysis</h4></div>';

          if (data.similar_tickets && data.similar_tickets.length > 0) {
            displaySimilarTickets(data.similar_tickets, searchValue);
          }
        } catch (error) {
          // Ensure content area exists for error message
          if (!document.getElementById('content-area')) {
            const contentArea = document.createElement('div');
            contentArea.id = 'content-area';
            contentArea.className = 'mt-4';
            const mainContent = document.querySelector('.main-content');
            mainContent.appendChild(contentArea);
          }
          document.getElementById('content-area').innerHTML = '<div class="alert alert-danger">Error getting advice: ' + error.message + '</div>';
        } finally {
          // Re-enable search button and reset text
          searchButton.disabled = false;
          searchButton.innerHTML = '<i class="bi bi-search"></i>';
        }
        return;
      }

      // Disable search button and show loading state
      searchButton.disabled = true;
      searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

      // Show loading spinner in content area
      document.getElementById('content-area').innerHTML = '<div class="d-flex justify-content-center my-4"><div class="spinner-grow text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>';

      try {
        let bodyObj, searchType;
        if (phone.isOn) {
          bodyObj = { contactMethod: searchValue, contains: true };
          searchType = 'phone number';
        } else if (match.isOn) {
          bodyObj = { description: searchValue, contains: true };
          searchType = 'exact match';
        } else if (semantic.isOn) {
          bodyObj = { semanticDescription: searchValue };
          searchType = 'semantic similarity';
        } else if (ticket.isOn) {
          bodyObj = { ticketId: searchValue };
          searchType = 'ticket-based vector search';
        } else {
          // Default to match if none selected (though mutually exclusive)
          bodyObj = { description: searchValue, contains: true };
          searchType = 'description';
        }

        const response = await fetch('/api/search-tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        displaySearchResults(data, searchValue, searchType);
      } catch (error) {
        document.getElementById('content-area').innerHTML =
          '<div class="alert alert-danger">Error searching tickets: ' + error.message + '</div>';
      } finally {
        // Re-enable search button and reset text
        searchButton.disabled = false;
        searchButton.innerHTML = '<i class="bi bi-search"></i>';
      }
    });
  }

  // Ticket assignment navigation button functionality
  const assignmentBtn = document.getElementById('ticket-assignment-nav-btn');
  if (assignmentBtn) {
    assignmentBtn.addEventListener('click', function() {
      // Remove any existing toggle buttons (assignment ones if present, keep search ones)
      document.querySelectorAll('.main-content .d-flex:not(:has(#phone-toggle))').forEach(div => div.remove());
      // Hide search buttons by changing Bootstrap utility classes
      const searchDiv = document.getElementById('phone-toggle').closest('.d-flex');
      if (searchDiv) {
        searchDiv.classList.remove('d-flex');
        searchDiv.classList.add('d-none');
      }

      // Add assignment toggle buttons if not present
      const assignmentToggleDiv = document.createElement('div');
      assignmentToggleDiv.className = 'd-flex justify-content-center align-items-center mb-4';
      assignmentToggleDiv.innerHTML = `
        <button id="single_ticket-toggle" class="btn single-ticket-btn rounded-circle" aria-label="Single Ticket Toggle">
          <img id="single_ticket-icon" src="/static/images/single_ticket_icon_on_light.svg" alt="Single Ticket Toggle" class="img-fluid">
        </button>
        <button id="multiple_tickets-toggle" class="btn multiple-tickets-btn rounded-circle" aria-label="Multiple Tickets Toggle" style="margin-left: 0.5rem;">
          <img id="multiple_tickets-icon" src="/static/images/multiple_tickets_icon_off_light.svg" alt="Multiple Tickets Toggle" class="img-fluid">
        </button>
      `;
      const mainContent = document.querySelector('.main-content');
      const searchGroup = mainContent.querySelector('.input-group');
      if (searchGroup) {
        searchGroup.insertAdjacentElement('afterend', assignmentToggleDiv);
      }

      // Ensure content area exists
      if (!document.getElementById('content-area')) {
        const contentArea = document.createElement('div');
        contentArea.id = 'content-area';
        contentArea.className = 'mt-4';
        mainContent.appendChild(contentArea);
      }

      // Set assignment toggles on, search off
      phone.isOn = false;
      match.isOn = false;
      semantic.isOn = false;
      ticket.isOn = false;
      singleTicket.isOn = true;
      multipleTickets.isOn = false;

      // Apply changes
      phone.applyIcon(ToggleButton.currentThemeIsDark());
      match.applyIcon(ToggleButton.currentThemeIsDark());
      semantic.applyIcon(ToggleButton.currentThemeIsDark());
      ticket.applyIcon(ToggleButton.currentThemeIsDark());
      singleTicket.applyIcon(ToggleButton.currentThemeIsDark());
      multipleTickets.applyIcon(ToggleButton.currentThemeIsDark());

      // Save preferences
      phone.savePreference();
      match.savePreference();
      semantic.savePreference();
      ticket.savePreference();
      singleTicket.savePreference();
      multipleTickets.savePreference();

      // Update placeholder
      const searchInput = document.getElementById('ticket-search-input');
      if (searchInput) {
        searchInput.placeholder = 'Get advice on ticket assignment. Enter a ticket number.';
      }

      // Clear content area
      document.getElementById('content-area').innerHTML = '';
    });
  }

  // Ticket search navigation button functionality
  const searchNavBtn = document.getElementById('ticket-search-nav-btn');
  if (searchNavBtn) {
    searchNavBtn.addEventListener('click', function() {
      // Remove any existing toggle buttons (assignment ones if present)
      document.querySelectorAll('.main-content .d-flex:not(:has(#phone-toggle))').forEach(div => div.remove());
      // Show search buttons by changing Bootstrap utility classes
      const searchDiv = document.getElementById('phone-toggle').closest('.d-none');
      if (searchDiv) {
        searchDiv.classList.remove('d-none');
        searchDiv.classList.add('d-flex');
      }

      // Ensure content area exists
      if (!document.getElementById('content-area')) {
        const contentArea = document.createElement('div');
        contentArea.id = 'content-area';
        contentArea.className = 'mt-4';
        const mainContent = document.querySelector('.main-content');
        mainContent.appendChild(contentArea);
      }

      // Set search toggles on, assignment off
      phone.isOn = true;
      match.isOn = false;
      semantic.isOn = false;
      ticket.isOn = false;
      singleTicket.isOn = false;
      multipleTickets.isOn = false;

      // Apply changes
      phone.applyIcon(ToggleButton.currentThemeIsDark());
      match.applyIcon(ToggleButton.currentThemeIsDark());
      semantic.applyIcon(ToggleButton.currentThemeIsDark());
      ticket.applyIcon(ToggleButton.currentThemeIsDark());
      singleTicket.applyIcon(ToggleButton.currentThemeIsDark());
      multipleTickets.applyIcon(ToggleButton.currentThemeIsDark());

      // Save preferences
      phone.savePreference();
      match.savePreference();
      semantic.savePreference();
      ticket.savePreference();
      singleTicket.savePreference();
      multipleTickets.savePreference();

      // Update placeholder
      const searchInput = document.getElementById('ticket-search-input');
      if (searchInput) {
        searchInput.placeholder = 'Search tickets by phone number.';
      }

      // Clear content area
      document.getElementById('content-area').innerHTML = '';
    });
  }

});

console.log('Script loaded and initialized.');
