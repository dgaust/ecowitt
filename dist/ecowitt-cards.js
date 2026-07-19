/*
 * Ecowitt Lovelace cards — dependency-free custom elements for the
 * "Ecowitt Local" (ecowitt_local) HACS integration.
 *
 * Registers one overview card plus focused sub-cards:
 *   ecowitt-weather-card  station overview (WS90)
 *   ecowitt-wind-card     compass, speed, gust, daily max
 *   ecowitt-rain-card     rate + accumulation periods
 *   ecowitt-solar-card    UV index, illuminance, irradiance
 *   ecowitt-soil-card     one soil probe (WH51)
 *   ecowitt-indoor-card   gateway indoor climate + pressure
 *
 * Every card takes a `device` and discovers its own entities, so nothing
 * hard-codes an entity id and extra probes work without a code change.
 */

const CARD_VERSION = "1.16.0";

/* Plain text rather than a %c-styled banner: console styling can only take
 * literal colours, and nothing in this file should hardcode one. */
console.info(`ECOWITT-CARDS ${CARD_VERSION}`);

/* ------------------------------------------------------------------ *
 * Discovery
 *
 * Entities are matched by id, first rule wins, and a key is never
 * overwritten once claimed. Order matters where one id contains
 * another: soil_moisture_battery before soil_moisture, wind_direction_avg
 * before wind_direction, capacitor_voltage before voltage.
 * ------------------------------------------------------------------ */

const SENSOR_RULES = [
  ["soil_battery", /soil_moisture_battery/],
  ["soil_moisture", /soil_moisture/],
  ["wind_dir_avg", /wind_direction_avg/],
  ["wind_dir", /wind_direction/],
  ["wind_gust", /wind_gust/],
  ["wind_speed", /wind_speed/],
  ["max_gust", /max_daily_gust/],
  ["rain_rate", /rain_rate/],
  ["rain_hourly", /hourly_rain/],
  ["rain_24h", /24h_rain/],
  ["rain_daily", /daily_rain/],
  ["rain_weekly", /weekly_rain/],
  ["rain_monthly", /monthly_rain/],
  ["rain_yearly", /yearly_rain/],
  ["rain_event", /rain_event/],
  ["solar_lux", /solar_lux|illuminance/],
  ["solar_rad", /solar_radiation|irradiance/],
  ["uv", /uv_index/],
  ["dewpoint", /dewpoint|dew_point/],
  ["feels_like", /feels_like/],
  ["temp_out", /outdoor_temp/],
  ["hum_out", /outdoor_humidity/],
  ["temp_in", /temperature_indoor|indoor_temp/],
  ["hum_in", /humidity_humidityin|indoor_humidity/],
  ["press_rel", /pressure_relative/],
  ["press_abs", /pressure_absolute/],
  ["vpd", /vpd/],
  ["cap_voltage", /capacitor_voltage/],
  ["voltage", /voltage/],
  ["battery", /battery/],
  ["signal", /signal_strength/],
  ["channel", /channel/],
  ["hw_id", /hardware_id/],
];

const BINARY_RULES = [
  ["online", /online|connectivity/],
  ["rain_piezo", /rain|srain/],
];

/* Fall back to device_class when the id is unfamiliar, so a renamed or
 * newly supported sensor still lands somewhere sensible. */
const CLASS_FALLBACK = {
  temperature: "temp_out",
  humidity: "hum_out",
  atmospheric_pressure: "press_rel",
  pressure: "press_rel",
  illuminance: "solar_lux",
  irradiance: "solar_rad",
  wind_speed: "wind_speed",
  precipitation: "rain_daily",
  precipitation_intensity: "rain_rate",
  moisture: "soil_moisture",
  battery: "battery",
  voltage: "voltage",
};

function discover(hass, deviceId) {
  const found = {};
  if (!hass || !deviceId || !hass.entities) return found;

  for (const [entityId, reg] of Object.entries(hass.entities)) {
    if (reg.device_id !== deviceId) continue;
    if (!hass.states[entityId]) continue;

    const domain = entityId.split(".")[0];
    if (domain !== "sensor" && domain !== "binary_sensor") continue;

    const rules = domain === "binary_sensor" ? BINARY_RULES : SENSOR_RULES;
    let claimed = false;
    for (const [key, re] of rules) {
      if (re.test(entityId) && found[key] === undefined) {
        found[key] = entityId;
        claimed = true;
        break;
      }
      if (re.test(entityId)) {
        claimed = true; // matched a rule but the slot is taken
        break;
      }
    }

    if (!claimed && domain === "sensor") {
      const dc = hass.states[entityId].attributes.device_class;
      const key = CLASS_FALLBACK[dc];
      if (key && found[key] === undefined) found[key] = entityId;
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const isBad = (s) => !s || s.state === "unknown" || s.state === "unavailable";

function num(hass, entityId) {
  const st = hass && entityId ? hass.states[entityId] : null;
  if (isBad(st)) return null;
  const v = parseFloat(st.state);
  return Number.isFinite(v) ? v : null;
}

function unit(hass, entityId) {
  const st = hass && entityId ? hass.states[entityId] : null;
  return (st && st.attributes.unit_of_measurement) || "";
}

/* Format with the entity's own display precision when HA supplies one,
 * otherwise fall back to a sensible fixed number of decimals. */
function fmt(hass, entityId, fallbackDigits = 1) {
  const st = hass && entityId ? hass.states[entityId] : null;
  if (isBad(st)) return "—";
  const v = parseFloat(st.state);
  if (!Number.isFinite(v)) return st.state;
  const p = st.attributes.suggested_display_precision;
  return v.toFixed(Number.isInteger(p) ? p : fallbackDigits);
}

function deviceName(hass, deviceId) {
  const d = hass && hass.devices ? hass.devices[deviceId] : null;
  if (!d) return "Ecowitt";
  return d.name_by_user || d.name || "Ecowitt";
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

const cardinal = (deg) =>
  deg === null ? "—" : COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/* Beaufort-ish descriptors, in km/h. Purely for the wind card's caption. */
function windLabel(kmh) {
  if (kmh === null) return "";
  if (kmh < 1) return "Calm";
  if (kmh < 6) return "Light air";
  if (kmh < 12) return "Light breeze";
  if (kmh < 20) return "Gentle breeze";
  if (kmh < 29) return "Moderate breeze";
  if (kmh < 39) return "Fresh breeze";
  if (kmh < 50) return "Strong breeze";
  if (kmh < 62) return "Near gale";
  if (kmh < 75) return "Gale";
  if (kmh < 89) return "Strong gale";
  if (kmh < 103) return "Storm";
  return "Violent storm";
}

/* ------------------------------------------------------------------ *
 * Scales
 *
 * A scale is an axis maximum plus ordered bands: `{ to, label, color }`,
 * where the final band has no `to` and runs to the top. Both the soil and
 * UV cards read theirs from config, because the right thresholds are a
 * property of the garden, not of this code.
 *
 * The UV defaults follow the WHO exposure categories. The soil defaults do
 * not follow anything — a capacitive probe reports a relative index
 * between its dry and wet calibration points, not volumetric water
 * content, and the useful range depends on soil texture and planting. They
 * are a starting point to be overridden, not a recommendation.
 * ------------------------------------------------------------------ */

const SCALE_COLORS = {
  success: "var(--success-color)",
  good: "var(--success-color)",
  warning: "var(--warning-color)",
  caution: "var(--warning-color)",
  error: "var(--error-color)",
  danger: "var(--error-color)",
  info: "var(--info-color)",
  primary: "var(--primary-color)",
  neutral: "var(--disabled-color)",
};

/* Named tokens keep a config themeable; anything else is passed through so
 * a user who wants a literal colour is not blocked by our convention. */
function scaleColor(name) {
  if (!name) return "var(--disabled-color)";
  return SCALE_COLORS[name] || String(name);
}

/*
 * The Bureau of Meteorology's categories: Low 0–2, Moderate 3–5, High 6–7,
 * Very high 8–10, Extreme 11+. Expressed as exclusive upper bounds, those
 * are the thresholds below.
 *
 * The dividing line that matters is 3: BoM issues sun protection times, and
 * ARPANSA and Cancer Council recommend protection, whenever the index
 * reaches 3 or above. The descriptions say so rather than leaving a colour
 * to imply it.
 */
const DEFAULT_UV_SCALE = {
  max: 12,
  bands: [
    {
      to: 3, label: "Low", color: "success",
      description: "Sun protection not generally required.",
    },
    {
      to: 6, label: "Moderate", color: "warning",
      description: "Sun protection required — slip, slop, slap, seek, slide.",
    },
    {
      to: 8, label: "High", color: "warning",
      description: "Sun protection required — slip, slop, slap, seek, slide.",
    },
    {
      to: 11, label: "Very high", color: "error",
      description: "Sun protection required. Take extra care and seek shade around midday.",
    },
    {
      label: "Extreme", color: "error",
      description: "Sun protection required. Minimise time outdoors around midday.",
    },
  ],
};

const DEFAULT_SOIL_SCALE = {
  max: 100,
  bands: [
    { to: 20, label: "Very dry", color: "error" },
    { to: 35, label: "Dry", color: "warning" },
    { to: 65, label: "Ideal", color: "success" },
    { to: 80, label: "Moist", color: "info" },
    { label: "Saturated", color: "info" },
  ],
};

/* Accepts either a bare list of bands or `{ max, bands }`. Malformed input
 * falls back to the card's default rather than rendering a broken axis. */
function parseScale(config, fallback) {
  const raw = config && config.scale;
  let bands = null;
  let max = fallback.max;

  if (Array.isArray(raw)) {
    bands = raw;
  } else if (raw && typeof raw === "object") {
    if (Array.isArray(raw.bands)) bands = raw.bands;
    if (Number.isFinite(raw.max) && raw.max > 0) max = raw.max;
  }
  if (!bands) return fallback;

  const clean = bands
    .filter((b) => b && typeof b === "object" && b.label !== undefined)
    .map((b) => ({
      to: Number.isFinite(b.to) ? b.to : null,
      label: String(b.label),
      color: b.color,
      description: typeof b.description === "string" ? b.description : "",
    }))
    /* Open-ended band sorts last whatever order it was written in. */
    .sort((a, b) => (a.to === null ? Infinity : a.to) - (b.to === null ? Infinity : b.to));

  return clean.length ? { max, bands: clean } : fallback;
}

function bandFor(value, scale) {
  const shape = (b) => ({
    label: b.label,
    color: scaleColor(b.color),
    description: b.description || "",
  });
  if (value === null) {
    return { label: "—", color: "var(--disabled-color)", description: "" };
  }
  for (const b of scale.bands) {
    if (b.to === null || value < b.to) return shape(b);
  }
  return shape(scale.bands[scale.bands.length - 1]);
}

/* Hard stops rather than a blend, so a boundary reads as a boundary. */
function scaleGradient(scale) {
  const stops = [];
  let prev = 0;
  scale.bands.forEach((b, i) => {
    const last = i === scale.bands.length - 1;
    const end = b.to === null || last ? scale.max : Math.min(b.to, scale.max);
    const c = scaleColor(b.color);
    stops.push(`${c} ${(prev / scale.max) * 100}%`, `${c} ${(end / scale.max) * 100}%`);
    prev = end;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/* Ticks sit at the band boundaries, so the axis explains the colours. */
function scaleTicks(scale) {
  const points = [0, ...scale.bands.map((b) => b.to).filter((t) => t !== null && t <= scale.max)];
  return [...new Set(points)]
    .map((v) => {
      const pct = (v / scale.max) * 100;
      const align = pct <= 0 ? "left:0;transform:none"
        : pct >= 100 ? "right:0;left:auto;transform:none"
        : `left:${pct}%;transform:translateX(-50%)`;
      return `<span style="${align}">${v}</span>`;
    })
    .join("");
}

/* ------------------------------------------------------------------ *
 * Metric tiles
 *
 * The catalogue of tiles the weather card can show. `metrics` in the card
 * config is an ordered list of these keys; the editor adds, removes and
 * reorders it. Anything the selected device doesn't report is skipped at
 * render time, so a list may safely name a tile the hardware lacks.
 * ------------------------------------------------------------------ */

const METRIC_CATALOGUE = {
  temp_out: { label: "Temperature", icon: "mdi:thermometer", digits: 1 },
  feels_like: { label: "Feels like", icon: "mdi:thermometer-lines", digits: 1 },
  dewpoint: { label: "Dew point", icon: "mdi:water-thermometer", digits: 1 },
  hum_out: { label: "Humidity", icon: "mdi:water-percent", digits: 0 },
  wind_speed: { label: "Wind", icon: "mdi:weather-windy", digits: 1 },
  wind_gust: { label: "Gust", icon: "mdi:weather-windy", digits: 1 },
  max_gust: { label: "Max gust", icon: "mdi:speedometer-medium", digits: 1 },
  wind_dir: { label: "Direction", icon: "mdi:compass-outline", digits: 0 },
  wind_dir_avg: { label: "Avg direction", icon: "mdi:compass-outline", digits: 0 },
  rain_rate: { label: "Rain rate", icon: "mdi:speedometer", digits: 1 },
  rain_hourly: { label: "Rain this hour", icon: "mdi:weather-rainy", digits: 1 },
  rain_daily: { label: "Rain today", icon: "mdi:weather-pouring", digits: 1 },
  rain_24h: { label: "Rain 24 hours", icon: "mdi:weather-pouring", digits: 1 },
  rain_weekly: { label: "Rain this week", icon: "mdi:weather-pouring", digits: 1 },
  rain_monthly: { label: "Rain this month", icon: "mdi:weather-pouring", digits: 1 },
  rain_yearly: { label: "Rain this year", icon: "mdi:weather-pouring", digits: 1 },
  rain_event: { label: "Rain event", icon: "mdi:weather-pouring", digits: 1 },
  uv: { label: "UV index", icon: "mdi:weather-sunny-alert", digits: 0, noUnit: true },
  solar_rad: { label: "Solar", icon: "mdi:solar-power-variant", digits: 0 },
  solar_lux: { label: "Illuminance", icon: "mdi:white-balance-sunny", digits: 0 },
  press_rel: { label: "Pressure", icon: "mdi:gauge", digits: 0, hub: true },
  press_abs: { label: "Absolute pressure", icon: "mdi:gauge-low", digits: 0, hub: true },
  vpd: { label: "VPD", icon: "mdi:leaf", digits: 2 },
  temp_in: { label: "Indoor temperature", icon: "mdi:home-thermometer", digits: 1, hub: true },
  hum_in: { label: "Indoor humidity", icon: "mdi:water-percent", digits: 0, hub: true },
  soil_moisture: { label: "Soil moisture", icon: "mdi:watering-can", digits: 0 },
  battery: { label: "Battery", icon: "mdi:battery", digits: 0 },
  signal: { label: "Signal", icon: "mdi:signal", digits: 0 },
  voltage: { label: "Voltage", icon: "mdi:flash", digits: 2 },
  cap_voltage: { label: "Capacitor voltage", icon: "mdi:flash-outline", digits: 2 },
};

/* What the weather card shows when `metrics` is absent — the set it had
 * before the option existed, so upgrading changes nothing. */
const DEFAULT_METRICS = [
  "hum_out", "wind_gust", "rain_daily", "rain_rate",
  "uv", "solar_rad", "press_rel", "vpd",
];

/*
 * Some readings only exist on the gateway: a WS90 has no barometer, so
 * pressure and the indoor climate belong to the GW2000 that receives it.
 * The device registry links each sensor to its gateway through
 * `via_device_id`, so metrics flagged `hub` fall back to that parent when
 * the selected device doesn't report them.
 *
 * Only flagged keys do this. A blanket fallback would let a card borrow a
 * sibling's battery or a soil probe's moisture, which would be wrong and
 * confusing.
 */
function withHubMetrics(hass, deviceId, ids) {
  const dev = hass && hass.devices ? hass.devices[deviceId] : null;
  const parentId = dev && dev.via_device_id;
  if (!parentId || parentId === deviceId) return ids;

  const parent = discover(hass, parentId);
  const merged = { ...ids };
  for (const [key, meta] of Object.entries(METRIC_CATALOGUE)) {
    if (meta.hub && !merged[key] && parent[key]) merged[key] = parent[key];
  }
  return merged;
}

/*
 * Resolve a config to its ordered tiles, dropping anything that is not a
 * known metric. An empty list is honoured — that means "no tiles", and must
 * not silently fall back to the defaults.
 *
 * An entry is either a bare key or `{ metric, name }`, so a tile can carry
 * a shorter label than the catalogue's. Tile labels are a single line with
 * an ellipsis, and something like "Capacitor voltage" does not fit.
 */
function metricEntries(config) {
  const chosen = config && config.metrics;
  const list = Array.isArray(chosen) ? chosen : DEFAULT_METRICS;

  return list
    .map((item) => {
      const key = typeof item === "string" ? item : item && item.metric;
      const meta = METRIC_CATALOGUE[key];
      if (!meta) return null;
      const name = item && typeof item === "object" ? item.name : null;
      return {
        key,
        label: (typeof name === "string" && name.trim()) || meta.label,
        icon: meta.icon,
        digits: meta.digits,
        suffixUnit: !meta.noUnit,
      };
    })
    .filter(Boolean);
}

/* Store a bare key unless the name actually differs from the default, so
 * YAML stays terse and a renamed default doesn't get pinned by accident. */
function metricEntryFor(key, name) {
  const meta = METRIC_CATALOGUE[key];
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed && meta && trimmed !== meta.label
    ? { metric: key, name: trimmed }
    : key;
}

/* ------------------------------------------------------------------ *
 * Shared styles
 * ------------------------------------------------------------------ */

/*
 * Type comes from Home Assistant's own typography tokens rather than fixed
 * rem values, so the cards follow the user's theme — including
 * --ha-font-size-scale, which scales every size at once for accessibility.
 * Each token carries its HA default as a fallback for older cores.
 *
 *   xs 10px  s 12px  m 14px  l 16px  xl 20px  2xl 24px  3xl 28px
 *   4xl 32px  5xl 40px      weights: light 300, medium 500
 */
const BASE_CSS = `
  :host { display: block; }
  ha-card {
    padding: var(--ha-space-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--ha-space-3, 12px);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ha-space-2, 8px);
  }
  .title {
    font-size: var(--ha-font-size-l, 16px);
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    flex: 0 0 auto;
  }
  .batt {
    display: inline-flex;
    align-items: center;
    gap: var(--ha-space-1, 4px);
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
  }
  .batt ha-icon { --mdc-icon-size: 14px; color: inherit; }
  .batt.low { color: var(--warning-color); }
  .batt.critical { color: var(--error-color); }
  .dot {
    width: 8px; height: 8px; border-radius: var(--ha-border-radius-circle, 50%);
    background: var(--success-color);
    flex: 0 0 auto;
  }
  .dot.off { background: var(--error-color); }
  .dot.unknown { background: var(--disabled-color); }
  .sub {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
    gap: var(--ha-space-2, 8px);
  }
  .cell {
    background: var(--secondary-background-color);
    border-radius: var(--ha-border-radius-md, 8px);
    padding: var(--ha-space-2, 8px);
    display: flex;
    flex-direction: column;
    gap: var(--ha-space-1, 4px);
    min-width: 0;
  }
  .cell .k {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    display: flex;
    align-items: center;
    gap: var(--ha-space-1, 4px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell .v {
    font-size: var(--ha-font-size-l, 16px);
    color: var(--primary-text-color);
    font-variant-numeric: tabular-nums;
    /* Values must not spill out of their tile when the user scales type up. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell .v small {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    margin-left: var(--ha-space-1, 4px);
  }
  ha-icon { --mdc-icon-size: 15px; color: var(--secondary-text-color); }
  .clickable { cursor: pointer; }
  .clickable:hover { background: var(--divider-color); }
  .bar {
    height: 6px;
    border-radius: var(--ha-border-radius-pill, 9999px);
    background: var(--divider-color);
    overflow: hidden;
  }
  .bar > i {
    display: block;
    height: 100%;
    border-radius: var(--ha-border-radius-pill, 9999px);
    transition: width 240ms ease-in-out;
  }
  .warn {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    padding: var(--ha-space-1, 4px) 0;
  }
`;

/* ------------------------------------------------------------------ *
 * Base card
 * ------------------------------------------------------------------ */

class EcowittBase extends HTMLElement {
  static get properties() {
    return { hass: {}, config: {} };
  }

  setConfig(config) {
    if (!config || !config.device) {
      throw new Error("Select a device in the card editor.");
    }
    this._config = config;
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
  }

  set hass(hass) {
    this._hass = hass;
    this._ids = withHubMetrics(
      hass, this._config.device, discover(hass, this._config.device)
    );

    /* A device with nothing recognisable behind it is almost always the
     * wrong device rather than a broken sensor, and a card full of dashes
     * doesn't say so. Rebuild if a later update does find entities. */
    if (Object.keys(this._ids).length === 0) {
      this._renderEmpty();
      this._built = false;
      return;
    }
    if (!this._built) this._build();
    this._update();
  }

  _renderEmpty() {
    const name = deviceName(this._hass, this._config.device);
    this._shadow().innerHTML = `
      <style>${BASE_CSS}</style>
      <ha-card>
        <div class="head"><div class="title">${this._config.name || name}</div></div>
        <div class="warn">
          No Ecowitt sensors found on this device. Pick the device that owns the
          readings you want in the card editor.
        </div>
      </ha-card>`;
  }

  getCardSize() {
    return 3;
  }

  _shadow() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    return this.shadowRoot;
  }

  /* Open HA's own more-info dialog, so every value stays one tap from
   * its history without this card reimplementing any of that. */
  _moreInfo(entityId) {
    if (!entityId) return;
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  /* A metric tile. Returns "" when the entity is absent so callers can
   * concatenate freely and missing hardware just disappears. */
  _cell(key, label, icon, digits = 1, suffixUnit = true) {
    const id = this._ids[key];
    if (!id) return "";
    const u = suffixUnit ? unit(this._hass, id) : "";
    return `
      <div class="cell clickable" data-entity="${id}"
           data-digits="${digits}" data-unit="${suffixUnit ? 1 : 0}">
        <div class="k">${icon ? `<ha-icon icon="${icon}"></ha-icon>` : ""}${label}</div>
        <div class="v">${fmt(this._hass, id, digits)}${u ? `<small>${u}</small>` : ""}</div>
      </div>`;
  }

  /*
   * Replacing a container's innerHTML on every state update destroys the
   * node under the user's finger. A tap only counts when press and release
   * land on the same element, so an update arriving mid-tap silently
   * swallows it — the tile looks unresponsive until you jab at it.
   *
   * So: rebuild only when the *structure* changes (which tiles, in what
   * order), and otherwise patch the values of the existing nodes.
   */
  _syncGrid(container, specs) {
    const live = specs.filter((s) => this._ids[s.key]);
    /* The label is part of the structure: renaming a tile has to repaint it. */
    const sig = live.map((s) => `${s.key}:${this._ids[s.key]}:${s.label}`).join("|");

    if (container.dataset.sig !== sig) {
      container.dataset.sig = sig;
      container.innerHTML = live
        .map((s) => this._cell(s.key, s.label, s.icon, s.digits, s.suffixUnit !== false))
        .join("");
      this._bindCells();
      return;
    }
    this._patchCells(container);
  }

  _patchCells(root) {
    root.querySelectorAll(".cell[data-entity]").forEach((el) => {
      const id = el.getAttribute("data-entity");
      const digits = Number(el.dataset.digits);
      const u = el.dataset.unit === "1" ? unit(this._hass, id) : "";
      el.querySelector(".v").innerHTML =
        `${fmt(this._hass, id, digits)}${u ? `<small>${u}</small>` : ""}`;
    });
  }

  _bindCells() {
    this._shadow().querySelectorAll("[data-entity]").forEach((el) => {
      el.onclick = () => this._moreInfo(el.getAttribute("data-entity"));
    });
  }

  /* Sub-cards title themselves by subject ("Wind", "Rain") — on a dashboard
   * the device is already obvious from context, and repeating its name on
   * every card just makes six identical headings. Cards that represent a
   * whole device pass preferDevice. An explicit `name` always wins. */
  /* Same reasoning as _syncGrid: the battery chip is a tap target, so the
   * header is only rebuilt when its structure changes, not on every tick. */
  _syncHead(container, subject, preferDevice = false) {
    const battId = this._ids.battery || this._ids.soil_battery;
    const sig = [
      this._config.name || "",
      preferDevice ? deviceName(this._hass, this._config.device) : subject,
      this._ids.online || "",
      battId || "",
    ].join("|");

    if (container.dataset.sig !== sig) {
      container.dataset.sig = sig;
      container.innerHTML = this._headHtml(subject, preferDevice);
      this._bindCells();
      return;
    }

    const dot = container.querySelector(".dot");
    if (dot && this._ids.online) {
      const st = this._hass.states[this._ids.online];
      const s = st ? st.state : null;
      dot.className = "dot" + (s === "on" ? "" : s === "off" ? " off" : " unknown");
    }
    const chip = container.querySelector(".batt");
    if (chip) {
      const fresh = this._batteryChip();
      /* An empty chip means the reading went unavailable; leave the node in
       * place so the tap target survives, and blank its text. */
      const tmp = document.createElement("div");
      tmp.innerHTML = fresh || "";
      const next = tmp.firstElementChild;
      chip.className = next ? next.className : "batt";
      chip.innerHTML = next ? next.innerHTML : "";
    }
  }

  _headHtml(subject, preferDevice = false) {
    const title =
      this._config.name ||
      (preferDevice ? deviceName(this._hass, this._config.device) : subject) ||
      subject;
    const online = this._ids.online;
    let cls = "unknown";
    if (online && this._hass.states[online]) {
      const s = this._hass.states[online].state;
      cls = s === "on" ? "" : s === "off" ? "off" : "unknown";
    }
    return `
      <div class="head">
        <div class="title">${title}</div>
        <div class="head-right">
          ${this._batteryChip()}
          ${online ? `<div class="dot ${cls}" title="Connectivity"></div>` : ""}
        </div>
      </div>`;
  }

  /* Battery reads as a glance-level fact rather than a metric worth a tile,
   * so it sits in the header. It only earns colour once it matters. */
  _batteryChip() {
    const id = this._ids.battery || this._ids.soil_battery;
    if (!id) return "";
    const pct = num(this._hass, id);
    if (pct === null) return "";

    let cls = "";
    let icon = "mdi:battery";
    if (pct <= 15) {
      cls = "critical";
      icon = "mdi:battery-alert-variant-outline";
    } else if (pct <= 30) {
      cls = "low";
      icon = "mdi:battery-30";
    } else if (pct <= 70) {
      icon = "mdi:battery-70";
    }

    return `<span class="batt ${cls}" data-entity="${id}" title="Battery">
        <ha-icon icon="${icon}"></ha-icon>${Math.round(pct)}%
      </span>`;
  }
}

/* ------------------------------------------------------------------ *
 * Wind compass (shared SVG)
 * ------------------------------------------------------------------ */

/*
 * Needle shapes, drawn pointing up: the tip is the downwind end and the
 * tail is where the wind comes from. Sizes scale off the 132px the wind
 * card uses, because the weather card draws the same compass at 72px and
 * anything tuned only for the large size falls apart there.
 */
const NEEDLE_STYLES = {
  /* A hollow ring at the source and a solid head downwind. The two ends
   * are different kinds of object, so which is which survives 72px. */
  arrow(size, c, r) {
    const k = size / 132;
    const tail = c + r - 9;
    const tip = c - r + 7;
    return `
      <circle cx="${c}" cy="${tail}" r="${4.2 * k}" fill="none"
              stroke="var(--primary-color)" stroke-width="${2 * k}"/>
      <line x1="${c}" y1="${tail - 4.2 * k}" x2="${c}" y2="${tip + 13 * k}"
            stroke="var(--primary-color)" stroke-width="${2.4 * k}" stroke-linecap="round"/>
      <polygon points="${c},${tip} ${c - 6.5 * k},${tip + 15 * k} ${c + 6.5 * k},${tip + 15 * k}"
               fill="var(--primary-color)"/>`;
  },

  /* The original solid pointer, kept so the change is reversible. */
  classic(size, c, r) {
    return `
      <polygon points="${c},${c - r + 12} ${c - size * 0.055},${c + size * 0.07} ${c},${c + size * 0.035} ${c + size * 0.055},${c + size * 0.07}"
               fill="var(--primary-color)"/>`;
  },
};

const DEFAULT_NEEDLE = "arrow";

function needleShape(style, size, c, r) {
  const draw = NEEDLE_STYLES[style] || NEEDLE_STYLES[DEFAULT_NEEDLE];
  return draw(size, c, r);
}

function compassSvg(size, dir, avgDir, style) {
  const c = size / 2;
  const r = c - 10;
  const ticks = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * 22.5 * Math.PI) / 180;
    const major = i % 4 === 0;
    const inner = r - (major ? 9 : 5);
    ticks.push(
      `<line x1="${c + Math.sin(a) * inner}" y1="${c - Math.cos(a) * inner}"
             x2="${c + Math.sin(a) * r}" y2="${c - Math.cos(a) * r}"
             stroke="var(--divider-color)" stroke-width="${major ? 2 : 1}"
             stroke-linecap="round"/>`
    );
  }
  /* Below ~90px the cardinal letters are too small to read and just add
   * noise, so the small inline compass shows ticks and needle only. */
  const showLabels = size >= 90;
  const lbl = (t, dx, dy) =>
    !showLabels
      ? ""
      : `<text x="${dx}" y="${dy}" text-anchor="middle" dominant-baseline="middle"
           font-size="${size * 0.085}" fill="var(--secondary-text-color)">${t}</text>`;

  /*
   * Wind direction is reported as the bearing the wind comes FROM. The
   * arrow is drawn pointing the other way — downwind, where the air is
   * heading — which is what the Ecowitt console shows, so the two agree.
   * The text says "from" so the reading is unambiguous either way.
   */
  const arrow = (deg) => (deg + 180) % 360;

  const needle =
    dir === null
      ? ""
      : `<g transform="rotate(${arrow(dir)} ${c} ${c})">
           ${needleShape(style, size, c, r)}
         </g>`;

  const ghost =
    avgDir === null || avgDir === undefined
      ? ""
      : `<g transform="rotate(${arrow(avgDir)} ${c} ${c})" opacity="0.35">
           <line x1="${c}" y1="${c}" x2="${c}" y2="${c - r + 14}"
                 stroke="var(--primary-text-color)" stroke-width="2"
                 stroke-dasharray="3 3" stroke-linecap="round"/>
         </g>`;

  return `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none"
              stroke="var(--divider-color)" stroke-width="1"/>
      ${ticks.join("")}
      ${lbl("N", c, c - r + size * 0.105)}
      ${lbl("E", c + r - size * 0.105, c)}
      ${lbl("S", c, c + r - size * 0.105)}
      ${lbl("W", c - r + size * 0.105, c)}
      ${ghost}
      ${needle}
      <circle cx="${c}" cy="${c}" r="3" fill="var(--primary-text-color)"/>
    </svg>`;
}

/* ------------------------------------------------------------------ *
 * Station overview
 * ------------------------------------------------------------------ */

class EcowittWeatherCard extends EcowittBase {
  _build() {
    const s = this._shadow();
    s.innerHTML = `
      <style>
        ${BASE_CSS}
        .hero { display: flex; align-items: center; gap: var(--ha-space-4, 16px); }
        .hero .temp {
          font-size: var(--ha-font-size-5xl, 40px);
          font-weight: var(--ha-font-weight-light, 300);
          line-height: 1;
          color: var(--primary-text-color);
          font-variant-numeric: tabular-nums;
        }
        .hero .temp small { font-size: var(--ha-font-size-l, 16px); color: var(--secondary-text-color); }
        .hero .meta { display: flex; flex-direction: column; gap: var(--ha-space-1, 4px); min-width: 0; }
        .hero .spacer { flex: 1; }
        .wind-mini { display: flex; flex-direction: column; align-items: center; gap: var(--ha-space-1, 4px); }
        .wind-mini .lbl {
          font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="hero">
          <div class="meta">
            <div class="temp" id="temp">—</div>
            <div class="sub" id="feels"></div>
          </div>
          <div class="spacer"></div>
          <div class="wind-mini" id="windmini"></div>
        </div>
        <div class="grid" id="grid"></div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Weather Station", true);

    const tId = this._ids.temp_out;
    s.getElementById("temp").innerHTML = tId
      ? `${fmt(h, tId, 1)}<small>${unit(h, tId)}</small>`
      : "—";

    const feels = this._ids.feels_like;
    const dew = this._ids.dewpoint;
    const bits = [];
    if (feels) bits.push(`Feels ${fmt(h, feels, 1)}${unit(h, feels)}`);
    if (dew) bits.push(`Dew point ${fmt(h, dew, 1)}${unit(h, dew)}`);
    s.getElementById("feels").textContent = bits.join(" · ");

    const dir = num(h, this._ids.wind_dir);
    const spd = this._ids.wind_speed;
    s.getElementById("windmini").innerHTML = `
      ${compassSvg(72, dir, num(h, this._ids.wind_dir_avg), this._config.needle)}
      <div class="lbl">${dir === null ? "—" : `from ${cardinal(dir)}`}${
        spd ? ` · ${fmt(h, spd, 1)} ${unit(h, spd)}` : ""
      }</div>`;

    this._syncGrid(s.getElementById("grid"), metricEntries(this._config));
  }

  static getStubConfig(hass) {
    const dev = Object.values(hass.devices || {}).find((d) =>
      /weather station/i.test(d.name_by_user || d.name || "")
    );
    return { type: "custom:ecowitt-weather-card", device: dev ? dev.id : "" };
  }

  static getConfigElement() {
    return document.createElement("ecowitt-weather-card-editor");
  }
}

/* ------------------------------------------------------------------ *
 * Wind
 * ------------------------------------------------------------------ */

class EcowittWindCard extends EcowittBase {
  _build() {
    const s = this._shadow();
    s.innerHTML = `
      <style>
        ${BASE_CSS}
        /* Compass left, everything else stacked right. The compass is sized
         * to the text column beside it rather than the other way round. */
        .cols {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: var(--ha-space-4, 16px);
          align-items: center;
        }
        .info { display: flex; flex-direction: column; gap: var(--ha-space-1, 4px); min-width: 0; }
        .big {
          font-size: var(--ha-font-size-4xl, 32px);
          font-weight: var(--ha-font-weight-light, 300); line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: var(--ha-font-size-m, 14px); color: var(--secondary-text-color); }
        /* One grid for all rows, so labels and values line up as columns.
         * Both cells carry the entity so either half opens more-info. */
        /* Rows flow into as many columns as fit. Stretching four rows across
         * a wide card leaves a chasm between label and value; wrapping them
         * into two columns fills the width with content instead, and halves
         * the height. Narrow cards fall back to a single column. */
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
          column-gap: var(--ha-space-5, 20px);
          row-gap: var(--ha-space-1, 4px);
          margin-top: var(--ha-space-2, 8px);
        }
        /* Wrap rather than ellipsise. On a narrow card at a large font scale
         * the label and value stop fitting side by side, and a clipped
         * reading is worse than a row that takes two lines. */
        .srow {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: space-between;
          gap: 0 var(--ha-space-2, 8px);
          min-width: 0;
          cursor: pointer;
        }
        .srow .sk {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          white-space: nowrap;
        }
        .srow .sv {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--primary-text-color);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          flex: 0 0 auto;
        }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="cols">
          <div id="compass"></div>
          <div class="info">
            <div class="big" id="speed">—</div>
            <div class="sub" id="desc"></div>
            <div class="stats" id="stats"></div>
          </div>
        </div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Wind");

    const dir = num(h, this._ids.wind_dir);
    const avg = num(h, this._ids.wind_dir_avg);
    s.getElementById("compass").innerHTML =
      compassSvg(132, dir, avg, this._config.needle);

    const spd = this._ids.wind_speed;
    s.getElementById("speed").innerHTML = spd
      ? `${fmt(h, spd, 1)}<small> ${unit(h, spd)}</small>`
      : "—";

    /* The compass already shows where the wind is coming from, so the line
     * under the speed carries the description instead of repeating it. */
    s.getElementById("desc").textContent = windLabel(num(h, spd));

    const bearing = (deg) => `from ${cardinal(deg)} ${Math.round(deg)}°`;
    const rows = [];
    if (this._ids.wind_dir && dir !== null) {
      rows.push({ id: this._ids.wind_dir, label: "Direction", value: bearing(dir) });
    }
    for (const [key, label] of [["wind_gust", "Gust"], ["max_gust", "Max today"]]) {
      const id = this._ids[key];
      if (id) rows.push({ id, label, value: `${fmt(h, id, 1)} ${unit(h, id)}` });
    }
    if (this._ids.wind_dir_avg && avg !== null) {
      rows.push({ id: this._ids.wind_dir_avg, label: "Avg dir", value: bearing(avg) });
    }

    /* Rebuild only when the set of rows changes; otherwise patch the
     * values, so a row stays the same node between taps. */
    const stats = s.getElementById("stats");
    const sig = rows.map((r) => r.id).join("|");
    if (stats.dataset.sig !== sig) {
      stats.dataset.sig = sig;
      stats.innerHTML = rows.map((r) => this._stat(r.id, r.label, r.value)).join("");
      this._bindCells();
    } else {
      stats.querySelectorAll(".srow").forEach((el, i) => {
        el.querySelector(".sv").textContent = rows[i].value;
      });
    }
  }

  _stat(id, label, value) {
    return `<div class="srow" data-entity="${id}">
        <span class="sk">${label}</span><span class="sv">${value}</span>
      </div>`;
  }

  static getStubConfig() {
    return { type: "custom:ecowitt-wind-card", device: "" };
  }
  static getConfigElement() {
    return document.createElement("ecowitt-card-editor");
  }
}

/* ------------------------------------------------------------------ *
 * Rain
 * ------------------------------------------------------------------ */

class EcowittRainCard extends EcowittBase {
  _build() {
    const s = this._shadow();
    s.innerHTML = `
      <style>
        ${BASE_CSS}
        .top { display: flex; align-items: baseline; gap: var(--ha-space-2, 8px); }
        .big {
          font-size: var(--ha-font-size-4xl, 32px);
          font-weight: var(--ha-font-weight-light, 300); line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: var(--ha-font-size-m, 14px); color: var(--secondary-text-color); }
        .wet {
          margin-left: auto; display: flex; align-items: center; gap: var(--ha-space-1, 4px);
          font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color);
        }
        /* The tracks live on the container, not the row, so every row shares
         * them and the bars all start and end at the same x. Giving each row
         * its own grid would size max-content per row, which staggered the
         * bars by label length ("24 hours" vs "Hour"). The rows stay real
         * elements — rather than display:contents — so a row remains one
         * hover and click target. */
        .periods {
          display: grid;
          grid-template-columns: max-content 1fr max-content;
          row-gap: var(--ha-space-2, 8px);
        }
        .prow {
          display: grid;
          grid-column: 1 / -1;
          grid-template-columns: subgrid;
          column-gap: var(--ha-space-3, 12px);
          align-items: center;
        }
        .prow .pk {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color); white-space: nowrap;
        }
        .prow .pv {
          font-size: var(--ha-font-size-m, 14px);
          text-align: right; color: var(--primary-text-color);
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="top">
          <div class="big" id="rate">—</div>
          <div class="wet" id="wet"></div>
        </div>
        <div class="periods" id="periods"></div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Rain");

    const rate = this._ids.rain_rate;
    s.getElementById("rate").innerHTML = rate
      ? `${fmt(h, rate, 1)}<small> ${unit(h, rate)}</small>`
      : "—";

    const piezo = this._ids.rain_piezo;
    if (piezo && h.states[piezo]) {
      const wet = h.states[piezo].state === "on";
      s.getElementById("wet").innerHTML =
        `<ha-icon icon="${wet ? "mdi:weather-rainy" : "mdi:weather-partly-cloudy"}"></ha-icon>` +
        (wet ? "Raining now" : "Dry");
    } else {
      s.getElementById("wet").textContent = "";
    }

    /* Bars are scaled against the largest period present, on a square-root
     * rather than linear scale: the longest period still outweighs the
     * shortest by an order of magnitude or more, and linearly that leaves
     * the short ones as invisible slivers. Square root keeps the ordering
     * intact while staying readable at the bottom of the range. */
    const periods = [
      ["rain_hourly", "Hour"],
      ["rain_daily", "Today"],
      ["rain_24h", "24 hours"],
      ["rain_weekly", "Week"],
      ["rain_event", "Event"],
    ].filter(([k]) => this._ids[k]);

    const vals = periods.map(([k]) => num(h, this._ids[k]) || 0);
    const max = Math.max(...vals, 0.1);

    const width = (i) =>
      Math.max(0, Math.min(100, Math.sqrt(vals[i] / max) * 100));

    /* Rebuild only when the set of periods changes; otherwise patch the
     * bars and readings, so each row stays the same tap target. */
    const el = s.getElementById("periods");
    const sig = periods.map(([k]) => this._ids[k]).join("|");
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = periods
        .map(([k, label], i) => {
          const id = this._ids[k];
          return `
          <div class="prow clickable" data-entity="${id}">
            <div class="pk">${label}</div>
            <div class="bar"><i style="width:${width(i)}%;background:var(--info-color)"></i></div>
            <div class="pv">${fmt(h, id, 1)} ${unit(h, id)}</div>
          </div>`;
        })
        .join("");
      this._bindCells();
    } else {
      el.querySelectorAll(".prow").forEach((row, i) => {
        const id = this._ids[periods[i][0]];
        row.querySelector(".bar > i").style.width = `${width(i)}%`;
        row.querySelector(".pv").textContent = `${fmt(h, id, 1)} ${unit(h, id)}`;
      });
    }
  }

  static getStubConfig() {
    return { type: "custom:ecowitt-rain-card", device: "" };
  }
  static getConfigElement() {
    return document.createElement("ecowitt-card-editor");
  }
}

/* ------------------------------------------------------------------ *
 * Solar / UV
 * ------------------------------------------------------------------ */

class EcowittSolarCard extends EcowittBase {
  _build() {
    const s = this._shadow();
    s.innerHTML = `
      <style>
        ${BASE_CSS}
        /* Reading on the left, advice on the right. The reading column is
         * sized to its content so the advice gets whatever is left, and the
         * advice wraps rather than being clipped to one line. */
        /* Number on the left; category and advice stacked to its right.
         * Everything aligns to the top, so the category and the first line
         * of advice share an edge instead of one sitting on the number's
         * baseline while the other floats at the top. */
        .uvhead {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: var(--ha-space-3, 12px);
          align-items: start;
        }
        /* No gap here: the advice's line-height already leaves leading above
         * its first line, so a flex gap on top of that reads as a break
         * between the category and its own explanation. */
        .uvtext {
          display: flex; flex-direction: column;
          min-width: 0;
        }
        .advice {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          line-height: var(--ha-line-height-normal, 1.6);
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .big {
          font-size: var(--ha-font-size-4xl, 32px);
          font-weight: var(--ha-font-weight-light, 300); line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .band {
          font-size: var(--ha-font-size-m, 14px);
          font-weight: var(--ha-font-weight-medium, 500);
          line-height: var(--ha-line-height-condensed, 1.2);
        }
        /* Gradient and ticks are generated from the configured scale. */
        .scale {
          position: relative; height: 6px;
          border-radius: var(--ha-border-radius-pill, 9999px);
          opacity: 0.85;
        }
        .scale > i {
          position: absolute; top: -4px; width: 4px; height: 14px;
          border-radius: var(--ha-border-radius-sm, 4px);
          background: var(--primary-text-color);
          box-shadow: 0 0 0 2px var(--card-background-color);
          transform: translateX(-2px);
          transition: left 240ms ease-in-out;
        }
        .scaleticks {
          position: relative; height: 1em;
          font-size: var(--ha-font-size-xs, 10px);
          color: var(--secondary-text-color); margin-top: var(--ha-space-1, 4px);
        }
        .scaleticks span { position: absolute; top: 0; }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="uvhead">
          <div class="big" id="uv">—</div>
          <div class="uvtext">
            <div class="band" id="band"></div>
            <div class="advice" id="advice"></div>
          </div>
        </div>
        <div>
          <div class="scale" id="scale"><i id="marker" style="left:0%"></i></div>
          <div class="scaleticks" id="ticks"></div>
        </div>
        <div class="grid" id="grid"></div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Solar & UV");

    const scale = parseScale(this._config, DEFAULT_UV_SCALE);
    const uv = num(h, this._ids.uv);
    const band = bandFor(uv, scale);

    s.getElementById("uv").textContent = uv === null ? "—" : String(Math.round(uv));
    const bandEl = s.getElementById("band");
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;

    /* The advice line is the point of the band, not decoration: at UV 3 and
     * above the guidance is to cover up, and a colour alone doesn't say it. */
    const advice = s.getElementById("advice");
    advice.textContent = band.description;
    advice.style.display = band.description ? "" : "none";

    /* Repaint the axis only when the scale changes, not every tick. */
    const track = s.getElementById("scale");
    const sig = JSON.stringify(scale);
    if (track.dataset.sig !== sig) {
      track.dataset.sig = sig;
      track.style.backgroundImage = scaleGradient(scale);
      s.getElementById("ticks").innerHTML = scaleTicks(scale);
    }
    s.getElementById("marker").style.left =
      `${Math.max(0, Math.min(100, ((uv === null ? 0 : uv) / scale.max) * 100))}%`;

    this._syncGrid(s.getElementById("grid"), [
      { key: "solar_rad", label: "Irradiance", icon: "mdi:solar-power-variant", digits: 0 },
      { key: "solar_lux", label: "Illuminance", icon: "mdi:white-balance-sunny", digits: 0 },
    ]);
  }

  static getStubConfig() {
    return { type: "custom:ecowitt-solar-card", device: "" };
  }
  static getConfigElement() {
    return document.createElement("ecowitt-scale-card-editor");
  }
}

/* ------------------------------------------------------------------ *
 * Soil probe
 * ------------------------------------------------------------------ */

class EcowittSoilCard extends EcowittBase {
  _build() {
    const s = this._shadow();
    s.innerHTML = `
      <style>
        ${BASE_CSS}
        .top { display: flex; align-items: baseline; gap: var(--ha-space-2, 8px); }
        .big {
          font-size: var(--ha-font-size-4xl, 32px);
          font-weight: var(--ha-font-weight-light, 300); line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: var(--ha-font-size-m, 14px); color: var(--secondary-text-color); }
        .band {
          font-size: var(--ha-font-size-m, 14px);
          font-weight: var(--ha-font-weight-medium, 500); margin-left: auto;
        }
        /* The track shows the configured bands; the marker shows where the
         * reading falls in them. A plain fill implied "more is better",
         * which is wrong when the top of the range is a problem. */
        .track {
          position: relative; height: 6px;
          border-radius: var(--ha-border-radius-pill, 9999px);
          opacity: 0.85;
        }
        .track > i {
          position: absolute; top: -4px; width: 4px; height: 14px;
          border-radius: var(--ha-border-radius-sm, 4px);
          background: var(--primary-text-color);
          box-shadow: 0 0 0 2px var(--card-background-color);
          transform: translateX(-2px);
          transition: left 240ms ease-in-out;
        }
        .zones {
          position: relative; height: 1em;
          font-size: var(--ha-font-size-xs, 10px);
          color: var(--secondary-text-color); margin-top: var(--ha-space-1, 4px);
        }
        .zones span { position: absolute; top: 0; }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="top">
          <div class="big" id="moist">—</div>
          <div class="band" id="band"></div>
        </div>
        <div class="sub" id="advice"></div>
        <div>
          <div class="track" id="track"><i id="marker" style="left:0%"></i></div>
          <div class="zones" id="zones"></div>
        </div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Soil", true);

    const scale = parseScale(this._config, DEFAULT_SOIL_SCALE);
    const id = this._ids.soil_moisture;
    const pct = num(h, id);
    const band = bandFor(pct, scale);

    s.getElementById("moist").innerHTML =
      id ? `${fmt(h, id, 0)}<small> ${unit(h, id)}</small>` : "—";
    const bandEl = s.getElementById("band");
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;

    /* No soil defaults carry advice, so this stays hidden unless configured. */
    const advice = s.getElementById("advice");
    advice.textContent = band.description;
    advice.style.display = band.description ? "" : "none";

    const track = s.getElementById("track");
    const sig = JSON.stringify(scale);
    if (track.dataset.sig !== sig) {
      track.dataset.sig = sig;
      track.style.backgroundImage = scaleGradient(scale);
      s.getElementById("zones").innerHTML = scaleTicks(scale);
    }
    s.getElementById("marker").style.left =
      `${Math.max(0, Math.min(100, ((pct === null ? 0 : pct) / scale.max) * 100))}%`;

    this._bindCells();
  }

  static getStubConfig() {
    return { type: "custom:ecowitt-soil-card", device: "" };
  }
  static getConfigElement() {
    return document.createElement("ecowitt-scale-card-editor");
  }
}

/* ------------------------------------------------------------------ *
 * Indoor / gateway
 * ------------------------------------------------------------------ */

class EcowittIndoorCard extends EcowittBase {
  _build() {
    const s = this._shadow();
    s.innerHTML = `
      <style>
        ${BASE_CSS}
        .hero { display: flex; align-items: center; gap: var(--ha-space-3, 12px); }
        .big {
          font-size: var(--ha-font-size-4xl, 32px);
          font-weight: var(--ha-font-weight-light, 300); line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: var(--ha-font-size-l, 16px); color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="hero">
          <div>
            <div class="big" id="temp">—</div>
            <div class="sub" id="hum"></div>
          </div>
        </div>
        <div class="grid" id="grid"></div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Indoor");

    const t = this._ids.temp_in || this._ids.temp_out;
    s.getElementById("temp").innerHTML = t
      ? `${fmt(h, t, 1)}<small>${unit(h, t)}</small>`
      : "—";

    const hu = this._ids.hum_in || this._ids.hum_out;
    s.getElementById("hum").textContent = hu
      ? `Humidity ${fmt(h, hu, 0)}${unit(h, hu)}`
      : "";

    this._syncGrid(s.getElementById("grid"), [
      { key: "press_rel", label: "Relative", icon: "mdi:gauge", digits: 0 },
      { key: "press_abs", label: "Absolute", icon: "mdi:gauge-low", digits: 0 },
    ]);
  }

  static getStubConfig() {
    return { type: "custom:ecowitt-indoor-card", device: "" };
  }
  static getConfigElement() {
    return document.createElement("ecowitt-card-editor");
  }
}

/* ------------------------------------------------------------------ *
 * Shared editor
 *
 * ha-form is built into the HA frontend, so the editor stays
 * dependency-free while still getting a real device picker.
 * ------------------------------------------------------------------ */

class EcowittCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _schema() {
    const schema = [
      {
        name: "device",
        required: true,
        selector: { device: { integration: "ecowitt_local" } },
      },
      { name: "name", selector: { text: {} } },
    ];

    /* Only the two cards that actually draw a compass. */
    const type = (this._config && this._config.type) || "";
    if (type.includes("wind-card") || type.includes("weather-card")) {
      schema.push({
        name: "needle",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "arrow", label: "Dot and arrow" },
              { value: "classic", label: "Classic pointer" },
            ],
          },
        },
      });
    }
    return schema;
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => {
        if (s.name === "device") return "Ecowitt device";
        if (s.name === "needle") return "Compass needle";
        return "Name (optional)";
      };
      this._form.addEventListener("value-changed", (ev) => {
        const cfg = { ...this._config, ...ev.detail.value };
        Object.keys(cfg).forEach((k) => {
          if (cfg[k] === "" || cfg[k] === undefined) delete cfg[k];
        });
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config: cfg } })
        );
      });
      this.appendChild(this._form);
    }

    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = this._config;
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config } })
    );
  }
}

/* ------------------------------------------------------------------ *
 * Scale editor — soil and solar band thresholds
 *
 * Bands are kept sorted by threshold, so unlike the metric list there is
 * nothing to drag: the numbers decide the order. Sorting happens on blur
 * rather than on every keystroke, otherwise a row would jump out from
 * under the cursor mid-edit.
 * ------------------------------------------------------------------ */

class EcowittScaleCardEditor extends EcowittCardEditor {
  _defaultScale() {
    const type = (this._config && this._config.type) || "";
    return type.includes("solar") ? DEFAULT_UV_SCALE : DEFAULT_SOIL_SCALE;
  }

  /* Editing shape: every band carries a `to` except the last, which runs
   * to the top of the axis. */
  _scale() {
    return parseScale(this._config, this._defaultScale());
  }

  _writeScale(bands, max, rerender = true) {
    const fallback = this._defaultScale();
    const clean = bands.map((b, i) => {
      const last = i === bands.length - 1;
      const out = { label: b.label, color: b.color };
      if (b.description) out.description = b.description;
      if (!last && Number.isFinite(b.to)) out.to = b.to;
      return out;
    });
    const config = { ...this._config, scale: { max, bands: clean } };
    /* Keep it terse when the axis is the card's own default. */
    if (max === fallback.max) config.scale = clean;
    this._emit(config);
    if (rerender) this._renderScale();
    else this._scaleSig = this._scaleSignature();
  }

  _scaleSignature() {
    const s = this._scale();
    return JSON.stringify([s.max, s.bands.length, (this._config || {}).type]);
  }

  _render() {
    super._render();
    if (!this._hass || !this._config) return;

    if (!this._scaleSection) {
      if (!this._styled) {
        const style = document.createElement("style");
        style.textContent = EDITOR_CSS;
        this.appendChild(style);
        this._styled = true;
      }
      this._scaleSection = document.createElement("div");
      this._scaleSection.className = "ecw-section";
      this._scaleSection.innerHTML = `
        <div class="ecw-h">Scale</div>
        <div class="ecw-hint">
          Bands run from the previous threshold up to their own. The last runs
          to the top of the axis.
        </div>
        <div class="ecw-list"></div>
        <div class="ecw-max">
          Axis maximum <input type="number" step="any" id="ecw-scale-max">
        </div>
        <div class="ecw-actions"></div>`;
      this.appendChild(this._scaleSection);
    }

    if (this._scaleSignature() !== this._scaleSig) this._renderScale();
  }

  _renderScale() {
    this._scaleSig = this._scaleSignature();
    const scale = this._scale();
    const isDefault = !(this._config && this._config.scale);
    const list = this._scaleSection.querySelector(".ecw-list");
    const actions = this._scaleSection.querySelector(".ecw-actions");
    list.textContent = "";
    actions.textContent = "";

    const maxInput = this._scaleSection.querySelector("#ecw-scale-max");
    maxInput.value = scale.max;
    maxInput.onchange = () => {
      const v = parseFloat(maxInput.value);
      this._writeScale(scale.bands, Number.isFinite(v) && v > 0 ? v : scale.max);
    };

    scale.bands.forEach((band, i) => {
      const last = i === scale.bands.length - 1;
      const row = document.createElement("div");
      row.className = "ecw-band";

      const to = document.createElement("input");
      if (last) {
        /* The open band has no threshold to edit — say so rather than
         * showing an empty box that looks broken. */
        const span = document.createElement("span");
        span.className = "ecw-top";
        span.textContent = `to ${scale.max}`;
        row.appendChild(span);
      } else {
        to.type = "number";
        to.step = "any";
        to.value = band.to;
        to.title = "Upper threshold, exclusive";
        to.addEventListener("input", () => {
          const bands = this._scale().bands.slice();
          bands[i] = { ...bands[i], to: parseFloat(to.value) };
          this._writeScale(bands, scale.max, false);
        });
        /* Re-sort once editing settles, not on every keystroke. */
        to.addEventListener("blur", () => this._renderScale());
        row.appendChild(to);
      }

      const label = document.createElement("input");
      label.type = "text";
      label.value = band.label;
      label.placeholder = "Label";
      label.addEventListener("input", () => {
        const bands = this._scale().bands.slice();
        bands[i] = { ...bands[i], label: label.value };
        this._writeScale(bands, scale.max, false);
      });
      label.addEventListener("blur", () => this._renderScale());

      const colWrap = document.createElement("div");
      colWrap.className = "ecw-colwrap";
      const swatch = document.createElement("span");
      swatch.className = "ecw-swatch";
      swatch.style.background = scaleColor(band.color);
      const color = document.createElement("select");
      Object.keys(SCALE_COLORS).forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === band.color) opt.selected = true;
        color.appendChild(opt);
      });
      color.addEventListener("change", () => {
        const bands = this._scale().bands.slice();
        bands[i] = { ...bands[i], color: color.value };
        this._writeScale(bands, scale.max);
      });
      colWrap.append(swatch, color);

      const remove = document.createElement("button");
      remove.className = "ecw-btn";
      remove.title = "Remove band";
      remove.disabled = scale.bands.length <= 1;
      remove.innerHTML = `<ha-icon icon="mdi:close"></ha-icon>`;
      remove.addEventListener("click", () => {
        const bands = this._scale().bands.filter((_, j) => j !== i);
        this._writeScale(bands, scale.max);
      });

      /* Second line, spanning the row: the advice shown under the reading. */
      const desc = document.createElement("input");
      desc.type = "text";
      desc.className = "ecw-desc";
      desc.value = band.description || "";
      desc.placeholder = "Description (optional)";
      desc.addEventListener("input", () => {
        const bands = this._scale().bands.slice();
        bands[i] = { ...bands[i], description: desc.value };
        this._writeScale(bands, scale.max, false);
      });
      desc.addEventListener("blur", () => this._renderScale());

      row.append(label, colWrap, remove, desc);
      list.appendChild(row);
    });

    const add = document.createElement("button");
    add.className = "ecw-text";
    add.textContent = "Add band";
    add.addEventListener("click", () => {
      const bands = this._scale().bands.slice();
      /* Insert below the open band, halfway between its neighbours. */
      const prev = bands.length >= 2 ? bands[bands.length - 2].to : 0;
      const midpoint = Math.round(((prev || 0) + scale.max) / 2);
      bands.splice(bands.length - 1, 0, {
        to: midpoint, label: "New band", color: "info",
      });
      this._writeScale(bands, scale.max);
    });
    actions.appendChild(add);

    const reset = document.createElement("button");
    reset.className = "ecw-text";
    reset.textContent = "Reset to default";
    reset.disabled = isDefault;
    reset.addEventListener("click", () => {
      const config = { ...this._config };
      delete config.scale;
      this._emit(config);
      this._renderScale();
    });
    actions.appendChild(reset);
  }
}

/* ------------------------------------------------------------------ *
 * Weather card editor — metric tiles
 *
 * Modelled on the tile card's "features" editor: the chosen entries are a
 * reorderable list you can delete from, with a picker below offering what
 * is left. Reordering is native HTML5 drag and drop plus up/down buttons,
 * rather than the frontend's internal ha-sortable, to stay dependency-free
 * and keyboard-operable.
 * ------------------------------------------------------------------ */

const EDITOR_CSS = `
  .ecw-section { margin-top: var(--ha-space-4, 16px); }
  .ecw-h {
    font-size: var(--ha-font-size-m, 14px);
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--primary-text-color);
  }
  .ecw-hint {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    margin-top: var(--ha-space-1, 4px);
  }
  .ecw-list {
    display: flex; flex-direction: column;
    gap: var(--ha-space-1, 4px);
    margin-top: var(--ha-space-2, 8px);
  }
  .ecw-row {
    display: flex; align-items: center;
    gap: var(--ha-space-2, 8px);
    padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
    background: var(--secondary-background-color);
    border-radius: var(--ha-border-radius-md, 8px);
    font-size: var(--ha-font-size-m, 14px);
    color: var(--primary-text-color);
  }
  .ecw-row.dragging { opacity: 0.4; }
  .ecw-row.over { outline: 2px solid var(--primary-color); }
  .ecw-row .ecw-grip { cursor: grab; color: var(--secondary-text-color); }
  /* The label is editable in place: tile labels are one ellipsised line, so
   * a long catalogue name like "Capacitor voltage" needs shortening. */
  .ecw-row .ecw-label {
    flex: 1; min-width: 0;
    background: none; border: none; padding: var(--ha-space-1, 4px) 0;
    color: inherit; font: inherit;
    border-bottom: 1px solid transparent;
  }
  .ecw-row .ecw-label:hover { border-bottom-color: var(--divider-color); }
  .ecw-row .ecw-label:focus {
    outline: none; border-bottom-color: var(--primary-color);
  }
  .ecw-row .ecw-label.missing { color: var(--secondary-text-color); }
  .ecw-row .ecw-note {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    white-space: nowrap;
  }
  .ecw-btn {
    background: none; border: none; padding: var(--ha-space-1, 4px);
    cursor: pointer; color: var(--secondary-text-color);
    display: inline-flex; align-items: center;
    border-radius: var(--ha-border-radius-sm, 4px);
  }
  .ecw-btn:hover:not(:disabled) { color: var(--primary-text-color); }
  .ecw-btn:disabled { opacity: 0.3; cursor: default; }
  .ecw-add {
    display: flex; flex-wrap: wrap;
    gap: var(--ha-space-1, 4px);
    margin-top: var(--ha-space-2, 8px);
  }
  .ecw-chip {
    display: inline-flex; align-items: center;
    gap: var(--ha-space-1, 4px);
    padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
    border: 1px solid var(--divider-color);
    border-radius: var(--ha-border-radius-pill, 9999px);
    background: none; cursor: pointer;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--primary-text-color);
  }
  .ecw-chip:hover { border-color: var(--primary-color); }
  .ecw-chip.absent { color: var(--secondary-text-color); }
  .ecw-empty {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    padding: var(--ha-space-2, 8px) 0;
  }
  /* Band editor: threshold, label, colour, remove. */
  .ecw-band {
    display: grid;
    grid-template-columns: 5.5em minmax(0, 1fr) 7.5em auto;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
    background: var(--secondary-background-color);
    border-radius: var(--ha-border-radius-md, 8px);
  }
  .ecw-band input, .ecw-band select {
    background: none; border: none; color: var(--primary-text-color);
    font: inherit; font-size: var(--ha-font-size-m, 14px);
    min-width: 0; padding: var(--ha-space-1, 4px) 0;
    border-bottom: 1px solid transparent;
  }
  .ecw-band input:hover, .ecw-band select:hover { border-bottom-color: var(--divider-color); }
  .ecw-band input:focus, .ecw-band select:focus {
    outline: none; border-bottom-color: var(--primary-color);
  }
  .ecw-band select { cursor: pointer; }
  .ecw-band option { background: var(--card-background-color); color: var(--primary-text-color); }
  .ecw-band .ecw-desc {
    grid-column: 1 / -1;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
  }
  .ecw-band .ecw-top {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }
  .ecw-swatch {
    display: inline-block; width: 10px; height: 10px;
    border-radius: var(--ha-border-radius-circle, 50%);
    margin-right: var(--ha-space-1, 4px); flex: 0 0 auto;
  }
  .ecw-colwrap { display: flex; align-items: center; min-width: 0; }
  .ecw-actions {
    display: flex; align-items: center; gap: var(--ha-space-2, 8px);
    margin-top: var(--ha-space-2, 8px);
  }
  .ecw-text {
    background: none; border: 1px solid var(--divider-color);
    border-radius: var(--ha-border-radius-pill, 9999px);
    padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
    color: var(--primary-text-color); cursor: pointer;
    font-size: var(--ha-font-size-s, 12px);
  }
  .ecw-text:hover { border-color: var(--primary-color); }
  .ecw-max {
    display: flex; align-items: center; gap: var(--ha-space-2, 8px);
    margin-top: var(--ha-space-2, 8px);
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
  }
  .ecw-max input {
    width: 5em; background: none; border: none; font: inherit;
    font-size: var(--ha-font-size-m, 14px);
    color: var(--primary-text-color);
    border-bottom: 1px solid var(--divider-color);
    padding: var(--ha-space-1, 4px) 0;
  }
  .ecw-max input:focus { outline: none; border-bottom-color: var(--primary-color); }
  .ecw-btn ha-icon, .ecw-chip ha-icon, .ecw-grip { --mdc-icon-size: 18px; }
`;

class EcowittWeatherCardEditor extends EcowittCardEditor {
  _render() {
    super._render();
    if (!this._hass || !this._config) return;

    if (!this._section) {
      const style = document.createElement("style");
      style.textContent = EDITOR_CSS;
      this.appendChild(style);

      this._section = document.createElement("div");
      this._section.className = "ecw-section";
      this._section.innerHTML = `
        <div class="ecw-h">Metrics</div>
        <div class="ecw-hint">
          Tiles shown below the temperature, in order. Drag or use the arrows
          to reorder.
        </div>
        <div class="ecw-list"></div>
        <div class="ecw-add"></div>`;
      this.appendChild(this._section);
    }

    /* Home Assistant assigns `hass` on every state change, and a weather
     * station emits those constantly. Rebuilding the list each time
     * replaced the buttons under the cursor: a click only fires when
     * mousedown and mouseup land on the same element, so an update
     * arriving mid-click swallowed it and the button appeared dead.
     * Rebuild only when the list itself actually changed. */
    if (this._metricsSignature() !== this._signature) this._renderMetrics();
  }

  _metricsSignature() {
    /* Labels included: a rename must repaint the row's placeholder state. */
    return JSON.stringify([
      this._entries().map((e) => [e.key, e.label]),
      Object.keys(this._ids || {}).sort(),
    ]);
  }

  _entries() {
    return metricEntries(this._config);
  }

  /* The stored form: bare keys, or {metric,name} where a name was set. */
  _stored() {
    return this._entries().map((e) => metricEntryFor(e.key, e.label));
  }

  /* `rerender` is false while typing a name: rebuilding the list would
   * destroy the input mid-keystroke and drop focus. Advancing the
   * signature keeps the echoed setConfig from rebuilding it either. */
  _setEntries(entries, rerender = true) {
    this._emit({ ...this._config, metrics: entries });
    if (rerender) this._renderMetrics();
    else this._signature = this._metricsSignature();
  }

  _move(from, to) {
    const entries = this._stored();
    if (to < 0 || to >= entries.length) return;
    const [item] = entries.splice(from, 1);
    entries.splice(to, 0, item);
    this._setEntries(entries);
  }

  _rename(index, name) {
    const entries = this._stored();
    const key = this._entries()[index].key;
    entries[index] = metricEntryFor(key, name);
    this._setEntries(entries, false);
  }

  _renderMetrics() {
    this._signature = this._metricsSignature();
    const entries = this._entries();
    const list = this._section.querySelector(".ecw-list");
    const add = this._section.querySelector(".ecw-add");
    list.textContent = "";
    add.textContent = "";

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "ecw-empty";
      empty.textContent = "No metrics. Add one below.";
      list.appendChild(empty);
    }

    entries.forEach((entry, i) => {
      const key = entry.key;
      const m = METRIC_CATALOGUE[key];
      const missing = this._ids && !this._ids[key];
      const row = document.createElement("div");
      row.className = "ecw-row";

      /* Drag from the grip only. A draggable row hijacks text selection in
       * the name field, so the row opts in on grip mousedown and out again
       * when the drag ends. */
      const grip = document.createElement("ha-icon");
      grip.className = "ecw-grip";
      grip.setAttribute("icon", "mdi:drag");
      grip.addEventListener("mousedown", () => { row.draggable = true; });

      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", m.icon);

      const label = document.createElement("input");
      label.className = "ecw-label";
      label.type = "text";
      label.value = entry.label;
      label.placeholder = m.label;
      label.title = missing
        ? `${m.label} — not reported by this device`
        : `Shown as "${entry.label}" on the card`;
      if (missing) label.classList.add("missing");
      label.addEventListener("input", () => this._rename(i, label.value));
      /* Blur repaints, collapsing an emptied field back to the default. */
      label.addEventListener("blur", () => this._renderMetrics());

      const note = document.createElement("span");
      note.className = "ecw-note";
      note.textContent = missing ? "not on this device" : "";

      const mk = (iconName, title, disabled, fn) => {
        const b = document.createElement("button");
        b.className = "ecw-btn";
        b.title = title;
        b.disabled = disabled;
        b.innerHTML = `<ha-icon icon="${iconName}"></ha-icon>`;
        b.addEventListener("click", fn);
        return b;
      };

      row.append(
        grip, icon, label, note,
        mk("mdi:arrow-up", "Move up", i === 0, () => this._move(i, i - 1)),
        mk("mdi:arrow-down", "Move down", i === entries.length - 1, () => this._move(i, i + 1)),
        mk("mdi:close", "Remove", false, () =>
          this._setEntries(this._stored().filter((_, j) => j !== i)))
      );

      row.addEventListener("dragstart", (ev) => {
        this._dragFrom = i;
        row.classList.add("dragging");
        ev.dataTransfer.effectAllowed = "move";
        /* Firefox ignores drags without payload. */
        ev.dataTransfer.setData("text/plain", key);
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        row.draggable = false;
      });
      row.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        row.classList.add("over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("over"));
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        row.classList.remove("over");
        if (this._dragFrom !== undefined && this._dragFrom !== i) {
          this._move(this._dragFrom, i);
        }
        this._dragFrom = undefined;
      });

      list.appendChild(row);
    });

    /* Offer what the device actually reports first; the rest stay available
     * so a dashboard can be configured before hardware is paired. */
    const chosen = new Set(entries.map((e) => e.key));
    const available = Object.keys(METRIC_CATALOGUE).filter((k) => !chosen.has(k));
    const present = available.filter((k) => this._ids && this._ids[k]);
    const absent = available.filter((k) => !this._ids || !this._ids[k]);

    [...present, ...absent].forEach((key) => {
      const m = METRIC_CATALOGUE[key];
      const chip = document.createElement("button");
      chip.className = "ecw-chip" + (present.includes(key) ? "" : " absent");
      chip.innerHTML = `<ha-icon icon="${m.icon}"></ha-icon>`;
      chip.appendChild(document.createTextNode(m.label));
      chip.addEventListener("click", () => this._setEntries([...this._stored(), key]));
      add.appendChild(chip);
    });
  }

  /* Resolve exactly as the card does, hub fallback included, so the editor
   * never marks a metric unavailable that the card would happily show. */
  _resolve(hass, deviceId) {
    return withHubMetrics(hass, deviceId, discover(hass, deviceId));
  }

  set hass(hass) {
    this._hass = hass;
    this._ids = this._resolve(hass, this._config && this._config.device);
    super.hass = hass;
  }

  setConfig(config) {
    this._ids = this._resolve(this._hass, config && config.device);
    super.setConfig(config);
  }
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

const CARDS = [
  ["ecowitt-weather-card", EcowittWeatherCard, "Ecowitt Weather Station",
   "Overview of an Ecowitt WS90: temperature, wind, rain, solar."],
  ["ecowitt-wind-card", EcowittWindCard, "Ecowitt Wind",
   "Compass, wind speed, gust and daily maximum."],
  ["ecowitt-rain-card", EcowittRainCard, "Ecowitt Rain",
   "Rain rate and accumulation across every reported period."],
  ["ecowitt-solar-card", EcowittSolarCard, "Ecowitt Solar & UV",
   "UV index with exposure band, irradiance and illuminance."],
  ["ecowitt-soil-card", EcowittSoilCard, "Ecowitt Soil Moisture",
   "One soil probe with moisture band, battery and signal."],
  ["ecowitt-indoor-card", EcowittIndoorCard, "Ecowitt Indoor",
   "Gateway indoor temperature, humidity and pressure."],
];

for (const [tag, cls] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
}
if (!customElements.get("ecowitt-card-editor")) {
  customElements.define("ecowitt-card-editor", EcowittCardEditor);
}
if (!customElements.get("ecowitt-weather-card-editor")) {
  customElements.define("ecowitt-weather-card-editor", EcowittWeatherCardEditor);
}
if (!customElements.get("ecowitt-scale-card-editor")) {
  customElements.define("ecowitt-scale-card-editor", EcowittScaleCardEditor);
}

window.customCards = window.customCards || [];
for (const [tag, , name, description] of CARDS) {
  if (!window.customCards.some((c) => c.type === tag)) {
    window.customCards.push({
      type: tag,
      name,
      description,
      preview: false,
      documentationURL: "https://github.com/dgaust/ecowitt",
    });
  }
}
