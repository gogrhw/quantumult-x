/**
 * Quantumult X MITM — Kelee Loon plugin store → QX resource converter
 *
 * Usage (rewrite_remote):
 *   ^https:\/\/hub\.kelee\.one\/list\.json(?:[?#].*)?$ url script-response-body https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Scripts/kelee-loon-to-qx.js
 *   ^https:\/\/hub\.kelee\.one\/(?:index\.html)?(?:[?#].*)?$ url script-response-body https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Scripts/kelee-loon-to-qx.js
 *
 *   [mitm]
 *   hostname = hub.kelee.one
 *
 * Mechanism:
 *   Server-side: rewrites /list.json responses, converting Loon plugin URLs
 *   (loon://import?plugin=...) into QX add-resource URLs.
 *   Client-side: injects a <script> that hooks fetch() for /list.json,
 *   converting plugin URLs before the SPA renders them as links.
 */

const LOON_PLUGIN_PREFIX = "loon://import?plugin=";
const QX_ADD_RESOURCE_PREFIX = "quantumult-x:///add-resource?remote-resource=";
let convertedCount = 0;

// ── URL helpers ──────────────────────────────────────────────────────────────

function getUrlPath(url) {
  const withoutHash = url.split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  return withoutQuery;
}

function getFileNameFromUrl(url) {
  const path = getUrlPath(url);
  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? path : path.slice(slashIndex + 1);
}

// ── Loon → QX conversion ────────────────────────────────────────────────────

function loonPluginToQXResource(input, displayName) {
  if (typeof input !== "string" || input.indexOf(LOON_PLUGIN_PREFIX) !== 0) {
    return input;
  }

  try {
    const pluginUrl = decodeURIComponent(input.slice(LOON_PLUGIN_PREFIX.length));
    if (!pluginUrl) {
      return input;
    }

    const pluginPath = getUrlPath(pluginUrl);
    if (!/^https?:\/\//i.test(pluginUrl) || !/\.lpx$/i.test(pluginPath)) {
      return input;
    }

    const tag = displayName || getFileNameFromUrl(pluginUrl).replace(/\.lpx$/i, "");
    const resourceJson = JSON.stringify({
      rewrite_remote: [
        `${pluginUrl}, tag=${tag}, update-interval=172800, opt-parser=true, inserted-resource=true, enabled=true`
      ]
    });

    convertedCount += 1;
    return `${QX_ADD_RESOURCE_PREFIX}${encodeURIComponent(resourceJson)}`;
  } catch (_) {
    return input;
  }
}

// ── Plugin list rewriting ────────────────────────────────────────────────────

function rewritePluginList(lists) {
  if (!Array.isArray(lists)) return;
  lists.forEach((item) => {
    if (item && typeof item === "object" && typeof item.url === "string") {
      item.url = loonPluginToQXResource(item.url, item.name || item.title || "");
    }
  });
}

// ── Server-side response rewriting ──────────────────────────────────────────

function rewriteJsonBody(body) {
  const data = JSON.parse(body);
  rewritePluginList(data.lists);
  return JSON.stringify(data);
}

// ── Client-side injected script ─────────────────────────────────────────────

function getClientConverterScript() {
  return String.raw`
<script>
(function () {
  if (window.__loonToQXClientInstalled) return;
  window.__loonToQXClientInstalled = true;

  var LOON_PLUGIN_PREFIX = "loon://import?plugin=";
  var QX_ADD_RESOURCE_PREFIX = "quantumult-x:///add-resource?remote-resource=";

  function getUrlPath(url) {
    var withoutHash = url.split("#")[0];
    var withoutQuery = withoutHash.split("?")[0];
    return withoutQuery;
  }

  function getFileNameFromUrl(url) {
    var path = getUrlPath(url);
    var slashIndex = path.lastIndexOf("/");
    return slashIndex === -1 ? path : path.slice(slashIndex + 1);
  }

  function loonPluginToQXResource(input, displayName) {
    if (typeof input !== "string" || input.indexOf(LOON_PLUGIN_PREFIX) !== 0) {
      return input;
    }

    try {
      var pluginUrl = decodeURIComponent(input.slice(LOON_PLUGIN_PREFIX.length));
      if (!pluginUrl) {
        return input;
      }

      var pluginPath = getUrlPath(pluginUrl);
      if (!/^https?:\/\//i.test(pluginUrl) || !/\.lpx$/i.test(pluginPath)) {
        return input;
      }

      var tag = displayName || getFileNameFromUrl(pluginUrl).replace(/\.lpx$/i, "");
      var resourceJson = JSON.stringify({
        rewrite_remote: [
          pluginUrl + ", tag=" + tag + ", update-interval=172800, opt-parser=true, inserted-resource=true, enabled=true"
        ]
      });

      return QX_ADD_RESOURCE_PREFIX + encodeURIComponent(resourceJson);
    } catch (_) {
      return input;
    }
  }

  function rewritePluginList(lists) {
    if (!Array.isArray(lists)) return;
    lists.forEach(function (item) {
      if (item && typeof item === "object" && typeof item.url === "string") {
        item.url = loonPluginToQXResource(item.url, item.name || item.title || "");
      }
    });
  }

  // Intercept fetch() so dynamically-loaded /list.json is also converted
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function () {
      var response = await nativeFetch.apply(this, arguments);

      try {
        var request = arguments[0];
        var requestUrl = typeof request === "string" ? request : request && request.url;
        var resolvedUrl = new URL(requestUrl, location.href);

        if (resolvedUrl.origin === location.origin && resolvedUrl.pathname.endsWith("/list.json")) {
          var data = await response.clone().json();
          rewritePluginList(data.lists);

          var headers = new Headers(response.headers);
          headers.set("content-type", "application/json; charset=utf-8");

          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: headers,
          });
        }
      } catch (_) {}

      return response;
    };
  }

})();
</script>
`;
}

function injectClientConverter(body) {
  if (body.includes("__loonToQXClientInstalled")) {
    return body;
  }

  const script = getClientConverterScript();
  if (body.includes("</head>")) {
    return body.replace("</head>", `${script}\n</head>`);
  }

  if (body.includes("</body>")) {
    return body.replace("</body>", `${script}\n</body>`);
  }

  return `${body}\n${script}`;
}

// ── Response routing ────────────────────────────────────────────────────────

function rewriteBody(body, url) {
  if (!body || typeof body !== "string") {
    return body;
  }

  // JSON API: convert Loon plugin URLs in the response data
  if (/\/list\.json(?:[?#].*)?$/.test(url)) {
    if (!body.trim()) {
      return body;
    }

    return rewriteJsonBody(body);
  }

  // HTML page: inject the client-side converter script
  if (/\/(?:index\.html)?(?:[?#].*)?$/.test(url)) {
    return injectClientConverter(body);
  }

  return body;
}

// ── Entry point ──────────────────────────────────────────────────────────────

convertedCount = 0;

let body = $response.body || "";
let headers = $response.headers || {};

try {
  const requestUrl = $request.url || "";
  body = rewriteBody(body, requestUrl);
  console.log(`hub-kelee-loon-to-qx converted ${convertedCount} link(s) for ${requestUrl}`);

  // Drop Content-Length since the body may have changed size
  if (headers["Content-Length"]) {
    delete headers["Content-Length"];
  }
  if (headers["content-length"]) {
    delete headers["content-length"];
  }

  $done({ body, headers });
} catch (error) {
  console.log(`hub-kelee-loon-to-qx failed: ${error.message}`);
  $done({ body, headers });
}