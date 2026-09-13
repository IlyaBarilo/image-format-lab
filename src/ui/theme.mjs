// Own interface theme, independent of image data, encoding and analysis.
export const THEME_STORAGE_KEY = 'image-format-viewer.theme.v1';
const DEFAULT_THEME = 'dark';

function readPreference() {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return null; }
}

export function applyInitialTheme() {
  const preference = readPreference();
  document.documentElement.dataset.theme = preference ?? DEFAULT_THEME;
  return { preference };
}

export function createTheme() {
  let attached = false;
  let preference = null, sync = () => {};
  function resetTheme() {
    preference = null;
    sync();
    try { window.localStorage.removeItem(THEME_STORAGE_KEY); return true; } catch { return false; }
  }
  function attachThemeEvents() {
    if (attached) return;
    attached = true;
    ({ preference } = applyInitialTheme());
    const button = document.getElementById('themeToggle');
    sync = () => {
      const theme = preference ?? DEFAULT_THEME;
      document.documentElement.dataset.theme = theme;
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
    };
    button.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      sync();
      try { window.localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Retain this session's choice. */ }
    });
    window.addEventListener('storage', event => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      preference = readPreference();
      sync();
    });
    sync();
  }
  return { attachThemeEvents, resetTheme };
}
