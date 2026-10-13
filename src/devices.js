// -----------------------------------------------------------------------------
// From a Nanoleaf controller to a Gladys device, and back: discovery payload,
// state values, and the OpenAPI request of each command.
//
// One Gladys device per controller (one layout of panels), keyed on its
// serial number. Features (couples checked against the Gladys front):
//   - power              light/binary
//   - brightness         light/brightness, 0-100 %
//   - color              light/color (RGB integer), hue and saturation on
//                        the controller; not on Elements (white only)
//   - color-temperature  light/temperature, in kelvins, the controller's range
//   - effect             text/select: the effects of THIS controller, plus
//                        "None" (plain colour or white). light/effect-mode is
//                        display-only, a text/select can be driven.
//   - online             presence-sensor/binary, read only: the controller
//                        answers (the transport badge says it too, but a
//                        feature can drive a scene)
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  SOLID_EFFECT,
  clamp,
  hsToRgb,
  intToRgb,
  modelName,
  rgbToHs,
  rgbToInt,
} from './nanoleaf/model.js';

export const DEVICE_TYPE = 'nanoleaf';

export const FEATURE_KEYS = {
  POWER: 'power',
  BRIGHTNESS: 'brightness',
  COLOR: 'color',
  TEMPERATURE: 'color-temperature',
  EFFECT: 'effect',
  ONLINE: 'online',
};

// Feature names are frozen when the user creates the device: written in the
// language chosen in the configuration at that moment.
export const NAMES = {
  en: {
    light: 'Light',
    brightness: 'Brightness',
    color: 'Color',
    'color-temperature': 'Color temperature',
    effect: 'Effect',
    online: 'Connected',
    noEffect: 'None',
  },
  fr: {
    light: 'Éclairage',
    brightness: 'Luminosité',
    color: 'Couleur',
    'color-temperature': 'Température de couleur',
    effect: 'Effet',
    online: 'Connecté',
    noEffect: 'Aucun',
  },
  de: {
    light: 'Licht',
    brightness: 'Helligkeit',
    color: 'Farbe',
    'color-temperature': 'Farbtemperatur',
    effect: 'Effekt',
    online: 'Verbunden',
    noEffect: 'Keiner',
  },
  es: {
    light: 'Luz',
    brightness: 'Brillo',
    color: 'Color',
    'color-temperature': 'Temperatura de color',
    effect: 'Efecto',
    online: 'Conectado',
    noEffect: 'Ninguno',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;

/** External ids of the Gladys device of a controller. */
export const deviceIds = (gladys, serial) => gladys.externalIds(DEVICE_TYPE, serial);

/** The controller's own name ("Shapes 4F2A"), printed on it; the user renames it in Gladys. */
export function deviceName(record) {
  return (
    record.info?.name ??
    `Nanoleaf ${modelName(record.info?.model)} ${record.serial.slice(-4).toUpperCase()}`
  );
}

/** Options of the effect list: "None", then the controller's effects by name. */
export function effectOptions(effects, language) {
  const sorted = [...effects].sort((a, b) => a.localeCompare(b, language, { sensitivity: 'base' }));
  return [
    { value: SOLID_EFFECT, label: namesFor(language).noEffect },
    ...sorted.map((name) => ({ value: name, label: name })),
  ].map((option, index) => ({ ...option, sort_order: index }));
}

/**
 * Feature specs of a controller, in publication order.
 * @param {object} record `{ caps, effects }`
 * @param {string} language
 */
export function featureSpecs(record, language) {
  const names = namesFor(language);
  const { caps } = record;
  const specs = [
    {
      key: FEATURE_KEYS.POWER,
      name: names.light,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.BINARY,
      min: 0,
      max: 1,
      history: true,
    },
    {
      key: FEATURE_KEYS.BRIGHTNESS,
      name: names.brightness,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.BRIGHTNESS,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      history: true,
    },
  ];
  if (caps.color) {
    specs.push({
      key: FEATURE_KEYS.COLOR,
      name: names.color,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.COLOR,
      min: 0,
      max: 0xffffff,
      history: true,
    });
  }
  // In kelvins, the bounds of the controller: the Gladys slider reads the
  // `kelvin` unit as a physical scale (warm on the left).
  specs.push(
    {
      key: FEATURE_KEYS.TEMPERATURE,
      name: names['color-temperature'],
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.TEMPERATURE,
      unit: UNITS.KELVIN,
      min: caps.kelvin.min,
      max: caps.kelvin.max,
      history: true,
    },
    {
      key: FEATURE_KEYS.EFFECT,
      name: names.effect,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      history: false,
      supported_options: effectOptions(record.effects ?? [], language),
    },
    {
      key: FEATURE_KEYS.ONLINE,
      name: names.online,
      category: CATEGORIES.PRESENCE_SENSOR,
      type: TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
      read_only: true,
      history: true,
    },
  );
  return specs;
}

/** Discovery payload of one controller. */
export function buildDevice(gladys, record, language) {
  const ids = deviceIds(gladys, record.serial);
  const model = record.info?.model;
  return {
    name: deviceName(record),
    external_id: ids.device,
    model: model ? `Nanoleaf ${modelName(model)} (${model})` : 'Nanoleaf',
    // The container reads every controller itself and follows its event
    // stream: the Gladys scheduler is not needed (and not reliable, #3198).
    should_poll: false,
    params: [
      { name: 'IP_ADDRESS', value: record.host },
      ...(record.info?.firmware ? [{ name: 'FIRMWARE', value: record.info.firmware }] : []),
    ],
    features: featureSpecs(record, language).map((spec) => {
      const feature = {
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        min: spec.min,
        max: spec.max,
        read_only: spec.read_only === true,
        has_feedback: true,
        keep_history: spec.history,
      };
      if (spec.unit) {
        feature.unit = spec.unit;
      }
      if (spec.supported_options) {
        feature.supported_options = spec.supported_options;
      }
      return feature;
    }),
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** The effect of the list the controller runs, or null (colour, white, custom). */
export function activeEffect(record) {
  const { state, effect, effects } = record;
  if (state?.colorMode !== 'effect' || typeof effect !== 'string') {
    return null;
  }
  return (effects ?? []).includes(effect) ? effect : null;
}

/** The plain colour the controller shows, or null (white, effect). */
export function currentColor(record) {
  const { state } = record;
  if (!record.caps.color || state?.colorMode !== 'hs') {
    return null;
  }
  if (!isNumber(state.hue) || !isNumber(state.sat)) {
    return null;
  }
  // The colour Gladys sent, while the controller still shows it: the
  // conversion to hue and saturation drops the brightness of the colour.
  const sent = record.sentColor;
  if (sent && sent.hue === state.hue && sent.sat === state.sat) {
    return sent.value;
  }
  return rgbToInt(hsToRgb(state.hue, state.sat));
}

/**
 * Feature values of a controller, by feature key: numbers, or `{ text }` for
 * the effect list. Only what the controller told.
 */
export function deviceValues(record) {
  const state = record.state ?? {};
  const values = {};
  if (record.reachable === true || record.reachable === false) {
    values[FEATURE_KEYS.ONLINE] = record.reachable ? 1 : 0;
  }
  if (record.reachable === false) {
    // Unplugged, most often: the panels are dark.
    values[FEATURE_KEYS.POWER] = 0;
  } else if (typeof state.on === 'boolean') {
    values[FEATURE_KEYS.POWER] = state.on ? 1 : 0;
  }
  if (isNumber(state.brightness)) {
    values[FEATURE_KEYS.BRIGHTNESS] = clamp(state.brightness, 0, 100);
  }
  const color = currentColor(record);
  if (color !== null) {
    values[FEATURE_KEYS.COLOR] = color;
  }
  if (state.colorMode === 'ct' && isNumber(state.ct)) {
    values[FEATURE_KEYS.TEMPERATURE] = clamp(
      state.ct,
      record.caps.kelvin.min,
      record.caps.kelvin.max,
    );
  }
  if (record.info) {
    values[FEATURE_KEYS.EFFECT] = { text: activeEffect(record) ?? SOLID_EFFECT };
  }
  return values;
}

/**
 * The request of a Gladys command: `{ state }` (a `PUT /state` body), `{ effect }`
 * (an effect to select) or `{ solid: true }` ("None" in the effect list: back to
 * the plain colour or white). Like the other Gladys lights, a brightness, a
 * colour or a white also turns the panels on.
 * @param {object} record the controller record (caps, state)
 * @param {string} key feature key
 * @param {number|string} value
 */
export function commandFor(record, key, value) {
  const { caps } = record;
  const number = Number(value);
  switch (key) {
    case FEATURE_KEYS.POWER:
      return { state: { on: { value: number > 0 } } };

    case FEATURE_KEYS.BRIGHTNESS:
      if (!Number.isFinite(number)) {
        break;
      }
      if (!(number > 0)) {
        return { state: { on: { value: false } } };
      }
      // `on` last: the firmware applies the keys in order.
      return {
        state: { brightness: { value: clamp(Math.round(number), 1, 100) }, on: { value: true } },
      };

    case FEATURE_KEYS.COLOR: {
      if (!caps.color || !Number.isFinite(number)) {
        break;
      }
      const color = clamp(Math.round(number), 0, 0xffffff);
      const { hue, sat } = rgbToHs(intToRgb(color));
      return {
        state: { hue: { value: hue }, sat: { value: sat }, on: { value: true } },
        color,
      };
    }

    case FEATURE_KEYS.TEMPERATURE:
      if (!Number.isFinite(number)) {
        break;
      }
      return {
        state: {
          ct: { value: clamp(Math.round(number), caps.kelvin.min, caps.kelvin.max) },
          on: { value: true },
        },
      };

    case FEATURE_KEYS.EFFECT: {
      const name = String(value ?? '');
      if (name === SOLID_EFFECT) {
        return { solid: true };
      }
      const effect = findEffect(record, name);
      if (!effect) {
        throw new Error(`This Nanoleaf has no effect "${name}"`);
      }
      return { effect };
    }

    default:
      break;
  }
  throw new Error(`Feature "${key}" cannot be set on this Nanoleaf`);
}

/** The effect of the controller's list named `name`, ignoring case and spaces. */
export function findEffect(record, name) {
  if (typeof name !== 'string') {
    return null;
  }
  const wanted = name.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const effects = record.effects ?? [];
  return (
    effects.find((effect) => effect === name) ??
    effects.find((effect) => effect.toLowerCase() === wanted) ??
    null
  );
}

/**
 * The `PUT /state` body that brings back the plain colour or white the
 * controller showed before an effect (`record.solidMode`): its hue and
 * saturation, or its white.
 */
export function solidState(record) {
  const { state } = record;
  const mode =
    state?.colorMode === 'hs' || state?.colorMode === 'ct' ? state.colorMode : record.solidMode;
  if (record.caps.color && mode !== 'ct' && isNumber(state?.hue) && isNumber(state?.sat)) {
    return { hue: { value: state.hue }, sat: { value: state.sat }, on: { value: true } };
  }
  const ct = isNumber(state?.ct) ? state.ct : 2700;
  return {
    ct: { value: clamp(ct, record.caps.kelvin.min, record.caps.kelvin.max) },
    on: { value: true },
  };
}

/** What the controller shows once a `PUT /state` is applied, without waiting for the stream. */
export function applyState(state, body) {
  const next = { ...state };
  if (body.on) {
    next.on = body.on.value;
  }
  if (body.brightness) {
    next.brightness = body.brightness.value;
  }
  if (body.hue) {
    next.hue = body.hue.value;
    next.colorMode = 'hs';
  }
  if (body.sat) {
    next.sat = body.sat.value;
    next.colorMode = 'hs';
  }
  if (body.ct) {
    next.ct = body.ct.value;
    next.colorMode = 'ct';
  }
  return next;
}
