/**
 * Constants - Centralized configuration for all magic strings and defaults
 */

const CONSTANTS = {
  // Debug setting
  DEBUG: true,

  // DOM Element IDs and selectors
  SELECTORS: {
    // Containers
    CONTENT_AREA: 'content-area',
    SEARCH_TOGGLES_CONTAINER: 'search-toggles-container',
    BATCH_WORKFLOW_BUTTONS: 'batch-workflow-buttons',
    MAIN_CONTENT: '.main-content',
    INPUT_GROUP: '.input-group',

    // Navigation buttons
    SEARCH_NAV_BTN: 'ticket-search-nav-btn',
    ASSIGNMENT_NAV_BTN: 'ticket-assignment-nav-btn',

    // Search input
    SEARCH_INPUT: 'ticket-search-input',
    SEARCH_BUTTON: 'ticket-search-button',

    // Search toggles
    PHONE_TOGGLE: 'phone-toggle',
    PHONE_ICON: 'phone-icon',
    MATCH_TOGGLE: 'match-toggle',
    MATCH_ICON: 'match-icon',
    SEMANTIC_TOGGLE: 'semantic-toggle',
    SEMANTIC_ICON: 'semantic-icon',
    TICKET_TOGGLE: 'ticket-toggle',
    TICKET_ICON: 'ticket-icon',

    // Assignment toggles
    SINGLE_TICKET_TOGGLE: 'single_ticket-toggle',
    SINGLE_TICKET_ICON: 'single_ticket-icon',
    MULTIPLE_TICKETS_TOGGLE: 'multiple_tickets-toggle',
    MULTIPLE_TICKETS_ICON: 'multiple_tickets-icon',

    // Batch workflow
    GET_VALIDATION_TICKETS_BTN: 'get-validation-tickets-btn',
    GET_RECOMMENDATIONS_BTN: 'get-ticket-recommendations-btn',
    IMPLEMENT_ASSIGNMENT_BTN: 'implement-ticket-assignment-btn',
    BATCH_PROGRESS_INDICATOR: 'batch-progress-indicator',
    BATCH_PROGRESS_TEXT: 'batch-progress-text',
    VALIDATION_TOGGLE_ALL_BTN: 'validation-toggle-all-btn',
    VALIDATION_ACCORDION: 'validationTicketsAccordion',

    // CSS classes
    SPINNER_BORDER: 'spinner-border',
    ACCORDION_COLLAPSE: '.accordion-collapse',
    ACCORDION_BUTTON: '.accordion-button'
  },

  // Placeholder texts for search input
  PLACEHOLDERS: {
    PHONE: 'Search tickets by phone number.',
    MATCH: 'Search tickets by exact sentence match.',
    SEMANTIC: 'Search tickets by semantic description.',
    TICKET: 'Search for similar tickets using vectors.',
    SINGLE_TICKET: 'Get advice on ticket assignment. Enter a ticket number.',
    MULTIPLE_TICKETS: 'Batch ticket assignment will be available in a future update.'
  },

  // API endpoints
  API: {
    SEARCH_TICKETS: '/api/search-tickets',
    GET_TICKET_ADVICE: '/api/get-ticket-advice',
    GET_VALIDATION_TICKETS: '/api/get-validation-tickets'
  },

  // Default configuration values
  DEFAULTS: {
    BATCH_SIZE: 5,
    TRUNCATE_LENGTH_LONG: 250,
    TRUNCATE_LENGTH_SHORT: 100,
    CONTENT_PREVIEW_LENGTH: 200,
    MAX_RESULTS: 5,
    COPY_SUCCESS_DURATION: 3000
  },

  // Icon base names for ToggleButton
  ICONS: {
    PHONE: 'phone_icon',
    MATCH: 'sentence_match_icon',
    SEMANTIC: 'abc_icon',
    TICKET: 'ticket_icon',
    SINGLE_TICKET: 'single_ticket_icon',
    MULTIPLE_TICKETS: 'multiple_tickets_icon'
  },

  // Storage keys for localStorage
  STORAGE_KEYS: {
    PHONE_ON: 'phoneOn',
    MATCH_ON: 'matchOn',
    SEMANTIC_ON: 'semanticOn',
    TICKET_ON: 'ticketOn',
    SINGLE_TICKET_ON: 'singleTicketOn',
    MULTIPLE_TICKETS_ON: 'multipleTicketsOn'
  },

  // Search modes
  MODES: {
    PHONE: 'phone',
    MATCH: 'match',
    SEMANTIC: 'semantic',
    TICKET: 'ticket',
    SINGLE_TICKET: 'single',
    MULTIPLE_TICKETS: 'multiple'
  }
};

// Prevent modifications to constants
Object.freeze(CONSTANTS);
Object.freeze(CONSTANTS.SELECTORS);
Object.freeze(CONSTANTS.PLACEHOLDERS);
Object.freeze(CONSTANTS.API);
Object.freeze(CONSTANTS.DEFAULTS);
Object.freeze(CONSTANTS.ICONS);
Object.freeze(CONSTANTS.STORAGE_KEYS);
Object.freeze(CONSTANTS.MODES);
