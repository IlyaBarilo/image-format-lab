

// Dependencies are bound by application.mjs after all components are constructed.
export function createDownloads({}, deps) {
  function triggerDownload(url, name) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  }
  
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    try { deps.triggerDownload(url, name); }
    catch (error) { URL.revokeObjectURL(url); throw error; }
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return { triggerDownload, downloadBlob };
}
