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

class ABCToggle {
  constructor(isABCOn, themeIsDark) {
    this.isABCOn = isABCOn;
    this.applyIcon(themeIsDark);
    this.savePreference();
  }

  applyIcon(themeIsDark) {
    const icon = document.getElementById('abc-icon');
    if (icon) {
      const state = this.isABCOn ? 'on' : 'off';
      const theme = themeIsDark ? 'dark' : 'light';
      icon.src = '/static/images/abc_icon_' + state + '_' + theme + '.svg';
      icon.alt = this.isABCOn ? 'Switch to Off' : 'Switch to On';
    }
    // Update CSS class
    const btn = document.getElementById('abc-toggle');
    if (btn) {
      if (this.isABCOn) {
        btn.classList.remove('off');
      } else {
        btn.classList.add('off');
      }
    }
  }

  savePreference() {
    localStorage.setItem('abcOn', this.isABCOn ? 'true' : 'false');
  }

  static loadPreference() {
    const saved = localStorage.getItem('abcOn');
    const isOn = saved === 'true'; // default false
    const themeIsDark = ABCToggle.currentThemeIsDark();
    return new ABCToggle(isOn, themeIsDark);
  }

  static currentThemeIsDark() {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  }
}

async function handleCopy(ticketId, button) {
  try {
    await navigator.clipboard.writeText(ticketId);

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

function displaySearchResults(data, phoneNumber) {
  const container = document.getElementById('content-area');
  
  // Result counter
  let html = `<h4 class="mb-3">Found ${data.resultCount} result(s) for phone number ${phoneNumber}</h4>`;
  
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

// Initialize phone, and abc on page load
document.addEventListener('DOMContentLoaded', function() {
  const phone = PhoneToggle.loadPreference();
  const abc = ABCToggle.loadPreference();

  // Listen for theme changes to update icons
  document.addEventListener('themeChanged', function(e) {
    const isDark = e.detail.isDark;
    phone.applyIcon(isDark);
    abc.applyIcon(isDark);
  });

  // Phone toggle button functionality
  const phoneButton = document.getElementById('phone-toggle');
  if (phoneButton) {
    phoneButton.addEventListener('click', function() {
      if (phone.isPhoneOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on phone, turn off abc
        phone.isPhoneOn = true;
        abc.isABCOn = false;
        // Apply changes
        phone.applyIcon(PhoneToggle.currentThemeIsDark());
        abc.applyIcon(ABCToggle.currentThemeIsDark());
        // Save preferences
        phone.savePreference();
        abc.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Search tickets by phone number.';
        }
      }
    });
  }

  // ABC toggle button functionality
  const abcButton = document.getElementById('abc-toggle');
  if (abcButton) {
    abcButton.addEventListener('click', function() {
      if (abc.isABCOn) {
        // Already on, do nothing
        return;
      } else {
        // Turn on abc, turn off phone
        abc.isABCOn = true;
        phone.isPhoneOn = false;
        // Apply changes
        abc.applyIcon(ABCToggle.currentThemeIsDark());
        phone.applyIcon(PhoneToggle.currentThemeIsDark());
        // Save preferences
        abc.savePreference();
        phone.savePreference();
        // Update search placeholder
        const searchInput = document.getElementById('ticket-search-input');
        if (searchInput) {
          searchInput.placeholder = 'Search tickets by description sentence.';
        }
      }
    });
  }

  // Ticket search button functionality
  const searchButton = document.getElementById('ticket-search-button');
  if (searchButton) {
    searchButton.addEventListener('click', async function() {
      if (!phone.isPhoneOn) {
        alert('Please select phone search mode first');
        return;
      }

      const searchInputElement = document.getElementById('ticket-search-input');
      const searchValue = searchInputElement.value.trim();
      if (!searchValue) {
        alert('Please enter a phone number');
        return;
      }

      // Disable search button and show loading state
      searchButton.disabled = true;
      searchButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

      // Show loading spinner in content area
      document.getElementById('content-area').innerHTML = '<div class="d-flex justify-content-center my-4"><div class="spinner-grow text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>';

      try {
        const response = await fetch('/api/search-tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactMethod: searchValue, contains: true })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        displaySearchResults(data, searchValue);
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
