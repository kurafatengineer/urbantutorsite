"use strict";

/* =========================================================
   URBAN TUTOR SITE
   GLOBAL FOOTER
   ========================================================= */

const FOOTER_COMPONENT =
  "components/footer.html";


/* =========================================================
   LOAD FOOTER
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  loadFooter
);


async function loadFooter() {

  const container =
    document.getElementById("site-footer");


  /*
   * Footer container doesn't exist on this page.
   */
  if (!container) {
    return;
  }


  try {

    const response =
      await fetch(
        FOOTER_COMPONENT,
        {
          method: "GET",
          cache: "no-cache"
        }
      );


    if (!response.ok) {

      throw new Error(
        "Footer HTTP error: " +
        response.status
      );

    }


    const html =
      await response.text();


    if (!html.trim()) {

      throw new Error(
        "Footer component is empty."
      );

    }


    container.innerHTML =
      html;


  } catch (error) {

    console.error(
      "Footer loading error:",
      error
    );

  }

}
