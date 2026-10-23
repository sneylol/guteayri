// Builds the browser packages from this one source tree:
//   dist/firefox/  + dist/guteayri-firefox-<version>.zip   Firefox and Zen (Manifest V2, manifest.json)
//   dist/chrome/   + dist/guteayri-chrome-<version>.zip    Chrome, Edge, Brave (Manifest V3, platform/chrome/manifest.json)
//   dist/safari/                                           Safari web extension (Manifest V3, from the Chrome manifest)
//   dist/GuteAyri.app                                      the macOS app that carries it into Safari (needs Xcode)
// Run: node tools/build.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST = path.join(ROOT, "dist");
const SHARED = ["background", "content", "shared", "popup", "options", "icons", "fonts", "vendor"];

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const chromeManifest = readJson("platform/chrome/manifest.json");

// Safari takes the Chrome manifest without the Chrome-only keys.
const safariManifest = structuredClone(chromeManifest);
delete safariManifest.minimum_chrome_version;
for (const cs of safariManifest.content_scripts) delete cs.match_origin_as_fallback;

const TARGETS = {
  firefox: {
    manifest: readJson("manifest.json"),
    // Chrome and Safari pieces: the service-worker entry and the page bridge.
    skip: ["background/service-worker.js", "content/page-bridge.js"],
    zip: true,
  },
  chrome: { manifest: chromeManifest, skip: ["icons/icon.svg"], zip: true },
  safari: { manifest: safariManifest, skip: ["icons/icon.svg"], zip: false },
};

const version = TARGETS.firefox.manifest.version;
if (version !== chromeManifest.version) throw new Error(`Version mismatch: manifest.json ${version}, Chrome manifest ${chromeManifest.version}`);

fs.rmSync(DIST, { recursive: true, force: true });
for (const [name, t] of Object.entries(TARGETS)) {
  const out = path.join(DIST, name);
  for (const dir of SHARED) {
    fs.cpSync(path.join(ROOT, dir), path.join(out, dir), {
      recursive: true,
      filter: (src) => path.basename(src) !== ".DS_Store" && !t.skip.includes(path.relative(ROOT, src)),
    });
  }
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(t.manifest, null, 2) + "\n");
  let line = `${name}: ${path.relative(ROOT, out)}/`;
  if (t.zip) {
    const zip = path.join(DIST, `guteayri-${name}-${version}.zip`);
    execFileSync("zip", ["-qr", zip, "."], { cwd: out });
    line += `  ${path.relative(ROOT, zip)}`;
  }
  console.log(line);
}

/* Safari only loads extensions that ship inside a macOS app. Apple's converter makes the Xcode
   project and xcodebuild builds it, signed to run on this Mac only. Both come with Xcode. */
const hasXcode = (() => {
  try {
    execFileSync("xcrun", ["--find", "safari-web-extension-converter"], { stdio: "ignore" });
    execFileSync("xcodebuild", ["-version"], { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
})();
if (!hasXcode) {
  console.log("safari app: skipped (install Xcode from the App Store, open it once, then run this again)");
} else {
  const proj = path.join(DIST, "safari-xcode");
  execFileSync("xcrun", ["safari-web-extension-converter", path.join(DIST, "safari"),
    "--project-location", proj, "--app-name", "GuteAyri", "--bundle-identifier", "local.guteayri.extension",
    "--macos-only", "--copy-resources", "--no-open", "--no-prompt", "--force"], { stdio: "inherit" });
  const find = (dir, test) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (test(e.name)) return p;
      if (e.isDirectory() && !e.name.endsWith(".xcodeproj")) { const hit = find(p, test); if (hit) return hit; }
    }
    return null;
  };
  const xcodeproj = find(proj, (n) => n.endsWith(".xcodeproj"));
  const derived = path.join(proj, "build");
  execFileSync("xcodebuild", ["-project", xcodeproj, "-scheme", "GuteAyri", "-configuration", "Release", "-derivedDataPath", derived,
    "CODE_SIGN_IDENTITY=-", "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM=", "build"], { stdio: ["ignore", "ignore", "inherit"] });
  const app = find(path.join(derived, "Build", "Products"), (n) => n === "GuteAyri.app");
  fs.cpSync(app, path.join(DIST, "GuteAyri.app"), { recursive: true });
  console.log("safari app: dist/GuteAyri.app");
}
