// Cloudflare Worker: proxies a whitelisted subset of the official FPL API
// so the static site at nathan047.github.io can call it without hitting
// the browser CORS block. Deploy this via the Cloudflare dashboard
// (Workers & Pages > your worker > Edit code) — see repo README/chat
// history for the walkthrough. Not part of the GitHub Pages build itself,
// kept here for reference and version history.

const ALLOWED_ORIGIN = "https://nathan047.github.io";
const FPL_BASE = "https://fantasy.premierleague.com/api";

// Only these exact FPL endpoints can be reached through this proxy —
// keeps it from being usable as an open relay to arbitrary URLs.
const ALLOWED_PATHS = [
  /^\/bootstrap-static\/$/,
  /^\/entry\/\d+\/$/,
  /^\/entry\/\d+\/event\/\d+\/picks\/$/,
];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (!ALLOWED_PATHS.some((re) => re.test(url.pathname))) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    let upstream;
    try {
      upstream = await fetch(FPL_BASE + url.pathname, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  },
};
