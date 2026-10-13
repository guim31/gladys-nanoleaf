// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the life of the
// controllers and of Gladys, never one line per reading or event, a repeated
// failure once, and never a token. Also: the hub reads the controllers by its
// own timer, without onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import {
  FakeNanoleaf,
  SHAPES,
  TOKEN,
  createAll,
  createWorld,
  deviceId,
  featureId,
  settle,
} from './helpers/world.js';

/** Everything written on stdout and stderr while `fn` runs, at `level`. */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  await settle(world);
  return world;
}

const lastState = (world, device, key) =>
  world.fake.lastState(featureId(world.gladys, device, key));

test('logs: normal reads and live events, with changes, write nothing at the info level', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  const lines = await capture(t, async () => {
    for (const brightness of [20, 40, 60, 60]) {
      shapes.data.state.brightness.value = brightness;
      await world.hub.refreshAll();
    }
    shapes.changeFromApp({ brightness: 70, effect: 'Prism' });
    shapes.gesture(1, 12);
    await settle(world);
    await world.hub.rediscover();
    await world.hub.idle();
  });
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 70);
  assert.deepEqual(lines, []);
});

test('logs: Gladys refusing the states at every read is said once, and its return once', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  const refusal = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const brightness of [20, 30, 40, 50]) {
      shapes.data.state.brightness.value = brightness;
      await world.hub.refreshAll();
    }
    await world.hub.idle();
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(
    failing[0],
    /\[WARN\].*Gladys does not take the Nanoleaf updates: Gladys is restarting/,
  );

  refusal.mock.restore();
  const back = await capture(t, async () => {
    await world.hub.refreshAll();
    await world.hub.refreshAll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the Nanoleaf updates again/);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 50);
});

test('logs: a controller answering errors is said once, and its return once', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  shapes.failWith = 500;
  const failing = await capture(t, async () => {
    for (let read = 0; read < 4; read += 1) {
      await world.hub.refreshAll();
    }
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /\[WARN\].*Cannot read Shapes 7D21: 192\.0\.2\.10 answers HTTP 500/);

  shapes.failWith = null;
  const back = await capture(t, async () => {
    await world.hub.refreshAll();
    await world.hub.refreshAll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Shapes 7D21 reads again/);
});

test('logs: an unplugged controller is said once when lost and once when back', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes] });
  const lines = await capture(t, async () => {
    shapes.setOnline(false);
    for (let read = 0; read < 5; read += 1) {
      await world.hub.refreshAll();
      await settle(world);
    }
    shapes.setOnline(true);
    await world.hub.refreshAll();
    await world.hub.refreshAll();
    await settle(world);
  });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Shapes 7D21 no longer answers at 192\.0\.2\.10/);
  assert.match(lines[1], /\[INFO\].*Shapes 7D21 answers at 192\.0\.2\.10/);
});

test('logs: a core without mediated discovery is said once', async (t) => {
  const world = await createdWorld(t, {});
  t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw new GladysApiError(403, 'FORBIDDEN', 'network_discovery not declared');
  });
  const lines = await capture(t, async () => {
    for (let round = 0; round < 3; round += 1) {
      await world.hub.track(world.hub.rediscover());
    }
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Nanoleaf discovery through Gladys failed/);
  assert.equal(world.hub.summary().scan, 'unavailable');
});

test('logs: a bug in a background task is logged with its stack, not hidden', async (t) => {
  const world = await createdWorld(t, {});
  t.mock.method(world.hub, 'publishTransports', async () => {
    throw new RangeError('a bug');
  });
  const lines = await capture(t, async () => {
    await world.hub.track(world.hub.rediscover());
  });
  const text = lines.join('\n');
  assert.match(text, /\[ERROR\].*Background task failed/);
  assert.match(text, /RangeError: a bug\n\s+at /);
});

test('logs: no token ever, even at the debug level and in the errors sent to Gladys', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.20');
  const world = await createWorld({ devices: [shapes], paired: false });
  t.after(() => world.app.stop());
  const acks = [];
  const lines = await capture(
    t,
    async () => {
      shapes.holdPowerButton();
      acks.push(await world.fake.action('pair', {}));
      await createAll(world);
      await settle(world);
      const device = { external_id: deviceId(world.gladys, shapes) };
      const feature = (key) => ({ external_id: featureId(world.gladys, shapes, key) });
      acks.push(await world.fake.setValue(device, feature(FEATURE_KEYS.BRIGHTNESS), 30));
      acks.push(await world.fake.setValue(device, feature(FEATURE_KEYS.EFFECT), 'Nope'));
      shapes.changeFromApp({ hue: 10 });
      shapes.gesture(0, 3);
      await settle(world);
      shapes.failWith = 500;
      await world.hub.refreshAll();
      acks.push(await world.fake.setValue(device, feature(FEATURE_KEYS.POWER), 0));
      shapes.failWith = null;
      shapes.setOnline(false);
      await world.hub.refreshAll();
      await world.hub.refreshAll();
      acks.push(await world.fake.setValue(device, feature(FEATURE_KEYS.POWER), 0));
      shapes.setOnline(true);
      shapes.forgetTokens();
      await world.hub.refreshAll();
      acks.push(await world.fake.setValue(device, feature(FEATURE_KEYS.POWER), 0));
      await settle(world);
    },
    'debug',
  );
  const token = [...world.hub.records.values()][0].token;
  assert.ok(token.length >= 16);
  assert.ok(lines.length >= 8, 'the debug level writes the details');
  const leaks = [...lines, ...acks.map((ack) => JSON.stringify(ack))].filter((line) =>
    line.includes(token),
  );
  assert.deepEqual(leaks, []);
  assert.ok(acks.some((ack) => ack.success === false));
});

test('polling: the hub reads by its own timer, without any onPoll; devices have should_poll false', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, { devices: [shapes], timers: true });
  assert.ok(world.fake.discoveredDevices.every((device) => device.should_poll === false));
  assert.ok(world.fake.discoveredDevices.every((device) => device.poll_frequency === undefined));
  const onPoll = t.mock.method(world.hub, 'refresh');

  // Changed on the controller, without event: only a read can see it.
  shapes.data.state.brightness.value = 33;
  t.mock.timers.tick(59_000);
  await world.hub.idle();
  assert.equal(onPoll.mock.callCount(), 0, 'not before the interval');
  t.mock.timers.tick(1_000);
  await world.hub.idle();
  assert.equal(onPoll.mock.callCount(), 1);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 33);
  assert.equal(
    world.fake.requests.filter((request) => request.path.includes('poll')).length,
    0,
    'Gladys never polled',
  );
});
