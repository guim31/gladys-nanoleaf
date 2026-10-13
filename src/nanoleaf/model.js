// -----------------------------------------------------------------------------
// The Nanoleaf OpenAPI, as data: what a controller answers to
// `GET /api/v1/<token>/`, normalized, plus the colour conversions and the
// event codes of the `/events` stream.
//
// Written from the public Nanoleaf OpenAPI documentation. The Home Assistant
// integration (Apache-2.0) was read to confirm the model lists; aionanoleaf
// (LGPL-3.0) was only read, nothing is copied from it.
// -----------------------------------------------------------------------------

export const NANOLEAF_PORT = 16021;

// Effect names the firmware reserves (starred): the panels show a plain
// colour or white (`*Solid*`), a static custom layout (`*Static*`) or a
// stream (`*Dynamic*`). They are never in the effects list.
export const SOLID_EFFECT = '*Solid*';
const RESERVED_EFFECT = /^\*.*\*$/;

// Models without touch: Light Panels (Aurora) and Lines. Canvas (NL29),
// Shapes (NL42) and Elements (NL52) have it; another code (a Shapes variant
// unknown here) is asked for the gesture events too, and the hub drops them
// if the controller refuses (see NanoleafHub.startStream).
export const NO_TOUCH_MODELS = new Set(['NL22', 'NL59']);

// Elements (wood-look hexagons) only light in shades of white: no colour.
export const WHITE_ONLY_MODELS = new Set(['NL52']);

// Product names of the model codes the controllers report. Another code is
// shown as is.
export const MODEL_NAMES = {
  NL22: 'Light Panels',
  NL29: 'Canvas',
  NL42: 'Shapes',
  NL52: 'Elements',
  NL59: 'Lines',
};

// What a controller answers when the range is missing or nonsensical: the
// documentation itself shows `ct.max: 100`, and old firmware has 1200-6500 K.
export const DEFAULT_KELVIN = { min: 1200, max: 6500 };

// Event types of `GET /api/v1/<token>/events?id=…`.
export const EVENT_TYPES = { STATE: 1, LAYOUT: 2, EFFECTS: 3, TOUCH: 4 };

// Attributes of a state event (type 1).
export const STATE_ATTRIBUTES = {
  1: 'on',
  2: 'brightness',
  3: 'hue',
  4: 'sat',
  5: 'ct',
  6: 'colorMode',
};

// Gestures of a touch event (type 4). The keys are the scene trigger values:
// permanent.
export const GESTURES = {
  0: 'single_tap',
  1: 'double_tap',
  2: 'swipe_up',
  3: 'swipe_down',
  4: 'swipe_left',
  5: 'swipe_right',
};
export const GESTURE_KEYS = Object.values(GESTURES);

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * The stable id of a controller, from its serial number: lower case letters
 * and digits only. Part of every external id: permanent.
 * @returns {string|null}
 */
export function normalizeSerial(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const serial = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return serial.length >= 4 ? serial : null;
}

export const isReservedEffect = (name) => typeof name === 'string' && RESERVED_EFFECT.test(name);

/**
 * The effects a Gladys list can offer: names, trimmed (the core refuses
 * blank or padded values), without duplicates and without the starred
 * names, in the controller's order.
 */
export function cleanEffects(list) {
  const effects = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') {
      continue;
    }
    const name = raw.trim();
    if (name && name === raw && !isReservedEffect(name) && !effects.includes(name)) {
      effects.push(name);
    }
  }
  return effects;
}

function kelvinRange(ct) {
  const min = ct?.min;
  const max = ct?.max;
  if (isNumber(min) && isNumber(max) && min >= 1000 && max > min && max <= 10000) {
    return { min: Math.round(min), max: Math.round(max) };
  }
  return { ...DEFAULT_KELVIN };
}

const valueOf = (entry) => (entry && typeof entry === 'object' ? entry.value : undefined);

/**
 * The light state of a `GET /` or `GET /state` answer: `{ on, brightness,
 * hue, sat, ct, colorMode }`, only the fields that are present and valid.
 */
export function parseState(state) {
  const parsed = {};
  if (!state || typeof state !== 'object') {
    return parsed;
  }
  const on = valueOf(state.on);
  if (typeof on === 'boolean') {
    parsed.on = on;
  }
  for (const key of ['brightness', 'hue', 'sat', 'ct']) {
    const value = valueOf(state[key]);
    if (isNumber(value)) {
      parsed[key] = Math.round(value);
    }
  }
  if (typeof state.colorMode === 'string') {
    parsed.colorMode = state.colorMode;
  }
  return parsed;
}

/**
 * Everything the integration keeps from a `GET /api/v1/<token>/` answer.
 * Throws when the answer has no serial number: it is the device id.
 */
export function parseInfo(data) {
  const serial = normalizeSerial(data?.serialNo);
  if (!serial) {
    throw new Error('The Nanoleaf answer has no serial number');
  }
  const model = typeof data.model === 'string' ? data.model.trim().toUpperCase() : '';
  const layout = data.panelLayout?.layout;
  return {
    serial,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
    model,
    firmware: typeof data.firmwareVersion === 'string' ? data.firmwareVersion : null,
    panels: isNumber(layout?.numPanels) ? layout.numPanels : null,
    kelvin: kelvinRange(data.state?.ct),
    effects: cleanEffects(data.effects?.effectsList),
    effect: typeof data.effects?.select === 'string' ? data.effects.select : null,
    state: parseState(data.state),
  };
}

/** What the integration can do with a controller of this model. */
export function capabilitiesOf(info) {
  return {
    color: !WHITE_ONLY_MODELS.has(info.model),
    touch: !NO_TOUCH_MODELS.has(info.model),
    kelvin: info.kelvin ?? { ...DEFAULT_KELVIN },
  };
}

/** "Shapes", "Canvas"… or the model code. */
export const modelName = (model) => MODEL_NAMES[model] ?? (model || 'Nanoleaf');

// --- Colours -----------------------------------------------------------------

export const intToRgb = (value) => ({
  r: (value >> 16) & 0xff,
  g: (value >> 8) & 0xff,
  b: value & 0xff,
});

export const rgbToInt = ({ r, g, b }) => (r << 16) | (g << 8) | b;

/**
 * Hue (0-359°) and saturation (0-100 %) of an RGB colour: the brightness is
 * the separate feature, so the value of the colour is dropped.
 */
export function rgbToHs({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max === 0 || delta === 0) {
    return { hue: 0, sat: 0 };
  }
  let hue;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) {
    hue += 360;
  }
  return { hue: hue % 360, sat: Math.round((delta / max) * 100) };
}

/** The full-brightness RGB colour of a hue and a saturation. */
export function hsToRgb(hue, sat) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = clamp(sat, 0, 100) / 100;
  const c = s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 1 - c;
  const [r, g, b] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  const channel = (value) => Math.round((value + m) * 255);
  return { r: channel(r), g: channel(g), b: channel(b) };
}

/**
 * "#FF8800", "ff8800", "#f80": a colour typed in a scene. Null when it is not
 * one.
 */
export function parseHexColor(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let hex = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = [...hex].map((digit) => digit + digit).join('');
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : null;
}
