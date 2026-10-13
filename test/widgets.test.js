import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildDevice } from '../src/devices.js';
import { WIDGET_KEY } from '../src/hub.js';
import {
  CANVAS,
  FakeNanoleaf,
  LIGHT_PANELS,
  SHAPES,
  TOKEN,
  createAll,
  createWorld,
  deviceId,
  settle,
} from './helpers/world.js';

async function createdWorld(t, devices) {
  const world = await createWorld({ devices });
  t.after(() => world.app.stop());
  await createAll(world);
  await settle(world);
  return world;
}

async function content(world, settings, language = 'en') {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content.components;
}

const buttons = (components) => components.filter((component) => component.type === 'button');
const status = (components) => components.find((component) => component.type === 'status').items;

/** Every live tile is bound to a feature of the device the integration publishes. */
function assertBound(world, components, device) {
  const record = world.hub.resolveDevice(deviceId(world.gladys, device));
  const published = buildDevice(world.gladys, record, 'en').features.map((f) => f.external_id);
  for (const component of components) {
    if (component.device_feature) {
      assert.ok(published.includes(component.device_feature), component.device_feature);
    }
  }
}

test('widget: favourite effects, the running one marked, the state and the last gesture', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, [shapes]);
  shapes.gesture(0, 4821);
  await settle(world);
  const settings = {
    device: deviceId(world.gladys, shapes),
    effects: 'northern lights, Prism, Nope',
  };
  const components = await content(world, settings);
  assert.deepEqual(validateWidgetContent({ components }), []);
  assertBound(world, components, shapes);
  assert.deepEqual(
    buttons(components).map(({ label, icon, action }) => [label, icon, action.key]),
    [
      ['Northern Lights', 'check-circle', 'effect_1'],
      ['Prism', 'play', 'effect_2'],
      ['Turn off', 'power', 'power'],
    ],
  );
  assert.deepEqual(
    status(components).map(({ label, value }) => [label, value]),
    [
      ['Light', 'On'],
      ['Effect', 'Northern Lights'],
      ['Last gesture', 'Single tap (panel 4821)'],
    ],
  );
  assert.match(components[0].text, /^Shapes · 192\.0\.2\.10$/);

  const fr = await content(world, settings, 'fr');
  assert.equal(status(fr)[2].value, 'Simple tape (panneau 4821)');
  assert.equal(buttons(fr).at(-1).label, 'Éteindre');
});

test('widget: four favourites leave no room for the power button; defaults are three', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, [shapes]);
  const device = deviceId(world.gladys, shapes);
  let components = await content(world, {
    device,
    effects: 'Prism, Jungle, Blaze, Hip Hop, Sundown',
  });
  assert.deepEqual(
    buttons(components).map(({ label }) => label),
    ['Prism', 'Jungle', 'Blaze', 'Hip Hop'],
  );
  components = await content(world, { device });
  assert.deepEqual(
    buttons(components).map(({ label }) => label),
    ['Beatdrop', 'Blaze', 'Cocoa Beach', 'Turn off'],
  );
  assert.deepEqual(validateWidgetContent({ components }), []);
});

test('widget: a colour, a white, no touch, unreachable', async (t) => {
  const canvas = new FakeNanoleaf(CANVAS, '192.0.2.10', { token: TOKEN });
  const panels = new FakeNanoleaf(LIGHT_PANELS, '192.0.2.11', { token: TOKEN });
  const world = await createdWorld(t, [canvas, panels]);
  let components = await content(world, { device: deviceId(world.gladys, canvas) });
  assert.equal(status(components)[1].value, 'Color');
  assert.equal(status(components)[2].value, 'None yet');

  components = await content(world, { device: deviceId(world.gladys, panels) });
  assert.equal(status(components).length, 2, 'no gesture row without touch');

  canvas.changeFromApp({ ct: 2700, colorMode: 'ct' });
  await settle(world);
  components = await content(world, { device: deviceId(world.gladys, canvas) });
  assert.equal(status(components)[1].value, 'White 2700 K');

  canvas.setOnline(false);
  await world.hub.refreshAll();
  await world.hub.refreshAll();
  components = await content(world, { device: deviceId(world.gladys, canvas) }, 'de');
  assert.match(components[0].text, /antwortet nicht$/);
  assert.equal(status(components)[0].value, 'Aus');
  assert.equal(buttons(components).at(-1).label, 'Einschalten');
});

test('widget: the buttons start an effect and toggle the power', async (t) => {
  const shapes = new FakeNanoleaf(SHAPES, '192.0.2.10', { token: TOKEN });
  const world = await createdWorld(t, [shapes]);
  const settings = { device: deviceId(world.gladys, shapes) };
  let ack = await world.fake.widgetAction(
    WIDGET_KEY,
    'effect_2',
    { effect: 'Blaze' },
    { settings },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(shapes.data.effects.select, 'Blaze');
  assert.equal(ack.data.message.es, 'Efecto iniciado: Blaze');

  ack = await world.fake.widgetAction(WIDGET_KEY, 'power', {}, { settings });
  assert.equal(shapes.state.on.value, false);
  assert.equal(ack.data.message.fr, 'Éteint');
  ack = await world.fake.widgetAction(WIDGET_KEY, 'power', {}, { settings });
  assert.equal(shapes.state.on.value, true);
  assert.equal(ack.data.message.de, 'Eingeschaltet');
});

test('widget: no device chosen, or a device no longer paired', async (t) => {
  const world = await createdWorld(t, []);
  let components = await content(world, {}, 'es');
  assert.match(components[0].text, /^Elija un Nanoleaf/);
  components = await content(world, { device: 'ext:test-integration:nanoleaf:gone' }, 'fr');
  assert.match(components[0].text, /n'est plus appairé/);
});
