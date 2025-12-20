console.log('Script loaded. ToggleButton available:', typeof ToggleButton);


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
          <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" 
                  type="button" data-bs-toggle="collapse" 
                  data-bs-target="#collapse${ticket.id}" aria-expanded="${index === 0}" style="flex-grow: 1;">
            ${ticket.id} - ${ticket.title}
          </button>
        </h2>
        <div id="collapse${ticket.id}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}">
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

// Initialize phone, match, semantic, and ticket on page load
document.addEventListener('DOMContentLoaded', function() {
  const phone = ToggleButton.loadPreference(true, 'phoneOn', 'phone_icon', 'phone-icon', 'phone-toggle');
  const match = ToggleButton.loadPreference(false, 'matchOn', 'sentence_match_icon', 'match-icon', 'match-toggle');
  const semantic = ToggleButton.loadPreference(false, 'semanticOn', 'abc_icon', 'semantic-icon', 'semantic-toggle');
  const ticket = ToggleButton.loadPreference(false, 'ticketOn', 'ticket_icon', 'ticket-icon', 'ticket-toggle');

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
    }
  }

  // Listen for theme changes to update icons
  document.addEventListener('themeChanged', function(e) {
    const isDark = e.detail.isDark;
    phone.applyIcon(isDark);
    match.applyIcon(isDark);
    semantic.applyIcon(isDark);
    ticket.applyIcon(isDark);
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
          displaySearchResults(data, searchValue, 'ticket data');
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
      // Remove any existing toggle buttons (search or assignment)
      const toggleDiv = document.querySelector('.main-content .d-flex');
      if (toggleDiv) toggleDiv.remove();

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

      // Remove content area
      const contentArea = document.getElementById('content-area');
      if (contentArea) contentArea.remove();

      // Add back content area if not present
      if (!document.getElementById('content-area')) {
        const newContentArea = document.createElement('div');
        newContentArea.id = 'content-area';
        newContentArea.className = 'mt-4';
        newContentArea.innerHTML = '<!-- Assignment content will go here -->';
        mainContent.appendChild(newContentArea);
      }

      // Initialize assignment toggle button instances
      const singleTicket = ToggleButton.loadPreference(true, 'singleTicketOn', 'single_ticket_icon', 'single_ticket-icon', 'single_ticket-toggle');
      const multipleTickets = ToggleButton.loadPreference(false, 'multipleTicketsOn', 'multiple_tickets_icon', 'multiple_tickets-icon', 'multiple_tickets-toggle');

      // Set placeholder based on currently active assignment toggle
      const searchInput = document.getElementById('ticket-search-input');
      if (searchInput) {
        if (singleTicket.isOn) {
          searchInput.placeholder = 'Get advice on ticket assignment. Enter a ticket number.';
        } else if (multipleTickets.isOn) {
          searchInput.placeholder = 'Batch ticket assignment will be available in a future update.';
        }
      }

      // Re-attach theme change listener for assignment toggles
      document.addEventListener('themeChanged', function(e) {
        const isDark = e.detail.isDark;
        singleTicket.applyIcon(isDark);
        multipleTickets.applyIcon(isDark);
      });

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
    });
  }

  // Ticket search navigation button functionality
  const searchNavBtn = document.getElementById('ticket-search-nav-btn');
  if (searchNavBtn) {
    searchNavBtn.addEventListener('click', function() {
      // Remove any existing toggle buttons (search or assignment)
      const existingToggleDiv = document.querySelector('.main-content .d-flex');
      if (existingToggleDiv) existingToggleDiv.remove();

      // Now add back search toggle buttons
      const toggleDiv = document.createElement('div');
      toggleDiv.className = 'd-flex justify-content-center align-items-center mb-4';
      toggleDiv.innerHTML = `
          <button id="phone-toggle" class="btn phone-btn rounded-circle" aria-label="Phone Toggle">
            <img id="phone-icon" src="/static/images/phone_icon_on_light.svg" alt="Phone Toggle" class="img-fluid">
          </button>
          <button id="match-toggle" class="btn match-btn rounded-circle" aria-label="Match Toggle" style="margin-left: 0.5rem;">
            <img id="match-icon" src="/static/images/sentence_match_icon_off_light.svg" alt="Match Toggle" class="img-fluid">
          </button>
          <button id="semantic-toggle" class="btn semantic-btn rounded-circle" aria-label="Semantic Toggle" style="margin-left: 0.5rem;">
            <img id="semantic-icon" src="/static/images/abc_icon_off_light.svg" alt="Semantic Toggle" class="img-fluid">
          </button>
          <button id="ticket-toggle" class="btn ticket-btn rounded-circle" aria-label="Ticket Toggle" style="margin-left: 0.5rem;">
            <img id="ticket-icon" src="/static/images/ticket_icon_off_light.svg" alt="Ticket Toggle" class="img-fluid">
          </button>
        `;
      const mainContent = document.querySelector('.main-content');
      const searchGroup = mainContent.querySelector('.input-group');
      if (searchGroup) {
        searchGroup.insertAdjacentElement('afterend', toggleDiv);
      }
      // Add back content area if not present
      if (!document.getElementById('content-area')) {
        const contentArea = document.createElement('div');
        contentArea.id = 'content-area';
        contentArea.className = 'mt-4';
        contentArea.innerHTML = '<!-- Dynamic content will go here -->';
        const mainContent = document.querySelector('.main-content');
        mainContent.appendChild(contentArea);
      }
      // Re-initialize toggle button instances
      const phone = ToggleButton.loadPreference(true, 'phoneOn', 'phone_icon', 'phone-icon', 'phone-toggle');
      const match = ToggleButton.loadPreference(false, 'matchOn', 'sentence_match_icon', 'match-icon', 'match-toggle');
      const semantic = ToggleButton.loadPreference(false, 'semanticOn', 'abc_icon', 'semantic-icon', 'semantic-toggle');
      const ticket = ToggleButton.loadPreference(false, 'ticketOn', 'ticket_icon', 'ticket-icon', 'ticket-toggle');
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
        }
      }
      // Re-attach theme change listener for re-initialized toggles
      document.addEventListener('themeChanged', function(e) {
        const isDark = e.detail.isDark;
        phone.applyIcon(isDark);
        match.applyIcon(isDark);
        semantic.applyIcon(isDark);
        ticket.applyIcon(isDark);
      });

      // Re-attach toggle button event listeners for dynamically created buttons
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
    });
  }
});
