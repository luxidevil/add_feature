// Real-identity generator: pulls real residential addresses from OpenStreetMap
// (Overpass API, free, no key) for a pool of Manhattan ZIPs, caches them, and
// pairs them with realistic names/emails/phones whose area code matches the ZIP.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Manhattan residential ZIPs with bounding boxes [south, west, north, east].
const ZIPS = {
  "10009": { city: "New York", state: "NY", bbox: [40.720, -73.989, 40.732, -73.973] }, // East Village
  "10003": { city: "New York", state: "NY", bbox: [40.726, -73.998, 40.737, -73.984] }, // NoHo / Union Sq
  "10011": { city: "New York", state: "NY", bbox: [40.736, -74.008, 40.749, -73.992] }, // Chelsea
  "10014": { city: "New York", state: "NY", bbox: [40.730, -74.012, 40.742, -73.998] }, // West Village
  "10025": { city: "New York", state: "NY", bbox: [40.793, -73.978, 40.808, -73.960] }, // Upper West Side
  "10128": { city: "New York", state: "NY", bbox: [40.778, -73.961, 40.789, -73.944] }, // Upper East Side
};

const NYC_AREA_CODES = ["212", "646", "917", "332"];
const FIRST_NAMES = ["James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda","David","Elizabeth","William","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen","Christopher","Nancy","Daniel","Lisa","Matthew","Margaret","Anthony","Betty","Mark","Sandra","Donald","Ashley","Steven","Kimberly","Paul","Emily","Andrew","Donna","Joshua","Michelle","Kenneth","Carol","Kevin","Amanda","Brian","Melissa","George","Deborah","Edward","Stephanie","Ronald","Rebecca","Timothy","Laura","Jason","Sharon","Jeffrey","Cynthia","Ryan","Kathleen","Jacob","Amy","Gary","Shirley","Nicholas","Anna","Eric","Angela","Jonathan","Helen","Stephen","Brenda","Larry","Pamela","Justin","Nicole","Scott","Samantha","Brandon","Katherine","Benjamin","Christine","Samuel","Emma","Gregory","Catherine","Alexander","Debra","Patrick","Rachel","Frank","Carolyn","Raymond","Janet","Jack","Virginia","Dennis","Maria","Jerry","Heather"];
const LAST_NAMES = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts","Gomez","Phillips","Evans","Turner","Diaz","Parker","Cruz","Edwards","Collins","Reyes","Stewart","Morris","Morales","Murphy","Cook","Rogers","Gutierrez","Ortiz","Morgan","Cooper","Peterson","Bailey","Reed","Kelly","Howard","Ramos","Kim","Cox","Ward","Richardson","Watson","Brooks","Chavez","Wood","James","Bennett","Gray","Mendoza","Ruiz","Hughes","Price","Alvarez","Castillo","Sanders","Patel","Myers","Long","Ross","Foster","Jimenez"];
const EMAIL_DOMAINS = ["gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com","aol.com","comcast.net","verizon.net","msn.com","me.com"];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = n   => Math.floor(Math.random() * n);

async function fetchAddressesForZip(zip) {
  const cachePath = path.join(DATA_DIR, `addresses_${zip}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (Array.isArray(cached) && cached.length > 50) return cached;
    } catch {}
  }
  const meta = ZIPS[zip];
  if (!meta) throw new Error(`Unknown ZIP: ${zip}`);
  const [s, w, n, e] = meta.bbox;
  const query = `
    [out:json][timeout:60];
    (
      node["addr:housenumber"]["addr:street"](${s},${w},${n},${e});
      way ["addr:housenumber"]["addr:street"](${s},${w},${n},${e});
    );
    out tags 5000;
  `;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
  ];
  let data = null, lastErr = null;
  for (const url of endpoints) {
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 30000);
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "BrainChargedAuth/1.0",
          "Accept": "application/json",
        },
        body: "data=" + encodeURIComponent(query),
        signal: ac.signal,
      });
      clearTimeout(tid);
      if (!r.ok) { lastErr = new Error(`${url} → ${r.status}`); await new Promise(s => setTimeout(s, 500)); continue; }
      data = await r.json();
      break;
    } catch (e) { lastErr = e; await new Promise(s => setTimeout(s, 500)); }
  }
  if (!data) throw lastErr || new Error("All Overpass endpoints failed");
  const seen = new Set();
  const list = [];
  for (const el of (data.elements || [])) {
    const t = el.tags || {};
    const num = (t["addr:housenumber"] || "").trim();
    const street = (t["addr:street"] || "").trim();
    if (!num || !street || !/^\d/.test(num) || street.length < 3) continue;
    const key = `${num} ${street}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ address_1: `${num} ${street}`, city: meta.city, state: meta.state, postcode: zip });
  }
  fs.writeFileSync(cachePath, JSON.stringify(list));
  return list;
}

let pool = null, poolReady = null;

async function buildPool() {
  if (pool) return pool;
  if (poolReady) return poolReady;
  poolReady = (async () => {
    const all = [];
    for (const zip of Object.keys(ZIPS)) {
      try {
        const list = await fetchAddressesForZip(zip);
        console.log(`[identity] ZIP ${zip}: ${list.length} addresses`);
        all.push(...list);
      } catch (e) {
        console.warn(`[identity] ZIP ${zip} failed: ${e.message}`);
      }
    }
    pool = all;
    return all;
  })();
  return poolReady;
}

function randomPhone() {
  const ac  = pick(NYC_AREA_CODES);
  const mid = String(200 + rand(800)).padStart(3, "0");
  const end = String(rand(10000)).padStart(4, "0");
  return `${ac}${mid}${end}`;
}

function randomEmail(first, last) {
  const f = first.toLowerCase(), l = last.toLowerCase();
  const styles = [
    () => `${f}.${l}${rand(99)}`,
    () => `${f}${l}${rand(999)}`,
    () => `${f[0]}${l}${rand(9999)}`,
    () => `${f}_${l}${rand(99)}`,
    () => `${f}${rand(99)}.${l}`,
    () => `${l}.${f}${rand(99)}`,
  ];
  return `${pick(styles)()}@${pick(EMAIL_DOMAINS)}`;
}

async function randomIdentity() {
  const list = await buildPool();
  if (!list.length) throw new Error("Address pool is empty");
  const addr  = list[rand(list.length)];
  const first = pick(FIRST_NAMES);
  const last  = pick(LAST_NAMES);
  return {
    billing_first_name: first,
    billing_last_name:  last,
    billing_email:      randomEmail(first, last),
    billing_phone:      randomPhone(),
    billing_address_1:  addr.address_1,
    billing_city:       addr.city,
    billing_state:      addr.state,
    billing_postcode:   addr.postcode,
    billing_country:    "US",
    _poolSize:          list.length,
    _zipsLoaded:        Object.keys(ZIPS).length,
  };
}

function warmPool() {
  buildPool()
    .then(p => console.log(`[identity] pool ready: ${p.length} addresses across ${Object.keys(ZIPS).length} ZIPs`))
    .catch(e => console.warn(`[identity] pool warm failed: ${e.message}`));
}

module.exports = { randomIdentity, warmPool };
