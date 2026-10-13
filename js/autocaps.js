/* =====================================================================
   AUTO CAPITALS
   Every word a person types into a details box starts with a capital
   letter ("rahul kumar" -> "Rahul Kumar"), on every page. Only the first
   letter of a word is changed; the rest stays as typed ("CBSE" stays).

   Left alone: email, phone, number, password, search boxes, anything
   numeric (inputmode), OTP / PIN / year / percentage / IDs / amounts,
   notes, read-only boxes, and any box marked data-no-caps.
   ===================================================================== */
(function () {

  const SKIP_NAME = /mail|otp|code|pin|year|percent|cgpa|mobile|phone|whatsapp|amount|dues|remaining|search|notes|url|link|password|(^|[^a-z])id$|demoid|tutorid|studentid|partyid/i;

  function wants(el) {
    if (!el || el.readOnly || el.disabled) return false;
    if (el.closest && el.closest("[data-no-caps]")) return false;
    if (el.tagName === "TEXTAREA") return !SKIP_NAME.test(el.id || el.name || "");
    if (el.tagName !== "INPUT") return false;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type !== "text") return false;
    const mode = (el.getAttribute("inputmode") || "").toLowerCase();
    if (mode === "numeric" || mode === "decimal" || mode === "tel" || mode === "email") return false;
    if (el.classList.contains("otp-box")) return false;
    const names = [el.id, el.name, el.getAttribute("autocomplete"),
      ...Object.values(el.dataset || {})].filter(Boolean).join(" ");
    if (/(Id|ID)$/.test(el.id || "")) return false;   // taStudentId, paymentStuId, ...
    return !SKIP_NAME.test(names);
  }

  function titleCase(text) {
    if (/@|https?:\/\//i.test(text)) return text;   // looks like an email / link
    return text.replace(/(^|[\s(\-\/,.&])([a-z])/g, (m, before, letter) => before + letter.toUpperCase());
  }

  document.addEventListener("input", (event) => {
    const el = event.target;
    if (event.isComposing || !wants(el)) return;
    if (event.inputType && event.inputType.startsWith("delete")) return;
    const next = titleCase(el.value);
    if (next === el.value) return;
    const start = el.selectionStart, end = el.selectionEnd;
    el.value = next;                         // same length, so the cursor stays put
    try { el.setSelectionRange(start, end); } catch (e) {}
  }, true);

})();
