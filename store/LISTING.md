# GuteAyri store listing

Everything the Chrome Web Store, Firefox Add-ons (AMO) and Edge Add-ons ask for, ready to paste. The packages come from `node tools/build.mjs`:
- **Chrome and Edge:** `dist/guteayri-chrome-1.0.0.zip`
- **Firefox:** `dist/guteayri-firefox-1.0.0.zip`

Images are in `store/images/`. The privacy policy is `PRIVACY.md`, published at https://sneylol.github.io/guteayri/PRIVACY.html.

## Name

GuteAyri

## Summary (Chrome ≤ 132 characters, AMO ≤ 250)

Reads the questions on any page, including images, and fills in the answers with the AI model you choose.

## Description

GuteAyri reads the questions on the page you're looking at, including their images and formulas, and fills in answers using the AI provider and model you pick.

WHAT IT FILLS
• Multiple choice, checkboxes, dropdowns, text and number fields, text areas and rich-text editors
• Matching, drag and drop, ordering and the other question types of learning platforms such as Moodle (all core question types and common plugins like STACK, CodeRunner and Gapfill)
• Custom widgets such as Google Forms–style choices, searchable dropdowns and answer buttons
• Questions with pictures, and formulas written with KaTeX, MathJax or MathML

YOU STAY IN CONTROL
• It runs only when you press its button, its keyboard shortcut or the right-click menu, or on the sites you list for auto mode.
• Every answer appears in a side panel. Turn on "Show answers before filling them" to check them before anything changes on the page.
• Undo puts every field back the way it was.
• It never presses submit, next, finish or navigation buttons, and leaves password, search and payment fields alone.

YOUR PROVIDER, YOUR KEY
Use OpenAI, Anthropic (Claude), Google Gemini, OpenRouter, xAI, Groq, Mistral, DeepSeek, a local model through Ollama, or any OpenAI-compatible endpoint. You can also use a ChatGPT plan through Sign in with ChatGPT, or other subscriptions through a local CLIProxyAPI. Your keys and settings stay in your browser. GuteAyri has no servers, no accounts and no analytics. Page content goes only to the provider you chose.

USE IT FAIRLY
Check your school's or employer's rules before using AI on assessed work. GuteAyri can make mistakes, so review its answers before you hand anything in.

GuteAyri is not affiliated with Moodle Pty Ltd, OpenAI, Anthropic or Google.

## Category

- **Chrome:** Productivity → Tools
- **Edge:** Productivity
- **AMO:** Other

## Language

English

## Images

| File | Use |
|---|---|
| `images/icon-128.png` | Store icon (Chrome takes it from the package too) |
| `images/screenshot-1-quiz-dragdrop.png` | Screenshot: answers placed in drag-and-drop questions, with the answer panel |
| `images/screenshot-2-quiz-stack.png` | Screenshot: maths answers in STACK questions |
| `images/screenshot-3-settings.png` | Screenshot: settings overview |
| `images/screenshot-4-providers.png` | Screenshot: choosing a provider |
| `images/promo-tile-440x280.png` | Chrome small promo tile |

Screenshots are 1280×800, which Chrome requires and AMO accepts. They show a recorded Moodle quiz used for testing, answered through a scripted stand-in model.

## Privacy policy

https://sneylol.github.io/guteayri/PRIVACY.html (from `PRIVACY.md`). Firefox Add-ons stores the policy text itself: paste the text of `PRIVACY.md` there.

## Links

- **Homepage:** https://github.com/sneylol/guteayri
- **Support email:** raczpepo@gmail.com

## Chrome Web Store: Privacy practices tab

**Single purpose**

GuteAyri answers the questions on the web page the user is viewing: it sends them to the AI provider the user configured and fills the answers into the page's fields.

**Permission justifications**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings, provider API keys and Knowledge notes in the browser. |
| `tabs` | Finds the tab the user asked to answer, and opens the ChatGPT sign-in tab and the settings page. |
| `activeTab` | Reads and fills the page the user is on when they press the toolbar button, shortcut or menu item. |
| `contextMenus` | Adds "Fill this page", "Answer “…”" (for selected text) and "Answer the question in this image" to the right-click menu. |
| `clipboardWrite` | The answer panel's Copy button copies the answers. |
| `scripting` | Runs the content script in tabs that were already open when the extension was installed or updated, and in frames that need it. |
| Host permission `<all_urls>` | Quizzes and forms are on any site (school learning platforms, Google Forms, company tools). The extension reads only the page the user runs it on (or the sites they list for auto mode), downloads that page's question images, and sends requests to the AI provider address the user entered, which can be any OpenAI-compatible server, including one on their own computer. |

**Remote code:** No, I am not using remote code. All JavaScript is in the package.

**Data usage:** tick these, with the explanation that the data goes only to the AI provider the user configured:
- **Website content:** the page's text, question images and form fields, sent to the chosen AI provider to get answers.
- **Web history:** the page title and the site's name, sent with the page so the model has context.
- **Authentication information:** the user's own API key or ChatGPT sign-in, sent only to that provider to authorise requests.

Tick all three certifications: not sold to third parties, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

**Test instructions** (for reviewers): GuteAyri works with the reviewer's own AI provider; no test key is supplied. Any of these works:
- **Local, free:** install Ollama (ollama.com), run `ollama pull qwen2.5vl`, start it with `OLLAMA_ORIGINS=chrome-extension://*`, and pick Ollama in Settings.
- **A hosted provider:** pick OpenAI, Anthropic, Google Gemini or OpenRouter in Settings and paste an API key from that provider.

Then open any page with questions, such as a public Google Forms quiz, and press Alt+Shift+G or click the toolbar button.

## Firefox Add-ons

`store/amo-metadata.json` has the listing for `web-ext sign --channel listed`. The manifest declares the data the add-on transmits: `websiteContent`, `browsingActivity` and `authenticationInfo`. It requires Firefox 140 or later, so the built-in data-consent screen is used.

Third-party code in the package:
- `vendor/browser-polyfill.min.js`: Mozilla's webextension-polyfill, MPL-2.0, unmodified.
- Barlow fonts: SIL Open Font License.

There is no build or minification step for GuteAyri's own code, so no source upload is needed.
