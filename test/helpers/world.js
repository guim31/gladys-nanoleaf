// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Nanoleaf controllers on a
// fake network, and a temporary /data, with the integration wired on top
// through registerHandlers. No timer runs unless asked: the tests read the
// controllers with `world.hub.refreshAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { parseInfo } from '../../src/nanoleaf/model.js';
import { Store } from '../../src/store.js';
import { FIXTURE_NAMES, FakeNanoleaf, createNetwork } from './fakeNanoleaf.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// Fast reconnections of the event streams.
export const FAST_STREAM = { retryMinMs: 5, retryMaxMs: 20 };

export const LIGHT_PANELS = 'light-panels-nl22-3.0.6';
export const CANVAS = 'canvas-nl29-9.2.3';
export const SHAPES = 'shapes-hexagons-nl42-9.6.3';
export const ELEMENTS = 'elements-nl52-9.6.3';
export const LINES = 'lines-nl59-9.6.3';

export const TOKEN = 'PairedToken0000000000000000000001';

/** One fake controller per fixture, at 192.0.2.10, .11..., already paired with TOKEN. */
export function allDevices() {
  return FIXTURE_NAMES.map(
    (name, index) => new FakeNanoleaf(name, `192.0.2.${10 + index}`, { token: TOKEN }),
  );
}

/** A /data directory where `devices` are already paired (what a pairing writes). */
export function pairedDataDir(devices, dataDir = mkdtempSync(join(tmpdir(), 'gladys-nanoleaf-'))) {
  const controllers = {};
  for (const device of devices) {
    const { state, effect, ...info } = parseInfo(device.data);
    void state;
    void effect;
    controllers[info.serial] = {
      host: device.host,
      port: device.port,
      token: [...device.tokens][0],
      deviceId: null,
      info,
    };
  }
  writeFileSync(join(dataDir, 'nanoleaf.json'), JSON.stringify({ controllers }));
  return dataDir;
}

/**
 * @param {object} [options]
 * @param {FakeNanoleaf[]} [options.devices] the fake controllers of the network
 * @param {boolean} [options.paired] whether /data already holds their tokens
 * @param {boolean} [options.scan] whether the core's discovery finds them
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.timers] the hub's own timers (off: the tests refresh)
 */
export async function createWorld({
  devices = [new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN })],
  paired = true,
  scan = true,
  config = { language: 'en' },
  created = [],
  connect = true,
  dataDir,
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(devices);
  const directory =
    dataDir ??
    (paired
      ? pairedDataDir(devices.filter((device) => device.tokens.size > 0))
      : mkdtempSync(join(tmpdir(), 'gladys-nanoleaf-')));
  const gladys = createFakeGladys({
    config,
    devices: created,
    scanResults: scan ? { mdns: network.mdnsResults(), ssdp: network.ssdpResults() } : {},
  });
  const app = registerHandlers(gladys, {
    store: new Store(directory),
    fetch: network.fetch,
    timers,
    timings,
    clientTimings: { requestTimeoutMs: 200 },
    streamTimings: FAST_STREAM,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, dataDir: directory };
}

export const serialOf = (device) => device.data.serialNo.toLowerCase();
export const deviceId = (gladys, device) => gladys.externalIds('nanoleaf', serialOf(device)).device;
export const featureId = (gladys, device, key) =>
  gladys.externalIds('nanoleaf', serialOf(device)).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

/** Let the event streams deliver what was pushed, then wait for the hub. */
export async function settle(world) {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await world.hub.idle();
}

export { FakeNanoleaf };
