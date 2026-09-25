// Shared by the node and jsdom projects (see vitest.config.ts); the polyfills only apply where there
// is a DOM to patch.
//
// jsdom doesn't implement pointer capture at all (a synthetic `fireEvent.pointerDown` never
// establishes an active pointer the browser could capture). Polyfilled once for every test file as
// harmless no-ops rather than guarded in `ScrubTrack` and friends, which are real application code:
// this is a test-environment gap, and any test whose press bubbles to the track would otherwise throw.
if (typeof HTMLElement !== 'undefined') {
  if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  if (typeof HTMLElement.prototype.releasePointerCapture !== 'function') {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }

  // jsdom doesn't implement scroll methods at all — same rationale as the pointer-capture no-ops
  // above (a test-environment gap, not something real application code should guard against).
  if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
    HTMLElement.prototype.scrollIntoView = () => {}
  }

  // Without the `canvas` package jsdom's getContext already returns null, but logs "Not
  // implemented" to stderr on every call (each WebGL probe, each 2D texture bake). Same null,
  // no log: callers take their no-canvas path exactly as before.
  HTMLCanvasElement.prototype.getContext = () => null
}
