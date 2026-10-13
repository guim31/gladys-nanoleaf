# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-13

### Added

- Nanoleaf light panels (Light Panels, Canvas, Shapes, Elements, Lines) on the
  local network, through the Nanoleaf OpenAPI: no cloud, no account.
- Automatic discovery through Gladys (mDNS, and SSDP for the old Light
  Panels), and IP addresses typed in the configuration.
- **Pair** button in the configuration: hold the power button 5 to 7 seconds,
  then click within 30 seconds. **Search for Nanoleaf controllers** button.
- One device per controller: on/off, brightness, color, white in kelvins, the
  effects of the controller as a list, and a **Connected** sensor.
- Changes made in the Nanoleaf app or on the panels show in Gladys at once
  (event stream), and the controllers are read every minute.
- Scene trigger **Gesture on a Nanoleaf**: taps and swipes on touch panels,
  with the panel number of a tap.
- Scene actions **Start a Nanoleaf effect** and **Show a color on a Nanoleaf**
  (for a number of seconds, then back to what the panels showed).
- Dashboard widget **Nanoleaf**: favorite effects in one tap, the state, the
  effect running and the last gesture.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-nanoleaf/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-nanoleaf/releases/tag/v1.0.1
