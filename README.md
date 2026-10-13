# Nanoleaf for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Nanoleaf](https://nanoleaf.me) light panels — Light Panels (Aurora), Canvas,
Shapes, Elements and Lines — driven over the local network with the Nanoleaf
OpenAPI. No account, no cloud.

> **Developed without the hardware: feedback welcome.** Everything was built
> and tested against the answers the Nanoleaf OpenAPI documents, served by a
> simulated controller, not against real panels. Please report what works and
> what does not on the [Gladys forum](https://community.gladysassistant.com)
> or in the [issues](https://github.com/guim31/gladys-nanoleaf/issues).

## Features

- **Automatic discovery**: Gladys browses the network for the integration
  (mDNS `_nanoleafapi._tcp`, and SSDP for the old Light Panels). IP addresses
  can be typed for the controllers it does not find.
- **Pairing from the Configuration screen**: hold the power button of the
  panels 5 to 7 seconds, click **Pair** within 30 seconds. The token stays in
  the integration's `/data` volume.
- **One Gladys device per controller**: on/off, brightness, color (hue and
  saturation; not on the white-only Elements), white in kelvins within the
  range of the controller, the **effects of the controller** as a list (with
  "None" to go back to the plain color or white), and a **Connected** sensor.
- **Live**: the integration follows the event stream of each controller, so a
  change made in the Nanoleaf app or on the panels shows in Gladys at once; a
  full read every minute keeps the effect list up to date.
- **Scene trigger** _Gesture on a Nanoleaf_: single and double tap, swipe up,
  down, left and right on touch panels (Canvas, Shapes, Elements), filtered by
  gesture and, for taps, by panel number.
- **Scene actions** _Start a Nanoleaf effect_ (by name, with a brightness) and
  _Show a color on a Nanoleaf_ (for a number of seconds, then back to what the
  panels showed).
- **Dashboard widget** _Nanoleaf_: up to four favorite effects in one tap, the
  state, the effect running, the last gesture with its panel number.
- English, French, German and Spanish, in the interface, the device names and
  the [documentation](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
  [es](docs/es.md)).

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions,
  mediated discovery).
- Nanoleaf panels with a Wi-Fi controller speaking the OpenAPI (port 16021),
  on the same network as Gladys. The **Nanoleaf Essentials** bulbs and strips
  (Matter / Thread) do not speak the OpenAPI: add them through Matter.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter
   `https://github.com/guim31/gladys-nanoleaf` (or install **Nanoleaf** from
   the catalog once it is listed).
2. In **Configuration**, hold the power button of the panels 5 to 7 seconds
   until the lights flash, then click **Pair** within 30 seconds.
3. Add the device from the **Discovery** tab.

The [documentation](docs/en.md) details every feature, the widget, the
trigger, the actions, scene examples and troubleshooting.

## How it works

- **Discovery**: the integration container sits on a Docker bridge, where
  multicast never arrives. Gladys runs the mDNS browse and the SSDP search for
  it (manifest `network_discovery`) and relays the raw answers; the
  controllers are then reached in unicast HTTP.
- **Pairing**: `POST /api/v1/new` on every controller found but not paired
  (or the typed address): only the one in pairing mode answers with a token.
- **Push**: one `GET /api/v1/<token>/events?id=1,3,4` server-sent event stream
  per controller (state, effect and gesture events), reopened with a growing
  delay when it closes.
- **Reading**: a full `GET /api/v1/<token>/` every minute, by the
  integration's own timer: the devices are published with
  `should_poll: false` (the Gladys scheduler does not poll external devices
  reliably, GladysAssistant/Gladys#3198). Only the values that changed are
  sent, plus a heartbeat every 6 hours.
- **Commands**: `PUT /state` (on, brightness, hue, saturation, white) and
  `PUT /effects` (effect).

## Checked, and what was not

Checked:

- five controller descriptions (Light Panels, Canvas, Shapes, Elements,
  Lines, firmware 3.0 to 9.6, written from the OpenAPI documentation) against
  the rules of the Gladys core (feature couples, bounds, units, poll
  frequencies, option values) in the four languages;
- the whole integration against the fake Gladys of the SDK and a simulated
  controller: pairing, discovery, event stream, gestures, commands, scene
  actions, widget, lost and refused tokens, address changes, logs;
- the manifest with the store validator.

Not checked, for want of hardware or of a Gladys instance:

- a real controller: the exact answers of each firmware, the event stream
  over time, the touch events of each model;
- the mDNS and SSDP discovery through a real Gladys core on a real LAN;
- the rendering of the widget and of the scene cards in the Gladys interface.

## Limitations

- The Rhythm music mode, the scenes and schedules of the Nanoleaf app, the
  layout and the per-panel colors are not available.
- The per-panel touch stream of the OpenAPI is UDP towards the client: the
  container cannot receive it. The gestures are available.
- The return after _Show a color on a Nanoleaf_ does not survive a restart of
  the integration during the wait.
- Nanoleaf Essentials, the 4D / Screen Mirror kit and the Skylight are not
  covered.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK
(`@gladysassistant/integration-sdk/testing`) and simulated controllers
(`test/helpers/fakeNanoleaf.js`): no network. Project rules for contributors
and coding assistants: [CLAUDE.md](CLAUDE.md).

Releases go through **Actions → Release** (it bumps the versions, the
changelog and the image tag).

## Credits

- The [Nanoleaf OpenAPI](https://nanoleaf.me/en-US/integration/open-api/)
  documentation: the protocol.
- The [Home Assistant Nanoleaf integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/nanoleaf)
  (Apache License 2.0, © Home Assistant contributors): the discovery services,
  the touch models and the gesture codes.
- [aionanoleaf](https://github.com/milanmeu/aionanoleaf) (LGPL-3.0, © Milan
  Meulemans): read to understand the event stream; no code copied.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is not affiliated with, endorsed by or connected to Nanoleaf.
Nanoleaf is a trademark of its owner.

## License

[Apache License 2.0](LICENSE).
