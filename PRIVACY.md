# GuteAyri privacy policy

Last updated: 23 October 2026

GuteAyri is a browser extension that reads the questions on a web page and fills in answers using an AI provider you choose. This policy explains what data it handles and where that data goes.

## The short version

- GuteAyri has no servers of its own. Its developer never receives, stores or sees your data.
- When you run GuteAyri on a page, it sends that page's questions to the AI provider you picked in Settings, and to nobody else.
- Your settings, API keys and sign-ins stay in your browser's extension storage.
- There is no analytics, tracking, advertising or telemetry.

## What GuteAyri reads

GuteAyri reads a page only when you ask it to: through the toolbar button, a keyboard shortcut or the right-click menu. With auto mode turned on, it also reads pages on the sites you list in Settings, or on every site if you leave that list empty. On those pages it reads:

- **Text and form fields:** the visible text and the questions' answer fields (labels, options, current values).
- **Images:** pictures that belong to the questions. Some images are only available while you're logged in, so GuteAyri downloads them again in the background with your existing login for that site.
- **Screenshot:** a screenshot of the visible part of the page, only if you turn on "Send a screenshot of the page too", or when a page can't be read any other way (such as the browser's PDF viewer).
- **Page title and address:** the page's title and the site's name (for example `moodle.example.edu`), but not the full address.

It skips password fields, search boxes and payment fields.

## Where that data goes

GuteAyri sends the page data above to **the one AI provider you selected in Settings**. It sends your instructions and the Knowledge notes you turned on along with it. The provider can be:

- **A hosted service:** OpenAI, Anthropic, Google Gemini, OpenRouter, xAI, Groq, Mistral or DeepSeek. Your API key goes to that provider so it can identify your account.
- **ChatGPT via "Sign in with ChatGPT":** you sign in on OpenAI's own page. GuteAyri receives sign-in tokens from OpenAI and sends them only to OpenAI, to renew the sign-in and to make requests on your ChatGPT plan.
- **A program on your own computer:** Ollama or CLIProxyAPI. Data goes to that program, which may forward it to services you've connected it to.
- **Any other compatible address you enter yourself.**

What the provider does with this data is governed by that provider's own privacy policy and terms. Check them before you use GuteAyri with personal or confidential pages.

GuteAyri doesn't sell data, share it with anyone else, or use it for advertising.

## What GuteAyri stores

GuteAyri stores the following in your browser's local extension storage, on your device only:

- **Settings:** your chosen provider, model, reasoning level, instructions, Knowledge notes and other options.
- **Credentials:** API keys you entered, and ChatGPT sign-in tokens if you used Sign in with ChatGPT.

It doesn't keep a history of the pages you ran it on. Answers stay in the open tab only until you close or reload it.

To delete everything, remove the extension. Signing out of ChatGPT in Settings also asks OpenAI to end that sign-in.

## Permissions

- **Read and change data on all websites:** to read questions and fill in answers on the page you run it on, and to reach the AI provider.
- **Tabs and active tab:** to find the page you want answered and take a screenshot of it when needed.
- **Context menus:** for the "Fill this page" and "Answer …" right-click items.
- **Clipboard (write only):** for the Copy button in the answer panel.
- **Scripting (Chrome and Safari):** to run on tabs that were open before the extension was installed or updated.
- **Storage:** to keep your settings on your device.

## Children

GuteAyri isn't directed at children under 13 and doesn't knowingly collect data from them.

## Changes

If this policy changes, the new version will be published at the same address, with a new date at the top.

## Contact

Questions about this policy: raczpepo@gmail.com
