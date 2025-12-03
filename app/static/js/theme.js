class Theme {
  constructor(isDarkMode) {
    this.isDarkMode = isDarkMode;
    this.applyTheme();
    this.savePreference();
  }

  applyTheme() {
    const html = document.documentElement;
    if (this.isDarkMode) {
      html.setAttribute('data-bs-theme', 'dark');
    } else {
      html.setAttribute('data-bs-theme', 'light');
    }
    // Update theme icon
    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.src = '/static/images/' + (this.isDarkMode ? 'dark_mode.svg' : 'light_mode.svg');
      icon.alt = this.isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  }

  savePreference() {
    localStorage.setItem('theme', this.isDarkMode ? 'dark' : 'light');
  }

  static loadPreference() {
    const savedTheme = localStorage.getItem('theme');
    const isDark = savedTheme === 'dark';
    return new Theme(isDark);
  }
}

// Initialize theme on page load with saved preference
document.addEventListener('DOMContentLoaded', function() {
  const theme = Theme.loadPreference();

  // Toggle button functionality
  const toggleButton = document.getElementById('theme-toggle');
  if (toggleButton) {
    toggleButton.addEventListener('click', function() {
      const newTheme = new Theme(!theme.isDarkMode);
      // Update the current theme reference
      theme.isDarkMode = newTheme.isDarkMode;
    });
  }
});
