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

// Initialize theme, phone, and abc on page load with saved preferences
document.addEventListener('DOMContentLoaded', function() {
  const theme = Theme.loadPreference();
  const phone = PhoneToggle.loadPreference();
  const abc = ABCToggle.loadPreference();

  // Theme toggle button functionality
  const themeButton = document.getElementById('theme-toggle');
  if (themeButton) {
    themeButton.addEventListener('click', function() {
      const newTheme = new Theme(!theme.isDarkMode);
      // Update the current theme reference
      theme.isDarkMode = newTheme.isDarkMode;
      // Update phone and abc icons for new theme
      phone.applyIcon(theme.isDarkMode);
      abc.applyIcon(theme.isDarkMode);
    });
  }

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
        phone.applyIcon(theme.isDarkMode);
        abc.applyIcon(theme.isDarkMode);
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
        abc.applyIcon(theme.isDarkMode);
        phone.applyIcon(theme.isDarkMode);
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
});
