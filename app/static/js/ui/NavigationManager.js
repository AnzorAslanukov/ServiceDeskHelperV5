/**
 * NavigationManager - Handles navigation between Search and Assignment modes
 */
class NavigationManager {
  /**
   * Create a NavigationManager instance
   * @param {SearchUIManager} searchUIManager - Search UI manager instance
   * @param {AssignmentUIManager} assignmentUIManager - Assignment UI manager instance
   */
  constructor(searchUIManager, assignmentUIManager) {
    this.searchUIManager = searchUIManager;
    this.assignmentUIManager = assignmentUIManager;
    this.currentSection = 'search';
  }

  /**
   * Initialize navigation event listeners
   * @param {Object} callbacks - Callback functions for mode switches
   * @param {Function} callbacks.onSwitchToSearch - Called when switching to search mode
   * @param {Function} callbacks.onSwitchToAssignment - Called when switching to assignment mode
   */
  initialize(callbacks = {}) {
    debugLog('[NAVIGATION] - Initializing NavigationManager');

    const searchNavBtn = document.getElementById(CONSTANTS.SELECTORS.SEARCH_NAV_BTN);
    const assignmentNavBtn = document.getElementById(CONSTANTS.SELECTORS.ASSIGNMENT_NAV_BTN);

    if (searchNavBtn) {
      searchNavBtn.addEventListener('click', () => {
        this.switchToSearchMode();
        if (callbacks.onSwitchToSearch) {
          callbacks.onSwitchToSearch();
        }
      });
    }

    if (assignmentNavBtn) {
      assignmentNavBtn.addEventListener('click', () => {
        this.switchToAssignmentMode();
        if (callbacks.onSwitchToAssignment) {
          callbacks.onSwitchToAssignment();
        }
      });
    }

    debugLog('[NAVIGATION] - NavigationManager initialization complete');
  }

  /**
   * Switch to search mode
   */
  switchToSearchMode() {
    debugLog('[NAVIGATION] - Switching to search mode');
    this.currentSection = 'search';

    // Show search input
    this.searchUIManager.showSearchInput();

    // Remove assignment toggle buttons
    this.assignmentUIManager.remove();

    // Show search toggle buttons
    this.searchUIManager.show();

    // Clear content area
    TicketRenderer.clear();

    // Reset search toggles to phone default, assignment off
    this.searchUIManager.setActiveMode(CONSTANTS.MODES.PHONE);

    // Reset assignment toggles
    if (this.assignmentUIManager.toggles.single) {
      this.assignmentUIManager.toggles.single.isOn = false;
      this.assignmentUIManager.toggles.single.savePreference();
    }
    if (this.assignmentUIManager.toggles.multiple) {
      this.assignmentUIManager.toggles.multiple.isOn = false;
      this.assignmentUIManager.toggles.multiple.savePreference();
    }

    debugLog('[NAVIGATION] - Switched to search mode');
  }

  /**
   * Switch to assignment mode
   */
  switchToAssignmentMode() {
    debugLog('[NAVIGATION] - Switching to assignment mode');
    this.currentSection = 'assignment';

    // Hide search toggle buttons
    this.searchUIManager.hide();

    // Clear content area
    TicketRenderer.clear();

    // Create assignment toggle buttons
    const mainContent = document.querySelector(CONSTANTS.SELECTORS.MAIN_CONTENT);
    const searchGroup = mainContent?.querySelector(CONSTANTS.SELECTORS.INPUT_GROUP);

    // Re-initialize assignment UI in the correct location
    this.assignmentUIManager.initialize(searchGroup);

    // Set assignment toggles to single mode
    this.assignmentUIManager.setMode(CONSTANTS.MODES.SINGLE_TICKET);

    // Turn off all search toggles
    Object.values(this.searchUIManager.toggles).forEach(toggle => {
      if (toggle) {
        toggle.isOn = false;
        toggle.savePreference();
      }
    });

    debugLog('[NAVIGATION] - Switched to assignment mode');
  }

  /**
   * Get the current active section
   * @returns {string} 'search' or 'assignment'
   */
  getCurrentSection() {
    return this.currentSection;
  }
}
