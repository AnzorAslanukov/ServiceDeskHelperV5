/**
 * TicketAccordionHeader class for generating reusable accordion header HTML
 * Encapsulates the common pattern used for ticket data accordions
 */
class TicketAccordionHeader {
  /**
   * Creates an accordion header HTML string
   * @param {Object} params - Configuration parameters
   * @param {string} params.id - The identifier for the item (used for copy functionality)
   * @param {string} params.title - The display title
   * @param {string} params.accordionTarget - The collapse target ID (e.g., "#collapseExample")
   * @param {string} [params.ariaControls] - Optional aria-controls attribute
   * @param {string} [params.copyTooltip="Copy ticket number"] - Tooltip text for copy button
   * @returns {string} HTML string for the accordion header
   */
  static generate(params) {
    const {
      id,
      title,
      accordionTarget,
      ariaControls = '',
      copyTooltip = "Copy ticket number"
    } = params;

    const ariaControlsAttr = ariaControls ? ` aria-controls="${ariaControls}"` : '';

    return `
      <h2 class="accordion-header" style="display: flex; align-items: center; padding-left: 0.5rem;">
        <button class="btn btn-sm btn-outline-primary me-2" onclick="handleCopy('${id}', this)" data-bs-toggle="tooltip" data-bs-placement="top" title="${copyTooltip}">
          <i class="bi bi-clipboard"></i>
        </button>
        <button class="accordion-button collapsed"
                type="button" data-bs-toggle="collapse"
                data-bs-target="${accordionTarget}" aria-expanded="false"${ariaControlsAttr} style="flex-grow: 1;">
          ${title}
        </button>
      </h2>
    `;
  }
}
