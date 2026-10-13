// -----------------------------------------------------------------------------
// Where to look for Nanoleaf controllers: the mDNS services (`_nanoleafapi`,
// and `_nanoleafms` of the first Light Panels) and the SSDP answers of the old
// Light Panels, both captured by the Gladys core for the integration, plus the
// addresses typed in the configuration.
//
// The container sits on a Docker bridge: multicast never reaches it, so the
// core browses and relays the raw answers (mediated discovery, manifest
// `network_discovery`). The controllers are then reached in unicast.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { parseAddress } from './config.js';
import { NANOLEAF_PORT } from './nanoleaf/model.js';

export const MDNS_SERVICES = ['_nanoleafapi._tcp', '_nanoleafms._tcp'];
export const SSDP_ST = 'nanoleaf_aurora:light';
export const SCAN_TIMEOUT_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The id a controller announces (`id` TXT entry, `nl-deviceid` header). */
export function normalizeDeviceId(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const id = raw.trim().toLowerCase();
  return /^[0-9a-z:-]{4,64}$/.test(id) ? id : null;
}

const validPort = (port) =>
  Number.isInteger(port) && port > 0 && port < 65536 ? port : NANOLEAF_PORT;

/**
 * Controllers announced in mDNS: `[{ host, port, deviceId, name, model }]`.
 * @param {Array} results raw `scanNetwork('mdns')` results
 */
export function parseMdnsResults(results) {
  const found = [];
  for (const result of Array.isArray(results) ? results : []) {
    const host = (Array.isArray(result?.addresses) ? result.addresses : []).find(
      (address) => typeof address === 'string' && IPV4.test(address),
    );
    if (!host) {
      continue;
    }
    const txt = parseMdnsTxt(Array.isArray(result.txt) ? result.txt : []);
    const name =
      typeof result.name === 'string' ? result.name.replace(/\._nanoleaf\w*\._tcp.*$/, '') : '';
    found.push({
      host,
      port: validPort(result.port),
      deviceId: normalizeDeviceId(txt.id),
      name: name || null,
      model: typeof txt.md === 'string' ? txt.md.toUpperCase() : null,
    });
  }
  return found;
}

/** Header values of a raw SSDP answer, names in lower case. */
function parseHeaders(raw) {
  const headers = {};
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      const name = line.slice(0, colon).trim().toLowerCase();
      if (!(name in headers)) {
        headers[name] = line.slice(colon + 1).trim();
      }
    }
  }
  return headers;
}

/**
 * Controllers that answered the SSDP search: `[{ host, port, deviceId, name,
 * model }]`.
 * @param {Array} results raw `scanNetwork('ssdp')` results
 */
export function parseSsdpResults(results) {
  const found = [];
  for (const result of Array.isArray(results) ? results : []) {
    const headers = parseHeaders(result?.headers);
    const isNanoleaf =
      String(headers.st ?? '')
        .toLowerCase()
        .includes('nanoleaf') || headers['nl-deviceid'] !== undefined;
    if (!isNanoleaf) {
      continue;
    }
    const location = headers.location?.match(/^https?:\/\/([^/:]+)(?::(\d+))?/i);
    const fromLocation = location
      ? parseAddress(`${location[1]}:${location[2] ?? NANOLEAF_PORT}`)
      : null;
    const host =
      fromLocation?.host ?? (IPV4.test(result.source_ip ?? '') ? result.source_ip : null);
    if (!host) {
      continue;
    }
    found.push({
      host,
      port: fromLocation?.port ?? NANOLEAF_PORT,
      deviceId: normalizeDeviceId(headers['nl-deviceid']),
      name: headers['nl-devicename'] || null,
      model: null,
    });
  }
  return found;
}

/**
 * Run `task` on every item, `limit` at a time; resolves with the results in
 * order (`{ value }` or `{ error }`).
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
