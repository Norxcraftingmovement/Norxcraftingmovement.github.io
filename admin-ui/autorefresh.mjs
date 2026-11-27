// Shared, non-disruptive auto refresh: a cheap `pulse` every 15 s while the tab is visible; reload only when something
// changed AND the user is not interacting; otherwise ask via a banner. Backs off to 60 s on repeated errors.
export function startAutoRefresh({ pulse, reload, interacting, onPending, onError, onOk, intervalMs = 15000 }) {
  let token = null, errs = 0, timer, stopped = false;
  const tick = async () => {
    clearTimeout(timer);
    if (!document.hidden && !stopped) {
      try {
        const p = await pulse(); errs = 0; onOk?.();
        if (token !== null && p.token !== token) { if (interacting()) onPending?.(true); else { await reload({ quiet: true }); } }
        if (token === null) token = p.token;
      } catch { errs++; onError?.(); }
    }
    timer = setTimeout(tick, Math.min(intervalMs * 2 ** Math.min(errs, 2), 60000));
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  timer = setTimeout(tick, intervalMs);
  return { setToken: (t) => { token = t; onPending?.(false); }, tick, stop: () => { stopped = true; clearTimeout(timer); } };
}
export function trackInteraction(extra = () => false, quietMs = 4000) {
  let at = 0; for (const ev of ["input", "keydown", "pointerdown"]) document.addEventListener(ev, () => { at = Date.now(); }, { passive: true });
  return () => Date.now() - at < quietMs || extra();
}
export const store = { get: (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
