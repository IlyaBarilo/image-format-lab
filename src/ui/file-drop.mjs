// File drops use the shared list; changing the source remains the files service's job.
export function createFileDrop({ app, els }, deps) {
  function attachFileDropEvents() {
    let depth = 0;
    const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes("Files") ||
      Array.from(event.dataTransfer?.items || []).some(item => item.kind === "file") ||
      Boolean(event.dataTransfer?.files?.length);

    function clearHints() {
      depth = 0;
      els.fileDropHint.hidden = els.viewDropHint.hidden = true;
    }

    function targetKind(event) {
      // Leave native file fields (e.g. profile import) to their own change handlers.
      const input = event.target?.closest?.('input[type="file"]');
      if (input && input !== els.fileInput) return "native";
      if (document.querySelector("dialog[open]")) return "dialog";
      return els.filePanel.contains(event.target) ? "list" : "view";
    }

    function dragOver(event) {
      if (!isFileDrag(event)) return;
      const kind = targetKind(event);
      if (kind === "native") { clearHints(); return; }
      event.preventDefault(); // A file must never navigate away from this app.
      const allowed = kind !== "dialog" && !app.batchRun?.running;
      event.dataTransfer.dropEffect = allowed ? "copy" : "none";
      els.fileDropHint.hidden = !allowed || kind !== "list";
      els.viewDropHint.hidden = !allowed || kind !== "view";
    }

    document.addEventListener("dragenter", event => {
      if (!isFileDrag(event)) return;
      depth++;
      dragOver(event);
    });
    document.addEventListener("dragover", dragOver);
    document.addEventListener("dragleave", event => {
      depth = Math.max(0, depth - 1);
      const outside = !event.relatedTarget && (event.clientX <= 0 || event.clientY <= 0 ||
        event.clientX >= window.innerWidth || event.clientY >= window.innerHeight);
      if (!depth || outside) clearHints();
    });
    document.addEventListener("drop", event => {
      clearHints();
      if (!isFileDrag(event) || event.defaultPrevented) return;
      const kind = targetKind(event);
      if (kind === "native") return;
      event.preventDefault();
      if (kind === "dialog") return;
      // Snapshot FileList while drop data is still readable; decoding is asynchronous.
      deps.addFiles(Array.from(event.dataTransfer.files || []), { openFirst: kind === "view" });
    });
    document.addEventListener("dragend", clearHints);
    document.addEventListener("keydown", event => { if (event.key === "Escape") clearHints(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearHints(); });
    window.addEventListener("blur", clearHints);
  }

  return { attachFileDropEvents };
}
