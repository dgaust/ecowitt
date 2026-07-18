# Ecowitt Cards

Lovelace cards for the [Ecowitt Local](https://github.com/) HACS integration
(`ecowitt_local`) — one station overview plus focused sub-cards you can lay out
however you like.

No Lit, no CDN, no build step. A single plain-JavaScript file registers every
card.

## Cards

| Card | Shows |
| --- | --- |
| `ecowitt-weather-card` | Station overview: temperature, feels-like, dew point, an inline wind compass, and tiles for humidity, gust, rain, UV, solar, pressure, VPD and battery |
| `ecowitt-wind-card` | Two columns: a compass with a dashed average-direction marker on the left, and on the right the speed, a Beaufort description, and rows for direction, gust, daily maximum and average direction |
| `ecowitt-rain-card` | Rain rate, a live wet/dry indicator from the piezo sensor, and accumulation bars for the hour, today, 24 hours, the week and the current event |
| `ecowitt-solar-card` | UV index against a banded exposure scale, plus irradiance and illuminance |
| `ecowitt-soil-card` | One soil probe: moisture with a dry/ideal/saturated band, battery, signal and channel |
| `ecowitt-indoor-card` | Gateway indoor temperature and humidity with relative and absolute pressure |

Every value opens Home Assistant's own more-info dialog on tap, so history is
one click away.

## Install

**HACS** — add this repository as a custom repository of type *Lovelace*,
install, and HACS adds the resource for you.

**Manual** — copy `dist/ecowitt-cards.js` to `config/www/` and add a resource
under Settings → Dashboards → Resources:

```
URL:  /local/ecowitt-cards.js
Type: JavaScript Module
```

Then hard-refresh the browser and confirm the `ECOWITT-CARDS <version>` banner
in the console.

## Configure

Add a card from the picker and choose a device — that is the only required
option. Each card discovers its own entities from the device you select, so
nothing references an entity id and adding a second soil probe needs no
configuration beyond pointing a new soil card at it.

```yaml
type: custom:ecowitt-weather-card
device: <your WS90 device>
name: Back Garden      # optional, overrides the default title
```

Sub-cards title themselves by subject ("Wind", "Rain", "Solar & UV") so a
dashboard full of them doesn't repeat the device name six times. The overview
and soil cards use the device name, since there the device *is* the subject.
Set `name` to override either.

### Which device goes with which card

The integration exposes one device per physical sensor:

- the **weather station** (WS90/`wh90`) drives the overview, wind, solar and a
  rain card
- a **standalone rain gauge** (WH40/`wh40`) drives its own rain card
- each **soil probe** (`wh51`) drives its own soil card
- the **gateway** (GW2000 etc.) drives the indoor card

If you pick a device with nothing recognisable on it, the card says so rather
than showing a grid of dashes.

### Two rain sources

A WS90 has a piezo rain sensor built in, and a WH40 is a separate tipping
bucket. If you have both, the gateway reports them as two independent blocks
and the integration creates a device for each — so they are two rain cards, not
one, and they will not always agree. The piezo reacts faster to the start of
rain; the tipping bucket is the more conventional measure of total
accumulation.

The gateway itself has a rain priority setting that decides which source it
treats as primary for its own reporting and uploads. It does not change what
Home Assistant sees, because the integration exposes both. You can read the
current setting from the gateway directly:

```bash
curl -s http://<gateway-ip>/get_rain_totals
# rainFallPriority: 0 = none, 1 = traditional (WH40), 2 = piezo (WS90)
```

Only the rain card built on the WH40 shows a battery tile, and only the one
built on the WS90 shows the live wet/dry indicator — that comes from the piezo's
`srain_piezo` flag, which a tipping bucket doesn't have. Both tiles are driven
by discovery, so each card shows what its device actually has.

## Troubleshooting

**A sensor is paired but has no entities.** The integration builds its device
list at setup, so a sensor paired afterwards won't appear until you reload it
(Settings → Devices & Services → Ecowitt Local → Reload). This is not related to
the sensor having no data yet — a rain gauge that has seen no rain still reports
zeros, battery and signal.

To check what the gateway itself can see, independent of Home Assistant:

```bash
curl -s "http://<gateway-ip>/get_sensors_info?page=1"   # pages 1..4
```

Entries with an `id` of `FFFFFFFF` are empty slots. Anything with a real id and
an `rssi` is paired and transmitting, whether or not Home Assistant knows about
it.

## How discovery works

Entities are matched by entity id against an ordered rule list, first match
wins, and each key is claimed only once. The ordering matters wherever one id
contains another — `soil_moisture_battery` is tested before `soil_moisture`,
`wind_direction_avg` before `wind_direction`, `capacitor_voltage` before
`voltage`. Anything the rules don't recognise falls back to its `device_class`,
so a renamed or newly supported sensor still lands somewhere sensible.

## Development

```bash
node --check dist/ecowitt-cards.js   # syntax
node tests/test_cards.js             # discovery + helper tests
```

The tests evaluate the card file in a `vm` context with the few globals it
touches stubbed, then run discovery against `tests/fixtures/devices.json` — a
capture from a real Home Assistant instance. They assert that every entity on
every device is classified and that the ids that contain one another don't
collide. No Home Assistant, no browser, no dependencies.

After pairing new hardware, refresh that fixture so the tests cover it:

```bash
cp .env.example .env    # fill in HA_URL and a long-lived token
python tests/capture_fixture.py
```

`.env` is gitignored and the script never prints the token.

For layout work, serve the repo and open the preview harness, which mounts all
six cards plus a deliberately misconfigured one against the same fixture:

```bash
python -m http.server 8777
# then open http://127.0.0.1:8777/tests/preview.html
```

It stubs `ha-card` and `ha-icon`, and has a dark-mode toggle. Note that icons
render as grey squares there — the real MDI glyphs only exist inside Home
Assistant.

## Conventions

- Keep the card dependency-free.
- Use Home Assistant theme variables for colour. The banded scales (UV, soil
  moisture) use `--success-color` / `--warning-color` / `--error-color` /
  `--info-color` rather than fixed hex values, so they follow the active theme.
- Use Home Assistant's typography tokens for type — `--ha-font-size-*`,
  `--ha-font-weight-*` — never fixed `rem` or `px`. HA multiplies every size by
  `--ha-font-size-scale`, so hardcoded values silently opt out of the user's
  text-size setting. Give each token its HA default as a fallback
  (`var(--ha-font-size-m, 14px)`) so the cards still render on older cores and
  in the preview harness.
- Because type scales, avoid fixed-width columns around text. Prefer
  `max-content` so a row grows with the font instead of clipping. The preview
  harness has a font-scale button for checking this.
- Bump `CARD_VERSION` on every change so a hard-refresh is verifiable.
