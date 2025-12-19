class ToggleButton {
  /**
   * Base class for toggle buttons with common functionality.
   * @param {boolean} defaultState - Default state (true=on, false=off)
   * @param {string} storageKey - localStorage key for persistence
   * @param {string} iconBaseName - Base name for icon files (e.g., "phone_icon")
   * @param {string} elementId - DOM ID for the icon element
   * @param {string} buttonId - DOM ID for the button element
   */
  constructor(defaultState, storageKey, iconBaseName, elementId, buttonId) {
    this.isOn = defaultState;
    this.storageKey = storageKey;
    this.iconBaseName = iconBaseName;
    this.elementId = elementId;
    this.buttonId = buttonId;
  }

  /**
   * Applies the correct icon based on current state and theme
   * @param {boolean} themeIsDark - Whether dark theme is active
   */
  applyIcon(themeIsDark) {
    const icon = document.getElementById(this.elementId);
    if (icon) {
      const state = this.isOn ? 'on' : 'off';
      const theme = themeIsDark ? 'dark' : 'light';
      icon.src = `/static/images/${this.iconBaseName}_${state}_${theme}.svg`;
      icon.alt = this.isOn ? 'Switch to Off' : 'Switch to On';
    }

    // Update CSS class on button
    const btn = document.getElementById(this.buttonId);
    if (btn) {
      if (this.isOn) {
        btn.classList.remove('off');
      } else {
        btn.classList.add('off');
      }
    }
  }

  /**
   * Saves the current state to localStorage
   */
  savePreference() {
    localStorage.setItem(this.storageKey, this.isOn ? 'true' : 'false');
  }

  /**
   * Sets the toggle state and updates UI
   * @param {boolean} onState - New state (true=on, false=off)
   */
  toggle(onState) {
    this.isOn = onState;
    this.applyIcon(ToggleButton.currentThemeIsDark());
    this.savePreference();
  }

  /**
   * Loads preference from localStorage or uses default
   * @returns {ToggleButton} Configured toggle instance
   */
  static loadPreference(defaultState, storageKey, iconBaseName, elementId, buttonId) {
    const saved = localStorage.getItem(storageKey);
    const isOn = saved !== null ? saved === 'true' : defaultState;
    const toggle = new ToggleButton(defaultState, storageKey, iconBaseName, elementId, buttonId);
    toggle.isOn = isOn;
    toggle.applyIcon(ToggleButton.currentThemeIsDark());
    return toggle;
  }

  /**
   * Static method to check if dark theme is currently active
   * @returns {boolean} True if dark theme is active
   */
  static currentThemeIsDark() {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  }
}
