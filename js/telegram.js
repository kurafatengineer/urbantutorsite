/* =====================================================================
   TELEGRAM MINI APP
   When a page is opened from @UrbanTutorSiteBot it runs inside Telegram.
   This fits the page to Telegram (full height, the site's black colours,
   Telegram's own Back button).

   Telegram's helper script is fetched ONLY inside Telegram (Telegram puts
   "tgWebAppData" in the address when it opens the page; later pages of the
   same visit remember it), so normal visitors load nothing extra.
   ===================================================================== */
(function () {

  const KEY = "urbanInTelegram";
  let inTelegram = /tgWebAppData=/.test(window.location.hash);
  try {
    if (inTelegram) sessionStorage.setItem(KEY, "1");
    else inTelegram = sessionStorage.getItem(KEY) === "1";
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

  const s = document.createElement("script");
  s.src = "https://telegram.org/js/telegram-web-app.js";
  s.async = true;
  s.onload = fit;
  document.head.appendChild(s);

})();
