import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KELVIN,
  capabilitiesOf,
  cleanEffects,
  hsToRgb,
  intToRgb,
  normalizeSerial,
  parseHexColor,
  parseInfo,
  rgbToHs,
  rgbToInt,
} from '../src/nanoleaf/model.js';
import { FIXTURE_NAMES, loadFixture } from './helpers/fakeNanoleaf.js';

test('serial numbers: lower case letters and digits, the device id forever', () => {
  assert.equal(normalizeSerial('S20283H0003'), 's20283h0003');
  assert.equal(normalizeSerial(' S19-124 C0002 '), 's19124c0002');
  assert.equal(normalizeSerial('ab'), null);
  assert.equal(normalizeSerial(42), null);
});

test('effects: the starred, blank, padded and repeated names are left out', () => {
  assert.deepEqual(
    cleanEffects(['Forest', '*Solid*', '*Dynamic*', '', ' Padded', 'Forest', 7, 'Nemo']),
    ['Forest', 'Nemo'],
  );
  assert.deepEqual(cleanEffects(undefined), []);
});

test('every fixture parses, with a white range and its effects', () => {
  for (const name of FIXTURE_NAMES) {
    const info = parseInfo(loadFixture(name));
    assert.match(info.serial, /^s\d{5}[a-z]\d{4}$/, name);
    assert.ok(info.effects.length >= 6, name);
    assert.ok(info.kelvin.min < info.kelvin.max, name);
    assert.equal(typeof info.state.on, 'boolean', name);
  }
  const elements = parseInfo(loadFixture('elements-nl52-9.6.3'));
  assert.deepEqual(elements.kelvin, { min: 1500, max: 4000 });
  assert.deepEqual(capabilitiesOf(elements), {
    color: false,
    touch: true,
    kelvin: elements.kelvin,
  });
  const panels = parseInfo(loadFixture('light-panels-nl22-3.0.6'));
  assert.equal(capabilitiesOf(panels).touch, false);
});

test('the white range as documented (ct max 100) falls back to 1200-6500 K', () => {
  const data = loadFixture('light-panels-nl22-3.0.6');
  data.state.ct = { value: 4000, max: 100, min: 0 };
  assert.deepEqual(parseInfo(data).kelvin, DEFAULT_KELVIN);
  delete data.state.ct;
  assert.deepEqual(parseInfo(data).kelvin, DEFAULT_KELVIN);
  assert.throws(() => parseInfo({ name: 'x' }), /no serial number/);
});

test('colours: RGB to hue and saturation, and back at full brightness', () => {
  assert.deepEqual(rgbToHs({ r: 255, g: 0, b: 0 }), { hue: 0, sat: 100 });
  assert.deepEqual(rgbToHs({ r: 255, g: 128, b: 0 }), { hue: 30, sat: 100 });
  assert.deepEqual(rgbToHs({ r: 0, g: 0, b: 255 }), { hue: 240, sat: 100 });
  assert.deepEqual(rgbToHs({ r: 255, g: 0, b: 128 }), { hue: 330, sat: 100 });
  assert.deepEqual(rgbToHs({ r: 255, g: 255, b: 255 }), { hue: 0, sat: 0 });
  assert.deepEqual(rgbToHs({ r: 0, g: 0, b: 0 }), { hue: 0, sat: 0 });
  assert.deepEqual(hsToRgb(120, 100), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hsToRgb(210, 80), { r: 51, g: 153, b: 255 });
  assert.deepEqual(hsToRgb(0, 0), { r: 255, g: 255, b: 255 });
  for (const value of [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff]) {
    const { hue, sat } = rgbToHs(intToRgb(value));
    assert.equal(rgbToInt(hsToRgb(hue, sat)), value);
  }
});

test('typed colours: #RRGGBB, RRGGBB and #RGB', () => {
  assert.equal(parseHexColor('#FF8800'), 0xff8800);
  assert.equal(parseHexColor(' ff8800 '), 0xff8800);
  assert.equal(parseHexColor('#f80'), 0xff8800);
  assert.equal(parseHexColor('red'), null);
  assert.equal(parseHexColor('#FF88001'), null);
  assert.equal(parseHexColor(undefined), null);
});
