// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status and the reports of the "Pair" and "Search" buttons. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noDevice: {
    en: 'No Nanoleaf found. Check that it is on the same network as Gladys, or enter its IP address.',
    fr: "Aucun Nanoleaf trouvé. Vérifiez qu'il est sur le même réseau que Gladys, ou saisissez son adresse IP.",
    de: 'Kein Nanoleaf gefunden. Prüfe, ob es im selben Netzwerk wie Gladys ist, oder gib seine IP-Adresse ein.',
    es: 'No se ha encontrado ningún Nanoleaf. Compruebe que está en la misma red que Gladys o introduzca su dirección IP.',
  },
  notPaired: {
    en: 'Nanoleaf found but not paired yet: use the "Pair" button below.',
    fr: 'Nanoleaf trouvé mais pas encore appairé : utilisez le bouton « Appairer » ci-dessous.',
    de: 'Nanoleaf gefunden, aber noch nicht gekoppelt: Nutze unten die Schaltfläche „Koppeln“.',
    es: 'Nanoleaf encontrado pero aún no emparejado: utilice el botón «Emparejar» de abajo.',
  },
  tokenRefused: {
    en: 'A Nanoleaf refuses its access token (reset or removed): pair it again.',
    fr: "Un Nanoleaf refuse son jeton d'accès (réinitialisé ou supprimé) : appairez-le de nouveau.",
    de: 'Ein Nanoleaf lehnt sein Zugriffstoken ab (zurückgesetzt oder gelöscht): Kopple es erneut.',
    es: 'Un Nanoleaf rechaza su token de acceso (restablecido o eliminado): vuelva a emparejarlo.',
  },
  noAnswer: {
    en: 'No paired Nanoleaf answers.',
    fr: 'Aucun Nanoleaf appairé ne répond.',
    de: 'Kein gekoppeltes Nanoleaf antwortet.',
    es: 'Ningún Nanoleaf emparejado responde.',
  },
};

const MAX_LISTED = 6;

// The pieces of the "Pair" report, one table per language.
export const PAIR_TEXT = {
  en: {
    paired: (list) => `Paired: ${list}. Open the Discovery tab to add it to Gladys.`,
    none: 'No Nanoleaf in pairing mode. Hold its power button 5 to 7 seconds until the lights flash, then click "Pair" within 30 seconds.',
    noCandidate:
      'No Nanoleaf to pair found. Check that it is on the same network as Gladys, or type its IP address in the field.',
    already: (list) => `Already paired: ${list}.`,
    unreachable: (list) => `Not answering: ${list}.`,
    invalidHost: 'This is not an IPv4 address (example: 192.168.1.50).',
  },
  fr: {
    paired: (list) => `Appairé : ${list}. Ouvrez l'onglet Découverte pour l'ajouter à Gladys.`,
    none: "Aucun Nanoleaf en mode appairage. Maintenez son bouton marche 5 à 7 secondes jusqu'à ce que les lumières clignotent, puis cliquez sur « Appairer » dans les 30 secondes.",
    noCandidate:
      "Aucun Nanoleaf à appairer trouvé. Vérifiez qu'il est sur le même réseau que Gladys, ou saisissez son adresse IP dans le champ.",
    already: (list) => `Déjà appairé : ${list}.`,
    unreachable: (list) => `Ne répond pas : ${list}.`,
    invalidHost: "Ce n'est pas une adresse IPv4 (exemple : 192.168.1.50).",
  },
  de: {
    paired: (list) =>
      `Gekoppelt: ${list}. Öffne den Tab „Entdecken“, um es zu Gladys hinzuzufügen.`,
    none: 'Kein Nanoleaf im Kopplungsmodus. Halte seine Ein-/Aus-Taste 5 bis 7 Sekunden gedrückt, bis die Lichter blinken, und klicke dann innerhalb von 30 Sekunden auf „Koppeln“.',
    noCandidate:
      'Kein Nanoleaf zum Koppeln gefunden. Prüfe, ob es im selben Netzwerk wie Gladys ist, oder gib seine IP-Adresse in das Feld ein.',
    already: (list) => `Bereits gekoppelt: ${list}.`,
    unreachable: (list) => `Antwortet nicht: ${list}.`,
    invalidHost: 'Das ist keine IPv4-Adresse (Beispiel: 192.168.1.50).',
  },
  es: {
    paired: (list) => `Emparejado: ${list}. Abra la pestaña Descubrir para añadirlo a Gladys.`,
    none: 'Ningún Nanoleaf en modo de emparejamiento. Mantenga pulsado su botón de encendido de 5 a 7 segundos hasta que las luces parpadeen y luego haga clic en «Emparejar» en los 30 segundos siguientes.',
    noCandidate:
      'No se ha encontrado ningún Nanoleaf para emparejar. Compruebe que está en la misma red que Gladys o escriba su dirección IP en el campo.',
    already: (list) => `Ya emparejado: ${list}.`,
    unreachable: (list) => `No responde: ${list}.`,
    invalidHost: 'No es una dirección IPv4 (ejemplo: 192.168.1.50).',
  },
};

// The pieces of the "Search" report, one table per language.
export const SEARCH_TEXT = {
  en: {
    none: 'No Nanoleaf found.',
    paired: (total, reachable) => `${total} paired, ${reachable} answering:`,
    notPaired: (list) => `To pair: ${list}.`,
    unreachable: 'not answering',
    tokenRefused: 'pair again',
    unavailable:
      'Automatic discovery through Gladys is unavailable (Gladys 5.1 or later needed): enter the IP addresses.',
    ignored: (list) => `Ignored addresses: ${list}.`,
  },
  fr: {
    none: 'Aucun Nanoleaf trouvé.',
    paired: (total, reachable) => `${total} appairé(s), ${reachable} répondent :`,
    notPaired: (list) => `À appairer : ${list}.`,
    unreachable: 'ne répond pas',
    tokenRefused: 'à appairer de nouveau',
    unavailable:
      'La découverte automatique par Gladys est indisponible (Gladys 5.1 ou plus récent) : saisissez les adresses IP.',
    ignored: (list) => `Adresses ignorées : ${list}.`,
  },
  de: {
    none: 'Kein Nanoleaf gefunden.',
    paired: (total, reachable) => `${total} gekoppelt, davon ${reachable} erreichbar:`,
    notPaired: (list) => `Zu koppeln: ${list}.`,
    unreachable: 'antwortet nicht',
    tokenRefused: 'erneut koppeln',
    unavailable:
      'Die automatische Erkennung über Gladys ist nicht verfügbar (Gladys 5.1 oder neuer nötig): Gib die IP-Adressen ein.',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
  },
  es: {
    none: 'No se ha encontrado ningún Nanoleaf.',
    paired: (total, reachable) => `${total} emparejado(s), ${reachable} responden:`,
    notPaired: (list) => `Por emparejar: ${list}.`,
    unreachable: 'no responde',
    tokenRefused: 'vuelva a emparejarlo',
    unavailable:
      'El descubrimiento automático a través de Gladys no está disponible (se necesita Gladys 5.1 o posterior): introduzca las direcciones IP.',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
  },
};

const listOf = (items) =>
  `${items.slice(0, MAX_LISTED).join(', ')}${items.length > MAX_LISTED ? '…' : ''}`;

/** In every language, from a function of the language. */
const everyLanguage = (render) =>
  Object.fromEntries(Object.keys(SEARCH_TEXT).map((language) => [language, render(language)]));

/**
 * The report shown under the "Pair" button.
 * @param {object} result `{ paired, already, unreachable, candidates, invalidHost }`, names
 */
export function pairMessage({
  paired = [],
  already = [],
  unreachable = [],
  candidates = 0,
  invalidHost = false,
}) {
  return everyLanguage((language) => {
    const text = PAIR_TEXT[language];
    if (invalidHost) {
      return text.invalidHost;
    }
    const lines = [];
    if (paired.length > 0) {
      lines.push(text.paired(listOf(paired)));
    } else if (candidates === 0 && already.length === 0) {
      lines.push(text.noCandidate);
    } else if (candidates > unreachable.length) {
      lines.push(text.none);
    }
    if (already.length > 0) {
      lines.push(text.already(listOf(already)));
    }
    if (unreachable.length > 0) {
      lines.push(text.unreachable(listOf(unreachable)));
    }
    return lines.join(' ');
  });
}

/** The report shown under the "Search" button. */
export function searchMessage({ controllers, candidates, scan, invalidHosts }) {
  return everyLanguage((language) => {
    const text = SEARCH_TEXT[language];
    const lines = [];
    if (controllers.length === 0 && candidates.length === 0) {
      lines.push(text.none);
    }
    if (controllers.length > 0) {
      const reachable = controllers.filter((controller) => controller.reachable).length;
      lines.push(text.paired(controllers.length, reachable));
      const list = controllers.map(({ name, host, reachable: up, tokenRefused }) => {
        const notes = [host];
        if (tokenRefused) {
          notes.push(text.tokenRefused);
        } else if (!up) {
          notes.push(text.unreachable);
        }
        return `${name} (${notes.join(', ')})`;
      });
      lines.push(`${listOf(list)}.`);
    }
    if (candidates.length > 0) {
      lines.push(
        text.notPaired(
          listOf(candidates.map(({ name, host }) => (name ? `${name} (${host})` : host))),
        ),
      );
    }
    if (scan === 'unavailable') {
      lines.push(text.unavailable);
    }
    if (invalidHosts.length > 0) {
      lines.push(text.ignored(invalidHosts.slice(0, 3).join(', ')));
    }
    return lines.join(' ');
  });
}
