/* Six-box code entry for the Student / Tutor OTP page.
   The page scripts keep reading and writing the hidden #otp field
   (value, readOnly, focus); this file mirrors all of that onto the boxes,
   and the boxes drive #otp - so verify / wrong-code / resend behave as before. */
(function () {

  const otp = document.getElementById("otp");
  const wrap = document.getElementById("otpBoxes");
  if (!otp || !wrap) return;

  const boxes = [...wrap.querySelectorAll(".otp-box")];
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const nativeReadOnly = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "readOnly");

  function render(text) {
    const digits = String(text || "").replace(/\D/g, "").slice(0, boxes.length);
    boxes.forEach((box, i) => { box.value = digits[i] || ""; });
  }

  function push() {
    nativeValue.set.call(otp, boxes.map(b => b.value).join(""));
    otp.dispatchEvent(new Event("input", { bubbles: true }));
  }

  Object.defineProperty(otp, "value", {
    get() { return nativeValue.get.call(this); },
    set(v) { nativeValue.set.call(this, v); render(v); }
  });

  Object.defineProperty(otp, "readOnly", {
    get() { return nativeReadOnly.get.call(this); },
    set(v) { nativeReadOnly.set.call(this, v); boxes.forEach(b => { b.readOnly = !!v; }); }
  });

  otp.focus = function () {
    const empty = boxes.find(b => !b.value) || boxes[boxes.length - 1];
    empty.focus();
  };

  boxes.forEach((box, i) => {

    box.addEventListener("input", () => {
      const digits = box.value.replace(/\D/g, "");
      box.value = digits.slice(-1);
      if (digits.length > 1) {
        // several digits landed in one box (paste / autofill): spread them
        digits.split("").slice(0, boxes.length - i).forEach((d, k) => { boxes[i + k].value = d; });
        boxes[Math.min(i + digits.length, boxes.length) - 1].focus();
      } else if (box.value && boxes[i + 1]) {
        boxes[i + 1].focus();
      }
      push();
    });

    box.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !box.value && boxes[i - 1]) {
        boxes[i - 1].value = "";
        boxes[i - 1].focus();
        push();
      } else if (e.key === "ArrowLeft" && boxes[i - 1]) {
        boxes[i - 1].focus();
      } else if (e.key === "ArrowRight" && boxes[i + 1]) {
        boxes[i + 1].focus();
      }
    });

  });

})();
