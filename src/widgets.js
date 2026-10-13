// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `nanoleaf`.
//
// The Gladys device box already has the switch, the brightness, the colour,
// the white and the effect list. What the widget adds: favourite effects as
// one-tap buttons, what the panels show at a glance, and the last gesture
// (with its panel number, the one the gesture trigger filters on).
//
// Budget (8 components, 2 texts, 1 status, 4 buttons): a caption, one live
// tile, one status list, up to four effect buttons, or three and the on/off
// button. The running effect is marked by its icon (`check-circle`), never
// by the button style: `primary` is invisible in dark mode.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  activeEffect,
  currentColor,
  deviceIds,
  findEffect,
  namesFor,
} from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { modelName } from './nanoleaf/model.js';

const logger = createLogger({ name: 'nanoleaf-widget' });

const ACTIVE_ICON = 'check-circle';
const MAX_BUTTONS = 4;
const EFFECT_ACTION_PREFIX = 'effect_';
const POWER_ACTION = 'power';

// The gestures, as the widget and the documentation name them (the
// manifest trigger options carry the same labels, see test/manifest.test.js).
export const GESTURE_LABELS = {
  single_tap: { en: 'Single tap', fr: 'Simple tape', de: 'Einfaches Tippen', es: 'Toque simple' },
  double_tap: { en: 'Double tap', fr: 'Double tape', de: 'Doppeltippen', es: 'Doble toque' },
  swipe_up: {
    en: 'Swipe up',
    fr: 'Balayage vers le haut',
    de: 'Nach oben wischen',
    es: 'Deslizar hacia arriba',
  },
  swipe_down: {
    en: 'Swipe down',
    fr: 'Balayage vers le bas',
    de: 'Nach unten wischen',
    es: 'Deslizar hacia abajo',
  },
  swipe_left: {
    en: 'Swipe left',
    fr: 'Balayage vers la gauche',
    de: 'Nach links wischen',
    es: 'Deslizar a la izquierda',
  },
  swipe_right: {
    en: 'Swipe right',
    fr: 'Balayage vers la droite',
    de: 'Nach rechts wischen',
    es: 'Deslizar a la derecha',
  },
};

export const TEXT = {
  pick: {
    en: 'Choose a Nanoleaf in the settings of this widget.',
    fr: 'Choisissez un Nanoleaf dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets ein Nanoleaf aus.',
    es: 'Elija un Nanoleaf en la configuración de este widget.',
  },
  unknown: {
    en: 'This Nanoleaf is not paired any more: pair it again in the integration.',
    fr: "Ce Nanoleaf n'est plus appairé : appairez-le de nouveau dans l'intégration.",
    de: 'Dieses Nanoleaf ist nicht mehr gekoppelt: Kopple es in der Integration erneut.',
    es: 'Este Nanoleaf ya no está emparejado: vuelva a emparejarlo en la integración.',
  },
  brightness: { en: 'Brightness', fr: 'Luminosité', de: 'Helligkeit', es: 'Brillo' },
  effect: { en: 'Effect', fr: 'Effet', de: 'Effekt', es: 'Efecto' },
  gesture: { en: 'Last gesture', fr: 'Dernier geste', de: 'Letzte Geste', es: 'Último gesto' },
  panel: { en: 'panel', fr: 'panneau', de: 'Panel', es: 'panel' },
  white: { en: 'White', fr: 'Blanc', de: 'Weiß', es: 'Blanco' },
  color: { en: 'Color', fr: 'Couleur', de: 'Farbe', es: 'Color' },
  noGesture: { en: 'None yet', fr: 'Aucun encore', de: 'Noch keine', es: 'Ninguno aún' },
  on: { en: 'On', fr: 'Allumé', de: 'Ein', es: 'Encendido' },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  unreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  tokenRefused: {
    en: 'pair again',
    fr: 'à appairer de nouveau',
    de: 'erneut koppeln',
    es: 'vuelva a emparejarlo',
  },
  effectStarted: {
    en: 'Effect started: ',
    fr: 'Effet lancé : ',
    de: 'Effekt gestartet: ',
    es: 'Efecto iniciado: ',
  },
  switchedOn: { en: 'Turned on', fr: 'Allumé', de: 'Eingeschaltet', es: 'Encendido' },
  switchedOff: { en: 'Turned off', fr: 'Éteint', de: 'Ausgeschaltet', es: 'Apagado' },
};

const t = (text, language) => text[language] ?? text.en;

/**
 * The favourite effects of the widget settings the controller has, in
 * order: the typed names (commas between them), or its first three effects
 * when none is typed.
 */
export function widgetEffects(record, settings) {
  const raw = typeof settings?.effects === 'string' ? settings.effects : '';
  const typed = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (typed.length === 0) {
    return record.effects.slice(0, MAX_BUTTONS - 1);
  }
  const effects = [];
  for (const name of typed) {
    const effect = findEffect(record, name);
    if (effect && !effects.includes(effect)) {
      effects.push(effect);
    }
  }
  return effects.slice(0, MAX_BUTTONS);
}

/** What the panels show, in words: the effect, the white or the colour. */
export function modeText(record, language) {
  const effect = activeEffect(record);
  if (effect) {
    return effect;
  }
  if (currentColor(record) !== null) {
    return t(TEXT.color, language);
  }
  const { ct, colorMode } = record.state ?? {};
  if (colorMode === 'ct' && typeof ct === 'number') {
    return `${t(TEXT.white, language)} ${Math.round(ct)} K`;
  }
  return namesFor(language).noEffect;
}

export function gestureText(record, language) {
  const last = record.lastGesture;
  if (!last) {
    return t(TEXT.noGesture, language);
  }
  const label = t(GESTURE_LABELS[last.gesture], language);
  return last.panel === null ? label : `${label} (${t(TEXT.panel, language)} ${last.panel})`;
}

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

async function get(hub, { settings, language = 'en' }) {
  const record = settings?.device ? hub.resolveDevice(settings.device) : null;
  if (!record?.caps) {
    return message(settings?.device ? TEXT.unknown : TEXT.pick, language);
  }
  const ids = deviceIds(hub.gladys, record.serial);
  const names = namesFor(language);
  const lit = record.reachable !== false && record.state?.on === true;

  const caption = [modelName(record.info.model), record.host];
  if (record.tokenRefused) {
    caption.push(t(TEXT.tokenRefused, language));
  } else if (record.reachable === false) {
    caption.push(t(TEXT.unreachable, language));
  }
  const components = [
    { type: 'text', variant: 'caption', text: caption.join(' · ') },
    {
      type: 'value',
      device_feature: ids.feature(FEATURE_KEYS.BRIGHTNESS),
      label: t(TEXT.brightness, language),
      icon: 'sun',
    },
  ];
  const items = [
    {
      label: names.light,
      icon: 'power',
      value: t(lit ? TEXT.on : TEXT.off, language),
      color: lit ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t(TEXT.effect, language),
      icon: 'play',
      value: modeText(record, language),
      color: activeEffect(record) ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (record.caps.touch && !record.touchRefused) {
    items.push({
      label: t(TEXT.gesture, language),
      icon: 'mouse-pointer',
      value: gestureText(record, language),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  const active = lit ? activeEffect(record) : null;
  const effects = widgetEffects(record, settings);
  effects.forEach((effect, index) => {
    components.push({
      type: 'button',
      label: effect,
      icon: effect === active ? ACTIVE_ICON : 'play',
      style: 'secondary',
      // Numbered keys: the core drops a button whose action key is taken.
      action: { key: `${EFFECT_ACTION_PREFIX}${index + 1}`, params: { effect } },
    });
  });
  if (effects.length < MAX_BUTTONS) {
    components.push({
      type: 'button',
      label: t(lit ? TEXT.turnOff : TEXT.turnOn, language),
      icon: 'power',
      style: 'secondary',
      // The tap toggles the state the controller has then, not the one shown.
      action: { key: POWER_ACTION },
    });
  }
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey, params = {}, settings }) {
  const device = settings?.device;
  if (!device) {
    throw new Error(TEXT.pick.en);
  }
  if (actionKey.startsWith(EFFECT_ACTION_PREFIX)) {
    const effect = await hub.runEffect(device, { effect: params.effect });
    logger.info(`Widget: effect "${effect}" started`);
    return {
      message: Object.fromEntries(
        Object.entries(TEXT.effectStarted).map(([language, text]) => [
          language,
          `${text}${effect}`,
        ]),
      ),
    };
  }
  if (actionKey === POWER_ACTION) {
    const record = hub.require(device);
    const on = record.state?.on !== true || record.reachable === false;
    await hub.switchPower(device, on);
    logger.info(`Widget: ${hub.label(record)} turned ${on ? 'on' : 'off'}`);
    return { message: on ? TEXT.switchedOn : TEXT.switchedOff };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
