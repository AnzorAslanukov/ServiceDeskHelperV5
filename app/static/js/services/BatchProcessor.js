/**
 * BatchProcessor - Handles batch ticket recommendation fetching with concurrency control
 */
class BatchProcessor {
  /**
   * Create a BatchProcessor instance
   * @param {number} [batchSize=5] - Number of concurrent requests to process
   */
  constructor(batchSize = CONSTANTS.DEFAULTS.BATCH_SIZE) {
    this.batchSize = batchSize;
    this.completed = 0;
    this.activeRequests = 0;
    this.queueIndex = 0;
    this.ticketItems = [];
    this.isRunning = false;
  }

  /**
   * Process tickets in batches with controlled concurrency
   * @param {Array} ticketItems - Array of ticket items with {id, index, container}
   * @param {Object} callbacks - Callback functions
   * @param {Function} callbacks.onProgress - Called with (completed, total) on each completion
   * @param {Function} callbacks.onTicketComplete - Called with (ticketItem, data) when each ticket is processed
   * @param {Function} callbacks.onComplete - Called when all tickets are processed
   * @param {Function} callbacks.onError - Called with (ticketItem, error) on error
   */
  async processTickets(ticketItems, callbacks = {}) {
    debugLog('[BATCH_PROCESSOR] - Starting batch processing', ticketItems.length, 'tickets');

    this.ticketItems = ticketItems;
    this.completed = 0;
    this.activeRequests = 0;
    this.queueIndex = 0;
    this.isRunning = true;

    // Show loading state for all tickets
    ticketItems.forEach(item => {
      if (item.container) {
        item.container.innerHTML = getLoadingSpinnerHTML('spinner-border-sm', 'text-secondary');
        item.container.style.display = 'block';
      }
    });

    // Start initial batch
    const initialBatchSize = Math.min(this.batchSize, ticketItems.length);
    debugLog('[BATCH_PROCESSOR] - Starting initial batch of', initialBatchSize, 'requests');

    for (let i = 0; i < initialBatchSize; i++) {
      this._startNextRequest(callbacks);
    }

    // Wait for all requests to complete
    await this._waitForCompletion();

    this.isRunning = false;

    if (callbacks.onComplete) {
      callbacks.onComplete();
    }

    debugLog('[BATCH_PROCESSOR] - Batch processing complete');
  }

  /**
   * Fetch recommendation for a single ticket
   * @param {string} ticketId - The ticket ID to fetch recommendation for
   * @returns {Promise<Object>} The recommendation data
   */
  async fetchRecommendation(ticketId) {
    debugLog('[BATCH_PROCESSOR] - Fetching recommendation for', ticketId);

    const response = await fetch(CONSTANTS.API.GET_TICKET_ADVICE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: ticketId })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Start the next request from the queue if available and under batch limit
   * @private
   */
  async _startNextRequest(callbacks) {
    if (this.queueIndex >= this.ticketItems.length || this.activeRequests >= this.batchSize) {
      return; // No more requests to start or batch limit reached
    }

    const item = this.ticketItems[this.queueIndex++];
    this.activeRequests++;

    debugLog('[BATCH_PROCESSOR] - Starting request for ticket', item.id, {
      activeRequests: this.activeRequests,
      queueIndex: this.queueIndex,
      completed: this.completed
    });

    try {
      const data = await this.fetchRecommendation(item.id);
      debugLog('[BATCH_PROCESSOR] - Received recommendations for', item.id);

      this.completed++;

      if (callbacks.onProgress) {
        callbacks.onProgress(this.completed, this.ticketItems.length);
      }

      if (callbacks.onTicketComplete) {
        callbacks.onTicketComplete(item, data);
      }

    } catch (error) {
      debugLog('[BATCH_PROCESSOR] - Error processing ticket', item.id, error);

      this.completed++;

      if (callbacks.onProgress) {
        callbacks.onProgress(this.completed, this.ticketItems.length);
      }

      if (callbacks.onError) {
        callbacks.onError(item, error);
      }

    } finally {
      this.activeRequests--;

      // Try to start next request if there are more and we're below batch limit
      if (this.queueIndex < this.ticketItems.length && this.activeRequests < this.batchSize) {
        this._startNextRequest(callbacks);
      }
    }
  }

  /**
   * Wait for all requests to complete
   * @private
   */
  async _waitForCompletion() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.completed >= this.ticketItems.length) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Collect ticket items from the validation accordion
   * @returns {Array} Array of ticket items with {id, index, container}
   */
  static collectTicketItems() {
    const validationAccordion = document.getElementById(CONSTANTS.SELECTORS.VALIDATION_ACCORDION);
    if (!validationAccordion) {
      debugLog('[BATCH_PROCESSOR] - Validation accordion not found');
      return [];
    }

    const ticketItems = [];
    const accordions = validationAccordion.querySelectorAll('.accordion-item');

    accordions.forEach((item, index) => {
      const titleDiv = item.querySelector('.accordion-header');
      const titleText = titleDiv ? titleDiv.textContent.trim() : '';
      const ticketMatch = titleText.match(/^([A-Z]{2}\d+).*?/);

      if (ticketMatch) {
        ticketItems.push({
          id: ticketMatch[1],
          index: index,
          container: document.getElementById(`recommendations-${index}`)
        });
      }
    });

    debugLog('[BATCH_PROCESSOR] - Collected', ticketItems.length, 'ticket items');
    return ticketItems;
  }
}
