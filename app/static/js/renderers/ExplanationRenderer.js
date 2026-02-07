/**
 * ExplanationRenderer - Handles markdown explanation display with truncation/show more functionality
 */
class ExplanationRenderer {
  /**
   * Render an explanation container with optional truncation
   * @param {HTMLElement} container - The container element to render into
   * @param {string} fullText - The full markdown text
   * @param {number} truncateLength - Length at which to truncate (0 for no truncation)
   * @returns {void}
   */
  static render(container, fullText, truncateLength = 0) {
    if (!container) return;

    const needsTruncation = truncateLength > 0 && fullText && fullText.length > truncateLength;
    const encodedText = encodeURIComponent(fullText || 'No detailed analysis available.');

    let html = `
      <div class="explanation-container" data-full-text="${encodedText}">
        <div class="truncated-explanation"></div>
        <div class="full-explanation" style="display: none;"></div>
    `;

    if (needsTruncation) {
      html += `
        <div class="mt-2">
          <button class="btn btn-link btn-sm p-0 explanation-toggle" onclick="ExplanationRenderer.toggle(this)">
            Show More
          </button>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;

    // Process the markdown content
    const truncatedEl = container.querySelector('.truncated-explanation');
    const fullEl = container.querySelector('.full-explanation');

    if (truncatedEl && fullEl) {
      if (needsTruncation) {
        const truncatedMarkdown = fullText.substring(0, truncateLength) + '...';
        truncatedEl.innerHTML = marked.parse(truncatedMarkdown);
        fullEl.innerHTML = marked.parse(fullText);
      } else {
        fullEl.innerHTML = marked.parse(fullText || 'No detailed analysis available.');
        fullEl.style.display = 'inline';
        truncatedEl.style.display = 'none';
      }
    }
  }

  /**
   * Toggle between truncated and full explanation
   * @param {HTMLElement} button - The toggle button element
   */
  static toggle(button) {
    const container = button.closest('.explanation-container');
    if (!container) return;

    const truncated = container.querySelector('.truncated-explanation');
    const full = container.querySelector('.full-explanation');

    if (!truncated || !full) return;

    if (truncated.style.display === 'none') {
      // Currently showing full, switch to truncated
      full.style.display = 'none';
      truncated.style.display = 'inline';
      button.textContent = 'Show More';
    } else {
      // Currently showing truncated, switch to full
      truncated.style.display = 'none';
      full.style.display = 'inline';
      button.textContent = 'Show Less';
    }
  }
}
