const THEME_KEY = 'thumb-theme';

let _darkButtonId;
let _lightButtonId;
let _refreshIcons = false;

export let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';

export function configureTheme(config) {
  _darkButtonId = config.darkButtonId;
  _lightButtonId = config.lightButtonId;
  _refreshIcons = config.refreshIcons ?? false;
}

export function applyTheme(theme) {
  currentTheme = theme;
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
  const darkBtn  = document.getElementById(_darkButtonId);
  const lightBtn = document.getElementById(_lightButtonId);
  if (darkBtn)  darkBtn.classList.toggle('active', theme === 'dark');
  if (lightBtn) lightBtn.classList.toggle('active', theme === 'light');
  if (_refreshIcons && typeof lucide !== 'undefined') lucide.createIcons();
}
