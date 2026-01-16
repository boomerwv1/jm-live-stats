// Polls Google Apps Script CSV endpoint and writes it to a local CSV file.
// run: node .\jm_titler_bridge.js

const fs = require("fs");
const path = require("path");

const GAS_BASE =
  "https://script.google.com/macros/s/AKfycbwV1gKTvh7S8sELkUR4NvXyIu5zTL95ZS2ic1kaCoWe5DygE9kKu3B-V-eqT_NJ5TzEBQ/exec";

const ACCESS_TOKEN = process.env.JM_TOKEN || "12345";

// Output file path (must match what Titler is pointed at)
// ✅ Still writes to C:\Broadcast\Data\jm_stats.csv (for NewBlue Titler)
const OUT_FILE = "C:\\Broadcast\\Data\\jm_stats.csv";

// How often to update (ms)
const INTERVAL_MS = 1000;

// Timeout per request (ms)
const FETCH_TIMEOUT_MS = 8000;

// ✅ Local image hosting (your working pattern)
const IMG_HTTP_BASE = "http://localhost:8085/Players/";
const IMG_WIN_PREFIX_1 = "C:\\Broadcast\\Players\\";
const IMG_WIN_PREFIX_2 = "C:\\Broadcast\\Players\\";
const IMG_FILE_PREFIX = "file:///C:/Broadcast/Players/"; // sometimes shows up

function buildUrl() {
  const u = new URL(GAS_BASE);
  u.searchParams.set("view", "tl_csv");
  u.searchParams.set("access_token", ACCESS_TOKEN);
  // cache buster so it always pulls fresh
  u.searchParams.set("_t", String(Date.now()));
  return u.toString();
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Atomic write: write temp file then rename
function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Rewrites any local Windows/file:// image paths anywhere in the CSV into an HTTP URL.
 * Examples:
 *  - C:\Broadcast\Players\Mya_Dunlap.jpg      -> http://localhost:8085/Players/web/Mya_Dunlap.jpg
 *  - C:\Broadcast\Players\web\Mya_Dunlap.jpg  -> http://localhost:8085/Players/web/Mya_Dunlap.jpg
 *  - file:///C:/Broadcast/Players/Mya_Dunlap.jpg -> http://localhost:8085/Players/web/Mya_Dunlap.jpg
 *
 * Leaves existing http(s) URLs unchanged.
 */
function rewriteImagePathsToHttp(csvText) {
  let s = String(csvText || "");

  // If the CSV already contains HTTP URLs, don't touch those.
  // (We still rewrite any Windows paths that appear alongside.)
  // Normalize any forward slashes in Windows paths (just in case)
  s = s.replace(/C:\/Broadcast\/Players\//gi, "C:\\Broadcast\\Players\\");

  // Rewrite file:///C:/Broadcast/Players/... -> IMG_HTTP_BASE + filename
  s = s.replace(/file:\/\/\/C:\/Broadcast\/Players\/([^,\r\n"]+)/gi, (_, tail) => {
    const filename = String(tail).split("/").pop();
    return IMG_HTTP_BASE + encodeURI(filename);
  });

  // Rewrite C:\Broadcast\Players\web\... -> IMG_HTTP_BASE + filename
  s = s.replace(/C:\\Broadcast\\Players\\web\\([^,\r\n"]+)/gi, (_, tail) => {
    const filename = String(tail).split("\\").pop();
    return IMG_HTTP_BASE + encodeURI(filename);
  });

  // Rewrite C:\Broadcast\Players\... -> IMG_HTTP_BASE + filename
  s = s.replace(/C:\\Broadcast\\Players\\([^,\r\n"]+)/gi, (_, tail) => {
    const filename = String(tail).split("\\").pop();
    return IMG_HTTP_BASE + encodeURI(filename);
  });

  return s;
}

let lastOk = Date.now();
let lastSize = 0;

async function tick() {
  const url = buildUrl();
  try {
    const csv = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);

    // ✅ Rewrite image paths to local-hosted HTTP urls
    let out = rewriteImagePathsToHttp(csv);

    // ✅ Ensure newline at end
    out = String(out || "").endsWith("\n") ? String(out || "") : String(out || "") + "\n";

    // Basic sanity check: if it *still* comes back key/value, log it loud
    const firstLine = out.split(/\r?\n/)[0].trim().toLowerCase();
    if (firstLine === "key,value") {
      process.stdout.write(
        `[WARN] ${new Date().toLocaleTimeString()} endpoint returned key/value. This is coming from Apps Script, not the bridge.\n`
      );
    }

    atomicWrite(OUT_FILE, out);

    lastOk = Date.now();
    lastSize = out.length;

    process.stdout.write(
      `[OK] ${new Date().toLocaleTimeString()} wrote ${lastSize} bytes → ${OUT_FILE}\n`
    );
  } catch (err) {
    process.stdout.write(
      `[ERR] ${new Date().toLocaleTimeString()} ${err.message || err}\n`
    );

    // Keep file alive if stale
    const since = Date.now() - lastOk;
    if (since > 15000) {
      const fallback = "status\nSTALE\n";
      try {
        atomicWrite(OUT_FILE, fallback);
      } catch {}
    }
  }
}

(async function main() {
  console.log("JM Titler Bridge starting…");
  console.log("Writing to:", OUT_FILE);
  console.log("Polling:", GAS_BASE);
  console.log("Interval(ms):", INTERVAL_MS);
  console.log("IMG_HTTP_BASE:", IMG_HTTP_BASE);

  await tick();
  setInterval(tick, INTERVAL_MS);
})();
