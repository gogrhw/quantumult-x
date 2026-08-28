/*
 * Plex Fast Connect
 *
 * Request phase:
 *   Remove cache validators so the response rewrite receives Plex resource XML
 *   instead of a 304 response.
 *
 * Response phase:
 *   Probe cached direct connections first. When the cache misses, probe the
 *   non-Relay connections in the official response and cache the selected Device.
 *
 * Automatic discovery uses a fixed 3-second probe timeout.
 */

(function () {
  'use strict';

  var PREFIX = '[PlexFastConnect]';
  var CACHE_KEY = 'plex-fast-connect.device';
  var SOURCE_SIGNATURE = 'automatic';
  var PROBE_TIMEOUT_SECONDS = 3;
  var phase = inferPhase();

  if (phase === 'request') {
    handleRequest();
    return;
  }

  if (phase === 'response') {
    handleResponse();
    return;
  }

  log('Unknown script phase; leaving traffic unchanged');
  $done({});

  function handleRequest() {
    continueWithOfficialDiscovery();
  }

  function handleResponse() {
    var response = $response || {};
    var body = response.body;
    var status = responseStatus(response);
    var cachedDevice = loadCachedDevice();
    var cachedConnections = cachedDevice
      ? directConnections(cachedDevice)
      : [];

    if (
      cachedDevice
      && cachedDevice.token
      && cachedConnections.length > 0
    ) {
      probeGroup(
        cachedConnections,
        cachedDevice.token,
        PROBE_TIMEOUT_SECONDS,
        function (winner, outcome) {
          if (winner) {
            var cachedBody = buildCachedResources(cachedDevice.raw, winner);
            finishModifiedResponse(
              cachedBody,
              'cache-hit',
              'Used cached official Device with '
                + safeConnectionLabel(winner)
            );
            return;
          }

          if (outcome && outcome.unauthorized) {
            clearCachedDevice();
            log('Cached server token was rejected; cleared cache for refresh');
          }
          continueWithOfficialResponse(status, body);
        }
      );
      return;
    }

    continueWithOfficialResponse(status, body);
  }

  function continueWithOfficialResponse(status, body) {
    if (
      status !== 200
      || typeof body !== 'string'
      || body.indexOf('<Connection') < 0
    ) {
      $done({});
      return;
    }

    var devices = findServerDevices(body);
    if (devices.length === 0) {
      $done({});
      return;
    }

    seedOfficialDevice(body, devices);
  }

  function continueWithOfficialDiscovery() {
    var headers = copyObject($request.headers || {});

    deleteHeader(headers, 'If-None-Match');
    deleteHeader(headers, 'If-Modified-Since');
    deleteHeader(headers, 'Cache-Control');
    deleteHeader(headers, 'Pragma');
    headers['Cache-Control'] = 'no-cache';
    headers.Pragma = 'no-cache';

    $done({ headers: headers });
  }

  function seedOfficialDevice(body, devices) {
    identifyAutomaticDevice(body, devices);
  }

  function identifyAutomaticDevice(body, devices) {
    var candidates = [];
    devices.forEach(function (device) {
      device.connections.forEach(function (connection) {
        if (connection.relay || !device.token) return;
        var candidate = copyObject(connection);
        candidate.probeToken = device.token;
        candidate.deviceIdentifier = device.clientIdentifier;
        candidates.push(candidate);
      });
    });

    probeGroup(candidates, '', PROBE_TIMEOUT_SECONDS, function (winner) {
      var device = winner
        ? findDeviceByIdentifier(devices, winner.deviceIdentifier)
        : null;
      if (!winner || !device) {
        log('No official direct candidate authenticated; preserving discovery');
        $done({});
        return;
      }
      persistSelectedDevice(body, device, winner);
    });
  }

  function persistSelectedDevice(body, device, winner) {
    if (!saveCachedDevice(device)) {
      log('Could not persist official Device; returning optimized response only');
    }
    var replacement = replaceConnections(device.raw, winner);
    var optimizedBody = replaceDevice(body, device, replacement);
    finishModifiedResponse(
      optimizedBody,
      'cache-seeded',
      'Seeded ' + labelForDevice(device) + ' with '
        + safeConnectionLabel(winner)
    );
  }

  function probeGroup(connections, token, timeout, callback) {
    var candidates = uniqueConnections(connections);
    if (candidates.length === 0) {
      callback(null, { unauthorized: false });
      return;
    }

    var settled = false;
    var pending = candidates.length;
    var sawUnauthorized = false;
    var timer = setTimeout(function () {
      finish(null);
    }, Math.ceil((timeout + 0.25) * 1000));

    candidates.forEach(function (connection) {
      var headers = {
        Accept: 'application/xml',
        'Accept-Encoding': 'identity',
      };
      var probeToken = connection.probeToken || token;
      if (probeToken) headers['X-Plex-Token'] = probeToken;

      var request = {
        url: probeURL(connection.uri),
        headers: headers,
        opts: {
          redirection: true,
          'auto-cookie': false,
        },
      };

      try {
        var fetchResult = $task.fetch(request);
        fetchResult.then(
          function (response) {
            handleProbeResult(connection, null, response, response && response.body);
          },
          function (reason) {
            handleProbeResult(connection, reason, null, '');
          }
        );
      } catch (error) {
        handleProbeResult(connection, error, null, '');
      }
    });

    function handleProbeResult(connection, error, response, data) {
      if (settled) return;

      var status = responseStatus(response);
      if (status === 401 || status === 403) sawUnauthorized = true;
      var reachable = !error
        && status >= 200
        && status < 300
        && isLibraryResponse(data);

      if (reachable) {
        finish(connection);
        return;
      }

      pending -= 1;
      if (pending === 0) finish(null);
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(result, { unauthorized: sawUnauthorized });
    }
  }

  function finishModifiedResponse(body, marker, message) {
    var headers = copyObject($response.headers || {});
    deleteHeader(headers, 'ETag');
    deleteHeader(headers, 'Content-MD5');
    headers['X-Quantumult-X-Plex-Fast-Connect'] = marker;
    log(message);
    // Quantumult X recalculates length and encoding for body rewrites.
    $done({ headers: headers, body: body });
  }

  function findServerDevices(body) {
    var devices = [];
    var devicePattern = /<Device\b[^>]*>[\s\S]*?<\/Device>/gi;
    var match;

    while ((match = devicePattern.exec(body)) !== null) {
      var raw = match[0];
      var opening = raw.match(/^<Device\b[^>]*>/i);
      if (!opening) continue;

      var provides = xmlAttribute(opening[0], 'provides');
      if (!/(^|,)\s*server\s*(,|$)/i.test(provides)) continue;

      var connections = findConnections(raw);
      if (connections.length === 0) continue;

      devices.push({
        start: match.index,
        end: match.index + raw.length,
        raw: raw,
        connections: connections,
        token: decodeXML(xmlAttribute(opening[0], 'accessToken')),
        name: decodeXML(xmlAttribute(opening[0], 'name')),
        clientIdentifier: decodeXML(xmlAttribute(opening[0], 'clientIdentifier')),
      });
    }

    return devices;
  }

  function findDeviceByIdentifier(devices, clientIdentifier) {
    var wanted = String(clientIdentifier || '').trim().toLowerCase();
    if (!wanted) return null;

    for (var index = 0; index < devices.length; index += 1) {
      if (
        String(devices[index].clientIdentifier || '').trim().toLowerCase()
        === wanted
      ) {
        return devices[index];
      }
    }
    return null;
  }

  function findConnections(deviceBody) {
    var connections = [];
    var connectionPattern = /<Connection\b[^>]*\/\s*>/gi;
    var match;

    while ((match = connectionPattern.exec(deviceBody)) !== null) {
      var raw = match[0];
      var uri = decodeXML(xmlAttribute(raw, 'uri'));
      if (!/^https?:\/\//i.test(uri)) continue;

      var relayValue = xmlAttribute(raw, 'relay');
      var address = decodeXML(xmlAttribute(raw, 'address'));
      var protocol = decodeXML(xmlAttribute(raw, 'protocol'));
      var port = decodeXML(xmlAttribute(raw, 'port'));
      var resolvedProtocol = protocol
        || ((uri.match(/^https?/i) || ['http'])[0].toLowerCase());
      connections.push({
        index: connections.length,
        start: match.index,
        end: match.index + raw.length,
        raw: raw,
        uri: uri,
        protocol: resolvedProtocol,
        address: address,
        port: port || (resolvedProtocol === 'https' ? '443' : '80'),
        local: parseBoolean(xmlAttribute(raw, 'local'), false),
        relay: parseBoolean(relayValue, false) || /\.plex\.bz$/i.test(address),
      });
    }

    return connections;
  }

  function replaceDevice(body, device, replacement) {
    return body.slice(0, device.start) + replacement + body.slice(device.end);
  }

  function replaceConnections(deviceRaw, connection) {
    var withoutConnections = deviceRaw.replace(
      /<Connection\b[^>]*\/\s*>/gi,
      ''
    );
    return withoutConnections.replace(
      /<\/Device>\s*$/i,
      connectionXML(connection) + '</Device>'
    );
  }

  function connectionXML(connection) {
    return [
      '<Connection',
      xmlField('protocol', connection.protocol),
      xmlField('address', connection.address),
      xmlField('port', connection.port),
      xmlField('uri', connection.uri),
      xmlField('local', connection.local ? '1' : '0'),
      xmlField('relay', connection.relay ? '1' : '0'),
      '/>',
    ].join('');
  }

  function buildCachedResources(deviceRaw, connection) {
    return '<?xml version="1.0" encoding="UTF-8"?>'
      + '<MediaContainer size="1">'
      + replaceConnections(deviceRaw, connection)
      + '</MediaContainer>';
  }

  function loadCachedDevice() {
    var stored = readPreference(CACHE_KEY);
    if (!stored) return null;
    try {
      var payload = JSON.parse(stored);
      if (
        !payload
        || payload.sourceSignature !== SOURCE_SIGNATURE
        || typeof payload.raw !== 'string'
      ) {
        return null;
      }
      var devices = findServerDevices(payload.raw);
      var device = findDeviceByIdentifier(devices, payload.clientIdentifier);
      if (!device || !device.token || devices.length !== 1) return null;
      return device;
    } catch (error) {
      return null;
    }
  }

  function saveCachedDevice(device) {
    return writePreference(
      JSON.stringify({
        sourceSignature: SOURCE_SIGNATURE,
        name: device.name,
        clientIdentifier: device.clientIdentifier,
        raw: device.raw,
      }),
      CACHE_KEY
    );
  }

  function clearCachedDevice() {
    if (
      typeof $prefs === 'undefined'
      || !$prefs
      || typeof $prefs.removeValueForKey !== 'function'
    ) {
      return false;
    }
    try {
      var result = $prefs.removeValueForKey(CACHE_KEY);
      return result !== false;
    } catch (error) {
      return false;
    }
  }

  function readPreference(key) {
    if (
      typeof $prefs === 'undefined'
      || !$prefs
      || typeof $prefs.valueForKey !== 'function'
    ) {
      return '';
    }
    try {
      return $prefs.valueForKey(key) || '';
    } catch (error) {
      return '';
    }
  }

  function writePreference(value, key) {
    if (
      typeof $prefs === 'undefined'
      || !$prefs
      || typeof $prefs.setValueForKey !== 'function'
    ) {
      return false;
    }
    try {
      var result = $prefs.setValueForKey(value, key);
      return result !== false;
    } catch (error) {
      return false;
    }
  }

  function uniqueConnections(connections) {
    var seen = {};
    return connections.filter(function (connection) {
      var key = connection.uri + '\n' + String(connection.probeToken || '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function directConnections(device) {
    return device.connections.filter(function (connection) {
      return !connection.relay;
    });
  }

  function probeURL(uri) {
    return uri.split(/[?#]/)[0].replace(/\/+$/, '') + '/library/sections';
  }

  function safeConnectionLabel(connection) {
    var protocol = connection.uri.match(/^https?/i);
    return (protocol ? protocol[0].toLowerCase() : 'http')
      + '://'
      + (connection.address || 'unknown-host')
      + (connection.local ? ' [local]' : connection.relay ? ' [relay]' : ' [remote]');
  }

  function labelForDevice(device) {
    return device.name || device.clientIdentifier || 'Plex server';
  }

  function xmlAttribute(tag, name) {
    var pattern = new RegExp(
      "\\b" + escapeRegExp(name) + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1",
      'i'
    );
    var match = tag.match(pattern);
    return match ? match[2] : '';
  }

  function isLibraryResponse(body) {
    return typeof body === 'string' && /<MediaContainer\b/i.test(body);
  }

  function xmlField(name, value) {
    return ' ' + name + '="' + encodeXML(value) + '"';
  }

  function encodeXML(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function decodeXML(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function deleteHeader(headers, target) {
    Object.keys(headers).forEach(function (name) {
      if (name.toLowerCase() === target.toLowerCase()) delete headers[name];
    });
  }

  function copyObject(source) {
    var copy = {};
    Object.keys(source).forEach(function (key) {
      copy[key] = source[key];
    });
    return copy;
  }

  function inferPhase() {
    return typeof $response !== 'undefined' && $response
      ? 'response'
      : 'request';
  }

  function responseStatus(response) {
    if (!response) return 0;
    var raw = response.statusCode !== undefined
      ? response.statusCode
      : response.status;
    var numeric = Number(raw);
    if (isFinite(numeric)) return numeric;
    var match = String(raw || '').match(/\b([1-5]\d\d)\b/);
    return match ? Number(match[1]) : 0;
  }

  function parseBoolean(value, fallback) {
    if (value === true || value === '1' || String(value).toLowerCase() === 'true') {
      return true;
    }
    if (value === false || value === '0' || String(value).toLowerCase() === 'false') {
      return false;
    }
    return fallback;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  }

  function log(message) {
    console.log(PREFIX + ' ' + message);
  }
})();
