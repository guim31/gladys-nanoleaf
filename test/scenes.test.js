import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { PRESET_COLORS, resolveColor } from '../src/scenes.js';
import {
  ELEMENTS,
  FakeNanoleaf,
  SHAPES,
  TOKEN,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function createdWorld(t, devices) {
  const world = await createWorld({ devices });
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const lastState = (world, device, key) =>
  world.fake.lastState(featureId(world.gladys, device, key));

test('run_effect: starts an effect by name, case ignored, with its brightness', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, [shapes]);
  const ack = await world.fake.sceneAction('run_effect', {
    device: deviceId(world.gladys, shapes),
    effect: '  hot sauce ',
    brightness: 30,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { effect: 'Hot Sauce' });
  assert.equal(shapes.data.effects.select, 'Hot Sauce');
  assert.equal(shapes.state.brightness.value, 30);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.EFFECT), 'Hot Sauce');
  assert.equal(lastState(world, shapes, FEATURE_KEYS.BRIGHTNESS), 30);
});

test('run_effect: an unknown effect fails the action and names the effects', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, [shapes]);
  const ack = await world.fake.sceneAction('run_effect', {
    device: deviceId(world.gladys, shapes),
    effect: 'Disco',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /has no effect "Disco"\. Its effects: Beatdrop, Blaze/);
});

test('show_color: a colour for a while, then back to the effect and brightness', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, [shapes]);
  const ack = await world.fake.sceneAction('show_color', {
    device: deviceId(world.gladys, shapes),
    color: 'green',
    duration: 10,
    brightness: 100,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(shapes.state.colorMode, 'hs');
  assert.equal(shapes.state.hue.value, 120);
  assert.equal(shapes.state.brightness.value, 100);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.COLOR), 0x00ff00);

  t.mock.timers.tick(9_000);
  await world.hub.idle();
  assert.equal(shapes.state.colorMode, 'hs', 'not before the end');
  t.mock.timers.tick(1_000);
  await world.hub.idle();
  assert.equal(shapes.data.effects.select, 'Northern Lights');
  assert.equal(shapes.state.colorMode, 'effect');
  assert.equal(shapes.state.brightness.value, 80);
  assert.equal(shapes.state.on.value, true);
  assert.equal(lastState(world, shapes, FEATURE_KEYS.EFFECT), 'Northern Lights');
});

test('show_color: back to off and white; a command meanwhile cancels the return', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  shapes.data.state.on.value = false;
  shapes.data.state.colorMode = 'ct';
  shapes.data.effects.select = '*Solid*';
  const world = await createdWorld(t, [shapes]);
  const device = deviceId(world.gladys, shapes);

  await world.fake.sceneAction('show_color', {
    device,
    color: 'red',
    custom_color: '#0080ff',
    duration: 5,
  });
  assert.equal(shapes.state.hue.value, 210);
  assert.equal(shapes.state.on.value, true);
  // A second flash keeps the state from before the first one.
  await world.fake.sceneAction('show_color', { device, color: 'yellow', duration: 5 });
  t.mock.timers.tick(5_000);
  await world.hub.idle();
  assert.equal(shapes.state.on.value, false);
  assert.equal(shapes.state.colorMode, 'ct');
  assert.equal(shapes.state.ct.value, 3500);

  await world.fake.sceneAction('show_color', { device, color: 'blue', duration: 5 });
  await world.fake.setValue(
    { external_id: device },
    { external_id: featureId(world.gladys, shapes, FEATURE_KEYS.BRIGHTNESS) },
    50,
  );
  t.mock.timers.tick(5_000);
  await world.hub.idle();
  assert.equal(shapes.state.hue.value, 240, 'the colour stays: the user took over');
  assert.equal(shapes.state.on.value, true);
});

test('show_color: refused on white-only Elements and for a wrong colour', async (t) => {
  const elements = new FakeNanoleaf(ELEMENTS, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, [elements]);
  const device = deviceId(world.gladys, elements);
  let ack = await world.fake.sceneAction('show_color', { device, color: 'red', duration: 5 });
  assert.equal(ack.success, false);
  assert.match(ack.error, /only shows white/);
  ack = await world.fake.sceneAction('show_color', {
    device,
    color: 'red',
    custom_color: 'rouge',
    duration: 5,
  });
  assert.match(ack.error, /"rouge" is not a colour/);
});

test('colours: presets and the #RRGGBB forms', () => {
  assert.equal(resolveColor({ color: 'orange' }), PRESET_COLORS.orange);
  assert.equal(resolveColor({ color: 'red', custom_color: '#f80' }), 0xff8800);
  assert.equal(resolveColor({ color: 'red', custom_color: '00FF7f' }), 0x00ff7f);
  assert.equal(resolveColor({ color: 'red', custom_color: '  ' }), 0xff0000);
  assert.throws(() => resolveColor({ color: 'mauve' }), /Unknown colour/);
});
