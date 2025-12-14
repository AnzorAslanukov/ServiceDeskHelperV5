class PhoneToggle {
  constructor(isPhoneOn, themeIsDark) {
    this.isPhoneOn = isPhoneOn;
    this.applyIcon(themeIsDark);
    this.savePreference();
  }

  applyIcon(themeIsDark) {
    const icon = document.getElementById('phone-icon');
    if (icon) {
      const state = this.isPhoneOn ? 'on' : 'off';
      const theme = themeIsDark ? 'dark' : 'light';
      icon.src = '/static/images/phone_icon_' + state + '_' + theme + '.svg';
      icon.alt = this.isPhoneOn ? 'Switch to Off' : 'Switch to On';
    }
    // Update CSS class
    const btn = document.getElementById('phone-toggle');
    if (btn) {
      if (this.isPhoneOn) {
        btn.classList.remove('off');
      } else {
        btn.classList.add('off');
      }
    }
  }

  savePreference() {
    localStorage.setItem('phoneOn', this.isPhoneOn ? 'true' : 'false');
  }

  static loadPreference() {
    const saved = localStorage.getItem('phoneOn');
    const isOn = saved !== 'false'; // default true
    const themeIsDark = PhoneToggle.currentThemeIsDark();
    return new PhoneToggle(isOn, themeIsDark);
  }

  static currentThemeIsDark() {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  }
}

class MatchToggle {
  constructor(isMatchOn, themeIsDark) {
    this.isMatchOn = isMatchOn;
    this.applyIcon(themeIsDark);
    this.savePreference();
  }

  applyIcon(themeIsDark) {
    const icon = document.getElementById('match-icon');
    if (icon) {
      const state = this.isMatchOn ? 'on' : 'off';
      const theme = themeIsDark ? 'dark' : 'light';
      icon.src = '/static/images/sentence_match_icon_' + state + '_' + theme + '.svg';
      icon.alt = this.isMatchOn ? 'Switch to Off' : 'Switch to On';
    }
    // Update CSS class
    const btn = document.getElementById('match-toggle');
    if (btn) {
      if (this.isMatchOn) {
        btn.classList.remove('off');
      } else {
        btn.classList.add('off');
      }
    }
  }

  savePreference() {
    localStorage.setItem('matchOn', this.isMatchOn ? 'true' : 'false');
  }

  static loadPreference() {
    const saved = localStorage.getItem('matchOn');
    const isOn = saved === 'true'; // default false
    const themeIsDark = MatchToggle.currentThemeIsDark();
    return new MatchToggle(isOn, themeIsDark);
  }

  static currentThemeIsDark() {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  }
}

class SemanticToggle {
  constructor(isSemanticOn, themeIsDark) {
    this.isSemanticOn = isSemanticOn;
    this.applyIcon(themeIsDark);
    this.savePreference();
  }

  applyIcon(themeIsDark) {
    const icon = document.getElementById('semantic-icon');
    if (icon) {
      const state = this.isSemanticOn ? 'on' : 'off';
      const theme = themeIsDark ? 'dark' : 'light';
      icon.src = '/static/images/abc_icon_' + state + '_' + theme + '.svg';
      icon.alt = this.isSemanticOn ? 'Switch to Off' : 'Switch to On';
    }
    // Update CSS class
    const btn = document.getElementById('semantic-toggle');
    if (btn) {
      if (this.isSemanticOn) {
        btn.classList.remove('off');
      } else {
        btn.classList.add('off');
      }
    }
  }

  savePreference() {
    localStorage.setItem('semanticOn', this.isSemanticOn ? 'true' : 'false');
  }

  static loadPreference() {
    const saved = localStorage.getItem('semanticOn');
    const isOn = saved === 'true'; // default false
    const themeIsDark = SemanticToggle.currentThemeIsDark();
    return new SemanticToggle(isOn, themeIsDark);
  }

  static currentThemeIsDark() {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  }
}

class TicketToggle {
  constructor(isTicketOn, themeIsDark) {
    this.isTicketOn = isTicketOn;
    this.applyIcon(themeIsDark);
    this.savePreference();
  }

  applyIcon(themeIsDark) {
    const icon = document.getElementById('ticket-icon');
    if (icon) {
      const state = this.isTicketOn ? 'on' : 'off';
      const theme = themeIsDark ? 'dark' : 'light';
      icon.src = '/static/images/ticket_icon_' + state + '_' + theme + '.svg';
      icon.alt = this.isTicketOn ? 'Switch to Off' : 'Switch to On';
    }
    // Update CSS class
    const btn = document.getElementById('ticket-toggle');
    if (btn) {
      if (this.isTicketOn) {
        btn.classList.remove('off');
      } else {
        btn.classList.add('off');
      }
    }
  }

  savePreference() {
    localStorage.setItem('ticketOn', this.isTicketOn ? 'true' : 'false');
  }

  static loadPreference() {
    const saved = localStorage.getItem('ticketOn');
    const isOn = saved === 'true'; // default false
    const themeIsDark = TicketToggle.currentThemeIsDark();
    return new TicketToggle(isOn, themeIsDark);
  }

  static currentThemeIsDark() {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  }
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
  const phone = PhoneToggle.loadPreference();
  const match = MatchToggle.loadPreference();
  const semantic = SemanticToggle.loadPreference();
  const ticket = TicketToggle.loadPreference();

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
      if (phone.isPhoneOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on phone, turn off match and semantic and ticket
        phone.isPhoneOn = true;
        match.isMatchOn = false;
        semantic.isSemanticOn = false;
        ticket.isTicketOn = false;
        // Apply changes
        phone.applyIcon(PhoneToggle.currentThemeIsDark());
        match.applyIcon(MatchToggle.currentThemeIsDark());
        semantic.applyIcon(SemanticToggle.currentThemeIsDark());
        ticket.applyIcon(TicketToggle.currentThemeIsDark());
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
      if (match.isMatchOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on match, turn off phone and semantic and ticket
        match.isMatchOn = true;
        phone.isPhoneOn = false;
        semantic.isSemanticOn = false;
        ticket.isTicketOn = false;
        // Apply changes
        match.applyIcon(MatchToggle.currentThemeIsDark());
        phone.applyIcon(PhoneToggle.currentThemeIsDark());
        semantic.applyIcon(SemanticToggle.currentThemeIsDark());
        ticket.applyIcon(TicketToggle.currentThemeIsDark());
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
      if (semantic.isSemanticOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on semantic, turn off phone and match and ticket
        semantic.isSemanticOn = true;
        phone.isPhoneOn = false;
        match.isMatchOn = false;
        ticket.isTicketOn = false;
        // Apply changes
        semantic.applyIcon(SemanticToggle.currentThemeIsDark());
        phone.applyIcon(PhoneToggle.currentThemeIsDark());
        match.applyIcon(MatchToggle.currentThemeIsDark());
        ticket.applyIcon(TicketToggle.currentThemeIsDark());
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
      if (ticket.isTicketOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on ticket, turn off phone and match and semantic
        ticket.isTicketOn = true;
        phone.isPhoneOn = false;
        match.isMatchOn = false;
        semantic.isSemanticOn = false;
        // Apply changes
        ticket.applyIcon(TicketToggle.currentThemeIsDark());
        phone.applyIcon(PhoneToggle.currentThemeIsDark());
        match.applyIcon(MatchToggle.currentThemeIsDark());
        semantic.applyIcon(SemanticToggle.currentThemeIsDark());
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

      // Disable search button and show loading state
      searchButton.disabled = true;
      searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

      // Show loading spinner in content area
      document.getElementById('content-area').innerHTML = '<div class="d-flex justify-content-center my-4"><div class="spinner-grow text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>';

      try {
        let bodyObj, searchType;
        if (phone.isPhoneOn) {
          bodyObj = { contactMethod: searchValue, contains: true };
          searchType = 'phone number';
        } else if (match.isMatchOn) {
          bodyObj = { description: searchValue, contains: true };
          searchType = 'exact match';
        } else if (semantic.isSemanticOn) {
          bodyObj = { semanticDescription: searchValue };
          searchType = 'semantic similarity';
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
});
