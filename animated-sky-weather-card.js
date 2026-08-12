/* animated-sky-weather-card
 * A Home Assistant weather card where the whole card is a living sky.
 * - Sky gradient follows the REAL sun (sun.sun elevation) through night,
 *   dawn, golden hour and day; overcast conditions mute it.
 * - The sun is drawn where it actually is (azimuth -> x, elevation -> y):
 *   an overexposed core + bloom (screen-blended so it lights the sky),
 *   diffraction starburst, anamorphic streak, horizon warmth and lens ghosts.
 *   At night: the real moon - position AND phase computed from your latitude
 *   and longitude - plus twinkling stars.
 * - Volumetric clouds: clusters of billboarded, self-shaded puff sprites in a
 *   CSS 3D world, sized and thickened by live cloud coverage, on period-locked
 *   drift trains so an overcast sky never opens a hole.
 * - Condition scenes: partly cloudy, overcast, wind (tumbling leaves, sheared
 *   faster clouds), fog, rain, downpour, fractal vein lightning, hail with
 *   bouncing stones, snow that settles on the forecast panel, severe.
 * - Rain, hail and snow interact with the hourly panel: every splash, bounce
 *   and drift of snow comes from a drop you can watch arrive.
 * - Clock, date, hero conditions, hourly strip with sunrise/sunset events, and
 *   a daily forecast with shared temperature range bars.
 * Zero network requests: no CDN, no telemetry, no API keys. Every texture is
 * generated and embedded.
 */
"use strict";

const VERSION = "1.0.0";
console.info("%c animated-sky-weather-card %c v" + VERSION + " ",
  "background:#1B2440;color:#F7C173;border-radius:3px 0 0 3px;padding:2px 0 2px 6px",
  "background:#F7C173;color:#1B2440;border-radius:0 3px 3px 0;padding:2px 6px 2px 0");

/* ---------- small pure helpers (kept standalone for testability) ---------- */

const wxClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const wxMixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (sh) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return "#" + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0").toUpperCase();
};

/* Sun position on the card. Azimuth: 90 = east (left) to 270 = west (right),
 * because the card is a south-facing window. Elevation 0 = horizon line,
 * 60+ = top of the sky area. Returns null when the sun is below -8deg. */
const wxSunPos = (elevation, azimuth, south) => {
  if (elevation == null || elevation < -8) return null;
  // North of the equator the sun crosses the SOUTH: azimuth runs 90 (east,
  // left) -> 180 -> 270 (west, right). South of it the sun crosses the NORTH
  // and a viewer facing that path sees east on their RIGHT, so the arc runs
  // right to left and wraps through 0/360.
  const t = south
    ? 1 - wxClamp(((90 - azimuth + 360) % 360) / 180, 0, 1)
    : wxClamp((azimuth - 90) / 180, 0, 1);
  const x = 6 + t * 88;
  const y = 76 - wxClamp(elevation / 60, 0, 1) * 62 - wxClamp(elevation, -8, 0) * 1.5;
  return { x, y };
};

/* Sky palette [top, mid, horizon] blended by sun elevation, then muted
 * toward grey by the condition's gloom factor. */
const WX_SKIES = [
  [-90, ["#070B1E", "#0B1026", "#1B2440"]],   // deep night
  [-10, ["#0D1330", "#1A1F48", "#3A2C55"]],   // late dusk
  [-4,  ["#1B2350", "#4A3670", "#C2543A"]],   // ember dusk
  [0,   ["#2E3A6E", "#9A5E86", "#FF7E3D"]],   // sunset fire
  [4,   ["#35508F", "#C77E8E", "#FF9950"]],   // low sun, pink-orange
  [10,  ["#3E6CB0", "#8FA3CF", "#F7B25C"]],   // golden hour
  [22,  ["#2E7FD0", "#5FA8E4", "#A8D4F2"]],   // morning/evening blue
  [55,  ["#1F6FC9", "#4F9BE0", "#BFE3F7"]],   // high day
];
const WX_GLOOM = { cloudy: 0.2, rainy: 0.5, pouring: 0.66, "lightning": 0.64,
  "lightning-rainy": 0.68, snowy: 0.35, "snowy-rainy": 0.5, fog: 0.6,
  partlycloudy: 0.1, hail: 0.55, windy: 0.1, "windy-variant": 0.1, exceptional: 0.72 };
const WX_GLOOM_DARK = { pouring: 1, lightning: 1, "lightning-rainy": 1, hail: 1, exceptional: 1 };

const wxSkyPalette = (elevation, condition) => {
  const e = elevation == null ? 30 : elevation;
  let lo = WX_SKIES[0], hi = WX_SKIES[WX_SKIES.length - 1];
  for (let i = 0; i < WX_SKIES.length - 1; i++) {
    if (e >= WX_SKIES[i][0] && e <= WX_SKIES[i + 1][0]) { lo = WX_SKIES[i]; hi = WX_SKIES[i + 1]; break; }
  }
  const t = lo[0] === hi[0] ? 0 : wxClamp((e - lo[0]) / (hi[0] - lo[0]), 0, 1);
  let pal = lo[1].map((c, i) => wxMixHex(c, hi[1][i], t));
  const gloom = WX_GLOOM[condition] || 0;
  const target = WX_GLOOM_DARK[condition] ? "#3B414B" : "#6B7280";
  if (gloom) pal = pal.map((c) => wxMixHex(c, target, gloom));
  return pal;
};

/* Scene class: which animated layers exist for a condition (+night). */
const wxScene = (condition, night) => {
  const c = condition || "";
  if (c === "clear-night") return "night-clear";
  if (night && (c === "sunny" || c === "clear")) return "night-clear";
  const map = {
    sunny: "clear", clear: "clear", partlycloudy: "partly", cloudy: "cloudy",
    rainy: "rain", pouring: "pour", lightning: "storm", "lightning-rainy": "storm",
    snowy: "snow", "snowy-rainy": "sleet", fog: "fog", hail: "hail",
    windy: "windy", "windy-variant": "windy", exceptional: "severe",
  };
  return (night ? "night-" : "") + (map[c] || "cloudy");
};

/* Forecast bar geometry: each day's [left%, width%] on a shared min..max. */
const wxBars = (rows) => {
  if (!rows.length) return [];
  const min = Math.min(...rows.map((r) => r.lo)), max = Math.max(...rows.map((r) => r.hi));
  const span = Math.max(max - min, 1);
  return rows.map((r) => ({
    left: ((r.lo - min) / span) * 100,
    width: Math.max(((r.hi - r.lo) / span) * 100, 4),
  }));
};

/* Current temperature -> % position on the shared forecast scale. */
const wxNowDot = (current, rows) => {
  if (current == null || !rows.length) return null;
  const min = Math.min(...rows.map((r) => r.lo)), max = Math.max(...rows.map((r) => r.hi));
  const span = Math.max(max - min, 1);
  return wxClamp(((current - min) / span) * 100, 0, 100);
};

/* With a REAL measured coverage %, trust it - but the OBSERVED condition
 * floors it, so the sky never contradicts the label it wears (a cloudy
 * observation with a 0% model reading still draws clouds). */
const WX_OBS_FLOOR = { rainy: 60, pouring: 78, lightning: 65,
  "lightning-rainy": 78, snowy: 60, "snowy-rainy": 70, hail: 70,
  partlycloudy: 40, cloudy: 75, fog: 90 };
const wxCoverEff = (real, coverageAttr, condition) => {
  if (real != null && isFinite(real))
    return Math.max(Number(real), WX_OBS_FLOOR[condition] || 0);
  return wxCover(coverageAttr, condition);
};

/* Effective cloud coverage %: live cloud_coverage floored by what the
 * condition implies, so a lagging condition string cannot hide a full sky. */
const WX_COVER_FLOOR = { cloudy: 85, rainy: 90, pouring: 95, lightning: 90,
  "lightning-rainy": 95, snowy: 90, "snowy-rainy": 95, hail: 90,
  partlycloudy: 45, windy: 30, "windy-variant": 30, fog: 92, exceptional: 85 };
const wxCover = (coverage, condition) => {
  const floor = WX_COVER_FLOOR[condition] || 0;
  const c = coverage == null ? null : Number(coverage);
  return Math.max(c == null || isNaN(c) ? 0 : c, floor);
};

/* Photographic layer opacities from coverage %: far haze arrives first,
 * the bold near field rolls in above ~25%. */
const WX_CLUSTER_AT = [8, 20, 32, 44, 56, 68, 78, 78, 78, 78];
const wxClusterO = (cover) =>
  WX_CLUSTER_AT.map((th, i) =>
    +(Math.min(1, Math.max(0, (cover - th) / 16)) * (0.92 - i * 0.03)).toFixed(2));

/* Real lunar position + illumination (low-precision standard formulas,
 * good to ~a degree - plenty for a sky widget). */
const wxAstro = (() => {
  const rad = Math.PI / 180, dayMs = 86400e3, J1970 = 2440588, J2000 = 2451545;
  const toDays = (date) => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const E = rad * 23.4397;
  const rAsc = (l, b) => Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
  const decl = (l, b) => Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));
  const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
  const sunCoords = (d) => {
    const M = rad * (357.5291 + 0.98560028 * d);
    const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    return { ra: rAsc(L, 0), dec: decl(L, 0) };
  };
  const moonCoords = (d) => {
    const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
    const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F);
    return { ra: rAsc(l, b), dec: decl(l, b), dist: 385001 - 20905 * Math.cos(M) };
  };
  const moonPos = (date, lat, lng) => {
    const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d);
    const H = sidereal(d, lw) - c.ra;
    let h = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
    h = h + rad * 0.017 / Math.tan(h + rad * 10.26 / (h + rad * 5.10));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
    return { elevation: h / rad, azimuth: (az / rad + 180 + 360) % 360 };
  };
  const moonIllum = (date) => {
    const d = toDays(date), su = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi2 = Math.acos(Math.sin(su.dec) * Math.sin(m.dec) + Math.cos(su.dec) * Math.cos(m.dec) * Math.cos(su.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi2), m.dist - sdist * Math.cos(phi2));
    const angle = Math.atan2(Math.cos(su.dec) * Math.sin(su.ra - m.ra),
      Math.sin(su.dec) * Math.cos(m.dec) - Math.cos(su.dec) * Math.sin(m.dec) * Math.cos(su.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, waxing: angle < 0 };
  };
  return { moonPos, moonIllum };
})();

/* Fractal lightning: recursive segment tree. The main channel starts ABOVE
 * the frame (origin never visible), branches fork like veins and thin out.
 * rand injected for testability. Segments carry their branch depth. */
const wxBoltTree = (rand, w, h) => {
  const segs = [];
  const grow = (x, y, ang, depth, energy) => {
    while (energy > 0 && y < h * 0.96 && segs.length < 500) {
      const len = (depth === 0 ? 20 : 13) + rand() * 24;
      ang = ang * 0.82 + (rand() - 0.5) * 0.6;
      const x2 = x + Math.sin(ang) * len;
      const y2 = y + Math.cos(ang) * len * (0.8 + rand() * 0.4);
      segs.push({ x1: x, y1: y, x2: x2, y2: y2, d: depth });
      if (depth < 3 && rand() < 0.18 - depth * 0.03) {
        grow(x2, y2, ang + (rand() < 0.5 ? -1 : 1) * (0.55 + rand() * 0.6),
          depth + 1, energy * (0.3 + rand() * 0.25));
      }
      x = x2; y = y2; energy -= len;
    }
  };
  grow(w * (0.18 + rand() * 0.64), -30 - rand() * 30, (rand() - 0.5) * 0.5,
    0, h * (0.9 + rand() * 0.5));
  return segs;
};

/* Depth-grouped SVG: trunk thick, capillaries thin, fat blurred underlay. */
const wxBoltSvg = (segs) => {
  const seg2d = (list) => list.map((g) =>
    "M" + g.x1.toFixed(0) + " " + g.y1.toFixed(0) +
    "L" + g.x2.toFixed(0) + " " + g.y2.toFixed(0)).join("");
  const W = [3.8, 2.2, 1.3, 0.75], O = [1, 0.92, 0.8, 0.65];
  let out = '<path d="' + seg2d(segs.filter((g) => g.d < 2)) +
    '" style="stroke-width:11;stroke:rgba(198,180,255,.4);filter:blur(6px)"></path>';
  for (let d = 0; d < 4; d++) {
    const list = segs.filter((g) => g.d === d);
    if (!list.length) continue;
    out += '<path d="' + seg2d(list) + '" style="stroke-width:' + W[d] +
      ';opacity:' + O[d] + '"></path>';
  }
  return out;
};

/* Angular separation (deg) between two sky positions. */
const wxAngSep = (e1, a1, e2, a2) => {
  const r = Math.PI / 180;
  const c = Math.sin(e1 * r) * Math.sin(e2 * r) +
    Math.cos(e1 * r) * Math.cos(e2 * r) * Math.cos((a1 - a2) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
};

/* Honest moon visibility: hidden in solar glare, faint when barely lit. */
const wxMoonVis = (fraction, sunUp, sepFromSun) => {
  if (sepFromSun != null && sepFromSun < 10) return 0;
  const base = sunUp ? 0.4 : 1;
  const lit = sunUp ? Math.min(1, fraction * 4) : Math.min(1, 0.25 + fraction * 1.5);
  return +(base * lit).toFixed(2);
};

/* Is timestamp t at night, given the NEXT rising/setting times (both in the
 * future)? next_set < next_rise means it is daytime now. Exact within one
 * sun cycle - plenty for a 7-slot hourly strip. */
const wxIsNightAt = (t, rise, set) => {
  if (!rise || !set) return false;
  if (set < rise) return t >= set && t < rise;   // day now: night between set and rise
  return t < rise || t >= set;                    // night now
};

/* Atmospheric warmth: 0 high in the sky -> 1 at the horizon. */
const wxWarm = (elevation) =>
  elevation == null ? 0 : wxClamp((14 - elevation) / 14, 0, 1);

/* Lens ghosts sit on the line from the sun through frame centre (50,52),
 * at parameter t > 1 (past centre) - real flare optics. */
const wxGhostPos = (pos, t) =>
  ({ x: pos.x + t * (50 - pos.x), y: pos.y + t * (52 - pos.y) });

/* The now-dot's colour = the bar gradient sampled at the dot's position
 * (near-black start 0-24%, lo colour, hi colour) - identical by construction
 * to the pixels beneath it. */
const wxDotColor = (cur, lo, hi, unit) => {
  const loC = wxTempColor(lo, unit), hiC = wxTempColor(hi, unit);
  const t = wxClamp(hi > lo ? (cur - lo) / (hi - lo) : 1, 0, 1);
  if (t <= 0.24) return wxMixHex(wxMixHex(loC, "#06090F", 0.55), loC, t / 0.24);
  return wxMixHex(loC, hiC, (t - 0.24) / 0.76);
};

/* Temp -> bar colour on a warm scale. The ladder is Fahrenheit, so a
 * Celsius reading is converted for the LOOKUP only - what the card prints
 * is always the provider's own number in the user's own unit. */
const wxToF = (t, unit) =>
  String(unit || "").indexOf("C") >= 0 ? t * 9 / 5 + 32 : t;
const wxTempColor = (t, unit) => {
  const f = wxToF(t, unit);
  return f >= 95 ? "#E85200" : f >= 85 ? "#E27C0A" : f >= 76 ? "#D9A410"
    : f >= 60 ? "#4693D1" : "#2A6FB8";
};

/* Locale for every date/time: an explicit config wins, then Home
 * Assistant's language, then the browser's. */
const wxLocale = (hass, cfg) =>
  (cfg && cfg.locale) ||
  (hass && hass.locale && hass.locale.language) ||
  (hass && hass.language) ||
  (typeof navigator !== "undefined" && navigator.language) || "en";

/* undefined = let the locale decide (Intl's own default). */
const wxHour12 = (hass, cfg) => {
  const t = cfg && cfg.time_format;
  if (t === "12" || t === 12) return true;
  if (t === "24" || t === 24) return false;
  const hl = hass && hass.locale;
  if (hl && hl.time_format === "12") return true;
  if (hl && hl.time_format === "24") return false;
  return undefined;
};

/* Hour label for the strip: "4PM" / "16" / whatever the locale writes. */
const wxHourLabel = (d, locale, h12) => {
  const o = { hour: "numeric" };
  if (h12 !== undefined) o.hour12 = h12;
  return d.toLocaleTimeString(locale, o).replace(/\s+/g, "");
};

const wxTimeLabel = (d, locale, h12) => {
  const o = { hour: "numeric", minute: "2-digit" };
  if (h12 !== undefined) o.hour12 = h12;
  return d.toLocaleTimeString(locale, o).replace(/\s+/g, "");
};

/* Home Assistant ships translations for these; fall back to English. */
const wxT = (hass, keys, fallback) => {
  if (hass && typeof hass.localize === "function") {
    for (const k of keys) {
      const v = hass.localize(k);
      if (v) return v;
    }
  }
  return fallback;
};

const WX_LABEL = { sunny: "Sunny", clear: "Clear", "clear-night": "Clear",
  partlycloudy: "Partly Cloudy", cloudy: "Cloudy", rainy: "Rain", pouring: "Heavy Rain",
  lightning: "Thunderstorms", "lightning-rainy": "Thunderstorms", snowy: "Snow",
  "snowy-rainy": "Sleet", fog: "Fog", hail: "Hail", windy: "Windy",
  "windy-variant": "Windy", exceptional: "Severe" };
const wxLabel = (c) => WX_LABEL[c] || String(c || "").replace(/-/g, " ");

const WX_ICONS = {
  sun: '<circle cx="12" cy="12" r="5" fill="#FFD24D"/><g stroke="#FFD24D" stroke-width="1.6" stroke-linecap="round"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></g>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" fill="#DCE3F5"/>',
  cloud: '<path d="M7 18h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.4 8.9 4.5 4.5 0 0 0 7 18Z" fill="#C9D4E4"/>',
  partly: '<circle cx="16" cy="8" r="4" fill="#FFD24D"/><path d="M5.5 18h8.7a3.6 3.6 0 0 0 .55-7.16A5 5 0 0 0 5 10.2 4.1 4.1 0 0 0 5.5 18Z" fill="#C9D4E4"/>',
  rain: '<path d="M7 15h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.4 5.9 4.5 4.5 0 0 0 7 15Z" fill="#C9D4E4"/><g stroke="#6FB6F5" stroke-width="1.7" stroke-linecap="round"><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/></g>',
  snow: '<path d="M7 15h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.4 5.9 4.5 4.5 0 0 0 7 15Z" fill="#C9D4E4"/><g fill="#EAF4FF"><circle cx="9" cy="18.6" r="1.2"/><circle cx="13" cy="20" r="1.2"/><circle cx="17" cy="18.6" r="1.2"/></g>',
  storm: '<path d="M7 14h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.4 4.9 4.5 4.5 0 0 0 7 14Z" fill="#C9D4E4"/><path d="M13 14l-3.2 5h2.4l-1.2 3.5L15 17h-2.4l1.4-3Z" fill="#FFD24D"/>',
  fog: '<g stroke="#C9D4E4" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h16M6 13h13M4.5 17h14"/></g>',
  sunset: '<path d="M7.5 16a4.5 4.5 0 0 1 9 0" fill="#FFD24D"/><g stroke="#FFD24D" stroke-width="1.6" stroke-linecap="round"><path d="M3 16h18M12 3.5V9M9.8 7.2 12 9.4l2.2-2.2M5 12.2l1.4 1.4M19 12.2l-1.4 1.4"/></g>',
  sunrise: '<path d="M7.5 16a4.5 4.5 0 0 1 9 0" fill="#FFD24D"/><g stroke="#FFD24D" stroke-width="1.6" stroke-linecap="round"><path d="M3 16h18M12 9V3.5M9.8 5.8 12 3.6l2.2 2.2M5 12.2l1.4 1.4M19 12.2l-1.4 1.4"/></g>',
  moonpartly: '<path d="M18.5 10A5.2 5.2 0 0 1 12 3.5 5.2 5.2 0 1 0 18.5 10Z" fill="#DCE3F5"/><path d="M5.5 19.5h8.8a3.4 3.4 0 0 0 .5-6.77A4.7 4.7 0 0 0 6 13.9a3.95 3.95 0 0 0-.5 5.6Z" fill="#C9D4E4"/>',
  mooncloud: '<path d="M19 9.5A4.6 4.6 0 0 1 13.2 3.7 4.6 4.6 0 1 0 19 9.5Z" fill="#DCE3F5"/><path d="M5 19h9.8a3.7 3.7 0 0 0 .55-7.36A5 5 0 0 0 5.6 10.5 4.2 4.2 0 0 0 5 19Z" fill="#C9D4E4"/>',
  wind: '<g stroke="#C9D4E4" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M3 8.5h9.5a2.2 2.2 0 1 0-2.2-2.3M3 12.8h13.5a2.3 2.3 0 1 1-2.3 2.3M3 17h6.5a2 2 0 1 1-2 2.1"/></g>',
};
const wxIconFor = (condition, night) => {
  const c = condition || "";
  if (c === "clear-night" || (night && (c === "sunny" || c === "clear"))) return "moon";
  if (night && c === "partlycloudy") return "moonpartly";
  if (night && c === "cloudy") return "mooncloud";
  return ({ sunny: "sun", clear: "sun", partlycloudy: "partly", cloudy: "cloud",
    rainy: "rain", pouring: "rain", lightning: "storm", "lightning-rainy": "storm",
    snowy: "snow", "snowy-rainy": "snow", fog: "fog", hail: "snow",
    windy: "wind", "windy-variant": "wind" })[c] || "cloud";
};

/* ---------- the card ---------- */

class AnimatedSkyWeatherCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._forecast = [];
    this._sceneKey = "";
  }

  setConfig(config) {
    if (!config || !config.entity) throw new Error("animated-sky-weather-card: 'entity' is required");
    this._config = Object.assign(
      { forecast_rows: 4, animation: true }, config);
    this._built = false;
  }

  getCardSize() { return 6; }
  getGridOptions() { return { rows: 6, columns: 12, min_rows: 5 }; }
  getLayoutOptions() { return { grid_rows: 6, grid_columns: 12, grid_min_rows: 5 }; }
  static getStubConfig() { return { entity: "weather.forecast_home" }; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    if (first) this._fetchForecast();
    this._render();
  }

  connectedCallback() {
    if (this._hass && !this._clockTimer) this._startTimers();
    if (this._built) this._startCamera();
  }
  disconnectedCallback() {
    clearInterval(this._clockTimer); this._clockTimer = 0;
    clearInterval(this._fcTimer); this._fcTimer = 0;
    this._stopCamera();
  }

  _buildClouds() {
    // Volumetric cloud trains (constants proven in test_wx1233 sim).
    // Durations AND delays divide by _windK: a uniform time scale, so the
    // phase structure - and both proven invariants - survive unchanged.
    const rnd = (a, b) => a + Math.random() * (b - a);
    const K = this._windK || 1;
    const TRAIN = [
      { d: 120, ph: 0, z: -50 }, { d: 120, ph: 0.5, z: -80 },
      { d: 180, ph: 0, z: -230 }, { d: 180, ph: 1 / 3, z: -250 },
      { d: 120, ph: 0.25, z: -65 }, { d: 180, ph: 2 / 3, z: -270 },
    ];
    // fog packs 4 extra banks into the empty phase slots (near -> even
    // quarters, far -> even sixths): blur shrinks a bank's visual footprint,
    // so fog needs denser spacing than the cloudy-deck proof assumed
    const EXTRA = [
      { d: 120, ph: 0.75, z: -70 },
      { d: 180, ph: 1 / 6, z: -240 }, { d: 180, ph: 0.5, z: -255 },
      { d: 180, ph: 5 / 6, z: -265 },
    ];
    const list = this._fogDense ? TRAIN.concat(EXTRA) : TRAIN;
    const jitN = rnd(0, 120), jitF = rnd(0, 180);
    let c3dHtml = "";
    for (let ci = 0; ci < list.length; ci++) {
      const tr = list[ci];
      const z = tr.z + rnd(-12, 12);
      const dur = tr.d / K;
      const y = rnd(-30, 150);
      const ns = (this._fogDense ? 16 : 10) + Math.floor(rnd(0, 6));
      let sprites = "";
      for (let k = 0; k < ns; k++) {
        sprites += `<div class="cpw" data-ox="${rnd(-185, 185).toFixed(0)}"` +
          ` data-oy="${rnd(-80, 80).toFixed(0)}" data-oz="${rnd(-95, 95).toFixed(0)}"` +
          ` data-s="${rnd(0.7, 1.6).toFixed(2)}">` +
          `<div class="cpf${k % 2 ? " v2" : ""}" style="--sd:${rnd(46, 95).toFixed(0)}s;` +
          `--sdl:-${rnd(0, 80).toFixed(0)}s;animation-direction:${rnd(0, 1) < 0.5 ? "normal" : "reverse"}"></div></div>`;
      }
      const dl = ((tr.d === 120 ? jitN : jitF) + tr.ph * tr.d) / K;
      c3dHtml += `<div class="ccl" style="--y:${y.toFixed(0)}px;` +
        `--z:${z.toFixed(0)}px;--dur:${dur.toFixed(0)}s;--dl:-${dl.toFixed(0)}s">${sprites}</div>`;
    }
    this._els.clouds.innerHTML = `<div class="ceil"></div><div class="c3dp"><div class="c3d">${c3dHtml}</div></div>`;
    this._c3d = this._els.clouds.querySelector(".c3d");
    this._c3dWraps = null;
  }

  _startCamera() {
    if (this._camRaf) return;
    const reduced = window.matchMedia
      && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this._config.animation === false || reduced) return;
    this._cam = { x: 0, y: 0, t0: performance.now() };
    const step = (now) => {
      this._camRaf = requestAnimationFrame(step);
      const c = this._cam;
      const t = (now - c.t0) / 1000;
      const ax = 1.9 * Math.sin(t / 47 * 2 * Math.PI);
      const ay = 2.6 * Math.sin(t / 63 * 2 * Math.PI + 1.7);
      c.x += (ax - c.x) * 0.04;
      c.y += (ay - c.y) * 0.04;
      if (!this._c3d) return;
      this._c3d.style.transform =
        "rotateX(" + c.x.toFixed(2) + "deg) rotateY(" + c.y.toFixed(2) + "deg)";
      if (!this._c3dWraps)
        this._c3dWraps = Array.from(this._c3d.querySelectorAll(".cpw"), (el) => ({
          el, ox: +el.dataset.ox, oy: +el.dataset.oy, oz: +el.dataset.oz, s: +el.dataset.s,
        }));
      const rx = (-c.x).toFixed(2), ry = (-c.y).toFixed(2);
      const f = this._cloudScale || 1;
      const shx = this._windShear ? 1.18 : 1, shy = this._windShear ? 0.94 : 1;
      for (const w of this._c3dWraps) {
        w.el.style.transform = "translate3d(" + (w.ox * f).toFixed(1) + "px," +
          (w.oy * f).toFixed(1) + "px," + (w.oz * f).toFixed(1) + "px) rotateY(" +
          ry + "deg) rotateX(" + rx + "deg) scale(" + (w.s * f * shx).toFixed(3) +
          "," + (w.s * f * shy).toFixed(3) + ")";
      }
    };
    this._camRaf = requestAnimationFrame(step);
  }

  _stopCamera() {
    if (this._camRaf) cancelAnimationFrame(this._camRaf);
    this._camRaf = 0;
  }

  _startTimers() {
    this._clockTimer = setInterval(() => this._renderClock(), 1000);
    this._fcTimer = setInterval(() => this._fetchForecast(), 30 * 60 * 1000);
  }

  async _fetchForecast() {
    if (!this._hass) return;
    try {
      const r = await this._hass.callWS({
        type: "call_service", domain: "weather", service: "get_forecasts",
        service_data: { entity_id: this._config.entity, type: "daily" },
        return_response: true,
      });
      const fc = r && r.response && r.response[this._config.entity];
      this._forecast = (fc && fc.forecast) || [];
      this._renderForecast();
      const rh = await this._hass.callWS({
        type: "call_service", domain: "weather", service: "get_forecasts",
        service_data: { entity_id: this._config.entity, type: "hourly" },
        return_response: true,
      });
      const fh = rh && rh.response && rh.response[this._config.entity];
      this._hourly = (fh && fh.forecast) || [];
      this._renderHourly();
    } catch (e) { /* keep the previous forecast; the scene still works */ }
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block;
                font-family: var(--ha-font-family-body,
                  var(--primary-font-family, Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif)); }
        ha-card { overflow: hidden; border-radius: var(--ha-card-border-radius, 16px); }
        .sky {
          position: relative; min-height: 440px; overflow: hidden;
          transition: background 2s ease;
          isolation: isolate;
        }
        .layer { position: absolute; inset: 0; pointer-events: none; }

        /* --- sun: photographic bloom, not a cartoon disc --- */
        .sun { position: absolute; width: 320px; height: 320px; margin: -160px 0 0 -160px;
               mix-blend-mode: screen; transition: left 60s linear, top 60s linear; }
        .sun .bloom {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(circle,
            rgba(255,255,255,.98) 0%, rgba(255,252,244,.88) 7%,
            rgba(255,244,220,.5) 15%, rgba(255,232,190,.22) 29%,
            rgba(255,220,170,.08) 46%, rgba(255,210,160,0) 68%);
          animation: sunbreathe 9s ease-in-out infinite;
        }
        .sun .core {
          position: absolute; left: 50%; top: 50%; width: 34px; height: 34px;
          margin: -17px; border-radius: 50%; background: #fff;
          box-shadow: 0 0 18px 10px rgba(255,255,255,.95),
                      0 0 60px 30px rgba(255,248,230,.6),
                      0 0 130px 65px rgba(255,236,200,.25);
        }
        .sun .warm {
          position: absolute; inset: 0; border-radius: 50%; opacity: var(--warm, 0);
          background: radial-gradient(circle,
            rgba(255,196,120,.6) 0%, rgba(255,160,90,.34) 22%,
            rgba(255,140,80,.12) 45%, rgba(255,130,70,0) 68%);
        }
        .sun .spikes { position: absolute; inset: 0; animation: spin 420s linear infinite; }
        .sun .spike { position: absolute; left: 50%; top: 50%; width: 232px; height: 2px;
          margin: -1px 0 0 -116px; filter: blur(2.5px);
          background: linear-gradient(90deg, rgba(255,246,230,0) 0%, rgba(255,246,230,.45) 35%,
            rgba(255,252,245,.8) 50%, rgba(255,246,230,.45) 65%, rgba(255,246,230,0) 100%);
        }
        .sun .spike.s2 { transform: rotate(90deg); width: 196px; margin-left: -98px; opacity: .75; }
        .sun .spike.s3 { transform: rotate(45deg); width: 140px; margin-left: -70px; opacity: .45; }
        .sun .spike.s4 { transform: rotate(135deg); width: 140px; margin-left: -70px; opacity: .45; }
        .sun .streak { position: absolute; left: 50%; top: 50%; width: 330px; height: 44px;
          margin: -22px 0 0 -165px; opacity: .5;
          background: radial-gradient(ellipse 50% 50% at center, rgba(255,214,170,.42) 0%, rgba(255,214,170,0) 70%);
          animation: shimmer 7s ease-in-out infinite;
        }
        .ghosts { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen; }
        .ghost { position: absolute; border-radius: 50%; opacity: .3; display: none;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(255,230,200,.9), rgba(255,230,200,0) 70%); }
        .ghost.g1 { width: 36px; height: 36px; }
        .ghost.g2 { width: 20px; height: 20px; opacity: .38; }
        .ghost.g3 { width: 58px; height: 58px; border-radius: 34%; opacity: .22; }
        @keyframes sunbreathe {
          50% { transform: scale(1.04); }
          76% { transform: scale(1.0); }
          83% { transform: scale(1.09); filter: brightness(1.12); }
          90% { transform: scale(1.02); }
        }
        @keyframes shimmer { 50% { opacity: .32; transform: scaleX(1.18); } }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* --- moon + stars --- */
        .moon { position: absolute; width: 58px; height: 58px;
                margin: -29px 0 0 -29px; border-radius: 50%; display: none;
                overflow: hidden;
                background: radial-gradient(circle at 38% 36%, #F4F7FF 0%, #D9E0F2 55%, #AEB9D6 100%);
                box-shadow: 0 0 34px 8px rgba(214,226,255,.35), inset -6px -5px 0 rgba(140,152,190,.35);
                transition: left 60s linear, top 60s linear, opacity 2.5s ease; }
        .moon .shade { position: absolute; inset: -2px; border-radius: 50%;
                background: rgba(9,13,28,.94);
                transform: translateX(var(--mshift, 0px)); transition: transform 2s ease; }
        .stars { display: none; }
        .star { position: absolute; width: 2px; height: 2px; border-radius: 50%;
                background: #EAF0FF; animation: twinkle 4s ease-in-out infinite; }
        @keyframes twinkle { 50% { opacity: .15; transform: scale(.7); } }

        /* --- clouds --- */
        /* Photographic cloud fields: generated fBm textures (x-tileable),
         * bright tops and blue-grey bellies baked in. Two parallax layers. */
        /* Volumetric clouds: perspective world of billboarded puff sprites.
         * Intra-cluster 3D offsets give parallax as the camera breathes or
         * follows the pointer - the CSS3DClouds technique. */
        .c3dp { position: absolute; inset: 0; perspective: 900px;
                perspective-origin: 50% 30%; pointer-events: none; }
        .c3d { position: absolute; inset: 0; transform-style: preserve-3d; }
        /* overcast ceiling: at heavy cover the top of the sky is always
         * cloud - billow y randomization alone can leave blue above the deck */
        .ceil { position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(var(--ceilc, #C7CDD4), transparent 46%);
          opacity: var(--ceilo, 0); transition: opacity 2s ease; }
        .ccl { position: absolute; left: 0; top: 0; width: 0; height: 0;
               transform-style: preserve-3d;
               animation: cdrift var(--dur, 90s) linear infinite var(--dl, 0s); }
        @keyframes cdrift {
          0% { transform: translate3d(1250px, var(--y, 120px), var(--z, 0px)); opacity: 0; }
          7% { opacity: var(--o, 0); }
          93% { opacity: var(--o, 0); }
          100% { transform: translate3d(-530px, var(--y, 120px), var(--z, 0px)); opacity: 0; } }
        .cpw { position: absolute; left: 0; top: 0; transform-style: preserve-3d;
               will-change: transform; }
        .cpf { position: absolute; left: -192px; top: -192px; width: 384px; height: 384px;
               background: url(data:image/webp;base64,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) center/contain no-repeat;
               opacity: .85;
               animation: cspin var(--sd, 70s) linear infinite var(--sdl, 0s); }
        .cpf.v2 { background-image: url(data:image/webp;base64,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); }
        @keyframes cspin { to { transform: rotate(360deg); } }
        .c3d.dim .cpf { filter: brightness(.68) contrast(1.1) saturate(.85); }
        .c3d.dark .cpf { filter: brightness(.37) contrast(1.34) saturate(.55); }
        /* fog: the same banks, but as hazy smears - blur lives on the sprite
         * (a filter on a preserve-3d ancestor would flatten the 3D) */
        .c3d.hazy .cpf { filter: blur(8px) brightness(1.04) saturate(.35) contrast(.82);
                         opacity: .78; }
        /* a milky wash behind the hazy banks - the sky itself must not
         * show through fog */
        .sky.fog .clouds::before, .sky.night-fog .clouds::before {
          content: ""; position: absolute; inset: 0;
          background: rgba(193, 198, 205, .68); }
        /* Heavy cover hazes the sun to a glow and kills the lens optics. */
        .sky.veiled .sun { opacity: .3; filter: blur(16px); }
        .sky.veiled .spikes, .sky.veiled .streak { display: none; }
        /* low sun paints the clouds: warm underlight through the dusk window */
        .sky.dusk .c3d:not(.dim):not(.dark) .cpf { filter: sepia(.38) saturate(1.3) hue-rotate(-13deg) brightness(1.04); }
        /* Crepuscular shafts: soft light bands descending from the sun. */
        .shafts { position: absolute; inset: 0; pointer-events: none;
          mix-blend-mode: screen; opacity: var(--ro, 0); filter: blur(14px);
          background: repeating-linear-gradient(var(--rayang, 115deg),
            rgba(255,248,226,0) 0px, rgba(255,248,226,0) 64px,
            rgba(255,248,226,.34) 96px, rgba(255,248,226,0) 128px,
            rgba(255,248,226,0) 190px);
          -webkit-mask-image: radial-gradient(circle at var(--sunx, 70%) var(--suny, 20%), #fff 0%, rgba(255,255,255,.5) 38%, transparent 74%);
          mask-image: radial-gradient(circle at var(--sunx, 70%) var(--suny, 20%), #fff 0%, rgba(255,255,255,.5) 38%, transparent 74%);
          animation: shaftdrift 46s linear infinite alternate,
                     shaftpulse 13s ease-in-out infinite; }
        @keyframes shaftdrift { to { background-position: 70px 46px; } }
        @keyframes shaftpulse { 50% { opacity: calc(var(--ro, 0) * 0.55); } }
        .drift { animation: drift var(--dur, 90s) linear infinite; }
        @keyframes drift {
          from { transform: translateX(-30%); }
          to { transform: translateX(130%); }
        }

        /* --- rain / snow / fog / lightning --- */
        /* scope to the LAYER elements: the sky itself wears scene classes with
         * the same names (sky.rain), and a bare .rain selector hid the whole
         * card on the first rainy day of its life */
        .layer.rain, .layer.snow, .layer.fog, .layer.flash, .layer.leaves { display: none; }
        .drop { position: absolute; top: -24px; width: 2px; border-radius: 1px;
                background: linear-gradient(rgba(160,205,245,0), rgba(160,205,245,.75));
                animation: fall var(--dur, 0.9s) linear infinite; }
        @keyframes fall { to { transform: translateY(440px); } }
        .drop.hv { display: none; }
        .sky.pour .drop.hv, .sky.night-pour .drop.hv,
        .sky.storm .drop.hv, .sky.night-storm .drop.hv { display: block; }
        .sky.pour .drop, .sky.night-pour .drop,
        .sky.storm .drop, .sky.night-storm .drop {
          animation-duration: calc(var(--dur, 0.9s) * 0.6); }
        /* sleet scenes (hail / snowy-rainy): ice pellets, not drifting snow */
        .sky.sleet .flake, .sky.night-sleet .flake,
        .sky.hail .flake, .sky.night-hail .flake {
          animation-duration: calc(var(--dur, 7s) * 0.22); }
        .flake { position: absolute; top: -12px; width: 5px; height: 5px; border-radius: 50%;
                 background: rgba(240,248,255,.9); animation: snowfall var(--dur, 7s) linear infinite; }
        @keyframes snowfall {
          to { transform: translateY(440px) translateX(26px); }
        }
        .fogband { position: absolute; left: -20%; width: 140%; height: 46px; border-radius: 50%;
                   background: rgba(214,222,234,.34); filter: blur(12px);
                   animation: fogdrift var(--dur, 60s) ease-in-out infinite alternate; }
        @keyframes fogdrift { to { transform: translateX(12%); } }
        .flash { position: absolute; inset: 0; background: rgba(255,255,240,.85); opacity: 0; }
        .bolts { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .boltg { opacity: 0;
                 filter: drop-shadow(0 0 7px rgba(224,210,255,.95)) drop-shadow(0 0 24px rgba(180,158,255,.6)); }
        .boltg path { fill: none; stroke: #F7F3FF; stroke-linecap: round; stroke-linejoin: round; }
        .boltg.strike { animation: boltstrike 1.15s ease-out; }
        @keyframes boltstrike {
          0% { opacity: 0; } 4% { opacity: 1; } 9% { opacity: .25; }
          15% { opacity: 1; } 23% { opacity: .45; } 30% { opacity: .9; }
          45% { opacity: .5; } 70% { opacity: .18; } 100% { opacity: 0; } }
        .flash.go { animation: bolt 0.9s ease-out; }
        @keyframes bolt { 0% {opacity:.9} 12% {opacity:.05} 22% {opacity:.6} 100% {opacity:0} }

        /* scene switches */
        .sky.night-clear .stars, .sky.night-partly .stars, .sky.night-cloudy .stars,
        .sky.night-rain .stars { display: block; }
        .sky.night-clear .sun, .sky.night-partly .sun, .sky.night-cloudy .sun,
        .sky.night-rain .sun, .sky.night-pour .sun, .sky.night-storm .sun,
        .sky.night-snow .sun, .sky.night-sleet .sun, .sky.night-fog .sun,
        .sky.night-hail .sun, .sky.night-windy .sun, .sky.night-severe .sun { display: none; }
        .sky.rain .rain, .sky.pour .rain, .sky.storm .rain, .sky.sleet .rain,
        .sky.night-rain .rain, .sky.night-pour .rain, .sky.night-storm .rain,
        .sky.night-sleet .rain, .sky.hail .rain, .sky.night-hail .rain { display: block; }
        .sky.snow .snow, .sky.sleet .snow, .sky.night-snow .snow, .sky.night-sleet .snow,
        .sky.hail .snow, .sky.night-hail .snow { display: block; }
        /* rain patters off the hourly panel rim: tiny rising splash rings */
        .splashrow { position: absolute; left: 10px; right: 10px; top: -3px;
                     height: 0; pointer-events: none; }
        .splash { display: none; }
        /* impact ricochet: the outer element carries constant sideways
         * velocity, the inner rises to a peak then falls under gravity -
         * together a parabolic splash arc off the rim */
        .splash { position: absolute; bottom: 0; width: 0; height: 0; }
        .splash b { position: absolute; left: -1px; bottom: 0; width: 2px;
                    height: var(--dln, 15px); border-radius: 1px;
                    background: linear-gradient(rgba(160,205,245,0), rgba(160,205,245,.75));
                    opacity: 0; transform-origin: bottom;
                    animation: spldrop var(--spd, 1.1s) linear infinite var(--spdl, 0s); }
        @keyframes spldrop {
          0% { transform: translateY(calc(-1 * var(--fh, 110px))); opacity: 0; }
          4% { opacity: var(--fo, .75); }
          32% { opacity: var(--fo, .75); }
          35% { transform: translateY(0); opacity: 0; }
          100% { transform: translateY(0); opacity: 0; } }
        .splash i { animation-name: sply; }
        .splash em { position: absolute; left: 0; bottom: 0; width: 0; height: 0;
                     animation: splx var(--spd, 1.1s) linear infinite var(--spdl, 0s); }
        .splash em i { position: absolute; left: 0; bottom: 0; width: 2.2px; height: 2.2px;
                    border-radius: 50%; background: rgba(224, 236, 248, .95); opacity: 0;
                    animation: sply var(--spd, 1.1s) infinite var(--spdl, 0s); }
        @keyframes splx { 0%, 35% { transform: translateX(0); }
                          100% { transform: translateX(var(--dx, 12px)); } }
        @keyframes sply {
          0%, 35% { transform: translateY(-1px); opacity: 0; }
          36% { opacity: var(--so, .85); animation-timing-function: ease-out; }
          55% { transform: translateY(calc(-1 * var(--pk, 4px))); animation-timing-function: ease-in; }
          100% { transform: translateY(var(--sh, 14px)); opacity: 0; } }
        /* hailstones: a pellet dives in, then BOUNCES off the rim - big hop,
         * smaller second hop, sideways drift - sleet scenes only */
        .hstone { position: absolute; bottom: 0; width: 0; height: 0; display: none; }
        .sky.hail .hstone, .sky.night-hail .hstone { display: block; }
        .hstone b { position: absolute; left: -1.75px; bottom: 0; width: 3.5px; height: 3.5px;
                    border-radius: 50%; background: rgba(240, 248, 255, .95); opacity: 0;
                    animation: hsin var(--spd, 1.2s) infinite var(--spdl, 0s); }
        @keyframes hsin {
          0% { transform: translateY(calc(-1 * var(--fh, 100px))); opacity: 0; animation-timing-function: cubic-bezier(.4, 0, .9, .6); }
          4% { opacity: var(--so, .85); }
          28% { opacity: var(--so, .85); }
          30% { transform: translateY(0); opacity: 0; }
          100% { transform: translateY(0); opacity: 0; } }
        .hstone em { position: absolute; left: 0; bottom: 0; width: 0; height: 0;
                     animation: hsx var(--spd, 1.2s) linear infinite var(--spdl, 0s); }
        .hstone em i { position: absolute; left: -1.75px; bottom: 0; width: 3.5px; height: 3.5px;
                       border-radius: 50%; background: rgba(240, 248, 255, .95); opacity: 0;
                       animation: hsb var(--spd, 1.2s) infinite var(--spdl, 0s); }
        @keyframes hsx { 0%, 30% { transform: translateX(0); }
                         100% { transform: translateX(var(--dx, 10px)); } }
        /* snow settling: a flake wobbles down, lands, and a small cap
         * accumulates on the rim - lingers, then melts - snow scenes only */
        .sflake { position: absolute; bottom: 0; width: 0; height: 0; display: none; }
        .sky.snow .sflake, .sky.night-snow .sflake { display: block; }
        .sflake b { position: absolute; left: -2.25px; bottom: 0; width: 4.5px; height: 4.5px;
                    border-radius: 50%; background: rgba(244, 250, 255, .9); opacity: 0;
                    animation: sfin var(--spd, 5s) linear infinite var(--spdl, 0s); }
        @keyframes sfin {
          0% { transform: translate(var(--wx, 6px), calc(-1 * var(--fh, 90px))); opacity: 0; }
          6% { opacity: var(--so, .8); }
          20% { transform: translate(calc(-1 * var(--wx, 6px)), calc(-0.55 * var(--fh, 90px))); }
          38% { opacity: var(--so, .8); }
          40% { transform: translate(0px, 0px); opacity: 0; }
          100% { transform: translate(0px, 0px); opacity: 0; } }
        .sflake i { position: absolute; left: calc(-0.5 * var(--cw, 7px)); bottom: -5px;
                    width: var(--cw, 7px); height: var(--ch, 3px);
                    border-radius: var(--ch, 3px) var(--ch, 3px) 1px 1px;
                    background: rgba(246, 251, 255, .58); opacity: 0; transform-origin: bottom;
                    animation: scap var(--spd, 5s) infinite var(--spdl, 0s); }
        @keyframes scap {
          0%, 39% { transform: scaleY(.2); opacity: 0; }
          42% { transform: scaleY(1); opacity: var(--co, .85); }
          88% { transform: scaleY(1); opacity: var(--co, .85); }
          100% { transform: scaleY(.55); opacity: 0; } }
        @keyframes hsb {
          0%, 30% { transform: translateY(0); opacity: 0; }
          31% { opacity: var(--so, .85); animation-timing-function: ease-out; }
          48% { transform: translateY(calc(-1 * var(--pk1, 11px))); animation-timing-function: ease-in; }
          62% { transform: translateY(0); animation-timing-function: ease-out; }
          73% { transform: translateY(calc(-0.35 * var(--pk1, 11px))); animation-timing-function: ease-in; }
          82% { transform: translateY(0); }
          100% { transform: translateY(3px); opacity: 0; } }

        .sky.rain .splash, .sky.pour .splash, .sky.storm .splash, .sky.sleet .splash,
        .sky.night-rain .splash, .sky.night-pour .splash, .sky.night-storm .splash,
        .sky.night-sleet .splash, .sky.hail .splash, .sky.night-hail .splash { display: block; }
        .sky.windy .leaves, .sky.night-windy .leaves { display: block; }
        /* Wind: leaves tumble across (negative delays = always some
         * mid-flight), and the content shudders once per cycle. */
        .layer.leaves { z-index: 4; }
        .leaf { position: absolute; left: 100%; opacity: 0;
                animation: lfly var(--ld, 5s) linear infinite var(--ldl, 0s); }
        @keyframes lfly {
          0% { transform: translateX(40px); opacity: 0; }
          6% { opacity: var(--lo, .85); }
          90% { opacity: var(--lo, .85); }
          100% { transform: translateX(-1340px); opacity: 0; } }
        .lbob { animation: lbob var(--bd, 1.2s) ease-in-out infinite alternate var(--bdl, 0s); }
        @keyframes lbob {
          from { transform: translateY(calc(-1 * var(--ba, 9px))) rotate(-9deg); }
          to { transform: translateY(var(--ba, 9px)) rotate(9deg); } }
        .lspin { animation: lspin var(--srd, 1.4s) linear infinite var(--srdl, 0s); }
        @keyframes lspin { to { transform: rotate(360deg); } }
        .leaf svg { display: block; filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)); }
        .sky.storm .flash, .sky.night-storm .flash { display: block; }
        .sky.windy .cloud, .sky.night-windy .cloud { animation-duration: calc(var(--dur, 90s) / 3); }

        /* --- info overlay --- */
        .content { position: relative; z-index: 5; padding: 18px 20px 14px;
                   color: #fff;
                   text-shadow: 0 1px 3px rgba(0,0,0,.55), 0 2px 12px rgba(0,0,0,.35);
                   font-family: inherit; display: flex; flex-direction: column;
                   min-height: 440px; box-sizing: border-box; }
        .clockrow { display: flex; align-items: baseline; justify-content: space-between; }
        .city { font-size: 16px; font-weight: 600; letter-spacing: .4px;
                opacity: .95; margin-bottom: 4px; }
        .clock { font-size: 44px; font-weight: 300; letter-spacing: .5px; line-height: 1; }
        .clock .ampm { font-size: 17px; font-weight: 600; margin-left: 6px; }
        .datel { font-size: 14.5px; opacity: .92; margin-top: 5px; }
        .hero { text-align: center; margin-top: 4px; }
        .hero .city { margin-bottom: 0; }
        .bigtemp { font-size: 66px; font-weight: 300; line-height: 1.02; letter-spacing: -1px; }
        .bigcond { font-size: 17px; font-weight: 600; opacity: .96; margin-top: 2px; }
        .hilo { font-size: 15px; opacity: .95; margin-top: 3px; }
        .spacer { flex: 1; min-height: 8px; }
        .hslots { display: contents; }
        .hourly { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px;
                  background: rgba(10,16,32,.28); backdrop-filter: blur(10px);
                  -webkit-backdrop-filter: blur(10px); border-radius: 14px;
                  padding: 10px 12px; margin-bottom: 10px;
                  box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
        .hourly .h { text-align: center; min-width: 0; }
        .hourly .hl { font-size: 12.5px; font-weight: 600; opacity: .9; }
        .hourly svg { width: 24px; height: 24px; display: block; margin: 5px auto 3px; }
        .hourly .ht { font-size: 14px; font-weight: 600; }
        .hourly .ht.evt { font-size: 12px; letter-spacing: .2px; }
        .fc { display: grid; grid-template-columns: 48px 30px 42px 1fr 42px;
              gap: 9px 12px; align-items: center; align-content: space-evenly;
              background: rgba(10,16,32,.28); backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              border-radius: 14px; padding: 10px 14px;
              box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
        .fc .day { font-size: 15px; font-weight: 600; opacity: .95; }
        .fc svg { width: 26px; height: 26px; display: block; }
        .fc .lo { font-size: 14px; opacity: .8; text-align: right; }
        .fc .hi { font-size: 14px; font-weight: 600; }
        .fc .track { position: relative; height: 22px; border-radius: 11px;
                     background: rgba(12,18,34,.38); }
        .fc .fill { position: absolute; top: 0; bottom: 0; border-radius: 11px;
                    box-shadow: inset 0 0 0 2px rgba(6,9,15,.5); }
        .fc .now { position: absolute; top: 50%; width: 16px; height: 16px;
                   margin: -8px 0 0 -8px; border-radius: 50%; background: #fff;
                   box-shadow: 0 0 0 2px rgba(255,255,255,.95), 0 1px 3px rgba(0,0,0,.4); }
        @media (prefers-reduced-motion: reduce) {
          .sky * { animation: none !important; }
        }
        .noanim * { animation: none !important; }
      </style>
      <ha-card>
        <div class="sky">
          <div class="layer stars"></div>
          <div class="sun"><div class="bloom"></div><div class="warm"></div><div class="spikes"><div class="spike"></div><div class="spike s2"></div><div class="spike s3"></div><div class="spike s4"></div></div><div class="streak"></div><div class="core"></div></div>
          <div class="layer ghosts"><div class="ghost g1"></div><div class="ghost g2"></div><div class="ghost g3"></div></div>
          <div class="moon"><div class="shade"></div></div>
          <div class="layer clouds"></div>
          <div class="layer shafts"></div>
          <div class="layer rain"></div>
          <div class="layer snow"></div>
          <div class="layer fog"></div>
          <div class="layer flash"></div>
          <svg class="layer bolts" viewBox="0 0 1000 520" preserveAspectRatio="none"><g class="boltg g1"></g><g class="boltg g2"></g></svg>
          <div class="layer leaves"></div>
          <div class="content">
            <div class="clockrow">
              <div>
                <div class="clock"></div>
                <div class="datel"></div>
              </div>
            </div>
            <div class="hero">
              <div class="city"></div>
              <div class="bigtemp"></div>
              <div class="bigcond"></div>
              <div class="hilo"></div>
            </div>
            <div class="spacer"></div>
            <div class="hourly"><div class="hslots"></div><div class="splashrow"></div></div>
            <div class="fc"></div>
          </div>
        </div>
      </ha-card>
    `;
    const q = (x) => this.shadowRoot.querySelector(x);
    // forecast_rows: 0 = compact card (sky + hero + hourly only, tighter)
    const compact = Number(this._config.forecast_rows) === 0;
    if (compact) {
      q(".fc").style.display = "none";
      // equal breathing room: sides are 20px, so bottom = 20px too
      // (default is 14px content padding + 10px hourly margin = 24px)
      q(".content").style.paddingBottom = "20px";
      q(".hourly").style.marginBottom = "0";
    }
    const hh = Number(this._config.height) || (compact ? 355 : 440);
    q(".sky").style.minHeight = hh + "px";
    q(".content").style.minHeight = hh + "px";
    this._els = {
      sky: q(".sky"), sun: q(".sun"), moon: q(".moon"), stars: q(".stars"),
      clouds: q(".clouds"), rain: q(".rain"), snow: q(".snow"), fog: q(".fog"),
      leaves: q(".leaves"), hslots: q(".hslots"), splashrow: q(".splashrow"),
      ghosts: [q(".ghost.g1"), q(".ghost.g2"), q(".ghost.g3")],
      shafts: q(".shafts"),
      flash: q(".flash"), clock: q(".clock"), datel: q(".datel"), city: q(".city"),
      bigtemp: q(".bigtemp"), bigcond: q(".bigcond"), hilo: q(".hilo"), hourly: q(".hourly"),
      fc: q(".fc"),
    };
    // stars: fixed random field, upper 60%
    const rnd = (a, b) => a + Math.random() * (b - a);
    let stars = "";
    for (let i = 0; i < 46; i++) {
      stars += `<div class="star" style="left:${rnd(1, 99).toFixed(1)}%;top:${rnd(2, 60).toFixed(1)}%;` +
        `animation-delay:-${rnd(0, 4).toFixed(2)}s;opacity:${rnd(0.4, 1).toFixed(2)};` +
        `transform:scale(${rnd(0.6, 1.6).toFixed(2)})"></div>`;
    }
    this._els.stars.innerHTML = stars;
    this._buildClouds();
    this._startCamera();

    // wind leaves: continuous ambient stream; negative delays keep some
    // always mid-flight (and make them capturable in the frozen harness)
    const LEAF_C = ["#C98A3B", "#A9752F", "#8FA653", "#B5541F", "#97A83E", "#C7A14A"];
    let leaves = "";
    for (let i = 0; i < 9; i++) {
      const sz = rnd(5, 9).toFixed(0);
      const ld = rnd(3.6, 6.5);
      leaves += `<div class="leaf" style="top:${rnd(10, 68).toFixed(1)}%;--ld:${ld.toFixed(2)}s;` +
        `--ldl:-${rnd(0, ld).toFixed(2)}s;--lo:${rnd(0.7, 0.95).toFixed(2)}">` +
        `<div class="lbob" style="--bd:${rnd(0.9, 1.7).toFixed(2)}s;--bdl:-${rnd(0, 1.7).toFixed(2)}s;` +
        `--ba:${rnd(6, 14).toFixed(0)}px">` +
        `<div class="lspin" style="--srd:${rnd(0.9, 2.2).toFixed(2)}s;--srdl:-${rnd(0, 2).toFixed(2)}s;` +
        `animation-direction:${rnd(0, 1) < 0.5 ? "normal" : "reverse"}">` +
        `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}">` +
        `<path d="M12 2 C 18 6, 20 14, 12 22 C 4 14, 6 6, 12 2 Z" fill="${LEAF_C[i % 6]}"/>` +
        `<path d="M12 4 L 12 20" stroke="rgba(60,30,0,.35)" stroke-width="1.2" fill="none"/>` +
        `</svg></div></div></div>`;
    }
    this._els.leaves.innerHTML = leaves;
    // rim impact sites: built ONCE - a per-hass rebuild would restart the
    // animations and the slower phases (snow caps) would never appear
    let spl = "";
    for (let i = 0; i < 16; i++) {
      const sgn = Math.random() < 0.5 ? -1 : 1;
      spl += `<div class="splash" style="left:${(2 + Math.random() * 96).toFixed(1)}%;` +
        `--dx:${(sgn * (8 + Math.random() * 12)).toFixed(1)}px;` +
        `--pk:${(2 + Math.random() * 4).toFixed(1)}px;--sh:${(10 + Math.random() * 8).toFixed(0)}px;` +
        `--fh:${(80 + Math.random() * 60).toFixed(0)}px;--dln:${(12 + Math.random() * 6).toFixed(0)}px;` +
        `--fo:${(0.55 + Math.random() * 0.25).toFixed(2)};` +
        `--spd:${(0.9 + Math.random() * 0.5).toFixed(2)}s;--spdl:-${(Math.random() * 1.4).toFixed(2)}s;` +
        `--so:${(0.6 + Math.random() * 0.3).toFixed(2)}"><b></b><em><i></i></em></div>`;
    }
    for (let i = 0; i < 9; i++) {
      const hsgn = Math.random() < 0.5 ? -1 : 1;
      spl += `<div class="hstone" style="left:${(3 + Math.random() * 94).toFixed(1)}%;` +
        `--dx:${(hsgn * (6 + Math.random() * 10)).toFixed(1)}px;` +
        `--fh:${(70 + Math.random() * 60).toFixed(0)}px;--pk1:${(8 + Math.random() * 7).toFixed(1)}px;` +
        `--spd:${(1.0 + Math.random() * 0.5).toFixed(2)}s;--spdl:-${(Math.random() * 1.5).toFixed(2)}s;` +
        `--so:${(0.7 + Math.random() * 0.25).toFixed(2)}"><b></b><em><i></i></em></div>`;
    }
    for (let i = 0; i < 13; i++) {
      spl += `<div class="sflake" style="left:${(2 + Math.random() * 96).toFixed(1)}%;` +
        `--fh:${(70 + Math.random() * 50).toFixed(0)}px;--wx:${(3 + Math.random() * 6).toFixed(1)}px;` +
        `--cw:${(8 + Math.random() * 6).toFixed(1)}px;--ch:${(3.2 + Math.random() * 1.6).toFixed(1)}px;` +
        `--spd:${(4.5 + Math.random() * 3).toFixed(2)}s;--spdl:-${(Math.random() * 7).toFixed(2)}s;` +
        `--so:${(0.65 + Math.random() * 0.25).toFixed(2)};--co:${(0.5 + Math.random() * 0.15).toFixed(2)}"><b></b><i></i></div>`;
    }
    this._els.splashrow.innerHTML = spl;
    // rain drops + snow flakes + fog bands (visibility gated by scene class)
    let drops = "";
    for (let i = 0; i < 82; i++) {
      const hv = i >= 44 ? " hv" : "";
      drops += `<div class="drop${hv}" style="left:${rnd(0, 100).toFixed(1)}%;height:${rnd(13, 22).toFixed(0)}px;` +
        `--dur:${rnd(0.65, 1.05).toFixed(2)}s;animation-delay:-${rnd(0, 1.1).toFixed(2)}s;opacity:${rnd(0.3, 0.65).toFixed(2)}"></div>`;
    }
    this._els.rain.innerHTML = drops;
    let flakes = "";
    for (let i = 0; i < 34; i++) {
      flakes += `<div class="flake" style="left:${rnd(0, 100).toFixed(1)}%;--dur:${rnd(5, 9).toFixed(1)}s;` +
        `animation-delay:-${rnd(0, 8).toFixed(1)}s;opacity:${rnd(0.4, 0.95).toFixed(2)};` +
        `transform:scale(${rnd(0.6, 1.3).toFixed(2)})"></div>`;
    }
    this._els.snow.innerHTML = flakes;
    let bands = "";
    for (let i = 0; i < 3; i++) {
      bands += `<div class="fogband" style="top:${28 + i * 22}%;--dur:${rnd(40, 75).toFixed(0)}s;` +
        `animation-delay:-${rnd(0, 30).toFixed(0)}s"></div>`;
    }
    this._els.fog.innerHTML = bands;
    this._built = true;
    this._startTimers();
    this._renderClock();
  }

  get _s() { return this._hass && this._config ? this._hass.states[this._config.entity] : undefined; }
  /* Condition from a real OBSERVER entity when configured (current_entity);
   * temperature stays with the primary (locally-modelled) entity. */
  get _curCond() {
    if (this._config && this._config.demo) return this._config.demo;
    const ce = this._config ? this._config.current_entity : null;
    const st = ce && this._hass ? this._hass.states[ce] : null;
    if (st && st.state && !["unavailable", "unknown"].includes(st.state)) return st.state;
    const s = this._s;
    return s ? s.state : "cloudy";
  }
  get _sun() { return this._hass ? this._hass.states["sun.sun"] : undefined; }

  /* Displayed values always come from the provider; the unit is only needed
   * to place them on the colour scale. */
  get _unit() {
    const s = this._s;
    const attr = s && s.attributes ? s.attributes.temperature_unit : null;
    if (attr) return attr;
    const c = this._hass && this._hass.config;
    const us = c && c.unit_system;
    return (us && us.temperature) || "°F";
  }

  /* Below the equator the sun and moon cross the northern sky. */
  get _south() {
    const c = this._hass && this._hass.config;
    return !!c && Number(c.latitude) < 0;
  }

  _renderClock() {
    if (!this._els) return;
    const now = new Date();
    const locale = wxLocale(this._hass, this._config);
    const h12 = wxHour12(this._hass, this._config);
    const opts = { hour: "numeric", minute: "2-digit" };
    if (h12 !== undefined) opts.hour12 = h12;
    // split via Intl parts: some locales omit the day period, some lead with
    // it, and not all separate it with a space
    let head = "", suffix = "";
    try {
      for (const p of new Intl.DateTimeFormat(locale, opts).formatToParts(now)) {
        if (p.type === "dayPeriod") suffix += p.value;
        else if (!(p.type === "literal" && !head)) head += p.value;
      }
      head = head.trim();
    } catch (e) { head = now.toLocaleTimeString(locale, opts); suffix = ""; }
    this._els.clock.innerHTML = suffix
      ? head + `<span class="ampm">${suffix}</span>` : head;
    this._els.datel.textContent = now.toLocaleDateString(locale,
      { weekday: "long", month: "long", day: "numeric" });
    const loc = this._hass && this._hass.config ? this._hass.config.location_name : "";
    this._els.city.textContent = this._config.city || (loc && loc !== "Home" ? loc : "");
  }

  _render() {
    if (!this._els) return;
    const s = this._s;
    const sun = this._sun;
    const elev = sun ? Number(sun.attributes.elevation) : null;
    const az = sun ? Number(sun.attributes.azimuth) : 180;
    const cond = this._curCond;
    const night = elev != null ? elev < -4 : false;

    this._els.sky.classList.toggle("noanim", this._config.animation === false);

    // sky gradient
    const [top, mid, hor] = wxSkyPalette(elev, cond);
    this._els.sky.style.background =
      `linear-gradient(180deg, ${top} 0%, ${mid} 55%, ${hor} 100%)`;

    // sun placement
    const pos = wxSunPos(elev, az, this._south);
    if (pos) {
      this._els.sun.style.left = pos.x + "%";
      this._els.sun.style.top = pos.y + "%";
      this._els.sun.style.display = "";
      this._els.sun.style.setProperty("--warm", wxWarm(elev).toFixed(2));
    } else {
      this._els.sun.style.display = "none";
    }
    // lens ghosts: only in clear/partly skies, on the sun->centre axis
    const ghostsOn = !!pos && !night && /^(sunny|clear|partlycloudy)$/.test(cond);
    this._els.ghosts.forEach((g, i) => {
      if (!ghostsOn) { g.style.display = "none"; return; }
      const gp = wxGhostPos(pos, [1.45, 1.8, 2.25][i]);
      g.style.left = gp.x.toFixed(1) + "%";
      g.style.top = gp.y.toFixed(1) + "%";
      g.style.display = "block";
    });

    // scene class swap (only when it changes, so animations don't restart)
    const scene = wxScene(cond, night);
    if (scene !== this._sceneKey) {
      const classes = ["clear", "partly", "cloudy", "rain", "pour", "storm", "snow",
        "sleet", "hail", "fog", "windy", "severe"].flatMap((c) => [c, "night-" + c]);
      this._els.sky.classList.remove(...classes);
      this._els.sky.classList.add(...scene.split(" "));
      this._sceneKey = scene;
      this._sceneOnly = scene;
      // lightning: random flashes while a storm scene is active
      clearInterval(this._boltTimer); this._boltTimer = 0;
      if (/storm/.test(scene) && this._config.animation !== false) {
        this._boltAlt = 0;
        this._boltTimer = setInterval(() => {
          if (Math.random() < 0.7) {
            const groups = this.shadowRoot.querySelectorAll(".boltg");
            const strike = (g, delay) => setTimeout(() => {
              g.innerHTML = wxBoltSvg(wxBoltTree(Math.random, 1000, 520));
              g.classList.remove("strike");
              void g.getBoundingClientRect();
              g.classList.add("strike");
            }, delay);
            if (Math.random() < 0.9) strike(groups[this._boltAlt ^= 1], 0);
            if (Math.random() < 0.35) strike(groups[this._boltAlt ^= 1], 160);
            setTimeout(() => {
              this._els.flash.classList.remove("go");
              void this._els.flash.offsetWidth;
              this._els.flash.classList.add("go");
            }, 60);
          }
        }, 2600);
      }
    }

    // wind/fog cloud rebuilds: windy = faster + sheared, fog = denser banks
    const windy = /windy/.test(scene);
    const foggy = /fog/.test(scene);
    if (windy !== !!this._windOn || foggy !== !!this._fogDense) {
      this._windOn = windy;
      this._fogDense = foggy;
      this._windK = windy ? 1.5 : 1;
      this._windShear = windy;
      this._buildClouds();
    }

    // cloud banks: density from LIVE coverage, floored by the condition -
    // runs every render so a coverage change repaints without a scene change
    let realCover = null;
    if (!this._config.demo && this._config.coverage_entity && this._hass.states[this._config.coverage_entity]) {
      const rc = Number(this._hass.states[this._config.coverage_entity].state);
      if (isFinite(rc)) realCover = rc;
    }
    const cover = wxCoverEff(realCover,
      this._config.demo ? null : (s ? s.attributes.cloud_coverage : null), cond);
    const dark = /pour|storm|severe/.test(scene);
    const dim = !dark && /rain|sleet|hail/.test(scene);
    this._cloudScale = (this._fogDense ? 1.22 : 1) * (0.5 + 0.5 * Math.min(1, cover / 85));
    const cls = wxClusterO(cover);
    this._els.clouds.querySelectorAll(".ccl").forEach((el, i) => {
      el.style.setProperty("--o", String(cls[i] || 0));
    });
    if (this._c3d) {
      this._c3d.classList.toggle("dim", dim);
      this._c3d.classList.toggle("dark", dark);
      this._c3d.classList.toggle("hazy", /fog/.test(scene));
    }
    const ceil = wxClamp((cover - 65) / 20, 0, 1);
    const ceilc = dark ? (night ? "#22272E" : "#565E68")
      : dim ? (night ? "#3A424A" : "#9AA3AD")
        : (night ? "#4A525C" : "#DCE2E8");
    this._els.clouds.style.setProperty("--ceilo", ceil.toFixed(2));
    this._els.clouds.style.setProperty("--ceilc", ceilc);
    const sunOut = !!pos && !night && cover < 60;
    const sx = pos ? pos.x.toFixed(1) + "%" : "70%";
    const sy = pos ? pos.y.toFixed(1) + "%" : "20%";
    const ang = pos ? (90 + (pos.x - 50) * 0.55).toFixed(0) + "deg" : "115deg";
    this._els.shafts.style.setProperty("--ro", sunOut ? "0.7" : "0");
    this._els.shafts.style.setProperty("--sunx", sx);
    this._els.shafts.style.setProperty("--suny", sy);
    this._els.shafts.style.setProperty("--rayang", ang);
    this._els.sky.classList.toggle("veiled", cover >= 70);
    this._lastCover = cover;
    this._updateMoon();
    this._els.sky.classList.toggle("dusk", elev != null && elev < 10 && elev > -10);

    // hero numbers
    if (s) {
      const t = s.attributes.temperature;
      this._els.bigtemp.textContent = t != null ? Math.round(t) + "°" : "--";
      // providers report 'sunny' around the clock; after dark that reads 'Clear'
      const oc = this._curCond;
      const condLabel = night && (oc === "sunny" || oc === "clear") ? "clear-night" : oc;
      // Home Assistant already translates weather states; use its string when
      // the condition really is that entity's state (not a demo override)
      let text = "";
      const ce = this._config.current_entity;
      const st = (ce && this._hass.states[ce]) || s;
      if (!this._config.demo && st && st.state === condLabel &&
          typeof this._hass.formatEntityState === "function") {
        try { text = this._hass.formatEntityState(st); } catch (e) { text = ""; }
      }
      this._els.bigcond.textContent = text || wxLabel(condLabel);
    }
    this._renderForecast();
    this._renderHourly();
  }

  _updateMoon() {
    if (!this._els || !this._hass || !this._hass.config) return;
    const lat = this._hass.config.latitude, lng = this._hass.config.longitude;
    const el = this._els.moon;
    if (lat == null || lng == null) { el.style.display = "none"; return; }
    const mp = wxAstro.moonPos(new Date(), lat, lng);
    const cover = this._lastCover || 0;
    const pos = wxSunPos(mp.elevation, mp.azimuth, this._south);
    if (mp.elevation < -1 || cover >= 70 || !pos) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.left = pos.x + "%";
    el.style.top = pos.y + "%";
    const sunUp = this._sun && Number(this._sun.attributes.elevation) > 0;
    const ill = wxAstro.moonIllum(new Date());
    let sep = null;
    if (this._sun) {
      sep = wxAngSep(Number(this._sun.attributes.elevation), Number(this._sun.attributes.azimuth),
        mp.elevation, mp.azimuth);
    }
    const vis = wxMoonVis(ill.fraction, !!sunUp, sep);
    if (vis <= 0.02) { el.style.display = "none"; return; }
    el.style.opacity = String(vis);
    const shift = (ill.fraction * 62) * (ill.waxing ? -1 : 1);
    el.style.setProperty("--mshift", shift.toFixed(0) + "px");
  }

  _renderHourly() {
    if (!this._els || !this._hourly || !this._hourly.length) return;
    const now = Date.now();
    const upcoming = this._hourly.filter((h) => new Date(h.datetime).getTime() > now - 3600e3);
    // sun events (sunset/sunrise) slot in at their true chronological position
    const sun = this._sun;
    const events = [];
    if (sun) {
      const sunsetWord = wxT(this._hass,
        ["ui.card.sun.setting", "ui.panel.lovelace.editor.card.sun.sunset"], "Sunset");
      const sunriseWord = wxT(this._hass,
        ["ui.card.sun.rising", "ui.panel.lovelace.editor.card.sun.sunrise"], "Sunrise");
      for (const [attr, kind, icon] of [["next_setting", sunsetWord, "sunset"],
                                        ["next_rising", sunriseWord, "sunrise"]]) {
        const t = new Date(sun.attributes[attr] || 0).getTime();
        if (t > now) events.push({ t, kind, icon });
      }
      events.sort((x, y) => x.t - y.t);
    }
    const riseT = sun ? new Date(sun.attributes.next_rising || 0).getTime() : 0;
    const setT = sun ? new Date(sun.attributes.next_setting || 0).getTime() : 0;
    const slots = [];
    let ei = 0;
    // "Now" is synthesized from the LIVE observation (like Apple): providers
    // like open-meteo start their hourly list at the NEXT full hour, so the
    // present moment simply is not in the forecast data.
    const cs = this._s;
    if (cs && cs.attributes.temperature != null) {
      slots.push({ nowcast: { condition: this._curCond, temperature: cs.attributes.temperature } });
    }
    // drop a current-hour entry if the provider DID include one - Now covers it
    while (upcoming.length && new Date(upcoming[0].datetime).getTime() <= now) {
      upcoming.shift();
    }
    // events (sunset/sunrise) that fall BEFORE the first forecast hour
    const firstT = upcoming.length ? new Date(upcoming[0].datetime).getTime() : Infinity;
    while (ei < events.length && events[ei].t < firstT && slots.length < 7) {
      slots.push({ ev: events[ei] });
      ei++;
    }
    for (let i = 0; i < upcoming.length && slots.length < 7; i++) {
      const h = upcoming[i];
      const ht = new Date(h.datetime).getTime();
      const nt = upcoming[i + 1] ? new Date(upcoming[i + 1].datetime).getTime() : ht + 3600e3;
      slots.push({ hour: h });
      while (ei < events.length && events[ei].t >= ht && events[ei].t < nt && slots.length < 7) {
        slots.push({ ev: events[ei] });
        ei++;
      }
    }
    const locale = wxLocale(this._hass, this._config);
    const h12 = wxHour12(this._hass, this._config);
    const nowWord = wxT(this._hass, ["ui.card.weather.forecast_now", "ui.common.now"], "Now");
    this._els.hslots.innerHTML = slots.slice(0, 7).map((sl) => {
      if (sl.ev) {
        const d = new Date(sl.ev.t);
        const lbl = wxTimeLabel(d, locale, h12);
        return `<div class="h"><div class="hl">${lbl}</div>` +
          `<svg viewBox="0 0 24 24">${WX_ICONS[sl.ev.icon]}</svg>` +
          `<div class="ht evt">${sl.ev.kind}</div></div>`;
      }
      if (sl.nowcast) {
        const nightNow = wxIsNightAt(now, riseT, setT);
        return `<div class="h"><div class="hl">${nowWord}</div>` +
          `<svg viewBox="0 0 24 24">${WX_ICONS[wxIconFor(sl.nowcast.condition, nightNow)]}</svg>` +
          `<div class="ht">${Math.round(sl.nowcast.temperature)}°</div></div>`;
      }
      const d = new Date(sl.hour.datetime);
      const lbl = wxHourLabel(d, locale, h12);
      const nightAt = wxIsNightAt(d.getTime(), riseT, setT);
      return `<div class="h"><div class="hl">${lbl}</div>` +
        `<svg viewBox="0 0 24 24">${WX_ICONS[wxIconFor(sl.hour.condition, nightAt)]}</svg>` +
        `<div class="ht">${Math.round(sl.hour.temperature)}°</div></div>`;
    }).join("");
  }

  _renderForecast() {
    if (!this._els || !this._forecast.length) return;
    const night = this._sun ? Number(this._sun.attributes.elevation) < -4 : false;
    // compact mode still owns the hero H:L line - only the panel is skipped
    if (Number(this._config.forecast_rows) === 0) {
      const d0 = this._forecast[0];
      if (this._els.hilo) this._els.hilo.textContent =
        `H:${Math.round(d0.temperature)}°  L:${Math.round(d0.templow)}°`;
      return;
    }
    const n = wxClamp(Number(this._config.forecast_rows) || 4, 1, 6);
    const rows = this._forecast.slice(0, n).map((d) => ({
      day: new Date(d.datetime).toLocaleDateString(
        wxLocale(this._hass, this._config), { weekday: "short" }),
      cond: d.condition, hi: Math.round(d.temperature), lo: Math.round(d.templow),
    }));
    const bars = wxBars(rows);
    const unit = this._unit;
    if (rows.length && this._els.hilo) {
      this._els.hilo.textContent = `H:${rows[0].hi}°  L:${rows[0].lo}°`;
    }
    const cur = this._s ? this._s.attributes.temperature : null;
    const dot = wxNowDot(cur, rows);
    this._els.fc.innerHTML = rows.map((r, i) =>
      `<div class="day">${i === 0 ? "Today" : r.day}</div>` +
      `<svg viewBox="0 0 24 24">${WX_ICONS[wxIconFor(r.cond, i === 0 ? night : false)]}</svg>` +
      `<div class="lo">${r.lo}°</div>` +
      `<div class="track"><div class="fill" style="left:${bars[i].left.toFixed(1)}%;` +
      `width:${bars[i].width.toFixed(1)}%;background:linear-gradient(90deg,` +
      `${wxMixHex(wxTempColor(r.lo, unit), "#06090F", 0.55)} 0%,` +
      `${wxTempColor(r.lo, unit)} 24%,${wxTempColor(r.hi, unit)} 100%)"></div>` +
      (i === 0 && dot != null ? `<div class="now" style="left:clamp(10px, ${dot.toFixed(1)}%, calc(100% - 10px));` +
        `background:${wxDotColor(Number(cur), r.lo, r.hi, unit)}"></div>` : "") +
      `</div>` +
      `<div class="hi">${r.hi}°</div>`).join("");
  }
}

customElements.define("animated-sky-weather-card", AnimatedSkyWeatherCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "animated-sky-weather-card",
  name: "Animated Sky Weather Card",
  description: "A living sky: real sun position, night stars, weather scenes, clock and forecast.",
});
