// jsdom doesn't implement pointer capture at all (a synthetic `fireEvent.pointerDown` never
// establishes an active pointer the browser could capture). Polyfilled once for every test file as
// harmless no-ops rather than guarded in `ScrubTrack` and friends, which are real application code:
// this is a test-environment gap, and any test whose press bubbles to the track would otherwise throw.
if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
  HTMLElement.prototype.setPointerCapture = () => {}
}
if (typeof HTMLElement.prototype.releasePointerCapture !== 'function') {
  HTMLElement.prototype.releasePointerCapture = () => {}
}
