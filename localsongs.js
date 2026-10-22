// localsongs.js — songs added on THIS device from a zip, kept in IndexedDB.
//
// The public (GitHub Pages) copy has no server, so a song package someone sent
// (Telegram etc.) is unpacked right here in the browser: chart.json + the audio
// the chart names (song.referenceAudio, song.backingAudio; WAV, FLAC, MP3 or
// M4A). Only those files are kept. Nothing leaves the phone, and the songs play
// offline. A zip may hold one song at its root or several song folders (e.g.
// the four parts of a piece).
//
// The zip reader is the platform's own DecompressionStream("deflate-raw")
// (iOS 16.4+, Chrome 80+) over Blob slices, so a 200 MB package is never held
// in memory whole.

import { t } from "./i18n.js";
const DB_NAME = "vt-local", STORE = "songs";
const MAX_TOTAL = 1.5 * 1024 ** 3;

export class PackageError extends Error {}

//==============================================================================
// Zip
async function bytes (blob, start, end) { return new DataView (await blob.slice (start, end).arrayBuffer()); }

async function readZip (file)
{
    // End of central directory: in the last 64 KB + 22 bytes (the comment may be up to 64 KB).
    const tailStart = Math.max (0, file.size - 65557);
    const tail = await bytes (file, tailStart, file.size);
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; --i)
        if (tail.getUint32 (i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new PackageError (t ("это не zip-архив (или он повреждён / не догрузился)"));
    const count = tail.getUint16 (eocd + 10, true);
    const cdSize = tail.getUint32 (eocd + 12, true), cdOff = tail.getUint32 (eocd + 16, true);
    if (cdOff === 0xffffffff || count === 0xffff) throw new PackageError (t ("архив в формате ZIP64 (больше 4 ГБ) не поддерживается"));
    const cd = await bytes (file, cdOff, cdOff + cdSize);
    const utf8 = new TextDecoder ("utf-8");
    const entries = new Map();
    for (let p = 0, n = 0; n < count; ++n)
    {
        if (cd.getUint32 (p, true) !== 0x02014b50) throw new PackageError (t ("оглавление zip повреждено"));
        const method = cd.getUint16 (p + 10, true);
        const csize = cd.getUint32 (p + 20, true), size = cd.getUint32 (p + 24, true);
        const nlen = cd.getUint16 (p + 28, true), xlen = cd.getUint16 (p + 30, true), clen = cd.getUint16 (p + 32, true);
        const local = cd.getUint32 (p + 42, true);
        const name = utf8.decode (new Uint8Array (cd.buffer, cd.byteOffset + p + 46, nlen)).replace (/\\/g, "/");
        p += 46 + nlen + xlen + clen;
        if (name.endsWith ("/")) continue;
        if (name.split ("/").some (s => s === "..") || name.startsWith ("/") || name.includes (":"))
            throw new PackageError (t ("в архиве опасный путь: {0}", name));
        if (name.split ("/").some (s => s === "__MACOSX") || /(^|\/)\._/.test (name)) continue;   // macOS junk
        entries.set (name.replace (/^\.\//, ""), { name, method, csize, size, local });
    }
    return entries;
}

async function unpack (file, e, type = "")
{
    const h = await bytes (file, e.local, e.local + 30);
    if (h.getUint32 (0, true) !== 0x04034b50) throw new PackageError (t ("повреждён файл в архиве: {0}", e.name));
    const start = e.local + 30 + h.getUint16 (26, true) + h.getUint16 (28, true);
    const raw = file.slice (start, start + e.csize);
    let out;
    if (e.method === 0) out = new Blob ([await raw.arrayBuffer()], { type });
    else if (e.method === 8)
    {
        if (typeof DecompressionStream === "undefined")
            throw new PackageError (t ("этот браузер не умеет распаковывать zip (нужен iOS 16.4+ или свежий Chrome)"));
        out = await new Response (raw.stream().pipeThrough (new DecompressionStream ("deflate-raw")), { headers: { "Content-Type": type } }).blob();
    }
    else throw new PackageError (t ("неподдерживаемое сжатие в архиве ({0}): {1}", e.method, e.name));
    if (out.size !== e.size) throw new PackageError (t ("файл распаковался не целиком: {0}", e.name));
    return out;
}

//==============================================================================
// Checking a package
const AUDIO = { wav: "audio/wav", flac: "audio/flac", mp3: "audio/mpeg", m4a: "audio/mp4" };

async function audioKind (blob)
{
    const b = new Uint8Array (await blob.slice (0, 12).arrayBuffer());
    const s = (i, n) => String.fromCharCode (...b.slice (i, i + n));
    if (s (0, 4) === "RIFF" && s (8, 4) === "WAVE") return "wav";
    if (s (0, 4) === "fLaC") return "flac";
    if (s (0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
    if (s (4, 4) === "ftyp") return "m4a";
    return null;
}

function joinPath (dir, rel)
{
    const parts = (dir ? dir.split ("/") : []).concat (String (rel).replace (/\\/g, "/").split ("/"));
    const out = [];
    for (const p of parts)
    {
        if (p === "" || p === ".") continue;
        if (p === "..") { if (! out.length) return null; out.pop(); continue; }
        out.push (p);
    }
    return out.join ("/");
}

function checkChart (c, where)
{
    const bad = (m) => { throw new PackageError (`chart.json${where}: ${m}`); };
    if (! c || typeof c !== "object") bad (t ("не JSON-объект"));
    if (c.schemaVersion !== "1.0") bad (t ("версия формата {0}, нужна 1.0", c.schemaVersion ?? "?"));
    if (! c.song || typeof c.song !== "object") bad (t ("нет раздела song"));
    if (! Array.isArray (c.notes)) bad (t ("нет списка нот"));
    const notes = c.notes.filter (n => n && n.type !== "breath");
    if (! notes.length) bad (t ("в партии нет нот"));
    for (const n of notes)
        if (! Number.isFinite (n.startSeconds) || ! Number.isFinite (n.durationSeconds) || ! Number.isFinite (n.midi))
            bad (t ("нота {0} без времени или высоты", n.id ?? "?"));
    if (c.phrases != null && ! Array.isArray (c.phrases)) bad (t ("phrases - не список"));
}

/** Reads and checks every song in the zip. Returns [{ id, chart, audio: { reference, backing } }]. */
export async function readPackage (file, say = () => {})
{
    const entries = await readZip (file);
    const total = [...entries.values()].reduce ((a, e) => a + e.size, 0);
    if (total > MAX_TOTAL) throw new PackageError (t ("архив слишком большой (больше 1,5 ГБ в распакованном виде)"));
    const charts = [...entries.keys()].filter (n => n === "chart.json" || n.endsWith ("/chart.json")).sort();
    if (! charts.length) throw new PackageError (t ("в архиве нет chart.json - это не пакет песни"));

    const songs = [];
    for (const cp of charts)
    {
        const dir = cp.slice (0, -"chart.json".length).replace (/\/$/, "");
        const where = dir ? ` (${dir})` : "";
        say (t ("проверяю {0}…", cp));
        let chart;
        try { chart = JSON.parse ((await (await unpack (file, entries.get (cp))).text()).replace (/^﻿/, "")); }
        catch (err) { if (err instanceof PackageError) throw err; throw new PackageError (t ("chart.json{0} не читается: {1}", where, err.message)); }
        checkChart (chart, where);

        const audio = {};
        for (const [which, key, what, required] of [["reference", "referenceAudio", t ("голос (подсказка)"), true],
                                                    ["backing", "backingAudio", t ("минус"), false]])
        {
            const rel = chart.song[key];
            if (! rel) { if (required) throw new PackageError (t ("chart.json{0}: не указан файл {1}", where, key)); continue; }
            const path = joinPath (dir, rel);
            if (path === null || (dir && ! path.startsWith (dir + "/")))
                throw new PackageError (t ("chart.json{0}: путь {1} выходит за папку песни", where, rel));
            const e = entries.get (path);
            if (! e) throw new PackageError (t ("в архиве нет файла: {0} ({1})", path, what));
            const ext = path.split (".").pop().toLowerCase();
            if (! AUDIO[ext]) throw new PackageError (t ("{0}: {1} - нужен WAV, FLAC, MP3 или M4A", what, path));
            say (t ("распаковываю {0} ({1} МБ)…", path, (e.size / 1048576).toFixed (1)));
            const blob = await unpack (file, e, AUDIO[ext]);
            const kind = await audioKind (blob);
            if (! kind || (kind !== ext && ! (ext === "m4a" && kind === "m4a")))
                throw new PackageError (t ("{0} - не настоящий {1} (повреждён?)", path, ext.toUpperCase()));
            audio[which] = blob;
        }
        const raw = /^[A-Za-z0-9._-]+$/.test (chart.song.id || "") ? chart.song.id
                  : (dir.split ("/").pop() || file.name.replace (/\.zip$/i, "")).replace (/[^A-Za-z0-9._-]+/g, "-");
        songs.push ({ id: "local-" + (raw || Date.now()), chart, audio });
    }
    const ids = songs.map (s => s.id);
    const dup = ids.find ((x, i) => ids.indexOf (x) !== i);
    if (dup) throw new PackageError (t ("в архиве две песни с одним id: {0}", dup));
    return songs;
}

//==============================================================================
// Storage
function db ()
{
    return new Promise ((resolve, reject) => {
        const r = indexedDB.open (DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore (STORE, { keyPath: "id" });
        r.onsuccess = () => resolve (r.result);
        r.onerror = () => reject (r.error);
    });
}

async function tx (mode, fn)
{
    const d = await db();
    return new Promise ((resolve, reject) => {
        const t = d.transaction (STORE, mode);
        const req = fn (t.objectStore (STORE));
        t.oncomplete = () => { d.close(); resolve (req?.result); };
        t.onerror = t.onabort = () => { d.close(); reject (t.error || new Error ("IndexedDB")); };
    });
}

export async function saveSongs (songs)
{
    try { await navigator.storage?.persist?.(); } catch {}    // ask the browser not to evict them
    const need = songs.reduce ((a, s) => a + (s.audio.reference?.size || 0) + (s.audio.backing?.size || 0), 0);
    try
    {
        const est = await navigator.storage?.estimate?.();
        if (est && est.quota && est.quota - est.usage < need * 1.1)
            throw new PackageError (t ("на телефоне не хватает места для приложения: нужно {0} МБ", (need / 1048576).toFixed (0)));
    }
    catch (err) { if (err instanceof PackageError) throw err; }
    try { await tx ("readwrite", st => { for (const s of songs) st.put ({ ...s, added: Date.now() }); }); }
    catch (err)
    {
        throw new PackageError (err?.name === "QuotaExceededError" ? t ("на телефоне не хватает места для приложения")
                                                                   : t ("не удалось сохранить: {0}", err?.message || err));
    }
}

export const getSong = (id) => tx ("readonly", st => st.get (id));
export const deleteSong = (id) => tx ("readwrite", st => st.delete (id));

/** The list entries, shaped like api/songs gives them, without the audio. */
export async function listSongs ()
{
    let all = [];
    try { all = await tx ("readonly", st => st.getAll()); } catch { return []; }
    return (all || []).sort ((a, b) => b.added - a.added).map (({ id, chart }) => {
        const s = chart.song || {};
        return { id, local: true, title: s.title || id.replace (/^local-/, ""), artist: s.artist, durationSeconds: s.durationSeconds,
                 range: s.vocalRangeMidi, piece: s.piece ? "local-" + s.piece : null, pieceTitle: s.pieceTitle,
                 part: s.part, partName: s.partName,
                 lyrics: (chart.phrases || []).map (p => p.text || "").join (" ").trim() };
    });
}

export async function hasSong (id) { try { return !! (await getSong (id)); } catch { return false; } }
