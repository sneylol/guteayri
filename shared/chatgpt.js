/* GuteAyri — Sign in with ChatGPT (OpenAI's flow for open-source and local apps).
   Requests then run on the person's ChatGPT plan instead of an API key:
   https://developers.openai.com/siwc/token-sharing-open-source
   The options page signs in (it stays open while the person logs in); the background
   page renews the access token before requests. Credentials live under their own storage
   key, apart from `settings`, so saving settings can never write back an old rotating token. */

const CHATGPT_AUTH = {
  authorize: "https://auth.openai.com/api/accounts/authorize",
  token: "https://auth.openai.com/api/accounts/oauth/token",
  revoke: "https://auth.openai.com/api/accounts/oauth/revoke",
  jwks: "https://auth.openai.com/.well-known/jwks.json",
  issuer: "https://auth.openai.com",
  resource: "https://api.openai.com/v1",
  // OpenAI only accepts a loopback callback. Nothing listens there: the tab is read and closed as it arrives.
  redirect: "http://127.0.0.1:1455/auth/callback",
  scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
  planScope: "chatgpt.tokens.use.direct",
  usageUrl: "https://chatgpt.com/settings/usage",
};
const CHATGPT_STORE = "chatgptAccounts";
const SIGN_IN_TIMEOUT_MS = 10 * 60000;

/* { hostId, active: sub | null, accounts: { [sub]: { clientId, email, idToken, accessToken, refreshToken, expiresAt, scopes } } }
   Each account keeps its issued client ID after signing out so the next sign-in reuses the registration. */
async function chatgptLoad() {
  const stored = (await browser.storage.local.get(CHATGPT_STORE))[CHATGPT_STORE] || {};
  return { hostId: stored.hostId || "", active: stored.active || null, accounts: stored.accounts || {} };
}

async function chatgptSave(store) {
  await browser.storage.local.set({ [CHATGPT_STORE]: store });
}

/* The signed-in account, or null. `planOn` is false when the person declined plan usage at consent. */
async function chatgptStatus() {
  const store = await chatgptLoad();
  const acc = store.active && store.accounts[store.active];
  const last = Object.values(store.accounts).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
  if (!acc || !acc.refreshToken) return { signedIn: false, lastEmail: last ? last.email : "" };
  return { signedIn: true, email: acc.email, planOn: (acc.scopes || []).includes(CHATGPT_AUTH.planScope) };
}

/* ---------- Encoding ---------- */

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

function jwtPart(jwt, i) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(String(jwt).split(".")[i] || "")));
}

/* ---------- Sign in (options page) ---------- */

/* `fresh`: register a new ChatGPT account instead of continuing with the last one.
   `consent`: ask again for plan usage after it was declined. */
async function chatgptSignIn({ fresh = false, consent = false } = {}) {
  const store = await chatgptLoad();
  if (!store.hostId) store.hostId = "urn:uuid:" + crypto.randomUUID();
  await chatgptSave(store);

  const saved = fresh ? null : (store.active && store.accounts[store.active]) ||
    Object.entries(store.accounts).sort(([, a], [, b]) => (b.savedAt || 0) - (a.savedAt || 0)).map(([sub, a]) => Object.assign({ sub }, a))[0];
  const known = saved && saved.clientId ? saved : null;
  const sub = known && (known.sub || store.active);

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: known ? known.clientId : "dynamic_agent_client",
    ext_agent_host_id: store.hostId,
    redirect_uri: CHATGPT_AUTH.redirect,
    scope: CHATGPT_AUTH.scope,
    resource: CHATGPT_AUTH.resource,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  if (!known) q.set("agent_name_hint", "GuteAyri");
  if (known && known.idToken) q.set("id_token_hint", known.idToken);
  if (known && known.email) q.set("login_hint", known.email);
  if (consent) q.set("prompt", "consent");

  const callback = await waitForCallback(`${CHATGPT_AUTH.authorize}?${q}`);
  if (callback.get("state") !== state) throw new Error("The sign-in reply didn't match this attempt. Try again.");
  const error = callback.get("error");
  if (error === "access_denied") throw new Error("Sign-in was cancelled.");
  if (error) throw new Error(`ChatGPT sign-in failed: ${callback.get("error_description") || error}`);
  const returned = callback.get("client_id");
  if (known && returned && returned !== known.clientId) throw new Error("ChatGPT returned a different app registration. Use “Another account” instead.");
  const clientId = known ? known.clientId : returned;
  if (!clientId) throw new Error("ChatGPT didn't finish registering GuteAyri. Try again.");

  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    client_id: clientId,
    code: callback.get("code") || "",
    code_verifier: verifier,
    redirect_uri: CHATGPT_AUTH.redirect,
    resource: CHATGPT_AUTH.resource,
  });
  const claims = await verifyIdToken(tokens.id_token, clientId, nonce);
  if (sub && known && claims.sub !== sub) throw new Error(`That's a different ChatGPT account than ${known.email || "the saved one"}. Use “Another account” to add it.`);

  const latest = await chatgptLoad();
  latest.accounts[claims.sub] = Object.assign({}, latest.accounts[claims.sub], {
    clientId,
    email: claims.email || "",
    idToken: tokens.id_token,
    savedAt: Date.now(),
  }, tokenFields(tokens));
  latest.active = claims.sub;
  await chatgptSave(latest);
  return chatgptStatus();
}

/* Opens the ChatGPT sign-in in a tab and resolves with the callback's query once the tab is sent there. */
function waitForCallback(url) {
  return new Promise((resolve, reject) => {
    let tabId = null;
    const done = (fn, arg) => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      fn(arg);
    };
    const onUpdated = (id, change, tab) => {
      const u = change.url || (tab && tab.url) || "";
      if (id !== tabId || !u.startsWith(CHATGPT_AUTH.redirect)) return;
      browser.tabs.remove(id).catch(() => {});
      done(resolve, new URL(u).searchParams);
    };
    const onRemoved = (id) => { if (id === tabId) done(reject, new Error("The sign-in tab was closed.")); };
    const timer = setTimeout(() => {
      if (tabId != null) browser.tabs.remove(tabId).catch(() => {});
      done(reject, new Error("Sign-in took too long. Try again."));
    }, SIGN_IN_TIMEOUT_MS);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.create({ url }).then((t) => { tabId = t.id; }, (e) => done(reject, e));
  });
}

async function tokenRequest(fields) {
  let res;
  try {
    res = await fetch(CHATGPT_AUTH.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
  } catch (e) {
    const err = new Error("Couldn't reach auth.openai.com.");
    err.code = "network";
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof data.error === "string" ? data.error : (data.error && data.error.code) || "";
    const err = new Error(`ChatGPT sign-in failed (${data.error_description || code || res.status}).`);
    err.code = code || "http";
    err.status = res.status;
    throw err;
  }
  return data;
}

function tokenFields(t) {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in || 3600) * 1000,
    scopes: String(t.scope || "").split(/\s+/).filter(Boolean),
  };
}

/* Checks the ID token's RS256 signature against OpenAI's published keys, then its claims. */
async function verifyIdToken(idToken, clientId, nonce) {
  if (!idToken) throw new Error("ChatGPT didn't return an ID token.");
  const [h, p, s] = idToken.split(".");
  const header = jwtPart(idToken, 0);
  if (header.alg !== "RS256") throw new Error("ChatGPT's ID token is signed in an unexpected way.");
  const { keys = [] } = await (await fetch(CHATGPT_AUTH.jwks)).json();
  const jwk = keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw new Error("Couldn't find the key ChatGPT signed the ID token with.");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("ChatGPT's ID token didn't verify.");
  const c = jwtPart(idToken, 1);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== CHATGPT_AUTH.issuer || !aud.includes(clientId) || c.nonce !== nonce || (c.exp || 0) * 1000 < Date.now() - 60000) {
    throw new Error("ChatGPT's ID token didn't match this sign-in.");
  }
  return c;
}

/* ---------- Sign out ---------- */

async function chatgptSignOut() {
  const store = await chatgptLoad();
  const acc = store.active && store.accounts[store.active];
  let revoked = true;
  if (acc && acc.refreshToken) {
    try {
      const res = await fetch(CHATGPT_AUTH.revoke, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: acc.refreshToken, token_type_hint: "refresh_token", client_id: acc.clientId }),
      });
      revoked = res.ok;
    } catch (e) {
      revoked = false;
    }
  }
  if (acc) {
    // Keep the registration (client ID, email, ID token for the next sign-in's hint); drop the tokens.
    delete acc.accessToken;
    delete acc.refreshToken;
    delete acc.expiresAt;
  }
  store.active = null;
  await chatgptSave(store);
  return { revoked };
}

/* ---------- Access tokens (background) ---------- */

let refreshing = null;

/* A valid access token for the signed-in account, renewed when it is within five minutes of expiring.
   Refreshes are serialized: the refresh token rotates, so two at once would invalidate each other. */
async function chatgptAccessToken() {
  const store = await chatgptLoad();
  const acc = store.active && store.accounts[store.active];
  if (!acc || !acc.refreshToken) throw new GuteAyriError("Sign in with ChatGPT in Settings first.", "no-key");
  if (!(acc.scopes || []).includes(CHATGPT_AUTH.planScope)) {
    throw new GuteAyriError("Using your ChatGPT plan isn't turned on for GuteAyri. Turn it on in Settings.", "auth");
  }
  if (acc.accessToken && acc.expiresAt - 5 * 60000 > Date.now()) return acc.accessToken;
  if (!refreshing) refreshing = refreshAccess(store.active).finally(() => { refreshing = null; });
  return refreshing;
}

async function refreshAccess(sub) {
  const store = await chatgptLoad();
  const acc = store.accounts[sub];
  let t;
  try {
    t = await tokenRequest({ grant_type: "refresh_token", client_id: acc.clientId, refresh_token: acc.refreshToken, resource: CHATGPT_AUTH.resource });
  } catch (err) {
    if (err.code === "network" || (err.status >= 500)) throw new GuteAyriError("Couldn't renew the ChatGPT sign-in. Check your connection and run again.", "network");
    // The refresh token is unusable (expired, revoked or reused): sign in again.
    delete acc.accessToken;
    delete acc.refreshToken;
    store.active = null;
    await chatgptSave(store);
    throw new GuteAyriError("Your ChatGPT sign-in has ended. Sign in again in Settings.", "auth");
  }
  const fields = tokenFields(t);
  if (!fields.refreshToken) delete fields.refreshToken;
  if (!fields.scopes.length) delete fields.scopes;
  Object.assign(acc, fields, t.id_token ? { idToken: t.id_token } : {});
  await chatgptSave(store);
  return acc.accessToken;
}

/* Forgets the access token after the API rejects it, so the next request renews it. */
async function chatgptDropAccess() {
  const store = await chatgptLoad();
  const acc = store.active && store.accounts[store.active];
  if (acc) {
    acc.expiresAt = 0;
    await chatgptSave(store);
  }
}
