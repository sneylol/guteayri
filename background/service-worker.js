/* GuteAyri — Chrome background (Manifest V3 service worker). Firefox loads the same scripts
   as a background page; the polyfill gives Chrome the promise-based `browser` API they use. */
importScripts("../vendor/browser-polyfill.min.js", "../shared/defaults.js", "../shared/chatgpt.js", "providers.js", "background.js");
