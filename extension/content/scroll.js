// Scrolling: picks the element that should scroll (the page, or the
// scrollable container the user last interacted with), then moves it.
PaneMux.Scroll = (() => {
  let activated = null; // last element clicked/focused/hinted

  document.addEventListener("mousedown", (e) => { if (!PaneMux.HUD.owns(e.target)) activated = e.target; }, true);
  document.addEventListener("focusin", (e) => { if (!PaneMux.HUD.owns(e.target)) activated = e.target; }, true);

  const axisProps = {
    y: { overflow: "overflowY", size: "scrollHeight", client: "clientHeight" },
    x: { overflow: "overflowX", size: "scrollWidth", client: "clientWidth" },
  };

  function canScroll(el, axis) {
    if (!el || el.nodeType !== 1) return false;
    const p = axisProps[axis];
    if (el[p.size] - el[p.client] < 2) return false;
    const se = document.scrollingElement || document.documentElement;
    if (el === se || el === document.body) {
      const html = getComputedStyle(document.documentElement)[p.overflow];
      const body = document.body ? getComputedStyle(document.body)[p.overflow] : "visible";
      return html !== "hidden" && !(el === document.body && body === "hidden");
    }
    const ov = getComputedStyle(el)[p.overflow];
    return ov === "auto" || ov === "scroll" || ov === "overlay";
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  // Biggest visible scrollable element, for pages whose document itself
  // doesn't scroll (app shells with an inner scrolling <main>, etc.).
  function largestScrollable(axis) {
    let best = null, bestArea = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (PaneMux.HUD.owns(el)) continue;
      if (!canScroll(el, axis) || !isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best;
  }

  function target(axis) {
    for (let el = activated; el && el !== document.documentElement; el = el.parentElement || (el.getRootNode() && el.getRootNode().host)) {
      if (el === document.body) break;
      if (el.isConnected && canScroll(el, axis)) return el;
    }
    const se = document.scrollingElement || document.documentElement;
    if (canScroll(se, axis)) return se;
    return largestScrollable(axis) || se;
  }

  // Held-down keys (auto-repeat) scroll instantly so they don't pile up.
  function smooth(event) {
    return !!PaneMux.Settings.get("smoothScroll") && !(event && event.repeat);
  }

  // Own rAF animator instead of native `behavior: "smooth"`: rapid keys
  // ("d d u") must add up from the destination, and Chrome's native smooth
  // scroll drifts when one animation interrupts another.
  const DURATION = 160;
  let anim = null; // { el, fromL, fromT, left, top, start, raf }

  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function clamp(el, left, top) {
    return {
      left: Math.max(0, Math.min(el.scrollWidth - el.clientWidth, left)),
      top: Math.max(0, Math.min(el.scrollHeight - el.clientHeight, top)),
    };
  }

  function stop() {
    if (anim) cancelAnimationFrame(anim.raf);
    anim = null;
  }

  function scrollEl(el, left, top, smooth) {
    const dest = clamp(el, left, top);
    stop();
    if (!smooth) { el.scrollTo({ left: dest.left, top: dest.top, behavior: "instant" }); return; }
    const a = (anim = { el, fromL: el.scrollLeft, fromT: el.scrollTop, ...dest, start: performance.now() });
    const frame = (now) => {
      if (anim !== a) return;
      const t = Math.min(1, (now - a.start) / DURATION);
      const k = ease(t);
      el.scrollTo({ left: a.fromL + (a.left - a.fromL) * k, top: a.fromT + (a.top - a.fromT) * k, behavior: "instant" });
      if (t < 1) a.raf = requestAnimationFrame(frame);
      else anim = null;
    };
    a.raf = requestAnimationFrame(frame);
  }

  // Stop animating if the user grabs the wheel / scrollbar mid-flight.
  addEventListener("wheel", stop, { passive: true, capture: true });

  function by(dx, dy, event) {
    const el = target(dy ? "y" : "x");
    const from = anim && anim.el === el ? anim : { left: el.scrollLeft, top: el.scrollTop };
    scrollEl(el, from.left + dx, from.top + dy, smooth(event));
  }

  function to({ x, y }, event) {
    const el = target(y !== undefined ? "y" : "x");
    const left = x === undefined ? (anim && anim.el === el ? anim.left : el.scrollLeft) : x === Infinity ? el.scrollWidth : x;
    const top = y === undefined ? (anim && anim.el === el ? anim.top : el.scrollTop) : y === Infinity ? el.scrollHeight : y;
    scrollEl(el, left, top, smooth(event));
  }

  // Viewport size of the current scroll target (for d/u half-page).
  function viewportHeight() {
    const el = target("y");
    const se = document.scrollingElement || document.documentElement;
    return el === se ? innerHeight : el.clientHeight;
  }

  function position() {
    const el = target("y");
    return { x: el.scrollLeft, y: el.scrollTop };
  }

  return {
    by,
    to,
    viewportHeight,
    position,
    target,
    setActivated: (el) => { activated = el; },
    get activated() { return activated; },
  };
})();
