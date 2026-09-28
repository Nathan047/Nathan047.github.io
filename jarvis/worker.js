// Cloudflare Worker (optional): relays Jarvis's requests to the Claude API
// so the real Anthropic API key never has to be stored on the phone. Not
// part of the GitHub Pages build -- kept here for reference and version
// history, like fpl/worker.js.
//
// Setup (Cloudflare dashboard > Workers & Pages > Create > Worker):
//   1. Paste this file in as the worker's code and deploy.
//   2. Settings > Variables and Secrets, add two *secrets*:
//        ANTHROPIC_API_KEY  -- your real sk-ant-... key
//        JARVIS_PASSPHRASE  -- any long random string you make up
//   3. In Jarvis > Settings > Advanced, set the proxy URL to the worker's
//      URL, and put the passphrase in the key box.
//
// The browser sends the passphrase where an API key would go (x-api-key);
// the worker checks it and swaps in the real key. The passphrase is what
// stops anyone who finds the worker URL from spending your credit.

const ALLOWED_ORIGIN = "https://nathan047.github.io";
const ANTHROPIC_BASE = "https://api.anthropic.com";

// Only the Messages endpoint can be reached through this proxy.
const ALLOWED_PATHS = [/^\/v1\/messages$/];

// Request headers passed through to Anthropic; everything else is dropped.
const FORWARD_HEADERS = ["content-type", "anthropic-version", "anthropic-beta"];

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // The SDK sends a handful of x-stainless-* headers; reflect whatever the
    // preflight asks for rather than trying to enumerate them.
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (request.method !== "POST" || !ALLOWED_PATHS.some((re) => re.test(url.pathname))) {
      return json(request, 404, { type: "error", error: { type: "not_found_error", message: "Not found" } });
    }

    if (!env.JARVIS_PASSPHRASE || request.headers.get("x-api-key") !== env.JARVIS_PASSPHRASE) {
      return json(request, 401, { type: "error", error: { type: "authentication_error", message: "Bad passphrase" } });
    }

    const headers = new Headers({ "x-api-key": env.ANTHROPIC_API_KEY });
    for (const name of FORWARD_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_BASE + url.pathname, {
        method: "POST",
        headers,
        body: request.body,
      });
    } catch (e) {
      return json(request, 502, { type: "error", error: { type: "api_error", message: "Upstream fetch failed" } });
    }

    const out = new Headers(corsHeaders(request));
    out.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) out.set("retry-after", retryAfter);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
