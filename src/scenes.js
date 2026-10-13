// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// On, brightness, colour, white and the effect list are already Gladys scene
// actions on the device features. These two add what a feature cannot do:
//   - run_effect: start an effect typed by name (a scene variable works too),
//     with its brightness, in one step;
//   - show_color: a colour for a few seconds, then back to what the panels
//     showed (a notification light: "the washing machine is done").
//
// The trigger (`gesture`) is fired by the hub (src/hub.js), never as a
// consequence of these actions: a scene bound to it would loop.
// -----------------------------------------------------------------------------

import { parseHexColor } from './nanoleaf/model.js';

// The colours of the `color` list. The keys are stored in scenes: permanent.
export const PRESET_COLORS = {
  red: 0xff0000,
  orange: 0xff8000,
  yellow: 0xffd000,
  green: 0x00ff00,
  cyan: 0x00ffff,
  blue: 0x0000ff,
  purple: 0x8000ff,
  pink: 0xff0080,
  white: 0xffffff,
};

/** The colour of a scene action: the typed one, else the chosen one. */
export function resolveColor({ color, custom_color: custom }) {
  if (typeof custom === 'string' && custom.trim() !== '') {
    const typed = parseHexColor(custom);
    if (typed === null) {
      throw new Error(`"${custom}" is not a colour: use the #RRGGBB form, e.g. #FF8800`);
    }
    return typed;
  }
  const preset = PRESET_COLORS[color];
  if (preset === undefined) {
    throw new Error(`Unknown colour "${color}"`);
  }
  return preset;
}

export const SCENE_ACTIONS = {
  async run_effect(hub, { fields }) {
    const effect = await hub.runEffect(fields.device, {
      effect: fields.effect,
      brightness: fields.brightness,
    });
    return { effect };
  },

  async show_color(hub, { fields }) {
    await hub.showColor(fields.device, {
      color: resolveColor(fields),
      seconds: fields.duration,
      brightness: fields.brightness,
    });
  },
};
