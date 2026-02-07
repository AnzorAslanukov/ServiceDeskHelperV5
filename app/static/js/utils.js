/**
 * Utility functions - Shared helper functions used across the application
 */

/**
 * Debug logging function - only logs when DEBUG is true
 * @param {string|object} message - Message to log
 * @param {...any} args - Additional arguments to log
 */
function debugLog(message, ...args) {
  if (CONSTANTS.DEBUG) {
    console.log(message, ...args);
  }
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
  debugLog('[UTILS] - Copy to clipboard triggered for text:', text);
  try {
    await navigator.clipboard.writeText(text);
    debugLog('[UTILS] - Clipboard write successful');
  } catch (err) {
    debugLog('[UTILS] - Clipboard write failed, using fallback');
    // Fallback for HTTP contexts
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    textArea.focus();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    debugLog('[UTILS] - Fallback copy executed');
  }
}

/**
 * Handle copy button click with visual feedback
 * @param {string} ticketId - Ticket ID to copy
 * @param {HTMLElement} button - The copy button element
 */
async function handleCopy(ticketId, button) {
  debugLog('[UTILS] - Handle copy called for ticketId:', ticketId, 'button element:', button.id);
  try {
    await copyToClipboard(ticketId);

    debugLog('[UTILS] - Hiding tooltip after copy');
    // Hide tooltip immediately after successful copy
    const tooltip = bootstrap.Tooltip.getInstance(button);
    if (tooltip) tooltip.hide();

    debugLog('[UTILS] - Updating button to success state');
    // Change to check mark
    const icon = button.querySelector('i');
    icon.className = 'bi bi-check-lg';
    button.classList.remove('btn-outline-primary');
    button.classList.add('btn-success');

    debugLog('[UTILS] - Setting timeout to revert button state');
    // Revert after configured duration
    setTimeout(() => {
      debugLog('[UTILS] - Reverting button to original state');
      icon.className = 'bi bi-clipboard';
      button.classList.remove('btn-success');
      button.classList.add('btn-outline-primary');
    }, CONSTANTS.DEFAULTS.COPY_SUCCESS_DURATION);
  } catch (err) {
    debugLog('[UTILS] - Copy operation failed');
    console.error('Copy failed:', err);
  }
  event?.stopPropagation();
}

/**
 * Initialize Bootstrap tooltips on elements
 * @param {string} [selector='[data-bs-toggle="tooltip"]'] - CSS selector for tooltip elements
 */
function initializeTooltips(selector = '[data-bs-toggle="tooltip"]') {
  const tooltipTriggerList = [].slice.call(document.querySelectorAll(selector));
  tooltipTriggerList.forEach(tooltipTriggerEl => {
    new bootstrap.Tooltip(tooltipTriggerEl);
  });
}

/**
 * Format a date string to locale date string
 * @param {string} dateString - ISO date string
 * @param {string} [defaultValue='N/A'] - Default value if date is invalid
 * @returns {string} Formatted date string
 */
function formatDate(dateString, defaultValue = 'N/A') {
  if (!dateString) return defaultValue;
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return defaultValue;
  }
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Generate HTML for a loading spinner
 * @param {string} [size=''] - Size class ('spinner-border-sm' for small)
 * @param {string} [color='text-primary'] - Color class
 * @returns {string} HTML string
 */
function getLoadingSpinnerHTML(size = '', color = 'text-primary') {
  const sizeClass = size ? ` ${size}` : '';
  return `<div class="d-flex justify-content-center my-4"><div class="spinner-border${sizeClass} ${color}" role="status"><span class="visually-hidden">Loading...</span></div></div>`;
}

/**
 * Generate HTML for an alert message
 * @param {string} message - Alert message
 * @param {string} [type='danger'] - Alert type (danger, info, success, warning)
 * @returns {string} HTML string
 */
function getAlertHTML(message, type = 'danger') {
  return `<div class="alert alert-${type}">${message}</div>`;
}

/**
 * Ensure the content area element exists, creating it if necessary
 * @returns {HTMLElement} The content area element
 */
function ensureContentArea() {
  let contentArea = document.getElementById(CONSTANTS.SELECTORS.CONTENT_AREA);
  if (!contentArea) {
    contentArea = document.createElement('div');
    contentArea.id = CONSTANTS.SELECTORS.CONTENT_AREA;
    contentArea.className = 'mt-4';
    const mainContent = document.querySelector(CONSTANTS.SELECTORS.MAIN_CONTENT);
    if (mainContent) {
      mainContent.appendChild(contentArea);
    }
  }
  return contentArea;
}

/**
 * Get badge color class based on status value
 * @param {string} status - Status value
 * @returns {string} Bootstrap badge color class
 */
function getStatusBadgeClass(status) {
  if (status === 'Closed') return 'success';
  if (status === 'Open' || status === 'Active') return 'danger';
  return 'warning';
}

/**
 * Get badge color class based on priority value
 * @param {string} priority - Priority value
 * @returns {string} Bootstrap badge color class
 */
function getPriorityBadgeClass(priority) {
  if (priority === '1' || priority === 'High') return 'danger';
  if (priority === '2' || priority === 'Medium') return 'warning';
  return 'secondary';
}
