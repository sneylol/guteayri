// GuteAyri — offline Moodle test quiz.
// Replays a quiz attempt recorded from a real Moodle 5.1 site (every core question type, the
// common question-type plugins, and STACK with each input type) and marks what gets submitted
// against the answers that Moodle itself graded correct.
//   node test/moodle/serve.mjs            then open http://localhost:8000
//   PORT=8123 node test/moodle/serve.mjs  to use another port
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";

const PORT = Number(process.env.PORT) || 8000;
const ORIGIN = `http://localhost:${PORT}`;
const RECORDED_ORIGIN = "http://localhost:8000";
const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("quiz.json.gz", import.meta.url))));

const TEXT = /^(text\/|application\/(javascript|json|x-javascript))|svg/;
function retarget(buf, type) {
  if (ORIGIN === RECORDED_ORIGIN || !TEXT.test(type || "")) return buf;
  const escaped = (s) => s.replace(/\//g, "\\/");
  return Buffer.from(buf.toString("utf8").split(RECORDED_ORIGIN).join(ORIGIN).split(escaped(RECORDED_ORIGIN)).join(escaped(ORIGIN)));
}

/* ---------- Recorded responses ---------- */

const gets = new Map(), byPath = new Map(), posts = new Map(), calls = new Map();
for (const e of archive.entries) {
  const path = e.url.split("?")[0];
  if (e.method === "GET") {
    gets.set(e.url, e);
    if (!byPath.has(path)) byPath.set(path, e);
    continue;
  }
  posts.set(e.method + " " + e.url.replace(/sesskey=[^&]+/, "") + " " + e.req, e);
  // Single web-service calls, so a call made in another batch still finds its answer.
  try {
    const reqs = JSON.parse(e.req), res = JSON.parse(Buffer.from(e.body, "base64"));
    if (Array.isArray(reqs) && Array.isArray(res)) reqs.forEach((r, i) => res[i] && calls.set(r.methodname + " " + JSON.stringify(r.args), res[i]));
  } catch (err) { /* not a web-service batch */ }
}

/* Moodle serves each JavaScript module on its own as well as in the core/first.js bundle, and a page asks for
   a single module when it needs one before the bundle has loaded. The recording only has the bundle, so cut
   single modules out of it: each one starts on its own line with define("name",. */
const modules = new Map();
{
  const bundle = archive.entries.find((e) => /^\/lib\/requirejs\.php\/[^/]+\/core\/first\.js$/.test(e.url.split("?")[0]));
  const src = bundle ? Buffer.from(bundle.body, "base64").toString("utf8") : "";
  const starts = [...src.matchAll(/(?:^|\n)define\("([^"]+)",/g)].map((m) => m.index + (m[0][0] === "\n" ? 1 : 0));
  const sections = starts.map((at, i) => [at, i + 1 < starts.length ? starts[i + 1] : src.length]);
  // A few libraries (loglevel and the like) define themselves from inside a wrapper, part-way along a line:
  // serve the whole section they sit in.
  for (const m of src.matchAll(/define\("([^"]+)",/g)) {
    const section = sections.findLast(([at]) => at <= m.index) || [0, starts[0] ?? src.length];
    if (!modules.has(m[1])) modules.set(m[1], src.slice(section[0], section[1]));
  }
}

// STACK names each validated answer after its question: learn the prefix for each attempt step.
const stackNames = new Map();
for (const [k, v] of calls) {
  if (!k.startsWith("qtype_stack_validate_input ")) continue;
  const args = JSON.parse(k.slice(k.indexOf(" ") + 1));
  const m = String(v.data && v.data.message).match(/name="([^"]+?)_(\w+)_val"/);
  if (m) stackNames.set(args.qaid, m[1]);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* YUI combo requests (theme/yui_combo.php?3.18.1/a/a.js&3.18.1/b/b.js) are built from the YUI 3.18.1 files
   Moodle ships, joined the way Moodle joins them. Their URLs carry no revision, so the browser cached them
   while the session was recorded, and which combinations a page asks for varies from load to load. */
function yuiCombo(query) {
  const parts = decodeURIComponent(query).split("&").filter(Boolean);
  const css = /\.css$/.test(parts[parts.length - 1] || "");
  let out = "";
  for (const part of parts) {
    const file = part.replace(/-(min|debug)\.js$/, ".js");
    let text = archive.yui[file] ?? archive.yui[part];
    if (text === undefined) {
      miss("missing YUI file", part);
      out += css ? `\n/* ${part} not found */\n` : `\n// Combo resource ${part} not found!\n`;
      continue;
    }
    if (css) {
      const version = part.split("/")[0];
      text = text.replace(/(\.\.\/\.\.\/\.\.\/\.\.\/assets\/skins\/sam\/)?([a-z0-9_-]+)\.(png|gif)/g, "$2.$3")
        .replace(/([a-z0-9_-]+)\.(png|gif)/g, `/theme/yui_image.php/${version}/$1.$2`);
    }
    out += text;
  }
  return { type: css ? "text/css" : "application/javascript", body: out };
}

/* Moodle asks the server to format dates with strftime patterns ("%A, %d %B %Y, %I:%M %p"). */
function strftime(format, ts) {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const day = d.toLocaleDateString("en-GB", { weekday: "long" }), month = d.toLocaleDateString("en-GB", { month: "long" });
  const h12 = d.getHours() % 12 || 12;
  const parts = {
    A: day, a: day.slice(0, 3), B: month, b: month.slice(0, 3), h: month.slice(0, 3), d: pad(d.getDate()), e: String(d.getDate()),
    m: pad(d.getMonth() + 1), Y: String(d.getFullYear()), y: pad(d.getFullYear() % 100), H: pad(d.getHours()), k: String(d.getHours()),
    I: pad(h12), l: String(h12), M: pad(d.getMinutes()), S: pad(d.getSeconds()), p: d.getHours() < 12 ? "AM" : "PM",
    P: d.getHours() < 12 ? "am" : "pm", "%": "%",
  };
  return String(format || "%d %B %Y").replace(/%([a-zA-Z%])/g, (m, c) => parts[c] ?? m);
}

/* Answers for web-service calls the recording never saw. */
function fallbackCall(r) {
  const a = r.args || {};
  switch (r.methodname) {
    case "core_get_user_dates":
      return { error: false, data: { dates: (a.timestamps || []).map((t) => strftime(t.format, t.timestamp)) } };
    case "qtype_stack_validate_input": {
      const name = `${stackNames.get(a.qaid) || "q"}_${a.name}_val`;
      return { error: false, data: { input: a.input, status: "valid", message: `<p>Your last answer was interpreted as follows: <code>${esc(a.input)}</code></p><input type="hidden" name="${esc(name)}" value="${esc(a.input)}" />` } };
    }
    case "qtype_formulas_validate_unit":
      return { error: false, data: { status: "success", detail: a.unit } };
    case "core_get_string":
      return { error: false, data: a.stringid };
    case "core_get_strings":
      return { error: false, data: (a.strings || []).map((s) => s.stringid) };
    default:
      return { error: false, data: null };
  }
}

function webService(reqBody) {
  let reqs;
  try { reqs = JSON.parse(reqBody); } catch (e) { return [{ error: true, exception: { message: "Bad request" } }]; }
  return reqs.map((r) => calls.get(r.methodname + " " + JSON.stringify(r.args)) || (miss("stand-in reply for", r.methodname + " " + JSON.stringify(r.args)), fallbackCall(r)));
}

/* ---------- Marking ---------- */

const loose = (s) => String(s).toLowerCase().replace(/\s+/g, "");
function sigFigs(s) {
  const digits = String(s).replace(/^[-+]?0*\.?0*/, "").replace(/\./g, "").replace(/e.*$/i, "");
  return digits.length;
}
function check(rule, value) {
  if (value === undefined) value = "";
  let v = rule.strip ? String(value).split(rule.strip).join("") : String(value);
  if (rule.nonempty) return v.replace(/<[^>]*>/g, "").trim() !== "";
  if (rule.eq !== undefined) return v === rule.eq;
  if (rule.ci !== undefined) return v.trim().toLowerCase() === rule.ci.toLowerCase();
  if (rule.num !== undefined) {
    const n = Number(v.trim().replace(",", "."));
    return v.trim() !== "" && Number.isFinite(n) && Math.abs(n - rule.num) <= rule.tol && (!rule.minsf || sigFigs(v.trim()) >= rule.minsf);
  }
  if (rule.any) return rule.any.some((a) => (rule.loose ? loose(a) === loose(v) : a === v));
  if (rule.regex) return new RegExp(rule.regex).test(v);
  if (rule.point) {
    const m = v.match(/(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    return !!m && Math.hypot(Number(m[1]) - rule.point[0], Number(m[2]) - rule.point[1]) <= rule.r;
  }
  if (rule.lines) {
    const got = v.split(/\n/).map(loose).filter(Boolean);
    return got.length === rule.lines.length && rule.lines.every((l) => got.includes(loose(l)));
  }
  if (rule.lastline) {
    const last = loose(v.trim().split(/\n/).pop() || "");
    return rule.lastline.every((part) => last.includes(loose(part)));
  }
  return false;
}

const IGNORE = /(_val|step_lang|:sequencecheck|:flagged|-seen|answerformat|_attachments|-submit|_ans2)$/;
const TYPE_NAMES = {
  multichoice: "Multiple choice", truefalse: "True/False", shortanswer: "Short answer", numerical: "Numerical", calculated: "Calculated",
  calculatedsimple: "Calculated simple", calculatedmulti: "Calculated multichoice", match: "Matching", randomsamatch: "Random short-answer matching",
  gapselect: "Select missing words", multianswer: "Embedded answers (Cloze)", essay: "Essay", ddwtos: "Drag and drop into text",
  ddimageortext: "Drag and drop onto image", ddmarker: "Drag markers", ordering: "Ordering", description: "Description", coderunner: "CodeRunner",
  gapfill: "Gapfill", wordselect: "Word select", crossword: "Crossword", formulas: "Formulas", kprime: "Kprime", mtf: "Multiple true/false",
  matrix: "Matrix", stack: "STACK",
};

function mark(form) {
  const rows = [];
  for (const s of archive.slots) {
    if (s.type === "description") continue;
    const prefix = `${archive.prefix}${s.slot}_`;
    const fields = Object.entries(archive.key).filter(([n]) => n.startsWith(prefix));
    const wrong = [];
    for (const [name, rule] of fields) if (!check(rule, form[name])) wrong.push({ name, got: form[name], rule });
    // A choice ticked that the key leaves out (an extra word in Word select, an extra box) is wrong too.
    for (const [name, value] of Object.entries(form)) {
      if (name.startsWith(prefix) && !IGNORE.test(name) && !archive.key[name] && (value === "on" || value === "1")) wrong.push({ name, got: value, extra: true });
    }
    const blank = fields.every(([n]) => form[n] === undefined || form[n] === "" || form[n] === "0");
    const manual = s.type === "essay";
    const status = manual ? (wrong.length ? "Not answered" : "Answered (marked by a teacher in Moodle)") : wrong.length === 0 ? "Correct" : blank ? "Not answered" : "Incorrect";
    rows.push({ s, status, wrong, ok: !manual && wrong.length === 0, manual });
  }
  return rows;
}

function ruleText(r) {
  if (!r) return "";
  if (r.extra) return "should not be selected";
  r = r.rule || r;
  if (r.eq !== undefined) return `expected ${JSON.stringify(r.eq)}`;
  if (r.ci !== undefined) return `expected ${JSON.stringify(r.ci)}`;
  if (r.num !== undefined) return `expected ${r.num}${r.minsf ? ` (at least ${r.minsf} significant figures)` : ""}`;
  if (r.any) return `expected one of ${r.any.map((a) => JSON.stringify(a)).join(", ")}`;
  if (r.point) return `expected within ${r.r}px of ${r.point.join(",")}`;
  if (r.lines) return `expected the lines ${r.lines.map((l) => JSON.stringify(l)).join(", ")}`;
  if (r.lastline) return `expected a final line with ${r.lastline.join(" and ")}`;
  if (r.regex) return `expected to match /${r.regex}/`;
  if (r.nonempty) return "expected an answer";
  return "";
}

function resultsPage(rows) {
  const marked = rows.filter((r) => !r.manual);
  const correct = marked.filter((r) => r.ok).length;
  const essays = rows.filter((r) => r.manual);
  const answered = essays.filter((r) => !r.wrong.length).length;
  const body = rows.map((r) => {
    const details = r.wrong.map((w) => `<li><code>${esc(w.name.replace(archive.prefix, "q:"))}</code> was ${w.got === undefined ? "<em>not sent</em>" : `<code>${esc(String(w.got).slice(0, 200))}</code>`}, ${esc(ruleText(w))}</li>`).join("");
    const cls = r.manual ? (r.wrong.length ? "bad" : "manual") : r.ok ? "ok" : "bad";
    return `<tr class="${cls}"><td>${esc(r.s.number)}</td><td>${esc(r.s.name || TYPE_NAMES[r.s.type] || r.s.type)}</td><td>${esc(r.status)}${details ? `<ul>${details}</ul>` : ""}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Moodle test results</title>
<style>
  :root { --ink: #1d2125; --muted: #5f6b77; --ok: #1b7a3a; --bad: #b3261e; --manual: #6a4fa3; --rule: #dee2e6; --bg: #fff; --head: #f5f6f8; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e8eaed; --muted: #a0a8b2; --ok: #6fcf8f; --bad: #ff8a80; --manual: #c3a6ff; --rule: #3a3f45; --bg: #1b1d20; --head: #24272b; } }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  .score { font-size: 18px; margin: 0 0 4px; }
  .note { color: var(--muted); margin: 0 0 24px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { background: var(--head); font-weight: 600; }
  td:first-child { width: 3em; font-variant-numeric: tabular-nums; }
  td:nth-child(2) { width: 19em; }
  tr.ok td:last-child { color: var(--ok); } tr.bad td:last-child { color: var(--bad); } tr.manual td:last-child { color: var(--manual); }
  ul { margin: 6px 0 0; padding-left: 18px; color: var(--ink); font-size: 13.5px; }
  code { font-size: 13px; word-break: break-all; }
  a.again { display: inline-block; margin-top: 24px; padding: 8px 14px; border-radius: 6px; background: #0f6cbf; color: #fff; text-decoration: none; }
</style></head><body><main>
<h1>Moodle test results</h1>
<p class="score">${correct} of ${marked.length} questions correct · ${answered} of ${essays.length} essays answered</p>
<p class="note">Marked against the answers real Moodle 5.1 accepted for this exact attempt. Wrong answers can come from the model as well as from GuteAyri: the details show what was sent.</p>
<table><thead><tr><th>#</th><th>Question</th><th>Result</th></tr></thead><tbody>${body}</tbody></table>
<a class="again" href="/">Start again</a>
</main></body></html>`;
}

/* ---------- Server ---------- */

async function formOf(req, raw) {
  const out = {};
  const fd = await new Response(raw, { headers: { "content-type": req.headers["content-type"] || "application/x-www-form-urlencoded" } }).formData();
  for (const [k, v] of fd.entries()) out[k] = typeof v === "string" ? v : "[file]"; // the last value wins, as in PHP
  return out;
}

function send(res, status, type, buf, extra = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(buf);
}

// LOG=1 lists every request the recording couldn't answer exactly.
const miss = (what, url) => process.env.LOG && console.log(`${new Date().toISOString().slice(11, 23)} ${what} ${url.slice(0, 160)}`);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const url = req.url;
  const path = url.split("?")[0];
  try {
    if (path === "/" || path === "/index.html") return send(res, 302, "text/plain", "", { location: archive.attemptUrl });
    if (path === "/mod/quiz/attempt.php") {
      return send(res, 200, "text/html; charset=utf-8", retarget(Buffer.from(archive.attemptHtml, "base64"), "text/html"));
    }
    if (req.method === "POST" && (path === "/mod/quiz/processattempt.php" || path === "/mod/quiz/summary.php")) {
      return send(res, 200, "text/html; charset=utf-8", resultsPage(mark(await formOf(req, raw))));
    }
    if (req.method === "POST" && path === "/mod/quiz/autosave.ajax.php") return send(res, 200, "application/json", JSON.stringify({ status: "OK" }));
    if (req.method === "POST" && path === "/lib/ajax/service.php") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(webService(raw.toString())));
    if (req.method === "POST") {
      const hit = posts.get("POST " + url.replace(/sesskey=[^&]+/, "") + " " + raw.toString());
      if (hit) return send(res, hit.status, hit.type, retarget(Buffer.from(hit.body, "base64"), hit.type));
      if (path === "/repository/draftfiles_ajax.php" || path === "/repository/repository_ajax.php") {
        return send(res, 200, "application/json", JSON.stringify({ error: "File uploads aren't available in this offline copy of Moodle." }));
      }
      return send(res, 200, "application/json", "{}");
    }
    if (path === "/theme/yui_combo.php" && !gets.has(url) && archive.yui) {
      const query = url.slice(url.indexOf("?") + 1);
      if (/^(3\.\d+\.\d+|2in3)\//.test(query)) {
        const { type, body } = yuiCombo(query);
        return send(res, 200, type, Buffer.from(body));
      }
    }
    const module = !gets.has(url) && path.match(/^\/lib\/requirejs\.php\/[^/]+\/(.+)\.js$/);
    if (module && modules.has(module[1])) {
      return send(res, 200, "application/javascript; charset=utf-8", retarget(Buffer.from(modules.get(module[1])), "application/javascript"));
    }
    // Same file, different query: fine for most URLs, but a combo or web-service URL's query is its content.
    const hit = gets.get(url) || (path === "/lib/ajax/service-nologin.php" || path === "/theme/yui_combo.php" ? null : byPath.get(path));
    if (!gets.has(url)) miss(hit ? "same path as" : "not recorded", url);
    if (hit) return send(res, hit.status, hit.type, retarget(Buffer.from(hit.body, "base64"), hit.type), { "cache-control": "max-age=3600" });
    if (path === "/lib/ajax/service-nologin.php") {
      const args = new URL(url, ORIGIN).searchParams.get("args");
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(webService(args || "[]")));
    }
    return send(res, 404, "text/html; charset=utf-8", `<!doctype html><title>Not in the test copy</title><p>This page isn't part of the offline Moodle test quiz. <a href="/">Back to the quiz</a></p>`);
  } catch (err) {
    console.error(err);
    send(res, 500, "text/plain", String(err && err.stack || err));
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Moodle test quiz (${archive.slots.filter((s) => s.type !== "description").length} questions) at ${ORIGIN}`);
  console.log("Run GuteAyri on it, then press Finish attempt to see the marks.");
});
