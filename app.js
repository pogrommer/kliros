// app.js — the phone version of Vocal Trainer: highway + five-line staff.
// Geometry and colours follow DESIGN.md §7; analysis lives in pitch-worklet.js.

import { DEFINITIONS, getDefinition, makeSpec, buildChart, LENGTHS, noteName } from "./exercises.js";
import { renderClickTrack, renderGuideTone, renderSingleNote } from "./synth.js";
import { drawStaff, midiName } from "./staff.js";

//==============================================================================
// Settings, remembered per device.
const DEFAULTS = {
    mode: "exercise", kind: "tenorG3toD4", root: 55, bpm: 72, length: "medium", labels: "fixed",
    clef: "bass", names: true, tolerance: "practice", guide: true, guideVol: 0.8, backVol: 0.8,
    latencyMs: 0, song: "", part: "T",
};
const TOLERANCES = { performance: [50, 150], practice: [25, 100], precision: [10, 50] };

let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse (localStorage.getItem ("vt-web") || "{}") }; } catch {}
if (! ["names", "fixed", "movable"].includes (S.labels)) S.labels = DEFAULTS.labels;
const save = () => { try { localStorage.setItem ("vt-web", JSON.stringify (S)); } catch {} };

const C = {
    bg: "#101014", grid: "#2A2A32", gridC: "#3a3a46", label: "#6a6a78",
    barFill: "rgba(0,114,178,0.35)", barEdge: "#56B4E9", active: "#56B4E9",
    good: [0x00, 0x9E, 0x73], bad: [0xD5, 0x5E, 0x00], ghost: "rgba(138,138,150,0.25)",
    nowLine: "#8a8a96", sung: "#F0E442", pending: "#8A8A96",
};

const HISTORY = 2.0, SPAN = 5.5;

//==============================================================================
// Note labels. ONE setting drives every place a note is named — the bars, the
// gutter, the syllable line, the staff and the readout — so the singer never
// has to translate between two naming systems mid-phrase.
//   names   — G3, A#3 ...
//   fixed   — до ре ми, до = C (the Russian school)
//   movable — do re mi from the exercise's tonic (as the desktop app sings it)
const FIXED_DO   = ["до", "до♯", "ре", "ре♯", "ми", "фа", "фа♯", "соль", "соль♯", "ля", "ля♯", "си"];
const MOVABLE_DO = ["do", "di", "re", "me", "mi", "fa", "fi", "sol", "le", "la", "te", "ti"];

function tonic ()
{
    return chart && chart.exercise ? chart.exercise.rootMidi : null;
}

function label (midi)
{
    const pc = ((midi % 12) + 12) % 12;
    if (S.labels === "fixed") return FIXED_DO[pc];
    if (S.labels === "movable" && tonic() != null)
        return MOVABLE_DO[(((midi - tonic()) % 12) + 12) % 12];
    return midiName (midi);
}

// Label plus, for syllables, the octave-bearing name — for the readout only.
const labelLong = (midi) => S.labels === "names" ? midiName (midi) : `${label (midi)} <small>${midiName (midi)}</small>`;
const $ = (id) => document.getElementById (id);

//==============================================================================
// Audio
let ctx = null, workletNode = null, micStream = null;
let guideGain = null, backGain = null, clickGain = null;
let sources = [];
let t0 = 0, running = false;

// The context (playback + the analysis worklet) and the microphone are
// separate on purpose: the mic button releases the mic completely — iOS's
// orange dot goes out — without tearing down playback or the worklet.
let micSource = null, micWanted = false;
const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };

// The user wants the mic question asked as soon as the app opens. The permission
// prompt needs no tap, but iOS starts audio processing only from a tap, so the
// stream granted here is kept and switched on by the first tap anywhere.
let earlyStream = null;
async function askMicAtLaunch ()
{
    if (! window.isSecureContext || ! navigator.mediaDevices) return;
    try { earlyStream = await navigator.mediaDevices.getUserMedia (MIC_CONSTRAINTS); }
    catch { return; }      // refused: the mic button asks again when pressed
    const first = (e) => {
        if (e.target.closest ("#mic")) return;      // the mic button does it itself
        removeEventListener ("pointerdown", first, true);
        micOn().catch (err => { $("status").textContent = err.message || String (err); });
    };
    addEventListener ("pointerdown", first, true);
}

async function ensureContext ()
{
    if (ctx) { if (ctx.state !== "running") await ctx.resume(); return; }

    if (! window.isSecureContext || ! navigator.mediaDevices)
        throw new Error ("Микрофон доступен только по https. Откройте адрес https://… (см. инструкцию).");

    try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {}

    ctx = new (window.AudioContext || window.webkitAudioContext) ({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule ("pitch-worklet.js");

    workletNode = new AudioWorkletNode (ctx, "pitch-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = ctx.createGain(); mute.gain.value = 0;
    workletNode.connect (mute).connect (ctx.destination);
    workletNode.port.onmessage = (e) => { if (micSource) onEstimate (e.data); };

    guideGain = ctx.createGain(); guideGain.connect (ctx.destination);
    backGain  = ctx.createGain(); backGain.connect (ctx.destination);
    clickGain = ctx.createGain(); clickGain.connect (ctx.destination);
    applyLevels();
    if (ctx.state !== "running") await ctx.resume();
}

// One start at a time: the first tap and the Start button can both ask for the mic.
let micStarting = null;
function micOn ()
{
    micStarting ||= micOnOnce().finally (() => { micStarting = null; });
    return micStarting;
}

async function micOnOnce ()
{
    await ensureContext();
    if (micSource) return;
    setMicButton ("wait");
    try
    {
        // The stream asked for at launch (askMicAtLaunch), if it is still live.
        micStream = earlyStream?.active ? earlyStream : await navigator.mediaDevices.getUserMedia (MIC_CONSTRAINTS);
        earlyStream = null;
    }
    catch (e) { setMicButton ("off"); throw new Error ("Нет доступа к микрофону: " + (e.message || e.name)); }

    micSource = ctx.createMediaStreamSource (micStream);
    micSource.connect (workletNode);
    // The mic can be taken away from outside (a call, another app, Settings).
    micStream.getAudioTracks().forEach (t => t.onended = () => micOff());
    if (ctx.state !== "running") await ctx.resume();
    setMicButton ("on");
}

function micOff ()
{
    if (micSource) { try { micSource.disconnect(); } catch {} }
    micSource = null;
    if (micStream) micStream.getTracks().forEach (t => t.stop());
    micStream = null;
    liveEst = null;
    setMicButton ("off");
}

async function toggleMic ()
{
    $("status").textContent = "";
    try { micSource ? micOff() : await micOn(); }
    catch (e) { $("status").textContent = e.message || String (e); }
}

function setMicButton (state)
{
    const b = $("mic");
    b.dataset.state = state;
    b.setAttribute ("aria-pressed", state === "on" ? "true" : "false");
    b.title = state === "on" ? "Микрофон включён — нажмите, чтобы выключить" : "Микрофон выключен — нажмите, чтобы включить";
    if (state !== "on") b.style.setProperty ("--lvl", "0");
}

// Starting an exercise implies listening: the mic comes on with it.
async function ensureAudio ()
{
    await ensureContext();
    if (! micSource) await micOn();
}

function applyLevels ()
{
    if (! ctx) return;
    guideGain.gain.value = S.guide ? S.guideVol : 0;
    backGain.gain.value = S.backVol;
    clickGain.gain.value = 1;
}

const outLatency = () => (ctx ? (ctx.outputLatency || ctx.baseLatency || 0) : 0) + S.latencyMs / 1000;
const chartNow = () => running ? ctx.currentTime - t0 - outLatency() : lastChartNow;
let lastChartNow = -1;

//==============================================================================
// Chart state
let chart = null;            // { song, notes, phrases, exercise?, contour? }
let noteStats = [];
let estimates = [];          // { tc, raw, smooth, clarity, rmsDb }
let liveEst = null;

function prepareChart (c)
{
    chart = c;
    chart.notes.sort ((a, b) => a.startSeconds - b.startSeconds);
    noteStats = chart.notes.map (() => ({ hit: 0, frames: 0, sung: [], folded: [] }));
    estimates = [];
    lastChartNow = chart.notes.length ? chart.notes[0].startSeconds - 1.5 : -1;
    viewInit = false;
    updateTitle();
}

function noteIndexAt (t)
{
    if (! chart) return -1;
    const ns = chart.notes;
    let lo = 0, hi = ns.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ns[m].startSeconds <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    if (ans >= 0 && t <= ns[ans].startSeconds + ns[ans].durationSeconds) return ans;
    return -1;
}

// The note an estimate at t is judged against: the one sounding, else the
// nearest within 0.5 s (so a scoop into a note folds onto it).
function referenceNoteAt (t)
{
    if (! chart || ! chart.notes.length) return -1;
    const i = noteIndexAt (t);
    if (i >= 0) return i;
    const ns = chart.notes;
    let lo = 0, hi = ns.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m].startSeconds < t) lo = m + 1; else hi = m; }
    let best = -1, bestD = 0.5;
    for (const j of [lo - 1, lo])
    {
        if (j < 0 || j >= ns.length) continue;
        const n = ns[j], d = t < n.startSeconds ? n.startSeconds - t : t - (n.startSeconds + n.durationSeconds);
        if (d < bestD) { bestD = d; best = j; }
    }
    return best;
}

const targetMidiOf = (n) => n.midi + (n.centsOffset || 0) / 100;
const foldTo = (midi, target) => target + remainder (midi - target, 12);
function remainder (x, y) { return x - y * Math.round (x / y); }

function powerFor (cents)
{
    const [full, zero] = TOLERANCES[S.tolerance];
    return Math.max (0, Math.min (1, (zero - Math.abs (cents)) / (zero - full)));
}

function colourFor (cents)
{
    const [full, zero] = TOLERANCES[S.tolerance];
    const a = Math.max (0, Math.min (1, (Math.abs (cents) - full) / (zero - full)));
    const c = C.good.map ((g, i) => Math.round (g + (C.bad[i] - g) * a));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function onEstimate (m)
{
    const tc = running ? m.t - t0 - outLatency() : (ctx ? m.t : 0);
    const e = { tc, raw: m.raw, smooth: m.smooth, clarity: m.clarity, rmsDb: m.rmsDb, wall: performance.now() };
    liveEst = e;

    if (! running)
    {
        // Free sing / idle: keep a rolling trace on the context clock.
        estimates.push (e);
        while (estimates.length && estimates[0].tc < tc - SPAN) estimates.shift();
        return;
    }

    estimates.push (e);
    if (estimates.length > 20000) estimates.splice (0, 5000);

    // Score (DESIGN.md §6): octave-folded, two-threshold ramp, per 8 ms frame.
    const i = noteIndexAt (tc);
    if (i >= 0)
    {
        const st = noteStats[i], n = chart.notes[i];
        st.frames++;
        if (Number.isFinite (m.smooth))
        {
            const cents = remainder (m.smooth - targetMidiOf (n), 12) * 100;
            if (powerFor (cents) > 0) st.hit++;
            if (tc - n.startSeconds > 0.15)
            {
                st.sung.push (m.smooth);
                st.folded.push (cents);
            }
        }
    }
}

const median = (a) => { if (! a.length) return NaN; const s = [...a].sort ((x, y) => x - y); return s[s.length >> 1]; };

function expectedFrames (n) { return Math.max (1, n.durationSeconds / 0.008); }

function phrasePercent (ph)
{
    let hit = 0, total = 0;
    for (const id of ph.noteIds)
    {
        const i = chart.notes.findIndex (n => n.id === id);
        if (i < 0) continue;
        hit += noteStats[i].hit; total += expectedFrames (chart.notes[i]);
    }
    return total > 0 ? Math.min (100, Math.round (100 * hit / total)) : 0;
}

function phraseAt (t)
{
    if (! chart || ! chart.phrases || ! chart.phrases.length) return null;
    let cur = null;
    for (const p of chart.phrases)
    {
        if (p.startSeconds - 1.2 <= t) cur = p; else break;
    }
    return cur || chart.phrases[0];
}

//==============================================================================
// Start / stop
async function start ()
{
    hideSummary();
    $("status").textContent = "";
    try { await ensureAudio(); }
    catch (err) { $("status").textContent = err.message || String (err); return; }

    stopSources();

    try
    {
        if (S.mode === "exercise")
        {
            prepareChart (buildChart (makeSpec (S.kind, S.root, S.bpm, LENGTHS[S.length], false)));
            const click = renderClickTrack (ctx, chart), guide = renderGuideTone (ctx, chart);
            schedule ([[click, clickGain], [guide, guideGain]]);
        }
        else if (S.mode === "song")
        {
            if (! S.song) { openSettings(); return; }
            $("status").textContent = "Загрузка песни…";
            const song = await loadSong (S.song);
            prepareChart (song.chart);
            const decks = [];
            if (song.backing) decks.push ([song.backing, backGain]);
            if (song.reference) decks.push ([song.reference, guideGain]);
            $("status").textContent = "";
            schedule (decks);
        }
        else
        {
            chart = null; running = false; estimates = [];
            setButton (false);
            return;
        }
    }
    catch (err) { $("status").textContent = "Ошибка: " + (err.message || err); return; }

    requestWakeLock();
}

function schedule (decks)
{
    t0 = ctx.currentTime + 0.25;
    for (const [buf, gain] of decks)
    {
        const s = ctx.createBufferSource();
        s.buffer = buf; s.connect (gain); s.start (t0);
        sources.push (s);
    }
    estimates = [];
    running = true;
    setButton (true);
}

function stopSources ()
{
    for (const s of sources) { try { s.stop(); } catch {} }
    sources = [];
}

function stop (finished = false)
{
    if (running) lastChartNow = chartNow();
    running = false;
    stopSources();
    setButton (false);
    releaseWakeLock();
    if (finished && chart) showSummary();
}

function setButton (on)
{
    $("play").textContent = on ? "■" : "▶";
    $("play").classList.toggle ("on", on);
}

//==============================================================================
// Songs from the shared library (the same songs/ folder the desktop app uses)
const songCache = new Map();

async function loadSong (id)
{
    if (songCache.has (id)) return songCache.get (id);
    // Offline these come from the service worker, which keeps the last song opened.
    const offline = "песня недоступна: сервер на ПК не отвечает, а в телефоне сохранена только последняя открытая песня";
    // URLs come with the list: the home server's api/..., or static files on the Pages site.
    const e = songEntries.get (id) || {};
    const api = `api/songs/${encodeURIComponent (id)}`;
    const chartResp = await fetch (e.chart || `${api}/chart`).catch (() => null);
    if (! chartResp?.ok) throw new Error (offline);
    const chartJson = await chartResp.json();
    const fetchAudio = async (which) => {
        const r = await fetch (e[which] || `${api}/audio/${which}`).catch (() => null);
        if (! r?.ok) return null;
        const buf = await r.arrayBuffer();
        try { return await ctx.decodeAudioData (buf); }
        catch (err)
        {
            // Say which file and what arrived, so a report from the phone is enough to fix it.
            const what = which === "backing" ? "минус" : "подсказку";
            throw new Error (`не удалось раскодировать ${what} (${r.headers.get ("Content-Type") || "?"}, `
                             + `${Math.round (buf.byteLength / 1024)} КБ): ${err.message || err.name}`);
        }
    };
    const [backing, reference] = await Promise.all ([fetchAudio ("backing"), fetchAudio ("reference")]);
    const song = { chart: chartJson, backing, reference };
    songCache.clear();
    songCache.set (id, song);
    return song;
}

// A choir piece arrives as one song per part (song.piece / song.part, made by
// pdf_score_to_chart.py), so the choice is two-step: the piece, then the part.
// A song without a piece is a piece with one part, and the part row hides.
let pieces = [];            // [{ key, label, parts: [{ id, part, partName }] }]
const songEntries = new Map();
let songsOffline = false;
const PART_ORDER = "SATB";

async function refreshSongList ()
{
    const sel = $("piece");
    try
    {
        // The home server first; without it (the GitHub Pages copy) the published scores.
        let r = await fetch ("api/songs").catch (() => null);
        if (! r?.ok || ! (r.headers.get ("Content-Type") || "").includes ("json"))
            r = await fetch ("songs/index.json");
        songsOffline = r.headers.get ("X-VT-Offline") === "1";
        const list = await r.json();
        songEntries.clear();
        for (const s of list) songEntries.set (s.id, s);
        const byKey = new Map();
        for (const s of list)
        {
            const key = s.piece || s.id;
            if (! byKey.has (key))
            {
                const mail = s.mail || {};
                const p = { key, label: [s.artist, s.pieceTitle || s.title].filter (Boolean).join (" — ") || s.id, parts: [],
                            date: mail.date || "", subject: mail.subject || "", collection: s.collection || "",
                            check: (s.needsCheck || []).join ("; ") };
                if (p.check) p.label = "⚠ " + p.label;    // the parse looked wrong: check against the PDF
                // Everything a search may hit: names, the letter, the collection, the words.
                // The words come as syllables ("Гос по ди"), so they are also kept run together.
                p.haystack = norm ([p.label, p.subject, p.collection, s.lyrics, (s.lyrics || "").replace (/\s+/g, ""),
                                    fmtDate (p.date), p.date].join (" "));
                byKey.set (key, p);
            }
            byKey.get (key).parts.push ({ id: s.id, part: s.part || "", partName: s.partName || "" });
        }
        pieces = [...byKey.values()];
        for (const p of pieces) p.parts.sort ((a, b) => PART_ORDER.indexOf (a.part) - PART_ORDER.indexOf (b.part));
        // The newest letter first; pieces that came without a letter after them, by name.
        pieces.sort ((a, b) => (b.date > a.date) - (b.date < a.date) || a.label.localeCompare (b.label, "ru"));
        renderPieces();
    }
    catch { sel.innerHTML = `<option value="">(сервер недоступен)</option>`; fillParts (null); }
}

const norm = (s) => (s || "").toLowerCase().replace (/ё/g, "е");
const fmtDate = (iso) => iso ? iso.slice (0, 10).split ("-").reverse().join (".") : "";

// The piece list as filtered by the search box: every word typed must occur somewhere.
function renderPieces ()
{
    const sel = $("piece");
    const words = norm ($("songSearch").value).split (/\s+/).filter (Boolean);
    const shown = pieces.filter (p => words.every (w => p.haystack.includes (w)));
    sel.innerHTML = "";
    if (! pieces.length) sel.innerHTML = songsOffline ? `<option value="">(сервер недоступен, сохранённых песен нет)</option>`
                                                      : `<option value="">(в библиотеке нет песен)</option>`;
    else if (! shown.length) sel.innerHTML = `<option value="">(ничего не найдено)</option>`;
    for (const p of shown)
    {
        const o = document.createElement ("option");
        o.value = p.key;
        o.textContent = (songsOffline ? "(без сервера) " : "") + (p.date ? fmtDate (p.date) + " · " : "") + p.label;
        sel.appendChild (o);
    }
    $("searchCount").textContent = words.length ? `${shown.length} из ${pieces.length}` : "";
    const cur = shown.find (p => p.parts.some (x => x.id === S.song)) || shown[0];
    if (cur) choosePiece (cur.key, S.song);
    else { fillParts (null); $("pieceInfo").textContent = ""; }
}

// Keeps the part across pieces: a tenor opening another piece gets its tenor part.
function choosePiece (key, songId)
{
    const p = pieces.find (x => x.key === key);
    if (! p) return;
    const pick = p.parts.find (x => x.id === songId) || p.parts.find (x => x.part === S.part) || p.parts[0];
    S.song = pick.id; save();
    $("piece").value = key;
    fillParts (p);
    // Where it came from: the letter and the collection, for finding it again later.
    $("pieceInfo").textContent = [p.check && `⚠ разбор под вопросом: ${p.check}`,
                                  p.date && `письмо ${fmtDate (p.date)}`, p.subject && `«${p.subject}»`, p.collection]
        .filter (Boolean).join (" · ");
}

function fillParts (p)
{
    const sel = $("part");
    sel.innerHTML = "";
    $("partRow").hidden = ! p || p.parts.length < 2;
    if (! p) return;
    for (const x of p.parts)
    {
        const o = document.createElement ("option");
        o.value = x.id;
        o.textContent = x.partName || x.part || x.id;
        sel.appendChild (o);
    }
    sel.value = S.song;
}

function songTitle ()
{
    const p = pieces.find (x => x.parts.some (y => y.id === S.song));
    if (! p) return "Песня";
    const part = p.parts.find (y => y.id === S.song);
    return p.label + (p.parts.length > 1 && part.partName ? " · " + part.partName : "");
}

async function saveTake ()
{
    if (! chart) return;
    const body = {
        kind: S.mode === "song" ? "song" : "exercise",
        id: S.mode === "song" ? S.song : S.kind,
        title: chart.song.title || "",
        startedAt: new Date().toISOString(),
        settings: { bpm: S.bpm, root: S.root, tolerance: S.tolerance, clef: S.clef },
        percent: overallPercent(),
        phrases: (chart.phrases || []).map (p => ({ text: p.text, percent: phrasePercent (p) })),
        notes: chart.notes.map ((n, i) => ({
            midi: n.midi, startSeconds: n.startSeconds,
            sungMidi: Number.isFinite (median (noteStats[i].sung)) ? +median (noteStats[i].sung).toFixed (2) : null,
            cents: Number.isFinite (median (noteStats[i].folded)) ? Math.round (median (noteStats[i].folded)) : null,
            hitPercent: Math.round (100 * Math.min (1, noteStats[i].hit / expectedFrames (n))),
        })),
    };
    try { await fetch ("api/takes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify (body) }); }
    catch {}
}

function overallPercent ()
{
    if (! chart) return 0;
    let hit = 0, total = 0;
    chart.notes.forEach ((n, i) => { hit += noteStats[i].hit; total += expectedFrames (n); });
    return total ? Math.round (100 * hit / total) : 0;
}

//==============================================================================
// Summary
function showSummary ()
{
    const rows = (chart.phrases || []).map (p => {
        const pc = phrasePercent (p);
        return `<tr><td>${esc (p.text || "")}</td><td class="${pc >= 60 ? "ok" : "bad"}">${pc}%</td></tr>`;
    }).join ("");

    // Notes most out of tune, by median folded cents.
    const worst = chart.notes.map ((n, i) => ({ n, c: median (noteStats[i].folded) }))
        .filter (x => Number.isFinite (x.c))
        .reduce ((acc, x) => { const k = x.n.midi; (acc[k] ||= []).push (x.c); return acc; }, {});
    const perPitch = Object.entries (worst).map (([m, cs]) => ({ m: +m, c: Math.round (median (cs)) }))
        .sort ((a, b) => a.m - b.m)
        .map (x => `<span class="pitch ${Math.abs (x.c) <= TOLERANCES[S.tolerance][0] ? "ok" : "bad"}">${label (x.m)} ${x.c > 0 ? "+" : ""}${x.c}¢</span>`)
        .join ("");

    $("summary").innerHTML = `
        <h2>${overallPercent()}% в тоне</h2>
        <div class="pitches">${perPitch || "нет данных"}</div>
        <table>${rows}</table>
        <button id="sumClose">Закрыть</button>`;
    $("summary").hidden = false;
    $("sumClose").onclick = hideSummary;
    saveTake();
}
const hideSummary = () => { $("summary").hidden = true; };
const esc = (s) => s.replace (/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

//==============================================================================
// Rendering
let viewLow = 48, viewSpan = 14, viewInit = false, lastFrame = performance.now();

function fitCanvas (cv)
{
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    const w = Math.max (1, Math.round (r.width * dpr)), h = Math.max (1, Math.round (r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext ("2d");
    g.setTransform (dpr, 0, 0, dpr, 0, 0);
    return [g, r.width, r.height];
}

function updateView (now, dt)
{
    let lo = Infinity, hi = -Infinity;
    if (chart && chart.notes.length)
    {
        for (const horizon of [8, 15])
        {
            for (const n of chart.notes)
                if (n.startSeconds + n.durationSeconds >= now - HISTORY && n.startSeconds <= now + horizon)
                { lo = Math.min (lo, n.midi); hi = Math.max (hi, n.midi); }
            if (lo <= hi) break;
        }
        if (lo > hi) { lo = chart.notes[0].midi; hi = lo; }
    }
    else
    {
        const recent = estimates.filter (e => Number.isFinite (e.smooth)).slice (-125).map (e => e.smooth);
        const m = recent.length ? median (recent) : 52;
        lo = m; hi = m;
    }
    let span = Math.max (12, hi - lo + 6);
    let low = (lo + hi) / 2 - span / 2;
    if (! viewInit) { viewLow = low; viewSpan = span; viewInit = true; }
    const k = Math.min (1, dt * 2.5);
    viewLow += (low - viewLow) * k;
    viewSpan += (span - viewSpan) * k;
}

// Time axis of the highway, shared with the lyric line so a word sits under its note.
function laneGeometry (W)
{
    const gutter = S.labels === "fixed" ? 38 : 30;
    const laneW = W - gutter;
    return { gutter, pps: laneW / SPAN, nowX: gutter + laneW * (HISTORY / SPAN) };
}

function drawHighway (now)
{
    const [g, W, H] = fitCanvas ($("highway"));
    g.fillStyle = C.bg; g.fillRect (0, 0, W, H);

    const { gutter, pps, nowX } = laneGeometry (W);
    const ppSemi = H / viewSpan;
    const yOf = (m) => H - (m - viewLow) * ppSemi;
    const xOf = (t) => nowX + (t - now) * pps;
    const [full, zero] = TOLERANCES[S.tolerance];

    // Semitone grid + labels.
    g.font = "10px -apple-system, system-ui, sans-serif";
    g.textBaseline = "middle"; g.textAlign = "left";
    for (let m = Math.floor (viewLow); m <= Math.ceil (viewLow + viewSpan); ++m)
    {
        const y = Math.round (yOf (m)) + 0.5;
        const isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = isC ? C.gridC : C.grid; g.lineWidth = 1;
        g.beginPath(); g.moveTo (gutter, y); g.lineTo (W, y); g.stroke();
        if (ppSemi >= 9 || isC) { g.fillStyle = C.label; g.fillText (label (m), 3, y); }
    }

    if (chart)
    {
        // Reference ghost contour (songs).
        const ct = chart.contour;
        if (ct && ct.fracMidi)
        {
            g.strokeStyle = C.ghost; g.lineWidth = 1; g.beginPath();
            const i0 = Math.max (0, Math.floor ((now - HISTORY - ct.startSeconds) * ct.rateHz));
            const i1 = Math.min (ct.fracMidi.length - 1, Math.ceil ((now + SPAN - ct.startSeconds) * ct.rateHz));
            let pen = false;
            for (let i = i0; i <= i1; ++i)
            {
                const v = ct.fracMidi[i];
                if (v == null) { pen = false; continue; }
                const x = xOf (ct.startSeconds + i / ct.rateHz), y = yOf (v);
                pen ? g.lineTo (x, y) : g.moveTo (x, y); pen = true;
            }
            g.stroke();
        }

        // Target bars: drawn height = 2 x tFullCents; halo = tZeroCents.
        const barH = Math.max (4, 2 * full / 100 * ppSemi), haloH = 2 * zero / 100 * ppSemi;
        chart.notes.forEach ((n, i) => {
            const x0 = xOf (n.startSeconds), x1 = xOf (n.startSeconds + n.durationSeconds);
            if (x1 < gutter || x0 > W) return;
            const y = yOf (targetMidiOf (n));
            const active = now >= n.startSeconds && now <= n.startSeconds + n.durationSeconds;
            const past = now > n.startSeconds + n.durationSeconds;

            g.fillStyle = "rgba(86,180,233,0.12)";
            g.fillRect (x0, y - haloH / 2, x1 - x0, haloH);

            let fill = C.barFill, edge = C.barEdge, labelColour = "#cfe9f8";
            if (active) { fill = C.active; labelColour = "#0b2233"; }
            else if (past && noteStats[i] && noteStats[i].frames > 0)
            {
                const pc = noteStats[i].hit / expectedFrames (n);
                const c = pc >= 0.6 ? "0,158,115" : pc >= 0.3 ? "230,159,0" : "213,94,0";
                fill = `rgba(${c},0.55)`; edge = `rgb(${c})`; labelColour = "#eee";
            }
            roundRect (g, x0, y - barH / 2, Math.max (2, x1 - x0), barH, Math.min (4, barH / 2));
            g.fillStyle = fill; g.fill();
            g.strokeStyle = edge; g.lineWidth = 1; g.stroke();

            // The name lives IN the bar, shrinking to fit (DESIGN.md M6++), so
            // the eye never leaves the pitch to find out what the note is called.
            const text = label (n.midi);
            let fs = Math.min (13, barH - 2);
            g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
            const w = g.measureText (text).width;
            if (w > x1 - x0 - 6) fs = Math.floor (fs * (x1 - x0 - 6) / w);
            if (fs >= 7)
            {
                g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
                g.fillStyle = labelColour; g.textAlign = "left"; g.textBaseline = "middle";
                g.fillText (text, x0 + 3, y + 0.5);
            }
        });
    }

    // Live trace: smoothed, octave-folded onto the note it was sung against.
    const visible = estimates.filter (e => e.tc >= now - HISTORY - 0.1 && e.tc <= now + 0.05);
    const yForEst = (e, v) => {
        const ri = chart ? referenceNoteAt (e.tc) : -1;
        if (ri < 0) return [v, null];
        const tgt = targetMidiOf (chart.notes[ri]);
        const f = foldTo (v, tgt);
        return [f, (f - tgt) * 100];
    };

    // Raw trail, last 500 ms.
    let prev = null;
    for (const e of visible)
    {
        if (e.tc < now - 0.5 || ! Number.isFinite (e.raw)) { prev = null; continue; }
        const [v] = yForEst (e, e.raw);
        if (prev && Math.abs (v - prev.v) < 1 && e.tc - prev.t < 0.04)
        {
            const a = 0.6 * (1 - (now - e.tc) / 0.5);
            g.strokeStyle = `rgba(200,200,210,${Math.max (0, a)})`; g.lineWidth = 2;
            g.beginPath(); g.moveTo (xOf (prev.t), yOf (prev.v)); g.lineTo (xOf (e.tc), yOf (v)); g.stroke();
        }
        prev = { t: e.tc, v };
    }

    // Smoothed core, 3 px scaled by level.
    prev = null;
    g.lineCap = "round";
    for (const e of visible)
    {
        if (! Number.isFinite (e.smooth)) { prev = null; continue; }
        const [v, cents] = yForEst (e, e.smooth);
        if (prev && Math.abs (v - prev.v) < 1 && e.tc - prev.t < 0.04)
        {
            g.strokeStyle = cents == null ? "#9ad" : colourFor (cents);
            g.lineWidth = 3 * Math.min (1.6, Math.max (0.5, 1 + e.rmsDb / 60));
            g.beginPath(); g.moveTo (xOf (prev.t), yOf (prev.v)); g.lineTo (xOf (e.tc), yOf (v)); g.stroke();
        }
        prev = { t: e.tc, v };
    }

    // Head dot.
    const last = visible.length ? visible[visible.length - 1] : null;
    if (last && Number.isFinite (last.smooth) && performance.now() - last.wall < 120)
    {
        const [v, cents] = yForEst (last, last.smooth);
        const col = cents == null ? "#9ad" : colourFor (cents);
        g.beginPath(); g.arc (xOf (last.tc), yOf (v), 5.5, 0, Math.PI * 2);
        g.fillStyle = col; g.fill();
        g.lineWidth = 2; g.strokeStyle = "#fff"; g.stroke();
        const oct = Math.round ((last.smooth - v) / 12);
        if (oct !== 0)
        {
            g.font = "600 10px -apple-system, system-ui, sans-serif"; g.fillStyle = "#ccc";
            g.textAlign = "left"; g.fillText (`${oct > 0 ? "+" : ""}${oct} 8ve`, xOf (last.tc) + 9, yOf (v) - 10);
        }
    }

    // Now-line.
    g.strokeStyle = C.nowLine; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo (nowX, 0); g.lineTo (nowX, H); g.stroke();
}

function roundRect (g, x, y, w, h, r)
{
    g.beginPath();
    g.moveTo (x + r, y); g.lineTo (x + w - r, y); g.quadraticCurveTo (x + w, y, x + w, y + r);
    g.lineTo (x + w, y + h - r); g.quadraticCurveTo (x + w, y + h, x + w - r, y + h);
    g.lineTo (x + r, y + h); g.quadraticCurveTo (x, y + h, x, y + h - r);
    g.lineTo (x, y + r); g.quadraticCurveTo (x, y, x + r, y);
}

function drawStaffPanel (now)
{
    const cv = $("staff");
    const [g, W, H] = fitCanvas (cv);
    const live = liveEst && Number.isFinite (liveEst.smooth) && performance.now() - liveEst.wall < 150 ? liveEst : null;

    let notes = [];
    const activeIdx = chart ? noteIndexAt (now) : -1;
    const ph = chart ? phraseAt (now) : null;

    if (ph)
    {
        let idx = ph.noteIds.map (id => chart.notes.findIndex (n => n.id === id)).filter (i => i >= 0);
        const maxCols = Math.max (4, Math.floor (W / 30));
        if (idx.length > maxCols)
        {
            const a = Math.max (0, idx.indexOf (activeIdx));
            const page = Math.floor (a / maxCols);
            idx = idx.slice (page * maxCols, page * maxCols + maxCols);
        }
        notes = idx.map (i => {
            const n = chart.notes[i], st = noteStats[i];
            const past = now > n.startSeconds + n.durationSeconds;
            const state = i === activeIdx ? "active" : past ? "past" : "future";
            let sung = null;
            if (past && st.sung.length)
            {
                const c = median (st.folded);
                sung = { midi: Math.round (median (st.sung)), cents: c, colour: colourFor (c) };
            }
            return { midi: n.midi, state, sung, syllable: n.syllable };
        });
    }

    let liveView = null;
    if (live)
    {
        let cents = null;
        if (activeIdx >= 0) cents = remainder (live.smooth - targetMidiOf (chart.notes[activeIdx]), 12) * 100;
        liveView = { midi: Math.round (live.smooth), cents, colour: cents == null ? "#9ad" : colourFor (cents) };
    }

    drawStaff (g, W, H, { mode: S.clef, showNames: S.names, notes, live: liveView, range: chartRange(), label });

    // Readout under the staff.
    const target = activeIdx >= 0 ? chart.notes[activeIdx] : null;
    let txt = "";
    if (target) txt += `Нужно: <b class="t">${labelLong (target.midi)}</b>`;
    if (liveView)
    {
        const c = liveView.cents;
        txt += `${txt ? " · " : ""}Поёте: <b style="color:${liveView.colour}">${labelLong (liveView.midi)}</b>`;
        if (c != null) txt += ` <span class="cents">${c > 0 ? "+" : ""}${Math.round (c)}¢</span>`;
        else { const fc = Math.round ((live.smooth - Math.round (live.smooth)) * 100); txt += ` <span class="cents">${fc > 0 ? "+" : ""}${fc}¢</span>`; }
    }
    $("readout").innerHTML = txt || "&nbsp;";
}

// Whole-chart pitch range, cached per chart: the staff's scale comes from it.
let rangeFor = null, rangeVal = null;
function chartRange ()
{
    if (! chart || ! chart.notes.length) return null;
    if (rangeFor !== chart)
    {
        let lo = Infinity, hi = -Infinity;
        for (const n of chart.notes) { lo = Math.min (lo, n.midi); hi = Math.max (hi, n.midi); }
        rangeFor = chart; rangeVal = [lo - 2, hi + 2];      // a third of room for a stray voice
    }
    return rangeVal;
}

// Each word starts where its note starts and scrolls with the highway, so the word
// being sung is always at the play line, under the bar it belongs to.
function drawLyrics (now)
{
    const el = $("lyrics");
    if (! chart) { if (el.dataset.key !== "free") { el.dataset.key = "free"; el.innerHTML = `<span class="hint">Свободное пение — пойте любую ноту</span>`; } return; }

    const W = el.clientWidth;
    const { gutter, pps, nowX } = laneGeometry (W);
    const xOf = (t) => nowX + (t - now) * pps;
    const words = [];
    for (const n of chart.notes)
    {
        const text = chart.exercise ? label (n.midi) : n.syllable;
        if (! text) continue;
        const x = xOf (n.startSeconds);
        if (x > W || xOf (n.startSeconds + n.durationSeconds) < gutter - 200) continue;
        const cls = now > n.startSeconds + n.durationSeconds ? "sung" : now >= n.startSeconds ? "now" : "";
        words.push ({ id: n.id, text, x, cls });
    }

    // Rebuild the spans only when the set of words or their states change; move them every frame.
    const key = words.map (w => w.id + w.cls).join ("|") + S.labels;
    if (el.dataset.key !== key)
    {
        el.dataset.key = key;
        el.innerHTML = words.map (w => `<span class="w ${w.cls}">${esc (w.text)}</span>`).join ("");
    }
    // Words that would print over each other move apart: the current and coming
    // words keep their note's x and push later ones right, sung words give way left.
    const spans = [...el.children], xs = words.map (w => w.x), ws = spans.map (sp => sp.offsetWidth);
    const anchor = Math.max (0, words.findIndex (w => w.cls !== "sung"));
    const first = words.some (w => w.cls !== "sung") ? anchor : words.length;
    for (let i = first + 1; i < words.length; ++i) xs[i] = Math.max (xs[i], xs[i - 1] + ws[i - 1] + 6);
    for (let i = first - 1; i >= 0; --i)
        if (i + 1 < words.length) xs[i] = Math.min (xs[i], xs[i + 1] - ws[i] - 6);
    spans.forEach ((sp, i) => sp.style.transform = `translateX(${xs[i].toFixed (1)}px)`);
}

function drawFooter (now)
{
    const e = liveEst;
    const parts = [];
    if (e && Number.isFinite (e.smooth) && chart)
    {
        const i = noteIndexAt (now);
        if (i >= 0) { const c = Math.round (remainder (e.smooth - targetMidiOf (chart.notes[i]), 12) * 100); parts.push (`${c > 0 ? "+" : ""}${c} cents`); }
    }
    if (e) parts.push (`clarity ${e.clarity.toFixed (2)}`, `level ${e.rmsDb.toFixed (0)} dB`);
    const ph = chart && running ? phraseAt (now) : null;
    if (ph) parts.push (`фраза ${phrasePercent (ph)}%`);
    $("footer").textContent = parts.join ("  |  ");
}

// The button's fill IS the input level: -60 dBFS empty, -12 dBFS full. It
// brightens while the voicing gate is open, so "it hears me" and "it is
// tracking my pitch" are both visible without looking at the footer.
let shownLevel = 0;
function updateMicLevel ()
{
    const b = $("mic");
    if (! micSource) return;
    const e = liveEst, fresh = e && performance.now() - e.wall < 200;
    const target = fresh ? Math.max (0, Math.min (1, (e.rmsDb + 60) / 48)) : 0;
    shownLevel = target > shownLevel ? target : shownLevel * 0.9 + target * 0.1;
    b.style.setProperty ("--lvl", shownLevel.toFixed (3));
    b.classList.toggle ("voiced", !! (fresh && Number.isFinite (e.smooth)));
}

function frame ()
{
    const t = performance.now(), dt = (t - lastFrame) / 1000; lastFrame = t;
    let now;
    if (running) now = chartNow();
    else if (chart) now = lastChartNow;
    else now = ctx ? ctx.currentTime : 0;

    updateMicLevel();
    updateView (now, dt);
    drawHighway (now);
    drawStaffPanel (now);
    drawLyrics (now);
    drawFooter (now);

    // Constrain the detector to the note at hand, as the desktop app does.
    if (workletNode)
    {
        let target = 0;
        if (chart && running)
        {
            let i = noteIndexAt (now + 0.05);
            if (i < 0) i = referenceNoteAt (now + 0.6);
            if (i < 0) i = referenceNoteAt (now);
            if (i >= 0) target = chart.notes[i].midi;
        }
        if (target !== frame.lastTarget) { workletNode.port.postMessage ({ targetMidi: target }); frame.lastTarget = target; }
    }

    if (running && chart && now > chart.song.durationSeconds) stop (true);
    requestAnimationFrame (frame);
}

//==============================================================================
// Wake lock
let wakeLock = null;
async function requestWakeLock () { try { wakeLock = await navigator.wakeLock?.request ("screen"); } catch {} }
function releaseWakeLock () { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener ("visibilitychange", () => { if (document.visibilityState === "visible" && running) requestWakeLock(); });

//==============================================================================
// UI
function updateTitle ()
{
    let t;
    if (S.mode === "exercise") { const d = getDefinition (S.kind); t = d.name + (d.fixedRoot ? "" : ` · от ${noteName (S.root)}`); }
    else if (S.mode === "song") t = songTitle();
    else t = "Свободное пение";
    $("titleText").textContent = t;
}

function openSettings () { syncForm(); $("settings").hidden = false; }
function closeSettings () { $("settings").hidden = true; updateTitle(); previewChart(); }

function syncForm ()
{
    document.querySelectorAll ("[data-mode]").forEach (b => b.classList.toggle ("sel", b.dataset.mode === S.mode));
    $("exBlock").hidden = S.mode !== "exercise";
    $("songBlock").hidden = S.mode !== "song";
    $("kind").value = S.kind;
    $("purpose").textContent = getDefinition (S.kind).purpose;
    $("root").value = S.root;
    $("root").disabled = getDefinition (S.kind).fixedRoot > 0;
    $("bpm").value = S.bpm; $("bpmVal").textContent = S.bpm;
    $("length").value = S.length;
    $("labels").value = S.labels;
    $("clef").value = S.clef;
    $("names").checked = S.names;
    $("tolerance").value = S.tolerance;
    $("guideVol").value = S.guideVol;
    $("backVol").value = S.backVol;
    $("latency").value = S.latencyMs; $("latVal").textContent = S.latencyMs;
}

// Shows the next exercise on the staff and highway before Start is pressed.
function previewChart ()
{
    if (running) return;
    if (S.mode === "exercise") prepareChart (buildChart (makeSpec (S.kind, S.root, S.bpm, LENGTHS[S.length], false)));
    else if (S.mode === "free") { chart = null; estimates = []; }
    else if (S.mode === "song" && songCache.has (S.song)) prepareChart (songCache.get (S.song).chart);
    else chart = null;
    updateTitle();
}

function buildForm ()
{
    const kind = $("kind");
    for (const d of DEFINITIONS) { const o = document.createElement ("option"); o.value = d.kind; o.textContent = d.name; kind.appendChild (o); }
    const root = $("root");
    for (let m = 40; m <= 72; ++m) { const o = document.createElement ("option"); o.value = m; o.textContent = noteName (m); root.appendChild (o); }

    document.querySelectorAll ("[data-mode]").forEach (b => b.onclick = () => {
        S.mode = b.dataset.mode; save(); syncForm();
        if (S.mode === "song") refreshSongList();
    });
    const bind = (id, key, conv = (v) => v, after) => $(id).addEventListener ("input", () => {
        S[key] = conv ($(id).type === "checkbox" ? $(id).checked : $(id).value); save(); syncForm(); applyLevels(); after && after();
    });
    // The title on the main screen is the song picker: one tap to piece and part.
    $("title").onclick = () => {
        if (running) stop();
        if (S.mode !== "song") { S.mode = "song"; save(); refreshSongList(); }
        openSettings();
        $("songBlock").scrollIntoView ({ block: "start" });
    };
    bind ("kind", "kind");
    bind ("root", "root", Number);
    bind ("bpm", "bpm", Number);
    bind ("length", "length");
    bind ("labels", "labels", v => v, () => { const el = $("lyrics"); el.dataset.key = ""; });
    bind ("clef", "clef");
    bind ("names", "names");
    bind ("tolerance", "tolerance");
    bind ("guideVol", "guideVol", Number);
    bind ("backVol", "backVol", Number);
    bind ("latency", "latencyMs", Number);
    $("piece").addEventListener ("input", () => { choosePiece ($("piece").value); });
    $("songSearch").addEventListener ("input", renderPieces);
    $("part").addEventListener ("input", () => {
        S.song = $("part").value;
        const p = pieces.find (x => x.parts.some (y => y.id === S.song));
        S.part = p?.parts.find (y => y.id === S.song)?.part || S.part;
        save();
    });

    $("menu").onclick = () => { if (running) stop(); openSettings(); };
    $("done").onclick = closeSettings;
    $("play").onclick = () => running ? stop() : start();
    $("guide").onclick = () => { S.guide = ! S.guide; save(); applyLevels(); $("guide").classList.toggle ("on", S.guide); };
    $("guide").classList.toggle ("on", S.guide);
    $("clefBtn").onclick = () => {
        const order = ["bass", "treble", "treble8", "grand"];
        S.clef = order[(order.indexOf (S.clef) + 1) % order.length]; save(); clefLabel();
    };
    clefLabel();

    // Tap the staff to hear the active phrase's nearest note.
    $("staff").addEventListener ("click", async (ev) => {
        if (running || ! chart) return;
        try { await ensureContext(); } catch (e) { $("status").textContent = e.message; return; }
        const ph = phraseAt (lastChartNow);
        if (! ph || ! ph.noteIds.length) return;
        const r = $("staff").getBoundingClientRect();
        const frac = (ev.clientX - r.left) / r.width;
        const ids = ph.noteIds;
        const pick = ids[Math.min (ids.length - 1, Math.max (0, Math.floor ((frac - 0.12) / 0.88 * ids.length)))];
        const n = chart.notes.find (x => x.id === pick);
        if (! n) return;
        const s = ctx.createBufferSource(); s.buffer = renderSingleNote (ctx, n.midi); s.connect (guideGain.gain.value > 0 ? guideGain : clickGain); s.start();
    });

    $("mic").onclick = toggleMic;
    setMicButton ("off");
}

function clefLabel ()
{
    // Symbols, not words: "Бас" / "Тенор" read like choir parts next to the part names.
    $("clefBtn").textContent = { bass: "𝄢", treble: "𝄞", treble8: "𝄞₈", grand: "𝄞𝄢" }[S.clef];
    $("clefBtn").title = { bass: "Басовый ключ", treble: "Скрипичный ключ", treble8: "Скрипичный, октавой ниже",
                           grand: "Оба ключа" }[S.clef];
    $("app").classList.toggle ("grand", S.clef === "grand");   // two staves need a taller panel
}

buildForm();
if (S.mode === "song") refreshSongList().then (previewChart); else previewChart();
requestAnimationFrame (frame);

window.addEventListener ("error", (e) => { $("status").textContent = "JS: " + e.message; });

// Offline use (sw.js). Not inside the Android wrapper: there the files are already local.
askMicAtLaunch();

if ("serviceWorker" in navigator && ! window.Capacitor)
    navigator.serviceWorker.register ("sw.js").catch (() => {});
