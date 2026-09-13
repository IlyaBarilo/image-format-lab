import { applyInitialTheme } from './ui/theme.mjs';

// Runs in the document head, before the interface can paint in the wrong theme.
applyInitialTheme();
