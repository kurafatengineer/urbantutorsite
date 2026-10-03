/* =====================================================================
   TELEGRAM MINI APP
   When a page is opened from @UrbanTutorSiteBot it runs inside Telegram.
   This fits the page to Telegram (full height, the site's black colours,
   Telegram's own Back button).

   Once the person is logged in here, their Telegram chat is linked to
   their student / tutor record (the bot checks Telegram's signed
   initData), so @UrbanTutorSiteBot can message them, e.g. "Demo Scheduled".

   Telegram's helper script is fetched ONLY inside Telegram (Telegram puts
   "tgWebAppData" in the address when it opens the page; later pages of the
   same visit remember it), so normal visitors load nothing extra.
   ===================================================================== */
(function () {

  const KEY = "urbanInTelegram";
  const DATA_KEY = "urbanTgInitData";
  let inTelegram = /tgWebAppData=/.test(window.location.hash);
  let initData = "";
  try {
    if (inTelegram) {
      sessionStorage.setItem(KEY, "1");
      initData = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData") || "";
      if (initData) sessionStorage.setItem(DATA_KEY, initData);
    } else {
      inTelegram = sessionStorage.getItem(KEY) === "1";
    }
    initData = initData || sessionStorage.getItem(DATA_KEY) || "";
  } catch (e) {}
  if (!inTelegram) return;

  document.documentElement.classList.add("in-telegram");

  function fit() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor("#050505");
      tg.setBackgroundColor("#050505");
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();   // scrolling the form must not close it
    } catch (e) {}
    // Telegram's Back button steps back through the site's own pages
    try {
      if (window.history.length > 1) {
        tg.BackButton.show();
        tg.BackButton.onClick(() => window.history.back());
      }
    } catch (e) {}
  }

  // link this Telegram chat to the logged-in student / tutor (once per login)
  async function linkChat(session) {
    const tg = window.Telegram && window.Telegram.WebApp;
    const data = initData || (tg && tg.initData) || "";
    if (!data || !session || !session.access_token || typeof SUPABASE_URL === "undefined") return;
    const done = "urbanTgLinked:" + session.user.id;
    try { if (sessionStorage.getItem(done)) return; } catch (e) {}
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram?link=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ initData: data })
      });
      // a brand-new registration has no record yet: try again on the next page
      const out = res.ok ? await res.json() : null;
      if (out && (out.students || out.tutors)) sessionStorage.setItem(done, "1");
    } catch (e) {}
  }

  window.addEventListener("load", async () => {
    if (!window.sb) return;
    try {
      const { data } = await window.sb.auth.getSession();
      if (data && data.session) linkChat(data.session);
      window.sb.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session) linkChat(session);
      });
    } catch (e) {}
  });

  const s = document.createElement("script");
  s.src = "https://telegram.org/js/telegram-web-app.js";
  s.async = true;
  s.onload = fit;
  document.head.appendChild(s);

})();
