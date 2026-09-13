// Installed before page scripts. Intercepts only embedded codec <script> nodes.
module.exports = function codecProbe({ failFirst = false, failAll = false, hold = false } = {}) {
  const probe = window.codecProbe = { scripts: [], revoked: [], failed: false, failAll, hold };
  const append = Element.prototype.append, revoke = URL.revokeObjectURL.bind(URL);
  const waiting = [];
  Element.prototype.append = function (...nodes) {
    const script = this === document.head && nodes.find(node => node.tagName === 'SCRIPT' && node.src.startsWith('blob:'));
    if (script) {
      probe.scripts.push(script.src);
      if (probe.failAll || (failFirst && !probe.failed)) {
        probe.failed = true;
        queueMicrotask(() => script.dispatchEvent(new Event('error')));
        return;
      }
      if (probe.hold) { waiting.push(() => append.apply(this, nodes)); return; }
    }
    return append.apply(this, nodes);
  };
  URL.revokeObjectURL = url => { probe.revoked.push(url); return revoke(url); };
  probe.release = () => { probe.hold = false; for (const run of waiting.splice(0)) run(); };
};
