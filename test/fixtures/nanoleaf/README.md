# Nanoleaf fixtures

Answers of `GET /api/v1/<token>/` (the whole controller description), one per
product family, written from the public Nanoleaf OpenAPI documentation (field
names, ranges, colour modes, the reserved `*Solid*` effect) and the default
effects each product ships with. They are not captures of real controllers.

Everything identifying is invented: names (`Shapes 7D21`), serial numbers
(`S20283H0003`), panel ids. The tests serve them at documentation addresses
(`192.0.2.x`, RFC 5737).

| File                              | Product               | What it covers                            |
| --------------------------------- | --------------------- | ----------------------------------------- |
| `light-panels-nl22-3.0.6.json`    | Light Panels (Aurora) | old firmware, running an effect, no touch |
| `canvas-nl29-9.2.3.json`          | Canvas                | touch, plain colour (`hs`)                |
| `shapes-hexagons-nl42-9.6.3.json` | Shapes Hexagons       | touch, running an effect                  |
| `elements-nl52-9.6.3.json`        | Elements              | white only, narrow white range, off       |
| `lines-nl59-9.6.3.json`           | Lines                 | white (`ct`), no touch                    |
