# GuteAyri

A browser extension for Firefox, Zen, Chrome and Safari that reads the questions on a page, including their images, and fills in the answers using the AI provider and model you choose.

## Build

`node tools/build.mjs` makes both packages from this folder:

| Package | For | Folder to load | Zip |
|---|---|---|---|
| Firefox (Manifest V2) | Firefox, Zen | `dist/firefox` (or this folder's `manifest.json`) | `dist/guteayri-firefox-1.0.3.zip` |
| Chrome (Manifest V3) | Chrome, Edge, Brave and other Chromium browsers | `dist/chrome` | `dist/guteayri-chrome-1.0.3.zip` |
| Safari (Manifest V3) | Safari on macOS | `dist/GuteAyri.app` (built when Xcode is installed) | — |

## Install

**Firefox and Zen.** Zen is built on Firefox, so it uses the Firefox package.
- To try it right away (it stays until the browser restarts): open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `manifest.json` in this folder or in `dist/firefox`.
- To keep it installed: Firefox only keeps signed extensions. Sign it for yourself (free, private): create API keys at addons.mozilla.org → Developer Hub, run `npx web-ext sign --source-dir dist/firefox --channel=unlisted --api-key=… --api-secret=…`, and open the `.xpi` it produces in Firefox or Zen. Firefox Developer Edition and Nightly also accept the unsigned zip once `xpinstall.signatures.required` is `false` in `about:config`.

**Chrome** (and Edge, Brave):
1. Run `node tools/build.mjs`.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist/chrome` folder.
3. Chrome keeps extension shortcuts on its own page, `chrome://extensions/shortcuts`; the Shortcuts section in GuteAyri's settings links there.

Settings open automatically after installing. Pick a provider, paste a key, and press **Test connection**.

**Safari** (macOS). Safari only loads extensions that come inside a Mac app, and that app is built with Xcode:
1. Install Xcode from the App Store, open it once and accept the license, then point the command-line tools at it: `sudo xcode-select -s /Applications/Xcode.app`.
2. Run `node tools/build.mjs`. It now also makes `dist/GuteAyri.app`, signed to run on this Mac only.
3. Open `dist/GuteAyri.app` once (it only installs the extension).
4. In Safari: **Settings → Advanced → Show features for web developers**, then **Develop → Allow Unsigned Extensions** (Safari turns this off again when it quits, so repeat it after a restart).
5. **Settings → Extensions →** turn on GuteAyri and allow it on every website.
Safari doesn't let extensions change their shortcuts; the defaults apply, and the toolbar button and right-click menu work too.

## Use

| Action | Default shortcut |
|---|---|
| Fill this page | Alt+Shift+G |
| Answer the selected text | Alt+Shift+A |
| Show or hide the answer panel | Alt+Shift+H |
| Open the popup | Alt+Shift+Y |
| Fill the answers waiting for review, undo the last fills, turn auto mode on or off | not set |

Change any of them under **Settings → Shortcuts**: click a shortcut and press the new keys. The right-click menu also has **Fill this page**, **Answer “…”** for selected text, and **Answer the question in this image**.

## What it handles

- Radio buttons, checkboxes, dropdowns (single and multiple), text, number, date, time, range and color inputs, text areas
- Rich-text editors (contenteditable, TinyMCE and other editors in same-origin frames)
- Custom widgets built with ARIA roles: Google Forms–style radios and checkboxes, listboxes, searchable comboboxes, and answer buttons
- React, Vue and Angular controlled inputs, shadow DOM, and quizzes embedded in cross-origin frames
- Images attached to questions: `<img>`, `<canvas>`, inline SVG, lazy-loaded and logged-in images, with screenshot cropping as the last resort
- Formulas from KaTeX, MathJax and MathML, sent to the model as TeX
- Moodle quizzes: every core question type (multiple choice, true/false, short answer, numerical with units, calculated, matching, select missing words, Cloze, essay in TinyMCE, Atto or plain text, drag and drop into text, drag and drop onto image, drag markers, ordering) and the CodeRunner, Gap Fill, Word Select, Crossword, Formulas, STACK, Kprime, Multiple True/False and Matrix plugins. Auto mode follows a quiz page by page. Drag-and-drop answers are placed through Moodle's own keyboard and mouse handling, so what you see is what gets submitted. Not filled: essay file attachments, drawing and audio/video recording questions, and interactive GeoGebra/JSXGraph applets
- NetAcad and Skills for All assessments: multiple choice, matching with dropdowns, and matching by clicking a category and then an option. Only the question on screen is read, so earlier answers are left alone, and auto mode answers each new question as you reach it. An answer counts as filled only once the page confirms it. Undo reverts choices and earlier dropdown selections; a first dropdown selection or a category connection stays, because the player offers no way to clear them
- Other questions with nothing to fill (drag-and-drop, hotspots): the answer is shown in the panel
- Pages extensions can't enter (Firefox's PDF viewer, reader view): the popup answers from a screenshot

The answer panel's footer shows what each run cost: an estimate in dollars (Claude models priced from Anthropic's price list; OpenRouter reports its own cost; other providers show tokens only), then the tokens: input (and how much of it came from the provider's cache) and output. GuteAyri marks its instructions and your topic notes as cacheable, so later pages in a quiz pay a fraction for them.

GuteAyri never presses submit, next, Check or navigation buttons, or flags questions, and leaves passwords, search boxes and payment fields alone. **Undo** in the panel reverts every fill.

## Testing on Moodle

`test/moodle/` holds an offline copy of a real Moodle 5.1 quiz attempt with 44 questions: every core question type, plus CodeRunner, Gapfill (drag and drop, typed and dropdown), Word Select, Crossword, Formulas, Kprime, Multiple True/False, Matrix, and STACK with each of its main input types. It was recorded from a live Moodle with these plugins installed, so the page, Moodle's own JavaScript (drag and drop, TinyMCE, the Ace code editor) and STACK's answer checking all behave as they do on a real site.

1. Run `node test/moodle/serve.mjs` and open `http://localhost:8000` (another port: `PORT=8123 node test/moodle/serve.mjs`).
2. Fill the page with GuteAyri.
3. Press **Finish attempt…**. The results page marks every question against the answers Moodle itself accepted for this attempt, and shows what was submitted for anything wrong.

A wrong answer can come from the model as well as from GuteAyri, so look at what was submitted before blaming either. Essays only count as answered, since a teacher marks them in Moodle. CodeRunner code is checked against the expected function rather than run. File uploads don't work offline. The Atto editor isn't covered, because Moodle 5 no longer ships it. `test/moodle/quiz-source/` has the question definitions, to rebuild the quiz in any Moodle 5.1 site.

## Publishing

`store/LISTING.md` has everything the Chrome Web Store, Firefox Add-ons and Edge Add-ons ask for: the description, permission justifications, data disclosures and reviewer instructions. The store images are in `store/images/`, the Firefox listing metadata in `store/amo-metadata.json`, and the privacy policy in `PRIVACY.md`.

## Providers

OpenAI, ChatGPT (sign in with your plan), Anthropic, Google Gemini, OpenRouter, xAI, Groq, Mistral, DeepSeek, Ollama (local), CLIProxyAPI (local) and any OpenAI-compatible endpoint. **Load models** fetches the live model list for your key. The reasoning level is sent in each provider's own format; if a model rejects a setting, GuteAyri retries without it.

**Backup keys and fallbacks:** each provider can have backup keys, tried in order when a key is rejected, out of credit or rate-limited. Under "If … fails" in Settings, list other providers to try next, in order, each with its own model and keys. Any other failure (a provider that's down, an unreadable answer) moves on to the next provider. The answer panel shows when a backup key or fallback answered. **Settings → Log** lists every request, newest first: which provider and key answered, and which failed and why. It keeps the last 200 in this browser, with keys shortened to their last four characters.

**Using a subscription instead of an API key:**
- **ChatGPT**: pick ChatGPT and press **Continue with ChatGPT**. This is OpenAI's official [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) for open-source and local apps. Requests count against your ChatGPT plan (Plus shares its five-hour limit with Codex and other apps; Pro has none). You can see and cap GuteAyri's share at [ChatGPT → Settings → Usage](https://chatgpt.com/settings/usage). The sign-in lives in the extension's own storage, apart from the settings, and GuteAyri renews it on its own.
- **CLIProxyAPI**: [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) runs on your computer and turns the accounts you sign in to through it (Gemini CLI, Codex, Qwen, iFlow, Antigravity and others) into one OpenAI-compatible endpoint. Start it, sign in with its `-login` options, pick CLIProxyAPI here, and press **Load models**. If its `config.yaml` sets `api-keys`, paste one as the key. Whether each service allows this is up to that service's terms. Anthropic's terms forbid using a Claude subscription outside Claude's own apps, so use an API key for Claude.

For Ollama, start it with `OLLAMA_ORIGINS=moz-extension://*` (Firefox, Zen) or `OLLAMA_ORIGINS=chrome-extension://*` (Chrome) so the extension can reach it.

## Files

```
manifest.json            Firefox / Zen manifest (Manifest V2)
platform/chrome/         Chrome manifest (Manifest V3); the Safari manifest is made from it
background/   providers.js (API adapters) · background.js (prompting, routing, menus, shortcuts)
              service-worker.js (Chrome entry point that loads the same scripts)
content/      scanner → images → filler → moodle (Moodle question types) → netacad (NetAcad assessments) → hud (answer panel) → main (runs, auto mode)
              page-bridge.js (Chrome and Safari: reaches page editors those browsers keep content scripts away from)
popup/        toolbar popup
options/      settings page
shared/       defaults.js (settings, providers) · chatgpt.js (Sign in with ChatGPT) · tokens.css (design tokens)
vendor/       browser-polyfill.min.js (Mozilla's webextension-polyfill, MPL-2.0: the `browser` API in Chrome)
store/        LISTING.md (store texts) · amo-metadata.json · images/ (icon, screenshots, promo tile)
tools/        build.mjs (makes dist/firefox, dist/chrome, dist/safari and, with Xcode, dist/GuteAyri.app)
test/moodle/  serve.mjs (offline Moodle test quiz and its marking) · quiz.json.gz (the recorded attempt) · quiz-source/ (question definitions)
fonts/        Barlow, Barlow Condensed (SIL Open Font License)
```
