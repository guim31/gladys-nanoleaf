// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// The tokens are not here: the pairing writes them under /data (src/store.js).
// -----------------------------------------------------------------------------

import { NANOLEAF_PORT } from './nanoleaf/model.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  hosts: '',
  language: 'fr',
};

const ADDRESS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/;
const MAX_HOSTS = 32;

/**
 * Parse one address: an IPv4, with an optional port (16021 by default).
 * Host names are refused: the container cannot resolve `.local` names.
 * @returns {{ host: string, port: number } | null}
 */
export function parseAddress(raw) {
  const match = typeof raw === 'string' ? raw.trim().match(ADDRESS) : null;
  if (!match) {
    return null;
  }
  const parts = match.slice(1, 5).map(Number);
  const port = match[5] === undefined ? NANOLEAF_PORT : Number(match[5]);
  if (!parts.every((part) => part <= 255) || port < 1 || port > 65535) {
    return null;
  }
  // Leading zeros would make another string for the same address.
  return { host: parts.join('.'), port };
}

/**
 * Parse the manual address list (commas, semicolons, spaces or new lines).
 * @returns {{ hosts: Array<{ host: string, port: number }>, invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    const text = entry.trim();
    if (!text) {
      continue;
    }
    const address = parseAddress(text);
    if (!address) {
      invalid.push(text);
    } else if (
      !hosts.some((known) => known.host === address.host && known.port === address.port) &&
      hosts.length < MAX_HOSTS
    ) {
      hosts.push(address);
    }
  }
  return { hosts, invalid };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  return {
    hosts,
    invalidHosts: invalid,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
