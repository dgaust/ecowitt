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

const CARD_VERSION = "1.1.0";

console.info(
  `%c ECOWITT-CARDS %c ${CARD_VERSION} `,
  "color:#fff;background:#3f7cac;font-weight:700;border-radius:3px 0 0 3px",
  "color:#3f7cac;background:#eaf1f6;font-weight:700;border-radius:0 3px 3px 0"
);

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
 * Shared styles
 * ------------------------------------------------------------------ */

const BASE_CSS = `
  :host { display: block; }
  ha-card {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 0 0 auto;
  }
  .batt {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 0.72rem;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
  }
  .batt ha-icon { --mdc-icon-size: 14px; color: inherit; }
  .batt.low { color: var(--warning-color); }
  .batt.critical { color: var(--error-color); }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--success-color);
    flex: 0 0 auto;
  }
  .dot.off { background: var(--error-color); }
  .dot.unknown { background: var(--disabled-color); }
  .sub {
    font-size: 0.8rem;
    color: var(--secondary-text-color);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
    gap: 10px;
  }
  .cell {
    background: var(--secondary-background-color);
    border-radius: 10px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .cell .k {
    font-size: 0.72rem;
    color: var(--secondary-text-color);
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell .v {
    font-size: 1.05rem;
    color: var(--primary-text-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .cell .v small {
    font-size: 0.72rem;
    color: var(--secondary-text-color);
    margin-left: 2px;
  }
  ha-icon { --mdc-icon-size: 15px; color: var(--secondary-text-color); }
  .clickable { cursor: pointer; }
  .clickable:hover { background: var(--divider-color); }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--divider-color);
    overflow: hidden;
  }
  .bar > i {
    display: block;
    height: 100%;
    border-radius: 3px;
    transition: width 240ms ease-in-out;
  }
  .warn {
    font-size: 0.78rem;
    color: var(--secondary-text-color);
    padding: 4px 0;
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
    this._ids = discover(hass, this._config.device);

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
      <div class="cell clickable" data-entity="${id}">
        <div class="k">${icon ? `<ha-icon icon="${icon}"></ha-icon>` : ""}${label}</div>
        <div class="v">${fmt(this._hass, id, digits)}${u ? `<small>${u}</small>` : ""}</div>
      </div>`;
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
        .hero { display: flex; align-items: center; gap: 16px; }
        .hero .temp {
          font-size: 2.6rem;
          font-weight: 300;
          line-height: 1;
          color: var(--primary-text-color);
          font-variant-numeric: tabular-nums;
        }
        .hero .temp small { font-size: 1.1rem; color: var(--secondary-text-color); }
        .hero .meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .hero .spacer { flex: 1; }
        .wind-mini { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .wind-mini .lbl {
          font-size: 0.72rem; color: var(--secondary-text-color);
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
    s.getElementById("head").innerHTML = this._headHtml("Weather Station", true);

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

    s.getElementById("grid").innerHTML = [
      this._cell("hum_out", "Humidity", "mdi:water-percent", 0),
      this._cell("wind_gust", "Gust", "mdi:weather-windy", 1),
      this._cell("rain_daily", "Rain today", "mdi:weather-pouring", 1),
      this._cell("rain_rate", "Rain rate", "mdi:speedometer", 1),
      this._cell("uv", "UV index", "mdi:weather-sunny-alert", 0, false),
      this._cell("solar_rad", "Solar", "mdi:solar-power-variant", 0),
      this._cell("press_rel", "Pressure", "mdi:gauge", 0),
      this._cell("vpd", "VPD", "mdi:leaf", 2),
    ].join("");

    this._bindCells();
  }

  static getStubConfig(hass) {
    const dev = Object.values(hass.devices || {}).find((d) =>
      /weather station/i.test(d.name_by_user || d.name || "")
    );
    return { type: "custom:ecowitt-weather-card", device: dev ? dev.id : "" };
  }

  static getConfigElement() {
    return document.createElement("ecowitt-card-editor");
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
        .row { display: flex; align-items: center; gap: 18px; }
        .row .readout { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .big {
          font-size: 2.1rem; font-weight: 300; line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: 0.95rem; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div id="head"></div>
        <div class="row">
          <div id="compass"></div>
          <div class="readout">
            <div class="big" id="speed">—</div>
            <div class="sub" id="desc"></div>
          </div>
        </div>
        <div class="grid" id="grid"></div>
      </ha-card>`;
    this._built = true;
  }

  _update() {
    const h = this._hass;
    const s = this._shadow();
    s.getElementById("head").innerHTML = this._headHtml("Wind");

    const dir = num(h, this._ids.wind_dir);
    s.getElementById("compass").innerHTML = compassSvg(
      120,
      dir,
      num(h, this._ids.wind_dir_avg)
    );

    const spd = this._ids.wind_speed;
    s.getElementById("speed").innerHTML = spd
      ? `${fmt(h, spd, 1)}<small> ${unit(h, spd)}</small>`
      : "—";

    const kmh = num(h, spd);
    const desc = [windLabel(kmh), dir === null ? "" : `from ${cardinal(dir)} (${Math.round(dir)}°)`]
      .filter(Boolean)
      .join(" · ");
    s.getElementById("desc").textContent = desc;

    s.getElementById("grid").innerHTML = [
      this._cell("wind_gust", "Gust", "mdi:weather-windy", 1),
      this._cell("max_gust", "Max today", "mdi:speedometer-medium", 1),
      this._cell("wind_dir_avg", "Avg dir", "mdi:compass-outline", 0),
    ].join("");
    this._bindCells();
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
        .top { display: flex; align-items: baseline; gap: 10px; }
        .big {
          font-size: 2.1rem; font-weight: 300; line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: 0.95rem; color: var(--secondary-text-color); }
        .wet {
          margin-left: auto; display: flex; align-items: center; gap: 5px;
          font-size: 0.78rem; color: var(--secondary-text-color);
        }
        .periods { display: flex; flex-direction: column; gap: 8px; }
        .prow { display: grid; grid-template-columns: 68px 1fr 74px; gap: 10px; align-items: center; }
        .prow .pk { font-size: 0.78rem; color: var(--secondary-text-color); }
        .prow .pv {
          font-size: 0.82rem; text-align: right; color: var(--primary-text-color);
          font-variant-numeric: tabular-nums;
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
    s.getElementById("head").innerHTML = this._headHtml("Rain");

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

    /* Bars are scaled against the largest period present. The scale is
     * square-root rather than linear: a yearly total dwarfs an hourly one
     * by two or three orders of magnitude, and on a linear scale every
     * short period collapses into an invisible sliver. Square root keeps
     * the ordering intact while leaving small values readable. */
    const periods = [
      ["rain_hourly", "Hour"],
      ["rain_daily", "Today"],
      ["rain_24h", "24 hours"],
      ["rain_weekly", "Week"],
      ["rain_monthly", "Month"],
      ["rain_yearly", "Year"],
      ["rain_event", "Event"],
    ].filter(([k]) => this._ids[k]);

    const vals = periods.map(([k]) => num(h, this._ids[k]) || 0);
    const max = Math.max(...vals, 0.1);

    s.getElementById("periods").innerHTML = periods
      .map(([k, label], i) => {
        const id = this._ids[k];
        const pct = Math.max(0, Math.min(100, Math.sqrt(vals[i] / max) * 100));
        return `
          <div class="prow clickable" data-entity="${id}">
            <div class="pk">${label}</div>
            <div class="bar"><i style="width:${pct}%;background:var(--info-color)"></i></div>
            <div class="pv">${fmt(h, id, 1)} ${unit(h, id)}</div>
          </div>`;
      })
      .join("");

    this._bindCells();
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
        .uvhead { display: flex; align-items: baseline; gap: 10px; }
        .big {
          font-size: 2.1rem; font-weight: 300; line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .band { font-size: 0.85rem; font-weight: 500; }
        /* Band boundaries sit at the WHO thresholds (3/6/8/11) mapped onto
         * the same 0–12 linear range the marker uses. */
        .scale {
          position: relative; height: 6px; border-radius: 3px;
          background: linear-gradient(to right,
            var(--success-color) 0%, var(--success-color) 25%,
            var(--warning-color) 25%, var(--warning-color) 50%,
            var(--warning-color) 50%, var(--warning-color) 66.7%,
            var(--error-color) 66.7%, var(--error-color) 100%);
          opacity: 0.85;
        }
        .scale > i {
          position: absolute; top: -4px; width: 4px; height: 14px; border-radius: 2px;
          background: var(--primary-text-color);
          box-shadow: 0 0 0 2px var(--card-background-color);
          transform: translateX(-2px);
          transition: left 240ms ease-in-out;
        }
        .scaleticks {
          display: flex; justify-content: space-between;
          font-size: 0.68rem; color: var(--secondary-text-color); margin-top: 2px;
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
    s.getElementById("head").innerHTML = this._headHtml("Solar & UV");

    const uv = num(h, this._ids.uv);
    const band = uvBand(uv);
    s.getElementById("uv").textContent = uv === null ? "—" : String(Math.round(uv));
    const bandEl = s.getElementById("band");
    bandEl.textContent = band.label;
    bandEl.style.color = band.color;
    s.getElementById("marker").style.left =
      `${Math.max(0, Math.min(100, ((uv === null ? 0 : uv) / 12) * 100))}%`;

    s.getElementById("grid").innerHTML = [
      this._cell("solar_rad", "Irradiance", "mdi:solar-power-variant", 0),
      this._cell("solar_lux", "Illuminance", "mdi:white-balance-sunny", 0),
    ].join("");
    this._bindCells();
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
        .top { display: flex; align-items: baseline; gap: 10px; }
        .big {
          font-size: 2.1rem; font-weight: 300; line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: 0.95rem; color: var(--secondary-text-color); }
        .band { font-size: 0.85rem; font-weight: 500; margin-left: auto; }
        .zones {
          display: flex; justify-content: space-between;
          font-size: 0.68rem; color: var(--secondary-text-color); margin-top: 2px;
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
    s.getElementById("head").innerHTML = this._headHtml("Soil", true);

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
        .hero { display: flex; align-items: center; gap: 14px; }
        .big {
          font-size: 2.3rem; font-weight: 300; line-height: 1;
          color: var(--primary-text-color); font-variant-numeric: tabular-nums;
        }
        .big small { font-size: 1rem; color: var(--secondary-text-color); }
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
    s.getElementById("head").innerHTML = this._headHtml("Indoor");

    const t = this._ids.temp_in || this._ids.temp_out;
    s.getElementById("temp").innerHTML = t
      ? `${fmt(h, t, 1)}<small>${unit(h, t)}</small>`
      : "—";

    const hu = this._ids.hum_in || this._ids.hum_out;
    s.getElementById("hum").textContent = hu
      ? `Humidity ${fmt(h, hu, 0)}${unit(h, hu)}`
      : "";

    s.getElementById("grid").innerHTML = [
      this._cell("press_rel", "Relative", "mdi:gauge", 0),
      this._cell("press_abs", "Absolute", "mdi:gauge-low", 0),
    ].join("");
    this._bindCells();
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
