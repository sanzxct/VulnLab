/*
 * ByteBazaar frontend bundle.
 *
 * NOTE(dev): CI's internal billing sync reads these. Rotate before launch.
 * (Yes, shipping secrets in the JS bundle is exactly the recon bug in #11.)
 */
const CONFIG = {
  apiBase: "/api",
  internalApiBase: "http://internal.bytebazaar.local",
  // Hardcoded fake internal API key leaked to every visitor via this bundle:
  internalApiKey: "phc_live_sk_9c2f1e77b0a4d3internalbilling",
  buildFlag: "FLAG{bytebazaar_recon_jskey_ca11ab1e}",
  buildInfo: "bytebazaar-web@1.0.0 built for Positive Hack Camp"
};

// #2 client-side trust: the server always sends hidden_admin_flag in /api/me;
// we only *display* it when the response says isAdmin === true. Tamper the
// response client-side (flip isAdmin) and the flag pops out of the UI.
async function loadMe() {
  try {
    const res = await fetch(CONFIG.apiBase + "/me", { credentials: "same-origin" });
    const me = await res.json();
    if (!me || me.authenticated !== true) return;
    if (me.isAdmin === true) {
      const link = document.getElementById("admin-link");
      if (link) link.style.display = "inline";
      const teaser = document.getElementById("admin-teaser");
      if (teaser) {
        teaser.style.display = "block";
        teaser.textContent = "Admin area unlocked — " + (me.hidden_admin_flag || "");
      }
    }
  } catch (e) {
    /* ignore */
  }
}

document.addEventListener("DOMContentLoaded", loadMe);
