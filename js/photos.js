/* =====================================================================
   TUTOR PROFILE PHOTOS
   The photo a tutor uploaded at registration sits in a PRIVATE storage
   folder, so every photo shown here is a temporary link (1 hour) made for
   the person who is allowed to see it:

     UrbanPhoto.mine()           the logged-in TUTOR's own photo (header,
                                 tutor profile). Allowed by the storage rule
                                 "a tutor can read his own folder".
     UrbanPhoto.forTutors(ids)   for a logged-in STUDENT: photos of the
                                 verified tutors who applied to his tuitions
                                 (asked from the "tutor-photos" server function).
     UrbanPhoto.fill(circle,url) puts the photo on top of a round avatar.
                                 If it fails to load it removes itself and
                                 the name letters stay.

   The Admin Panel gets its photos from its own server function, and the
   public homepage deliberately shows no photos.

   Needs js/supabase-client.js (and js/portal.js). Style: css/photos.css.
   ===================================================================== */
(function () {

  const CACHE_KEY = "urbantutorsite_photo_cache";
  const BUCKET = "tutor-documents";
  const FUNCTION_URL = "https://zbvtdcqoouwyrcxkzjfv.supabase.co/functions/v1/tutor-photos";
  const KEEP_MS = 50 * 60 * 1000;   // links last 60 min; renew a little earlier

  function readCache() {
    try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { return {}; }
  }

  function writeCache(cache) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* storage blocked */ }
  }

  function fresh(entry) {
    return !!entry && entry.exp > Date.now();
  }

  async function session() {
    try {
      const { data } = await window.sb.auth.getSession();
      return data && data.session ? data.session : null;
    } catch (e) {
      return null;
    }
  }

  // Photo on top of a round avatar element (which must be position: relative).
  function fill(circle, url) {
    if (!circle || !url) return;
    if (circle.querySelector(":scope > img.photo-fill")) return;
    const img = document.createElement("img");
    img.className = "photo-fill";
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove());
    img.src = url;
    circle.insertBefore(img, circle.firstChild);
  }

  // The logged-in tutor's own photo ("" when there is none).
  // `profile` may be passed when the page already loaded get_tutor_profile.
  async function mine(profile) {
    if (!window.sb || typeof window.sbCall !== "function") return "";
    try {
      if (window.UrbanPortal && !(await window.UrbanPortal.allows("tutor"))) return "";
      const current = await session();
      if (!current) return "";

      const key = "me:" + current.user.id;
      const cache = readCache();
      if (fresh(cache[key])) return cache[key].url;

      let path = profile && profile.profileImage;
      if (path === undefined) {
        const result = await window.sbCall("get_tutor_profile", {});
        path = result && result.success && result.profile ? result.profile.profileImage : "";
      }

      let url = "";
      if (path && !/^https?:\/\//i.test(path)) {
        const { data } = await window.sb.storage.from(BUCKET).createSignedUrl(path, 3600);
        url = (data && data.signedUrl) || "";
      }

      cache[key] = { url: url, exp: Date.now() + KEEP_MS };
      writeCache(cache);
      return url;
    } catch (e) {
      return "";
    }
  }

  // { tutorId: url } for the tutors this student may see.
  async function forTutors(ids) {
    const wanted = [...new Set((ids || []).filter(Boolean))];
    const out = {};
    if (!wanted.length || !window.sb) return out;

    const cache = readCache();
    const missing = [];
    wanted.forEach(id => {
      const entry = cache["t:" + id];
      if (fresh(entry)) { if (entry.url) out[id] = entry.url; } else missing.push(id);
    });
    if (!missing.length) return out;

    try {
      const current = await session();
      if (!current) return out;
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + current.access_token },
        body: JSON.stringify({ tutorIds: missing.slice(0, 20) })
      });
      const result = JSON.parse(await response.text());
      if (!result || !result.success) return out;
      missing.forEach(id => {
        const url = (result.photos && result.photos[id]) || "";
        cache["t:" + id] = { url: url, exp: Date.now() + KEEP_MS };
        if (url) out[id] = url;
      });
      writeCache(cache);
    } catch (e) { /* no photos: the letters stay */ }

    return out;
  }

  window.UrbanPhoto = { mine: mine, forTutors: forTutors, fill: fill };

})();
