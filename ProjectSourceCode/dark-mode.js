document.addEventListener('DOMContentLoaded', () => {
  const toggleCheckbox = document.getElementById('theme-toggle-checkbox');
  
  // 1. Sync the toggle switch UI with the body class (which was set instantly on load)
  if (toggleCheckbox) {
    toggleCheckbox.checked = document.body.classList.contains('dark-mode');
  }

  // 2. Toggle dark mode on user switch change and save their specific preference
  if (toggleCheckbox) {
    toggleCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
      } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  // 3. Listen for OS theme changes automatically in real-time
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only auto-switch if the user hasn't explicitly saved a manual override preference
    if (!localStorage.getItem('theme')) {
      if (e.matches) {
        document.body.classList.add('dark-mode');
        if (toggleCheckbox) toggleCheckbox.checked = true;
      } else {
        document.body.classList.remove('dark-mode');
        if (toggleCheckbox) toggleCheckbox.checked = false;
      }
    }
  });
});