

// Dependencies are bound by application.mjs after all components are constructed.
export function createStatus({app, els}, deps) {
  function showStatus(message, isError = false) {
    clearTimeout(app.statusTimer);
    els.status.textContent = message;
    els.status.style.background = isError ? "rgba(135, 31, 24, 0.96)" : "rgba(24, 33, 43, 0.94)";
    els.status.classList.add("show");
    app.statusTimer = setTimeout(() => els.status.classList.remove("show"), isError ? 5200 : 2800);
  }

  return { showStatus };
}
