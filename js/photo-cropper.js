/* =====================================================================
   ROUND PHOTO CROPPER
   Shows the person what their round profile picture will look like and lets
   them move / zoom the photo inside the circle before it is uploaded.

     const cropped = await PhotoCropper.open(file);
        -> a new JPEG File (600 x 600, exactly what is inside the circle),
           or null if the person cancelled.

   Inside the window: drag to move, slider (or mouse wheel) to zoom, "Use this
   photo" to confirm, and "Save a copy" to download the round picture as a PNG.

   Self-contained: builds its own window. Style: css/photo-cropper.css.
   ===================================================================== */
(function () {

  const STAGE = 260;      // size of the circle on screen (px)
  const OUTPUT = 600;     // size of the saved picture (px)

  function open(file) {

    return new Promise(resolve => {

      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };

      img.onload = () => {

        const natW = img.naturalWidth, natH = img.naturalHeight;
        const base = Math.max(STAGE / natW, STAGE / natH);   // smallest size that still fills the circle
        let zoom = 1, x = 0, y = 0;

        const modal = document.createElement("div");
        modal.className = "pc-modal";
        modal.innerHTML = `
          <div class="pc-overlay"></div>
          <div class="pc-box" role="dialog" aria-modal="true" aria-label="Adjust your photo">
            <h3>Adjust your photo</h3>
            <p>This is how your round profile picture will look. Drag to move, use the slider to zoom.</p>
            <div class="pc-stage"></div>
            <label class="pc-zoom"><span>−</span><input type="range" min="1" max="3" step="0.01" value="1" aria-label="Zoom"><span>+</span></label>
            <div class="pc-actions">
              <button type="button" class="pc-btn" data-pc="cancel">Cancel</button>
              <button type="button" class="pc-btn pc-primary" data-pc="ok">Use this photo</button>
            </div>
            <button type="button" class="pc-save" data-pc="save">Save a copy</button>
          </div>`;
        document.body.appendChild(modal);

        const stage = modal.querySelector(".pc-stage");
        const slider = modal.querySelector("input[type=range]");
        img.draggable = false;
        stage.appendChild(img);

        function scale() { return base * zoom; }

        function clamp() {
          const s = scale();
          x = Math.min(0, Math.max(STAGE - natW * s, x));
          y = Math.min(0, Math.max(STAGE - natH * s, y));
        }

        function draw() {
          clamp();
          const s = scale();
          img.style.width = natW * s + "px";
          img.style.height = natH * s + "px";
          img.style.left = x + "px";
          img.style.top = y + "px";
        }

        // start centred
        x = (STAGE - natW * scale()) / 2;
        y = (STAGE - natH * scale()) / 2;
        draw();

        function setZoom(next) {
          // keep the point in the middle of the circle where it is
          const cx = (STAGE / 2 - x) / scale(), cy = (STAGE / 2 - y) / scale();
          zoom = Math.min(3, Math.max(1, next));
          x = STAGE / 2 - cx * scale();
          y = STAGE / 2 - cy * scale();
          slider.value = zoom;
          draw();
        }

        slider.addEventListener("input", () => setZoom(Number(slider.value)));
        stage.addEventListener("wheel", e => { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 0.08 : -0.08)); }, { passive: false });

        let drag = null;
        stage.addEventListener("pointerdown", e => {
          drag = { px: e.clientX, py: e.clientY, x: x, y: y };
          stage.classList.add("pc-drag");
          stage.setPointerCapture(e.pointerId);
        });
        stage.addEventListener("pointermove", e => {
          if (!drag) return;
          x = drag.x + (e.clientX - drag.px);
          y = drag.y + (e.clientY - drag.py);
          draw();
        });
        const endDrag = () => { drag = null; stage.classList.remove("pc-drag"); };
        stage.addEventListener("pointerup", endDrag);
        stage.addEventListener("pointercancel", endDrag);

        // the part of the photo that is inside the circle, drawn on a canvas
        function render(round) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = OUTPUT;
          const ctx = canvas.getContext("2d");
          if (round) {
            ctx.beginPath();
            ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
            ctx.clip();
          } else {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, OUTPUT, OUTPUT);
          }
          const s = scale();
          ctx.drawImage(img, -x / s, -y / s, STAGE / s, STAGE / s, 0, 0, OUTPUT, OUTPUT);
          return canvas;
        }

        function close(result) {
          document.removeEventListener("keydown", onKey);
          modal.remove();
          URL.revokeObjectURL(url);
          resolve(result);
        }

        function onKey(e) { if (e.key === "Escape") close(null); }
        document.addEventListener("keydown", onKey);

        modal.querySelector(".pc-overlay").addEventListener("click", () => close(null));
        modal.querySelector('[data-pc="cancel"]').addEventListener("click", () => close(null));

        modal.querySelector('[data-pc="ok"]').addEventListener("click", () => {
          render(false).toBlob(blob => {
            if (!blob) return close(null);
            close(new File([blob], "profile-photo.jpg", { type: "image/jpeg" }));
          }, "image/jpeg", 0.9);
        });

        modal.querySelector('[data-pc="save"]').addEventListener("click", () => {
          render(true).toBlob(blob => {
            if (!blob) return;
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "my-round-photo.png";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(link.href), 2000);
          }, "image/png");
        });

      };

      img.src = url;

    });

  }

  window.PhotoCropper = { open: open };

})();
