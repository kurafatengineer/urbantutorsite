/* Top-of-card pills (collapsed rows and the Subject | Status row):
   every left pill takes the width of the widest left pill on the
   page, every right pill the width of the widest right pill. */
(function () {

  let probe = null;
  let lastKey = "";

  function width(text) {
    if (!probe) {
      probe = document.createElement("span");
      probe.className = "pill";
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;width:auto;max-width:none;";
      document.body.appendChild(probe);
    }
    probe.textContent = text;
    return Math.ceil(probe.getBoundingClientRect().width);
  }

  function widest(selector) {
    let max = 0;
    document.querySelectorAll(selector).forEach(el => {
      max = Math.max(max, width((el.textContent || "").trim()));
    });
    return max;
  }

  function equalize() {
    const texts = [...document.querySelectorAll(".pill-l, .pill-r")]
      .map(el => el.className.indexOf("pill-l") > -1 ? "L" + el.textContent.trim() : "R" + el.textContent.trim())
      .join("|");
    if (texts === lastKey) return;
    lastKey = texts;
    const root = document.documentElement.style;
    const l = widest(".pill-l");
    const r = widest(".pill-r");
    if (l) root.setProperty("--pill-l-w", l + "px");
    if (r) root.setProperty("--pill-r-w", r + "px");
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; equalize(); });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { lastKey = ""; schedule(); });
  schedule();

})();
