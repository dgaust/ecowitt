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

const CARD_VERSION = "1.9.1";

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

function uvBand(uv) {
  if (uv === null) return { label: "—", color: "var(--disabled-color)" };
  if (uv < 3) return { label: "Low", color: "var(--success-color)" };
  if (uv < 6) return { label: "Moderate", color: "var(--warning-color)" };
  if (uv < 8) return { label: "High", color: "var(--warning-color)" };
  if (uv < 11) return { label: "Very high", color: "var(--error-color)" };
  return { label: "Extreme", color: "var(--error-color)" };
}

function soilBand(pct) {
  if (pct === null) return { label: "—", color: "var(--disabled-color)" };
  if (pct < 20) return { label: "Very dry", color: "var(--error-color)" };
  if (pct < 35) return { label: "Dry", color: "var(--warning-color)" };
  if (pct < 65) return { label: "Ideal", color: "var(--success-color)" };
  if (pct < 80) return { label: "Moist", color: "var(--info-color)" };
  return { label: "Saturated", color: "var(--info-color)" };
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

/* Resolve a config to its ordered metric keys, dropping anything that is
 * not a known tile. An empty list is honoured — that means "no tiles", and
 * must not silently fall back to the defaults. */
function metricKeys(config) {
  const chosen = config && config.metrics;
  const list = Array.isArray(chosen) ? chosen : DEFAULT_METRICS;
  return list.filter((k) => METRIC_CATALOGUE[k]);
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
    const sig = live.map((s) => `${s.key}:${this._ids[s.key]}`).join("|");

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

function compassSvg(size, dir, avgDir) {
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

  const needle =
    dir === null
      ? ""
      : `<g transform="rotate(${dir} ${c} ${c})">
           <polygon points="${c},${c - r + 12} ${c - size * 0.055},${c + size * 0.07} ${c},${c + size * 0.035} ${c + size * 0.055},${c + size * 0.07}"
                    fill="var(--primary-color)"/>
         </g>`;

  const ghost =
    avgDir === null || avgDir === undefined
      ? ""
      : `<g transform="rotate(${avgDir} ${c} ${c})" opacity="0.35">
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
      ${compassSvg(72, dir, num(h, this._ids.wind_dir_avg))}
      <div class="lbl">${cardinal(dir)}${
        spd ? ` · ${fmt(h, spd, 1)} ${unit(h, spd)}` : ""
      }</div>`;

    this._syncGrid(
      s.getElementById("grid"),
      metricKeys(this._config).map((key) => {
        const m = METRIC_CATALOGUE[key];
        return {
          key, label: m.label, icon: m.icon,
          digits: m.digits, suffixUnit: !m.noUnit,
        };
      })
    );
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
    s.getElementById("compass").innerHTML = compassSvg(132, dir, avg);

    const spd = this._ids.wind_speed;
    s.getElementById("speed").innerHTML = spd
      ? `${fmt(h, spd, 1)}<small> ${unit(h, spd)}</small>`
      : "—";

    /* The compass already shows where the wind is coming from, so the line
     * under the speed carries the description instead of repeating it. */
    s.getElementById("desc").textContent = windLabel(num(h, spd));

    const bearing = (deg) => `${cardinal(deg)} ${Math.round(deg)}°`;
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
        .uvhead { display: flex; align-items: baseline; gap: var(--ha-space-2, 8px); }
        .big {
          font-size: var(--ha-font-size-4xl, 32px);
          font-weight: var(--ha-font-weight-light, 300); line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .band { font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); }
        /* Band boundaries sit at the WHO thresholds (3/6/8/11) mapped onto
         * the same 0–12 linear range the marker uses. */
        .scale {
          position: relative; height: 6px;
          border-radius: var(--ha-border-radius-pill, 9999px);
          background: linear-gradient(to right,
            var(--success-color) 0%, var(--success-color) 25%,
            var(--warning-color) 25%, var(--warning-color) 50%,
            var(--warning-color) 50%, var(--warning-color) 66.7%,
            var(--error-color) 66.7%, var(--error-color) 100%);
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
          display: flex; justify-content: space-between;
          font-size: var(--ha-font-size-xs, 10px);
          color: var(--secondary-text-color); margin-top: var(--ha-space-1, 4px);
        }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="uvhead">
          <div class="big" id="uv">—</div>
          <div class="band" id="band"></div>
        </div>
        <div>
          <div class="scale"><i id="marker" style="left:0%"></i></div>
          <div class="scaleticks"><span>0</span><span>3</span><span>6</span><span>9</span><span>12+</span></div>
        </div>
        <div class="grid" id="grid"></div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Solar & UV");

    const uv = num(h, this._ids.uv);
    const band = uvBand(uv);
    s.getElementById("uv").textContent = uv === null ? "—" : String(Math.round(uv));
    const bandEl = s.getElementById("band");
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;
    s.getElementById("marker").style.left =
      `${Math.max(0, Math.min(100, ((uv === null ? 0 : uv) / 12) * 100))}%`;

    this._syncGrid(s.getElementById("grid"), [
      { key: "solar_rad", label: "Irradiance", icon: "mdi:solar-power-variant", digits: 0 },
      { key: "solar_lux", label: "Illuminance", icon: "mdi:white-balance-sunny", digits: 0 },
    ]);
  }

  static getStubConfig() {
    return { type: "custom:ecowitt-solar-card", device: "" };
  }
  static getConfigElement() {
    return document.createElement("ecowitt-card-editor");
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
        .zones {
          display: flex; justify-content: space-between;
          font-size: var(--ha-font-size-xs, 10px);
          color: var(--secondary-text-color); margin-top: var(--ha-space-1, 4px);
        }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="top">
          <div class="big" id="moist">—</div>
          <div class="band" id="band"></div>
        </div>
        <div>
          <div class="bar"><i id="fill" style="width:0%"></i></div>
          <div class="zones"><span>Dry</span><span>Ideal</span><span>Saturated</span></div>
        </div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    this._syncHead(s.getElementById("head"), "Soil", true);

    const id = this._ids.soil_moisture;
    const pct = num(h, id);
    const band = soilBand(pct);

    s.getElementById("moist").innerHTML =
      id ? `${fmt(h, id, 0)}<small> ${unit(h, id)}</small>` : "—";
    const bandEl = s.getElementById("band");
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;

    const fill = s.getElementById("fill");
    fill.style.width = `${Math.max(0, Math.min(100, pct === null ? 0 : pct))}%`;
    fill.style.background = band.color;

    this._bindCells();
  }

  static getStubConfig() {
    return { type: "custom:ecowitt-soil-card", device: "" };
  }
  static getConfigElement() {
    return document.createElement("ecowitt-card-editor");
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
    return [
      {
        name: "device",
        required: true,
        selector: { device: { integration: "ecowitt_local" } },
      },
      { name: "name", selector: { text: {} } },
    ];
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) =>
        s.name === "device" ? "Ecowitt device" : "Name (optional)";
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
  .ecw-row .ecw-label { flex: 1; min-width: 0; }
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
    return JSON.stringify([
      this._keys(),
      Object.keys(this._ids || {}).sort(),
    ]);
  }

  _keys() {
    return metricKeys(this._config);
  }

  _setKeys(keys) {
    this._emit({ ...this._config, metrics: keys });
    this._renderMetrics();
  }

  _move(from, to) {
    const keys = this._keys();
    if (to < 0 || to >= keys.length) return;
    const [item] = keys.splice(from, 1);
    keys.splice(to, 0, item);
    this._setKeys(keys);
  }

  _renderMetrics() {
    this._signature = this._metricsSignature();
    const keys = this._keys();
    const list = this._section.querySelector(".ecw-list");
    const add = this._section.querySelector(".ecw-add");
    list.textContent = "";
    add.textContent = "";

    if (!keys.length) {
      const empty = document.createElement("div");
      empty.className = "ecw-empty";
      empty.textContent = "No metrics. Add one below.";
      list.appendChild(empty);
    }

    keys.forEach((key, i) => {
      const m = METRIC_CATALOGUE[key];
      const row = document.createElement("div");
      row.className = "ecw-row";
      row.draggable = true;

      const grip = document.createElement("ha-icon");
      grip.className = "ecw-grip";
      grip.setAttribute("icon", "mdi:drag");

      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", m.icon);

      const label = document.createElement("span");
      label.className = "ecw-label";
      /* Flag entries the chosen device doesn't report: the tile is kept in
       * the config but will not render, and saying so beats a silent gap. */
      label.textContent = this._ids && !this._ids[key]
        ? `${m.label} (not on this device)`
        : m.label;
      if (this._ids && !this._ids[key]) label.style.color = "var(--secondary-text-color)";

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
        grip, icon, label,
        mk("mdi:arrow-up", "Move up", i === 0, () => this._move(i, i - 1)),
        mk("mdi:arrow-down", "Move down", i === keys.length - 1, () => this._move(i, i + 1)),
        mk("mdi:close", "Remove", false, () =>
          this._setKeys(this._keys().filter((_, j) => j !== i)))
      );

      row.addEventListener("dragstart", (ev) => {
        this._dragFrom = i;
        row.classList.add("dragging");
        ev.dataTransfer.effectAllowed = "move";
        /* Firefox ignores drags without payload. */
        ev.dataTransfer.setData("text/plain", key);
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
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
    const available = Object.keys(METRIC_CATALOGUE).filter((k) => !keys.includes(k));
    const present = available.filter((k) => this._ids && this._ids[k]);
    const absent = available.filter((k) => !this._ids || !this._ids[k]);

    [...present, ...absent].forEach((key) => {
      const m = METRIC_CATALOGUE[key];
      const chip = document.createElement("button");
      chip.className = "ecw-chip" + (present.includes(key) ? "" : " absent");
      chip.innerHTML = `<ha-icon icon="${m.icon}"></ha-icon>`;
      chip.appendChild(document.createTextNode(m.label));
      chip.addEventListener("click", () => this._setKeys([...this._keys(), key]));
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
