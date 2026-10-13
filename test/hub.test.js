import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import {
  CANVAS,
  ELEMENTS,
  FakeNanoleaf,
  LIGHT_PANELS,
  SHAPES,
  TOKEN,
  allDevices,
  createAll,
  createWorld,
  deviceId,
  featureId,
  settle,
} from './helpers/world.js';

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const lastState = (world, device, key) =>
  world.fake.lastState(featureId(world.gladys, device, key));

test('start: the paired controllers are published, with their states once created', async (t) => {
  const devices = allDevices();
  const world = await createdWorld(t, { devices });
  assert.equal(world.fake.discoveredDevices.length, 5);
  const shapes = devices.find((device) => device.fixture === SHAPES);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.POWER), 1);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 80);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.EFFECT), 'Northern Lights');
  assert.equal(lastState(world, shapes, FEATURE_KEYS.ONLINE), 1);
  const canvas = devices.find((device) => device.fixture === CANVAS);
  assert.equal(lastState(world, canvas, FEATURE_KEYS.EFFECT), '*Solid*');
  assert.equal(world.fake.connectionStatus.connected, true);
});

// --- Pairing -------------------------------------------------------------------

test('pairing: a controller found but not paired is listed, then paired by the button', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.20');
  const world = await createWorld({ devices: [shapes], paired: false });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /not paired yet/);

  // Not in pairing mode: nothing paired, the instructions.
  let ack = await world.fake.action('pair', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /No Nanoleaf in pairing mode. Hold its power button/);
  assert.match(ack.data.message.fr, /Maintenez son bouton marche 5 à 7 secondes/);

  shapes.holdPowerButton();
  ack = await world.fake.action('pair', {});
  assert.match(ack.data.message.en, /^Paired: Shapes 7D21\. Open the Discovery tab/);
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.fake.discoveredDevices[0].name, 'Shapes 7D21');
  assert.equal(world.fake.connectionStatus.connected, true);

  // The token is kept under /data, readable by the container user only.
  const file = join(world.dataDir, 'nanoleaf.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.controllers.s20283h0003.token, [...shapes.tokens][0]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  // Pairing again: already paired.
  ack = await world.fake.action('pair', { host: '192.0.2.20' });
  assert.match(ack.data.message.en, /Already paired: Shapes 7D21/);
});

test('pairing: a typed address, an invalid one, and nothing on the network', async (t) => {
  const lines = new FakeNanoleaf('lines-nl59-9.6.3', '192.0.2.30', { port: 16021 });
  const world = await createWorld({ devices: [lines], paired: false, scan: false });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.en, /No Nanoleaf found/);

  let ack = await world.fake.action('pair', { host: 'nanoleaf.local' });
  assert.match(ack.data.message.en, /not an IPv4 address/);
  ack = await world.fake.action('pair', {});
  assert.match(ack.data.message.en, /No Nanoleaf to pair found/);
  ack = await world.fake.action('pair', { host: '192.0.2.99' });
  assert.match(ack.data.message.en, /Not answering: 192\.0\.2\.99/);

  lines.holdPowerButton();
  ack = await world.fake.action('pair', { host: ' 192.0.2.30 ' });
  assert.match(ack.data.message.en, /^Paired: Lines 9A04/);
  assert.equal(world.fake.discoveredDevices[0].params[0].value, '192.0.2.30');
});

test('pairing: a controller that forgot its token is said, then paired again', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  shapes.forgetTokens();
  await world.hub.refreshAll();
  await settle(world);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /refuses its access token/);
  const search = await world.fake.action('search', {});
  assert.match(search.data.message.en, /Shapes 7D21 \(192\.0\.2\.10, pair again\)/);

  shapes.holdPowerButton();
  const ack = await world.fake.action('pair', {});
  assert.match(ack.data.message.en, /^Paired: Shapes 7D21/);
  assert.equal(world.fake.connectionStatus.connected, true);
  shapes.changeFromApp({ brightness: 12 });
  await settle(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 12);
});

// --- Live events -----------------------------------------------------------------

test('events: a change made in the Nanoleaf app reaches Gladys without any read', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  await settle(world);
  assert.equal(shapes.openStreams(), 1);
  const reads = shapes.requests.filter((request) => request.path === '').length;

  shapes.changeFromApp({ brightness: 35 });
  shapes.changeFromApp({ hue: 240, sat: 100, colorMode: 'hs' });
  await settle(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 35);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.COLOR), 0x0000ff);

  shapes.changeFromApp({ effect: 'Prism' });
  await settle(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.EFFECT), 'Prism');
  shapes.changeFromApp({ on: false });
  await settle(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.POWER), 0);
  assert.equal(shapes.requests.filter((request) => request.path === '').length, reads);
});

test('events: gestures fire the scene trigger, with the panel of a tap', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  await settle(world);
  shapes.gesture(1, 4821);
  shapes.gesture(2);
  shapes.gesture(9);
  await settle(world);
  assert.deepEqual(
    world.fake.sceneEvents.map(({ key, data }) => ({ key, data })),
    [
      {
        key: 'gesture',
        data: { device: deviceId(world.gladys, shapes), gesture: 'double_tap', panel: 4821 },
      },
      {
        key: 'gesture',
        data: { device: deviceId(world.gladys, shapes), gesture: 'swipe_up', panel: null },
      },
    ],
  );
});

test('events: no trigger for a controller not added to Gladys, nor for a model without touch', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const panels = new FakeNanoleaf(LIGHT_PANELS, '192.0.2.11', { token: TOKEN });
  const world = await createWorld({ devices: [shapes, panels] });
  t.after(() => world.app.stop());
  await settle(world);
  shapes.gesture(0, 12);
  panels.gesture(0, 12);
  await settle(world);
  assert.deepEqual(world.fake.sceneEvents, []);
  // The Light Panels stream does not even ask for the touch events.
  const stream = (device) => device.requests.find((request) => request.path === 'events');
  assert.equal(stream(panels).query, 'id=1,3');
  assert.equal(stream(shapes).query, 'id=1,3,4');
});

// --- Commands ----------------------------------------------------------------------

test('commands: power, brightness, colour, white and effects reach the controller', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  const set = (key, value) =>
    world.fake.setValue(
      { external_id: deviceId(world.gladys, shapes) },
      { external_id: featureId(world.gladys, shapes, key) },
      value,
    );
  const body = () => shapes.requests.at(-1).body;

  assert.equal((await set(FEATURE_KEYS.POWER, 0)).success, true);
  assert.deepEqual(body(), { on: { value: false } });
  assert.equal(lastState(world, shapes, FEATURE_KEYS.POWER), 0);

  await set(FEATURE_KEYS.BRIGHTNESS, 40);
  assert.deepEqual(body(), { brightness: { value: 40 }, on: { value: true } });
  assert.equal(lastState(world, shapes, FEATURE_KEYS.POWER), 1);

  await set(FEATURE_KEYS.COLOR, 0xff8000);
  assert.deepEqual(body(), { hue: { value: 30 }, sat: { value: 100 }, on: { value: true } });
  assert.equal(lastState(world, shapes, FEATURE_KEYS.COLOR), 0xff8000);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.EFFECT), '*Solid*');

  await set(FEATURE_KEYS.TEMPERATURE, 9000);
  assert.deepEqual(body(), { ct: { value: 6500 }, on: { value: true } });
  assert.equal(lastState(world, shapes, FEATURE_KEYS.TEMPERATURE), 6500);

  await set(FEATURE_KEYS.EFFECT, 'cocoa beach');
  assert.deepEqual(shapes.requests.at(-1), {
    method: 'PUT',
    path: 'effects',
    body: { select: 'Cocoa Beach' },
  });
  assert.equal(lastState(world, shapes, FEATURE_KEYS.EFFECT), 'Cocoa Beach');

  // "None": back to the white it had.
  await set(FEATURE_KEYS.EFFECT, '*Solid*');
  assert.deepEqual(body(), { ct: { value: 6500 }, on: { value: true } });
  assert.equal(lastState(world, shapes, FEATURE_KEYS.EFFECT), '*Solid*');

  const unknown = await set(FEATURE_KEYS.EFFECT, 'Disco');
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /no effect "Disco"/);

  await set(FEATURE_KEYS.BRIGHTNESS, 0);
  assert.deepEqual(body(), { on: { value: false } });
});

test('commands: Elements have no colour, and a white within their range', async (t) => {
  const elements = new FakeNanoleaf(ELEMENTS, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [elements] });
  const [device] = world.fake.discoveredDevices;
  const keys = device.features.map((feature) => feature.external_id.split(':').at(-1));
  assert.deepEqual(keys, ['power', 'brightness', 'color-temperature', 'effect', 'online']);
  const white = device.features.find((feature) => feature.type === 'temperature');
  assert.deepEqual([white.min, white.max], [1500, 4000]);
  assert.equal(lastState(world, elements, FEATURE_KEYS.TEMPERATURE), 2700);
  assert.equal(lastState(world, elements, FEATURE_KEYS.POWER), 0);
});

// --- Reachability --------------------------------------------------------------------

test('reachability: an unplugged controller goes dark and offline, then comes back', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  await settle(world);
  shapes.setOnline(false);
  await settle(world);
  await world.hub.refreshAll();
  await settle(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.ONLINE), 0);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.POWER), 0);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);

  shapes.setOnline(true);
  await world.hub.refreshAll();
  await settle(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.ONLINE), 1);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.POWER), 1);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('reachability: a controller known from /data but off at start is offline at once', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  shapes.setOnline(false);
  const world = await createWorld({ devices: [shapes], created: [] });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1, 'still offered in Discovery');
  await createAll(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.ONLINE), 0);
  assert.match(world.fake.connectionStatus.message.en, /No paired Nanoleaf answers/);
});

test('discovery: a controller with a new address (DHCP) is followed, by its mDNS id', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  await world.hub.rediscover(); // learns the mDNS id of the controller
  shapes.setOnline(false);
  shapes.host = '192.0.2.77';
  shapes.setOnline(true);
  world.fake.scanResults = { mdns: world.network.mdnsResults(), ssdp: [] };
  await world.hub.rediscover();
  await settle(world);
  assert.equal(world.fake.discoveredDevices[0].params[0].value, '192.0.2.77');
  assert.equal(lastState(world, shapes, FEATURE_KEYS.ONLINE), 1);
  shapes.changeFromApp({ brightness: 22 });
  await settle(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 22);
});

test('discovery: a controller with a new address and no id is found by its token', async (t) => {
  const panels = new FakeNanoleaf(LIGHT_PANELS, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [panels], scan: false });
  panels.host = '192.0.2.78';
  await world.hub.refreshAll();
  await world.hub.refreshAll();
  assert.equal(lastState(world, panels, FEATURE_KEYS.ONLINE), 0);
  world.fake.scanResults = { ssdp: world.network.ssdpResults() };
  world.fake.scanResults.ssdp[0].headers = world.fake.scanResults.ssdp[0].headers.replace(
    /nl-deviceid.*\r\n/,
    '',
  );
  await world.hub.rediscover();
  await settle(world);
  assert.equal(world.fake.discoveredDevices[0].params[0].value, '192.0.2.78');
  assert.equal(lastState(world, panels, FEATURE_KEYS.ONLINE), 1);
});

test('effects: a new effect made in the app reaches the list of the created device', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  shapes.data.effects.effectsList.push('My Sunset');
  await world.hub.refreshAll();
  const effect = world.fake.discoveredDevices[0].features.find(
    (feature) => feature.type === 'select',
  );
  assert.ok(effect.supported_options.some((option) => option.value === 'My Sunset'));
  assert.equal(effect.supported_options[0].value, '*Solid*');
});

test('states: every refresh asks the SDK for a heartbeat shorter than 12 hours', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  const calls = t.mock.method(world.gladys, 'publishChangedStates');
  await world.hub.refreshAll();
  assert.equal(calls.mock.callCount(), 1);
  const { heartbeat } = calls.mock.calls[0].arguments[1];
  assert.ok(heartbeat > 0 && heartbeat <= 12 * 3600 * 1000);
});

test('states: the states are sent again when the user adds the device', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createWorld({ devices: [shapes] });
  t.after(() => world.app.stop());
  assert.equal(world.fake.states.length, 0, 'nothing before the device exists');
  await createAll(world);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 80);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.ok(world.fake.widgetRefreshes.length > 0);
});

test('events: a controller refusing the gesture events keeps its state events', async (t) => {
  const odd = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  odd.data.model = 'NL99';
  odd.refuseTouch = true;
  const world = await createdWorld(t, { devices: [odd] });
  for (let round = 0; round < 20 && odd.openStreams() === 0; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(odd.openStreams(), 1);
  const streams = odd.requests.filter((request) => request.path === 'events');
  assert.deepEqual(
    streams.map((request) => request.query),
    ['id=1,3,4', 'id=1,3'],
  );
  odd.changeFromApp({ brightness: 9 });
  await settle(world);
  assert.equal(lastState(world, odd, FEATURE_KEYS.BRIGHTNESS), 9);
});
