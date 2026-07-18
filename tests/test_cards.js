/*
 * Tests for the Ecowitt cards. No Home Assistant, no browser, no deps —
 * the card file is evaluated in a vm context with the handful of globals
 * it touches stubbed out, then exercised against a fixture captured from
 * a real HA instance (tests/fixtures/devices.json).
 *
 *   node tests/test_cards.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CARD = path.join(ROOT, "dist", "ecowitt-cards.js");
const FIXTURE = path.join(__dirname, "fixtures", "devices.json");

class FakeHTMLElement {
  attachShadow() { return {}; }
  appendChild() {}
  addEventListener() {}
  dispatchEvent() {}
}

const ctx = vm.createContext({
  console: { info() {} },
  HTMLElement: FakeHTMLElement,
  customElements: {
    _m: new Map(),
    get(t) { return this._m.get(t); },
    define(t, c) { this._m.set(t, c); },
  },
  document: { createElement: () => new FakeHTMLElement() },
  window: {},
  Event: class {},
  CustomEvent: class {},
});

vm.runInContext(
  fs.readFileSync(CARD, "utf8") +
    "\nglobalThis.__api = { discover, uvBand, soilBand, cardinal, windLabel," +
    " compassSvg, fmt, num, metricKeys, METRIC_CATALOGUE, DEFAULT_METRICS };",
  ctx
);
const api = ctx.__api;

/* ---- fixture -> hass-shaped object ---- */
const dump = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const hass = { states: {}, entities: {}, devices: {} };
const deviceIds = {};
let n = 0;
for (const [devName, info] of Object.entries(dump)) {
  const devId = "dev" + ++n;
  deviceIds[devName] = devId;
  hass.devices[devId] = { id: devId, name: devName };
  for (const e of info.entities) {
    hass.entities[e.entity_id] = { device_id: devId };
    hass.states[e.entity_id] = {
      state: e.state,
      attributes: {
        friendly_name: e.name,
        unit_of_measurement: e.unit,
        device_class: e.device_class,
      },
    };
  }
}

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label} => ${got}${ok ? "" : `  (want ${want})`}`);
}
function assert(label, cond) {
  if (!cond) failures++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
}

/* ---- every entity on every device must be classified ---- */
console.log("discovery");
for (const [devName, devId] of Object.entries(deviceIds)) {
  const ids = api.discover(hass, devId);
  const owned = Object.keys(hass.entities).filter(
    (e) => hass.entities[e].device_id === devId
  );
  const unclassified = owned.filter((e) => !Object.values(ids).includes(e));
  assert(
    `${devName}: ${owned.length - unclassified.length}/${owned.length} classified` +
      (unclassified.length ? ` — left over: ${unclassified.join(", ")}` : ""),
    unclassified.length === 0
  );
}

/* ---- ids that contain one another must not collide ---- */
console.log("ambiguous ids");
const ws = api.discover(hass, deviceIds["Ecowitt Weather Station"]);
const soil = api.discover(hass, deviceIds["Ecowitt Soil Moisture Sensor D431A"]);
const gw = api.discover(hass, deviceIds["Ecowitt Gateway"]);
check("wind_dir not the avg sensor", ws.wind_dir, "sensor.ecowitt_wind_direction_13360");
check("wind_dir_avg distinct", ws.wind_dir_avg, "sensor.ecowitt_wind_direction_avg_13360");
check("voltage not capacitor", ws.voltage, "sensor.ecowitt_voltage_13360");
check("cap_voltage distinct", ws.cap_voltage, "sensor.ecowitt_capacitor_voltage_13360");
check("daily rain not max gust", ws.rain_daily, "sensor.ecowitt_daily_rain_13360");
check("max gust distinct", ws.max_gust, "sensor.ecowitt_max_daily_gust_13360");
check("soil moisture not battery", soil.soil_moisture, "sensor.ecowitt_soil_moisture_d431a");
check("soil battery distinct", soil.soil_battery, "sensor.ecowitt_soil_moisture_battery_d431a");
check("soil online is binary", soil.online, "binary_sensor.ecowitt_soil_moisture_d431a_online");
check("gateway indoor temp", gw.temp_in, "sensor.ecowitt_temperature_indoor");
check("gateway indoor humidity", gw.hum_in, "sensor.ecowitt_humidity_humidityin");
assert("gateway has no outdoor temp", gw.temp_out === undefined);

/* The WH40 tipping bucket is a second, independent rain source alongside
 * the WS90's piezo. Its battery entity ("rain_battery") sits in the middle
 * of the rain_* accumulation names, which is exactly the kind of overlap
 * the ordered rules exist to resolve. */
const wh40 = api.discover(hass, deviceIds["Ecowitt Rain Sensor"]);
check("wh40 rate", wh40.rain_rate, "sensor.ecowitt_rain_rate_11c87");
check("wh40 daily", wh40.rain_daily, "sensor.ecowitt_daily_rain_11c87");
check("wh40 event", wh40.rain_event, "sensor.ecowitt_rain_event_11c87");
check("wh40 battery not a rain total", wh40.battery, "sensor.ecowitt_rain_battery_11c87");
assert("wh40 battery did not claim a rain_* slot",
  ![wh40.rain_rate, wh40.rain_daily, wh40.rain_event, wh40.rain_hourly,
    wh40.rain_weekly, wh40.rain_monthly, wh40.rain_yearly, wh40.rain_24h]
    .includes("sensor.ecowitt_rain_battery_11c87"));
assert("wh40 has no piezo binary (tipping bucket)", wh40.rain_piezo === undefined);
check("wh40 online", wh40.online, "binary_sensor.ecowitt_sensor_11c87_online");

/* Two soil probes must resolve to different entities on different devices. */
const soil1 = api.discover(hass, deviceIds["Ecowitt Soil Moisture Sensor D42E2"]);
check("soil CH1 moisture", soil1.soil_moisture, "sensor.ecowitt_soil_moisture_d42e2");
assert("soil CH1 and CH2 are distinct", soil1.soil_moisture !== soil.soil_moisture);

/* ---- an unknown device yields nothing rather than throwing ---- */
console.log("edge cases");
assert("unknown device => {}", Object.keys(api.discover(hass, "nope")).length === 0);
assert("missing hass => {}", Object.keys(api.discover(null, "dev1")).length === 0);
check(
  "unavailable state formats as dash",
  api.fmt({ states: { "sensor.x": { state: "unavailable", attributes: {} } } }, "sensor.x"),
  "—"
);
check(
  "non-numeric state passes through",
  api.fmt({ states: { "sensor.x": { state: "D431A", attributes: {} } } }, "sensor.x"),
  "D431A"
);
check(
  "display precision honoured",
  api.fmt(
    { states: { "sensor.x": { state: "1029.23", attributes: { suggested_display_precision: 0 } } } },
    "sensor.x"
  ),
  "1029"
);

/* ---- configurable metric tiles ---- */
console.log("metrics");
const { metricKeys, METRIC_CATALOGUE, DEFAULT_METRICS } = api;

check("absent config falls back to defaults",
  metricKeys({}).join(","), DEFAULT_METRICS.join(","));
check("non-array metrics falls back",
  metricKeys({ metrics: "nope" }).join(","), DEFAULT_METRICS.join(","));
check("order is preserved exactly",
  metricKeys({ metrics: ["vpd", "uv", "hum_out"] }).join(","), "vpd,uv,hum_out");
check("unknown keys are dropped",
  metricKeys({ metrics: ["uv", "not_a_metric", "vpd"] }).join(","), "uv,vpd");
/* An empty list must mean "no tiles", not "give me the defaults" — the
 * difference between honouring a choice and overriding it. */
check("empty list yields no tiles", metricKeys({ metrics: [] }).length, 0);
check("duplicates are left alone",
  metricKeys({ metrics: ["uv", "uv"] }).join(","), "uv,uv");

assert("every default metric is in the catalogue",
  DEFAULT_METRICS.every((k) => METRIC_CATALOGUE[k]));

/* A catalogue entry the discovery rules can never produce would be a tile
 * the user can add but that stays permanently blank. */
const discoverable = new Set(Object.keys(ws).concat(Object.keys(gw), Object.keys(soil)));
const knownKeys = new Set([
  ...discoverable, "temp_in", "hum_in", "press_abs", "soil_moisture",
  "rain_monthly", "rain_yearly", "wind_speed", "signal", "battery",
]);
const orphans = Object.keys(METRIC_CATALOGUE).filter((k) => !knownKeys.has(k));
assert(`no catalogue entry is undiscoverable${orphans.length ? ": " + orphans.join(", ") : ""}`,
  orphans.length === 0);

assert("every catalogue entry has a label and icon",
  Object.values(METRIC_CATALOGUE).every((m) => m.label && m.icon));

/* The defaults must be what the card rendered before the option existed,
 * so upgrading doesn't rearrange anyone's dashboard. */
check("defaults match the pre-existing tile set",
  DEFAULT_METRICS.join(","),
  "hum_out,wind_gust,rain_daily,rain_rate,uv,solar_rad,press_rel,vpd");

/* ---- helpers ---- */
console.log("helpers");
check("cardinal(0)", api.cardinal(0), "N");
check("cardinal(78)", api.cardinal(78), "ENE");
check("cardinal(180)", api.cardinal(180), "S");
check("cardinal(359) wraps to N", api.cardinal(359), "N");
check("cardinal(-90) normalises", api.cardinal(-90), "W");
check("cardinal(null)", api.cardinal(null), "—");
check("uvBand(0)", api.uvBand(0).label, "Low");
check("uvBand(7)", api.uvBand(7).label, "High");
check("uvBand(12)", api.uvBand(12).label, "Extreme");
check("uvBand(null)", api.uvBand(null).label, "—");
check("soilBand(51)", api.soilBand(51).label, "Ideal");
check("soilBand(10)", api.soilBand(10).label, "Very dry");
check("windLabel(0)", api.windLabel(0), "Calm");
check("windLabel(3.96)", api.windLabel(3.96), "Light air");

for (const d of [0, 78, 359, null]) {
  const svg = api.compassSvg(120, d, 38);
  assert(
    `compassSvg(dir=${d}) well formed`,
    svg.includes("<svg") && svg.trim().endsWith("</svg>") && !svg.includes("NaN")
  );
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall tests passed");
process.exit(failures ? 1 : 0);
