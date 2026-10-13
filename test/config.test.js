import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseAddress, parseHosts } from '../src/config.js';

test('addresses: IPv4 with an optional port, separated by anything, without duplicates', () => {
  assert.deepEqual(parseHosts('192.0.2.10, 192.0.2.11:16022;192.0.2.10\n198.51.100.7'), {
    hosts: [
      { host: '192.0.2.10', port: 16021 },
      { host: '192.0.2.11', port: 16022 },
      { host: '198.51.100.7', port: 16021 },
    ],
    invalid: [],
  });
  assert.deepEqual(
    parseHosts('192.0.2.010 shapes.local 192.0.2.300 http://192.0.2.1 192.0.2.1:0'),
    {
      hosts: [{ host: '192.0.2.10', port: 16021 }],
      invalid: ['shapes.local', '192.0.2.300', 'http://192.0.2.1', '192.0.2.1:0'],
    },
  );
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
  assert.equal(parseAddress('192.0.2.1:70000'), null);
});

test('defaults: no address, French names', () => {
  assert.deepEqual(normalizeConfig(), { hosts: [], invalidHosts: [], language: 'fr' });
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('an unknown language falls back to the default', () => {
  assert.equal(normalizeConfig({ language: 'it', hosts: 42 }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
  assert.equal(normalizeConfig(null).language, 'fr');
});
