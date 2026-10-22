// Service worker: makes the trainer work with the PC server switched off.
//
// App shell  - cached at install, served from cache at once and refreshed in the
//              background (so a new version shows on the launch after next).
//              Bump VERSION when a shell file is added or renamed.
// Songs      - always asked of the home server first; every chart / audio that
//              arrives is kept, but only for ONE song, the last one opened. Without
//              the server the song list shrinks to that song, and it plays from cache.
// Takes      - POST api/takes is not touched: offline it fails and app.js ignores it.

const VERSION = "vt-shell-v46";
const SONG_CACHE = "vt-song";

const SHELL = [
    "./", "index.html", "style.css", "app.js", "exercises.js", "synth.js", "staff.js",
    "pitch-worklet.js", "localsongs.js", "tempo.js", "analytics.js", "i18n.js", "manifest.webmanifest",
    "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener ("install", (e) => {
    e.waitUntil (caches.open (VERSION)
        .then (c => c.addAll (SHELL.map (u => new Request (u, { cache: "reload" }))))
        .then (() => self.skipWaiting()));
});

self.addEventListener ("activate", (e) => {
    e.waitUntil (caches.keys()
        .then (keys => Promise.all (keys.filter (k => k.startsWith ("vt-shell-") && k !== VERSION).map (k => caches.delete (k))))
        .then (() => self.clients.claim()));
});

// Away from home the PC's LAN address does not answer at all, and a phone can sit
// on a dead TCP connect for a minute. So every server request has a deadline, and
// once one has failed the next song files go straight to the cache for a while.
let serverDownUntil = 0;

async function fetchWithin (req, ms)
{
    const ctl = new AbortController();
    const t = setTimeout (() => ctl.abort(), ms);
    try
    {
        const r = await fetch (req, { signal: ctl.signal, cache: "no-store" });
        serverDownUntil = 0;
        return r;
    }
    catch (err) { serverDownUntil = Date.now() + 30000; throw err; }
    finally { clearTimeout (t); }
}

// Song files: api/songs/<id>/... from the home server, songs/<id>/... on the Pages site.
const songIdOf = (url) => decodeURIComponent (new URL (url).pathname.match (/\/songs\/([^/]+)\//)?.[1] || "");

async function songFile (req)
{
    const cache = await caches.open (SONG_CACHE);
    const isAudio = /\/audio\/|\.(m4a|mp3)$/.test (new URL (req.url).pathname);
    if (Date.now() < serverDownUntil)
        return (await cache.match (req)) || Response.error();
    try
    {
        // The first open of a song transcodes its WAVs on the PC before answering.
        const r = await fetchWithin (req, isAudio ? 90000 : 6000);
        if (! r.ok) return (await cache.match (req)) || r;
        await cache.put (req, r.clone());
        if (isAudio) await keepOnlySong (cache, songIdOf (req.url));
        return r;
    }
    catch { return (await cache.match (req)) || Response.error(); }
}

async function keepOnlySong (cache, id)
{
    for (const k of await cache.keys())
    {
        if (songIdOf (k.url) && songIdOf (k.url) !== id) await cache.delete (k);
    }
}

async function songList (req)
{
    const cache = await caches.open (SONG_CACHE);
    try
    {
        const r = await fetchWithin (req, 4000);
        if (r.ok) await cache.put (req, r.clone());
        return r;
    }
    catch
    {
        // Offline: the last list we saw, cut down to the songs we still hold.
        const old = await cache.match (req);
        if (! old) return Response.error();
        const held = new Set ((await cache.keys()).map (k => songIdOf (k.url)).filter (Boolean));
        const list = (await old.json()).filter (s => held.has (s.id));
        return new Response (JSON.stringify (list), { headers: { "Content-Type": "application/json; charset=utf-8", "X-VT-Offline": "1" } });
    }
}

async function shellFile (e)
{
    const cache = await caches.open (VERSION);
    const req = e.request.mode === "navigate" ? new Request ("index.html") : e.request;
    const hit = await cache.match (req, { ignoreSearch: true });
    const fresh = fetchWithin (req, 8000)
        .then (async r => { if (r.ok) await cache.put (req, r.clone()); return r; });
    if (hit) { e.waitUntil (fresh.catch (() => {})); return hit; }
    return fresh;
}

self.addEventListener ("fetch", (e) => {
    const url = new URL (e.request.url);
    if (e.request.method !== "GET" || url.origin !== location.origin) return;
    const p = url.pathname;
    if (/\/api\/songs\/?$/.test (p) || p.endsWith ("/songs/index.json")) return e.respondWith (songList (e.request));
    if (songIdOf (e.request.url)) return e.respondWith (songFile (e.request));
    if (p.includes ("/api/")) return;
    // Профиль голоса lives under the same scope but is its own app: leave it to the network.
    if (p.includes ("/voice-profile/")) return;
    e.respondWith (shellFile (e));
});
