// app.js — the phone version of Vocal Trainer: highway + five-line staff.
// Geometry and colours follow DESIGN.md §7; analysis lives in pitch-worklet.js.

import { DEFINITIONS, getDefinition, makeSpec, buildChart, buildDrillChart, LENGTHS, noteName, rootChoices } from "./exercises.js";
import { renderClickTrack, renderGuideTone, renderSingleNote } from "./synth.js";
import { drawStaff, midiName, isSharp } from "./staff.js";
import { stretch, scaleChart, TEMPO_STEPS } from "./tempo.js";
import { pageview, track } from "./analytics.js";
import { readPackage, saveSongs, getSong, deleteSong, hasSong, listSongs as listLocalSongs } from "./localsongs.js";

//==============================================================================
// Settings, remembered per device.
const DEFAULTS = {
    mode: "free", kind: "tenorG3toD4", root: 55, bpm: 72, length: "medium", labels: "fixed",
    clef: "auto", names: true, tolerance: "practice", guide: true, guideVol: 0.8, backVol: 0.8,
    latencyMs: 0, song: "antsev-trisvyatoe-tenor", part: "T", view: "staff", tempo: 1, voice: "",
};
const VOICES = [["S", "сопрано"], ["A", "альт"], ["T", "тенор"], ["B", "бас"]];
// Each voice's range in an Orthodox church choir (not opera): S C4-G5, A G3-C5, T C3-G4,
// B F2-C4. The keyboards and the free piano roll show all of it; the staff's five lines
// are always drawn whole, with their keys, even where the range ends inside them.
const VOICE_RANGE = { S: [60, 79], A: [55, 72], T: [48, 67], B: [41, 60] };
const voiceRange = () => VOICE_RANGE[S.voice] || VOICE_RANGE.T;
// Tenors usually read the bass clef (the user's choir), not the octave treble.
const VOICE_CLEF = { S: "treble", A: "treble", T: "bass", B: "bass" };
const TOLERANCES = { performance: [50, 150], practice: [25, 100], precision: [10, 50] };

let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse (localStorage.getItem ("vt-web") || "{}") }; } catch {}
if (! ["names", "fixed", "movable"].includes (S.labels)) S.labels = DEFAULTS.labels;
const save = () => { try { localStorage.setItem ("vt-web", JSON.stringify (S)); } catch {} };
// Once: the clef became automatic (2026-10-20) - a phone that had "bass" saved switches too.
if (! S.clefAutoSet) { S.clef = "auto"; S.clefAutoSet = true; save(); }
// Once: notes OR piano roll, the notes by default (2026-10-20).
if (! S.viewSet) { S.view = "staff"; S.viewSet = true; save(); }
// Once: the app opens in free singing (2026-10-22), a phone that had a song saved too.
if (! S.freeSet) { S.mode = "free"; S.freeSet = true; save(); }
// A drill lives only in memory: after a reload, back to what it was made from.
if (S.mode === "drill") S.mode = S.drillBack || "exercise";
// Voice type: new to this phone -> what its last part was (the tenor had been the default).
if (! VOICES.some (v => v[0] === S.voice)) { S.voice = VOICES.some (v => v[0] === S.part) ? S.part : "T"; save(); }

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
    workletNode.port.onmessage = (e) => { lastWorkletMsg = performance.now(); if (micSource) onEstimate (e.data); };

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
    // The mic can be taken away from outside (a call, another app, Settings, the
    // screen lock): the track ends. The singer still wants it - see checkAudio().
    micStream.getAudioTracks().forEach (t => t.onended = () => micOff (true));
    if (ctx.state !== "running") await ctx.resume();
    micWanted = true;
    lastWorkletMsg = performance.now();
    setMicButton ("on");
}

// The screen lock (and a call, or another app taking the audio) leaves the page
// with a suspended context and a mic track that is ended or muted for good - and
// the mic button may still say "on". So: whenever the page is in front, if the
// singer had the mic on but it is not delivering (no worklet frames for 1.5 s, or
// its track is ended/muted), resume the context and open the mic afresh. iOS may
// refuse that until a tap: then the status line asks for one, and the tap does it.
let lastWorkletMsg = 0, recovering = false, lastCheck = 0;

function audioDead ()
{
    if (! micWanted) return false;
    if (! ctx || ctx.state !== "running") return true;
    if (! micStream || micStream.getAudioTracks().some (t => t.readyState === "ended" || t.muted)) return true;
    return performance.now() - lastWorkletMsg > 1500;
}

async function recoverAudio ()
{
    if (recovering || ! audioDead()) return;
    recovering = true;
    try
    {
        if (ctx && ctx.state !== "running") { try { await ctx.resume(); } catch {} }
        if (audioDead())
        {
            micOff (true);
            await micOn();
        }
        if (! audioDead() && $("status").dataset.mic) { $("status").textContent = ""; delete $("status").dataset.mic; }
    }
    catch {}
    finally { recovering = false; }
    if (audioDead())
    {
        $("status").textContent = "Коснитесь экрана, чтобы вернуть микрофон";
        $("status").dataset.mic = "1";
        if (! tapArmed)
        {
            tapArmed = true;
            addEventListener ("pointerdown", () => { tapArmed = false; recoverAudio(); }, { once: true, capture: true });
        }
    }
}
let tapArmed = false;

function checkAudio ()
{
    const t = performance.now();
    if (t - lastCheck < 1000 || document.visibilityState !== "visible") return;
    lastCheck = t;
    if (audioDead()) recoverAudio();
}

// keepWanted: closed from outside or to be reopened - the singer did not switch it off.
function micOff (keepWanted = false)
{
    if (! keepWanted) micWanted = false;
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
    clefLabel();            // an automatic clef follows the new notes
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
    track ("start", S.mode);

    try
    {
        if (S.mode === "exercise" || (S.mode === "drill" && drillChart))
        {
            prepareChart (S.mode === "drill" ? drillChart : exerciseChart());
            const click = renderClickTrack (ctx, chart), guide = renderGuideTone (ctx, chart);
            schedule ([[click, clickGain], [guide, guideGain]]);
        }
        else if (S.mode === "song")
        {
            if (! S.song) { openSettings(); return; }
            $("status").textContent = "Загрузка песни…";
            const song = await loadSong (S.song);
            const decks = await songDecks (song);
            prepareChart (scaleChart (song.chart, S.tempo));
            earlyAsked = false;
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

function schedule (decks, from = 0)
{
    const at = ctx.currentTime + 0.25;
    t0 = at - from;
    for (const [buf, gain] of decks)
    {
        const s = ctx.createBufferSource();
        s.buffer = buf; s.connect (gain); s.start (at, Math.min (from, Math.max (0, buf.duration - 0.01)));
        sources.push (s);
    }
    if (from === 0) estimates = [];
    running = true;
    setButton (true);
}

function stopSources ()
{
    for (const s of sources) { try { s.stop(); } catch {} }
    sources = [];
}

// review: stopped with the Stop button part way - the summary (and the drill made
// from it) covers what was sung so far. Not when a menu stops playback.
function stop (finished = false, review = false)
{
    const wasRunning = running;
    if (running) lastChartNow = chartNow();
    running = false;
    stopSources();
    setButton (false);
    releaseWakeLock();
    if (chart && (finished || (review && wasRunning && sungSoFar() >= 3))) showSummary();
}

// Notes already past that the voice was heard on.
const sungSoFar = () => chart.notes.filter ((n, i) => n.startSeconds + n.durationSeconds <= lastChartNow
                                                      && noteStats[i].sung.length >= 5).length;

function setButton (on)
{
    $("play").textContent = on ? "■" : "▶";
    $("play").dataset.label = on ? "Стоп" : "Старт";
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
    // Added on this phone: chart and audio come from IndexedDB, not the network.
    const local = e.local ? await getSong (id) : null;
    if (e.local && ! local) throw new Error ("песня не найдена на телефоне - добавьте zip ещё раз");
    let chartJson = local?.chart;
    if (! chartJson)
    {
        const chartResp = await fetch (e.chart || `${api}/chart`).catch (() => null);
        if (! chartResp?.ok) throw new Error (offline);
        chartJson = await chartResp.json();
    }
    const fetchAudio = async (which) => {
        const r = local ? (local.audio[which] && new Response (local.audio[which], { headers: { "Content-Type": local.audio[which].type } }))
                        : await fetch (e[which] || `${api}/audio/${which}`).catch (() => null);
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
    try
    {
        // The home server first; without it (the GitHub Pages copy) the published scores.
        let r = await fetch ("api/songs").catch (() => null);
        if (! r?.ok || ! (r.headers.get ("Content-Type") || "").includes ("json"))
            r = await fetch ("songs/index.json").catch (() => null);
        songsOffline = ! r?.ok || r.headers.get ("X-VT-Offline") === "1";
        // Songs added on this phone (localsongs.js) go first; they need no server.
        const local = await listLocalSongs();
        const remote = r?.ok ? await r.json().catch (() => []) : [];
        if (! r?.ok && ! local.length) throw new Error ("no songs");
        const list = [...local, ...remote];
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
                if (s.local) { p.local = true; p.label = "📱 " + p.label; }
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
        // Added on this phone first, then the newest letter; pieces without a letter after them, by name.
        pieces.sort ((a, b) => (b.local || 0) - (a.local || 0) || (b.date > a.date) - (b.date < a.date)
                               || a.label.localeCompare (b.label, "ru"));
        renderPieces();
    }
    catch { $("pieceList").innerHTML = `<p class="note">Сервер недоступен</p>`; fillParts (null); syncDeleteButton(); }
}

const norm = (s) => (s || "").toLowerCase().replace (/ё/g, "е");
const fmtDate = (iso) => iso ? iso.slice (0, 10).split ("-").reverse().join (".") : "";

// The piece list as filtered by the search box: every word typed must occur somewhere.
// Typing only filters: the chosen song stays chosen until a piece is tapped.
function renderPieces ()
{
    const list = $("pieceList");
    const words = norm ($("songSearch").value).split (/\s+/).filter (Boolean);
    const shown = pieces.filter (p => words.every (w => p.haystack.includes (w)));
    list.innerHTML = "";
    if (! pieces.length) list.innerHTML = `<p class="note">${songsOffline ? "Сервер недоступен, сохранённых песен нет" : "В библиотеке нет песен"}</p>`;
    else if (! shown.length) list.innerHTML = `<p class="note">Ничего не найдено</p>`;
    for (const p of shown)
    {
        const b = document.createElement ("button");
        b.className = "pi"; b.dataset.key = p.key;
        b.innerHTML = esc (p.label) + (p.date ? `<small>${fmtDate (p.date)}</small>` : "")
                    + (songsOffline && ! p.local ? "<small>(без сервера)</small>" : "");
        b.onclick = () => pickPiece (p.key);
        list.appendChild (b);
    }
    $("searchCount").textContent = words.length ? `${shown.length} из ${pieces.length}` : "";
    const cur = pieces.find (p => p.parts.some (x => x.id === S.song)) || pieces[0];
    if (cur) choosePiece (cur.key, S.song);
    else { fillParts (null); $("pieceInfo").textContent = ""; }
}

// A tap in the list: that piece (in the singer's part), the sheet closes.
function pickPiece (key)
{
    S.mode = "song"; save();
    choosePiece (key);
    if (! pieces.find (p => p.key === key)?.local) track ("piece", key);   // not phone-only uploads
    $("songSheet").hidden = true;
    songChanged();
}

// Keeps the part across pieces: a tenor opening another piece gets its tenor part.
function choosePiece (key, songId)
{
    const p = pieces.find (x => x.key === key);
    if (! p) return;
    const pick = p.parts.find (x => x.id === songId) || p.parts.find (x => x.part === S.voice) || p.parts[0];
    S.song = pick.id; save();
    document.querySelectorAll ("#pieceList .pi").forEach (b => b.classList.toggle ("sel", b.dataset.key === key));
    fillParts (p);
    syncDeleteButton();
    // Where it came from: the letter and the collection, for finding it again later.
    $("pieceInfo").textContent = [p.check && `⚠ разбор под вопросом: ${p.check}`,
                                  p.date && `письмо ${fmtDate (p.date)}`, p.subject && `«${p.subject}»`, p.collection]
        .filter (Boolean).join (" · ");
    updateTitle();
}

// Партия: a button on the main screen, shown when the piece has more than one part.
let currentPiece = null;
function fillParts (p)
{
    currentPiece = p;
    const list = $("partList");
    list.innerHTML = "";
    for (const x of p ? p.parts : [])
    {
        const b = document.createElement ("button");
        b.textContent = x.partName || x.part || x.id;
        b.classList.toggle ("sel", x.id === S.song);
        b.onclick = () => {
            S.song = x.id; S.part = x.part || S.part; save();
            $("partSheet").hidden = true;
            fillParts (p); syncDeleteButton(); songChanged();
        };
        list.appendChild (b);
    }
    updatePartBtn();
}

function updatePartBtn ()
{
    const p = currentPiece, x = p?.parts.find (y => y.id === S.song);
    $("partBtn").hidden = S.mode !== "song" || ! p || p.parts.length < 2;
    $("partText").textContent = x ? (x.partName || x.part || "") : "";
}

function songChanged ()
{
    if (running) stop();
    updateTitle();
    previewChart();
}

//==============================================================================
// Темп: slower or faster than written, as a percentage. Exercises and drills are
// rebuilt at the new bpm; a song's recordings are stretched (tempo.js) without
// changing their pitch, and its chart runs on the stretched clock.
function tempoLabel ()
{
    $("tempoText").textContent = Math.round (S.tempo * 100) + "%";
    $("tempoBtn").classList.toggle ("on", S.tempo !== 1);
}

function renderTempo ()
{
    $("tempoVal").textContent = Math.round (S.tempo * 100) + "%";
    const list = $("tempoPresets");
    list.innerHTML = "";
    for (const f of TEMPO_STEPS)
    {
        const b = document.createElement ("button");
        b.textContent = Math.round (f * 100) + "%";
        b.classList.toggle ("sel", Math.abs (f - S.tempo) < 1e-3);
        b.onclick = () => setTempo (f);
        list.appendChild (b);
    }
}

function setTempo (f)
{
    if (running) stop();
    S.tempo = Math.round (Math.min (1.5, Math.max (0.5, f)) * 100) / 100; save();
    if (S.mode === "drill" && drillChart)
    {
        const part = drillChart.song.part;
        drillChart = buildDrillChart (drillChart.spots, Math.round (60 * S.tempo));
        if (part) drillChart.song.part = part;
    }
    tempoLabel(); renderTempo(); previewChart();
}

// The root the singer chose counts only for the voice it was chosen for; a new voice
// starts its exercises where they sit in that voice (exercises.js defaultRoot).
const chosenRoot = () => S.rootVoice === S.voice ? S.root : null;
const exerciseSpec = () => makeSpec (S.kind, chosenRoot(), Math.round (S.bpm * S.tempo), LENGTHS[S.length], false, voiceRange());
const exerciseChart = () => buildChart (exerciseSpec());

// A song's audio at the current tempo: stretched once, kept with the song.
async function songDecks (song)
{
    const f = S.tempo;
    let b = song;
    if (Math.abs (f - 1) > 1e-3)
    {
        if (song.stretchedFor !== f)
        {
            $("status").textContent = `Готовлю темп ${Math.round (f * 100)}%…`;
            await new Promise (r => setTimeout (r, 40));       // let that line show first
            song.stretched = { backing: song.backing && stretch (ctx, song.backing, f),
                               reference: song.reference && stretch (ctx, song.reference, f) };
            song.stretchedFor = f;
            $("status").textContent = "";
        }
        b = song.stretched;
    }
    return [b.backing && [b.backing, backGain], b.reference && [b.reference, guideGain]].filter (Boolean);
}

//==============================================================================
// Adding a song on THIS device: a zip with chart.json + stems (e.g. one sent in
// Telegram) is unpacked here in the browser and kept in IndexedDB (localsongs.js).
// No server is involved, so it works on the public site and offline.
function uploadSay (html) { $("uploadInfo").innerHTML = html; }

async function addSongFile (file)
{
    const btn = $("addSongBtn");
    btn.disabled = true;
    try
    {
        if (! /\.zip$/i.test (file.name))
            throw new Error ("нужен zip-архив песни: chart.json + голос и минус (WAV, FLAC, MP3 или M4A)");
        const songs = await readPackage (file, (m) => uploadSay (esc (m)));
        const clash = [];
        for (const s of songs) if (await hasSong (s.id)) clash.push (s.chart.song.title || s.id);
        if (clash.length && ! confirm (`Уже есть на телефоне: ${clash.join (", ")}. Заменить?`))
        { uploadSay ("Отменено."); return; }
        uploadSay ("сохраняю на телефоне…");
        await saveSongs (songs);
        S.song = songs[0].id; save();
        $("songSearch").value = "";
        songCache.clear();
        await refreshSongList();
        uploadSay (`<span class="ok">✓ Добавлено: ${songs.map (s => esc (s.chart.song.title || s.id)).join (", ")}.</span>
                    Выбрана — «Готово» и ▶.`);
    }
    catch (err) { uploadSay (`<span class="bad">Не добавлено: ${esc (String (err.message || err))}</span>`); }
    finally { btn.disabled = false; $("addSongFile").value = ""; }
}

// Only a song added on this phone can be removed from it.
function syncDeleteButton ()
{
    $("delSongBtn").hidden = ! songEntries.get (S.song)?.local;
}

async function deleteLocalSong ()
{
    const e = songEntries.get (S.song);
    if (! e?.local || ! confirm (`Удалить с телефона «${e.title}»?`)) return;
    await deleteSong (e.id);
    songCache.delete (e.id);
    S.song = ""; save();
    await refreshSongList();
    uploadSay (`Удалено: ${esc (e.title)}.`);
}

function songTitle ()
{
    const p = pieces.find (x => x.parts.some (y => y.id === S.song));
    if (! p) return "Песня";
    const part = p.parts.find (y => y.id === S.song);
    return p.label;
}

async function saveTake ()
{
    if (! chart) return;
    const body = {
        kind: S.mode === "song" ? "song" : "exercise",
        id: S.mode === "song" ? S.song : S.mode === "drill" ? "drill" : S.kind,
        title: chart.song.title || "",
        startedAt: new Date().toISOString(),
        settings: { bpm: S.bpm, root: chart?.exercise?.rootMidi ?? S.root, tolerance: S.tolerance, clef: effectiveClef() },
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
    chart.notes.forEach ((n, i) => {
        if (n.startSeconds >= lastChartNow) return;      // stopped before it: not part of this take
        hit += noteStats[i].hit; total += expectedFrames (n);
    });
    return total ? Math.round (100 * hit / total) : 0;
}

//==============================================================================
// The drill: the MOST FREQUENT misses of a take, made into a short exercise.
// A note counts as missed when the voice was on it (not a breath, not silence)
// but in tune for under half of it. A miss is the step INTO the note - the note
// before it and the note itself - since it is usually the interval that goes
// wrong. The same step missed anywhere in the song is one mistake, counted; the
// three most frequent go into the drill (ties: the worse one), once each.
let drillChart = null;
const DRILL_KINDS = 3;

const times = (n) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "раза" : "раз";

function missedSpots ()
{
    const kinds = new Map();
    chart.notes.forEach ((n, i) => {
        const st = noteStats[i];
        if (n.type === "breath" || n.startSeconds + n.durationSeconds > lastChartNow || st.sung.length < 5) return;
        const pc = st.hit / expectedFrames (n);
        if (pc >= 0.5) return;
        const prev = i > 0 ? chart.notes[i - 1] : null;
        const key = (prev ? prev.midi + ">" : "") + n.midi;
        if (! kinds.has (key)) kinds.set (key, { at: i, prev, note: n, count: 0, pcs: [], cs: [], words: [] });
        const k = kinds.get (key);
        k.count++; k.pcs.push (pc);
        if (Number.isFinite (median (st.folded))) k.cs.push (median (st.folded));
        const w = [prev?.syllable, n.syllable].filter (Boolean).join ("-");
        if (w && ! k.words.includes (w)) k.words.push (w);
    });

    const spots = [...kinds.values()].map (k => {
        const c = k.cs.length ? Math.round (median (k.cs)) : null;
        // Under a semitone in cents; from there in semitones, as a singer counts.
        const semis = c == null ? 0 : Math.round (Math.abs (c) / 100);
        const by = c == null ? "" : Math.abs (c) < 80 ? `${Math.abs (c)}¢`
                 : `${semis} ${semis === 1 ? "полутон" : semis < 5 ? "полутона" : "полутонов"}`;
        const way = c == null ? "" : Math.abs (c) < 15 ? ", неустойчиво" : `, пели ${c > 0 ? "выше" : "ниже"} на ${by}`;
        const steps = [k.prev, k.note].filter (Boolean).map (n => label (n.midi)).join ("→");
        const where = k.words.length && ! chart.exercise
            ? ` (${k.words.slice (0, 2).map (w => `«${w}»`).join (", ")}${k.words.length > 2 ? "…" : ""})` : "";
        return {
            at: k.at, count: k.count, score: k.pcs.reduce ((a, x) => a + x, 0) / k.pcs.length,
            text: `${steps} — ${k.count} ${times (k.count)}${way}${where}`,
            notes: [k.prev && { midi: k.prev.midi, syllable: k.prev.syllable, name: label (k.prev.midi), missed: false },
                    { midi: k.note.midi, syllable: k.note.syllable, name: label (k.note.midi), missed: true }].filter (Boolean),
        };
    });
    return spots.sort ((a, b) => b.count - a.count || a.score - b.score).slice (0, DRILL_KINDS);
}

function startDrill (spots)
{
    if (S.mode !== "drill") S.drillBack = S.mode;
    const part = chart?.song?.part;              // same voice, same automatic clef as the song
    drillChart = buildDrillChart (spots, Math.round (60 * S.tempo));
    if (part) drillChart.song.part = part;
    S.mode = "drill"; save();
    hideSummary();
    prepareChart (drillChart);
}

// After a drill: the places where a note was still missed (in the holds or the
// step); none left - the whole drill again.
function drillLeftovers ()
{
    const bad = new Set();
    chart.notes.forEach ((n, i) => {
        const st = noteStats[i];
        if (n.spot != null && n.startSeconds < lastChartNow && st.sung.length >= 5 && st.hit / expectedFrames (n) < 0.5) bad.add (n.spot);
    });
    return drillChart.spots.filter ((sp, k) => bad.has (k));
}

function leaveDrill ()
{
    S.mode = S.drillBack || "exercise"; save();
    drillChart = null;
    hideSummary();
    previewChart();
    drillFromEarly = false;
}

// After a drill made at the early pause: the song again, from the top or from the pause.
function backToSong (fromPause)
{
    leaveDrill();
    if (S.mode !== "song") return;
    fromPause ? resumeSong (earlyPausedAt) : start();
}

//==============================================================================
// Too many misses early on: once the 20th note of the song is past, if fewer than
// half of the notes sung so far were hit (the voice on a note, in tune for half of
// it), the song pauses and offers: the drill, going on, or starting over. Once per take.
const EARLY_AT_NOTE = 20, EARLY_MIN_JUDGED = 5, EARLY_OK = 0.5;
let earlyAsked = false, drillFromEarly = false, lastEarlyCheck = 0, earlyPausedAt = 0;

function checkEarlyMisses (now)
{
    if (! running || S.mode !== "song" || earlyAsked || ! chart) return;
    const t = performance.now();
    if (t - lastEarlyCheck < 500) return;
    lastEarlyCheck = t;
    const sung = chart.notes.filter (n => n.type !== "breath");
    if (sung.length <= EARLY_AT_NOTE) { earlyAsked = true; return; }          // too short to stop
    const at = sung[EARLY_AT_NOTE - 1];
    if (now < at.startSeconds + at.durationSeconds) return;                  // not at note 20 yet
    earlyAsked = true;
    let judged = 0, ok = 0;
    chart.notes.forEach ((n, i) => {
        const st = noteStats[i];
        if (n.type === "breath" || n.startSeconds + n.durationSeconds > now || st.sung.length < 5) return;
        ++judged;
        if (st.hit / expectedFrames (n) >= 0.5) ++ok;
    });
    if (judged >= EARLY_MIN_JUDGED && ok / judged < EARLY_OK)
    {
        stop();
        earlyPausedAt = lastChartNow;
        const spots = missedSpots();
        if (! spots.length) return resumeSong();          // nothing to drill: go on
        $("summary").innerHTML = `
            <h2>Много промахов</h2>
            <p class="note">Попали в ${ok} из ${judged} нот. Чаще всего:<br>${spots.map (x => esc (x.text)).join ("<br>")}</p>
            <button id="earlyDrill" class="drill">Упражнение на эти места</button>
            <div class="seg"><button id="earlyGo">Продолжить</button>
                <button id="earlyRestart">Начать сначала</button></div>`;
        $("summary").hidden = false;
        $("earlyDrill").onclick = () => { drillFromEarly = true; startDrill (spots); start(); };
        $("earlyGo").onclick = () => resumeSong();
        $("earlyRestart").onclick = () => start();
    }
}

// Back into the song where it paused (a second earlier, to find the pitch again).
// at: after a drill, the chart in hand is the drill's: the song's comes back, and
// the take goes on from the pause (its earlier notes are not scored again).
async function resumeSong (at = null)
{
    hideSummary();
    try
    {
        await ensureAudio();
        stopSources();
        const song = await loadSong (S.song);
        const decks = await songDecks (song);
        if (at != null)
        {
            prepareChart (scaleChart (song.chart, S.tempo));
            earlyAsked = true;
            lastChartNow = at;
        }
        schedule (decks, Math.max (0, lastChartNow - 1));
        requestWakeLock();
    }
    catch (err) { $("status").textContent = "Ошибка: " + (err.message || err); }
}

//==============================================================================
// Summary
function showSummary ()
{
    const rows = (chart.phrases || []).filter (p => p.startSeconds < lastChartNow).map (p => {
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

    if (S.mode === "drill" && drillChart) return showDrillSummary (perPitch);
    const spots = missedSpots();
    $("summary").innerHTML = `
        <h2>${overallPercent()}% в тоне</h2>
        <div class="pitches">${perPitch || "нет данных"}</div>
        ${spots.length ? `<button id="sumDrill" class="drill">Отработать ${spots.length === 1 ? "частую ошибку"
            : `${spots.length} частые ошибки`}</button>
            <p class="note">${spots.map (x => esc (x.text)).join ("<br>")}</p>` : ""}
        <table>${rows}</table>
        <div class="seg">${S.mode === "drill" ? `<button id="sumBack">Назад к ${S.drillBack === "song" ? "песне" : "упражнению"}</button>` : ""}
            <button id="sumClose">Закрыть</button></div>`;
    $("summary").hidden = false;
    $("sumClose").onclick = hideSummary;
    if (spots.length) $("sumDrill").onclick = () => startDrill (spots);
    if ($("sumBack")) $("sumBack").onclick = leaveDrill;
    saveTake();
}
// The end of a drill: go on (the places still missed, or all of it again) or finish.
function showDrillSummary (perPitch)
{
    const left = drillLeftovers (), next = left.length ? left : drillChart.spots;
    $("summary").innerHTML = `
        <h2>${overallPercent()}% в тоне</h2>
        <div class="pitches">${perPitch || "нет данных"}</div>
        <p class="note">${left.length ? "Ещё не получилось:<br>" : "Все места спеты чисто. Продолжить — ещё раз то же:<br>"}
            ${next.map (x => esc (x.text)).join ("<br>")}</p>
        <button id="sumMore" class="drill">Продолжить упражнение</button>
        ${drillFromEarly
            ? `<div class="seg"><button id="sumResume">Песню с места паузы</button><button id="sumRestart">Песню сначала</button></div>`
            : `<div class="seg"><button id="sumEnd">Закончить</button></div>`}`;
    $("summary").hidden = false;
    $("sumMore").onclick = () => { startDrill (next); start(); };
    if (drillFromEarly) { $("sumResume").onclick = () => backToSong (true); $("sumRestart").onclick = () => backToSong (false); }
    else $("sumEnd").onclick = leaveDrill;
    saveTake();
}

const hideSummary = () => { $("summary").hidden = true; };
const esc = (s) => s.replace (/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

//==============================================================================
// Rendering
let viewLow = 48, viewSpan = 14, viewInit = false, lastFrame = performance.now();

function fitCanvas (cv)
{
    // clientWidth/Height, not the bounding box: on an upright phone #app is turned a
    // quarter (style.css), and a turned canvas's bounding box has width and height swapped.
    const dpr = window.devicePixelRatio || 1, rw = cv.clientWidth, rh = cv.clientHeight;
    const w = Math.max (1, Math.round (rw * dpr)), h = Math.max (1, Math.round (rh * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext ("2d");
    g.setTransform (dpr, 0, 0, dpr, 0, 0);
    return [g, rw, rh];
}

function updateView (now, dt)
{
    // In ROWS (rowOf), not semitones: with a song loaded only its own pitches get a row.
    let lo = Infinity, hi = -Infinity;
    if (chart && chart.notes.length)
    {
        for (const horizon of [8, 15])
        {
            for (const n of chart.notes)
                if (n.startSeconds + n.durationSeconds >= now - HISTORY && n.startSeconds <= now + horizon)
                { lo = Math.min (lo, rowOf (n.midi)); hi = Math.max (hi, rowOf (n.midi)); }
            if (lo <= hi) break;
        }
        if (lo > hi) { lo = rowOf (chart.notes[0].midi); hi = lo; }
    }
    // A song that skips semitones needs fewer rows for an octave.
    const perOctave = pitchRows() ? Math.min (12, Math.max (5, pitchRows().perOctave)) : 12;
    // Twice the rows a phrase strictly needs: the roll shows more above and below.
    let span = 2 * Math.max (perOctave, hi - lo + perOctave / 2);
    let low = (lo + hi) / 2 - span / 2;
    // Free singing: the voice type's whole range, a key for every note of it.
    if (! (chart && chart.notes.length)) { const [a, b] = voiceRange(); low = a - 0.5; span = b - a + 1; }
    if (! viewInit) { viewLow = low; viewSpan = span; viewInit = true; }
    const k = Math.min (1, dt * 2.5);
    viewLow += (low - viewLow) * k;
    viewSpan += (span - viewSpan) * k;
}

//------------------------------------------------------------------------------
// Rows of the piano roll. A song in one key uses 7 of the 12 semitones: rows for the
// other 5 stay empty and only push its notes apart, so with a chart loaded there is
// one row per pitch the chart actually uses. Between two rows the scale is linear (a
// voice between them is drawn between them); past the lowest and highest rows, one
// row per semitone. A chromatic song keeps every row; free singing, plain semitones.
let rowsFor = null, rowsVal = null;
function pitchRows ()
{
    if (! chart || ! chart.notes.length) return null;
    if (rowsFor !== chart)
    {
        const P = [...new Set (chart.notes.map (n => Math.round (n.midi)))].sort ((a, b) => a - b);
        const octaves = Math.max (1, (P[P.length - 1] - P[0]) / 12);
        rowsFor = chart;
        rowsVal = { P, perOctave: Math.round (P.length / octaves) };
    }
    return rowsVal;
}

function rowOf (m)
{
    const R = pitchRows();
    if (! R) return m;
    const P = R.P, last = P.length - 1;
    if (m <= P[0]) return m - P[0];
    if (m >= P[last]) return last + (m - P[last]);
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P[mid] <= m) lo = mid; else hi = mid; }
    return lo + (m - P[lo]) / (P[hi] - P[lo]);
}

// The pitch a whole row stands for (rowOf backwards, at integers).
function pitchOfRow (r)
{
    const R = pitchRows();
    if (! R) return r;
    const P = R.P, last = P.length - 1;
    return r < 0 ? P[0] + r : r > last ? P[last] + (r - last) : P[r];
}

// Time axis of the highway, shared with the staff so a note sits under its bar.
function laneGeometry (W)
{
    const gutter = S.labels === "fixed" ? 44 : 36;
    const laneW = W - gutter;
    return { gutter, pps: laneW / SPAN, nowX: gutter + laneW * (HISTORY / SPAN) };
}

function drawHighway (now)
{
    const [g, W, H] = fitCanvas ($("highway"));
    g.fillStyle = C.bg; g.fillRect (0, 0, W, H);

    const { gutter, pps, nowX } = laneGeometry (W);
    const ppRow = H / viewSpan;
    const yOf = (m) => H - (rowOf (m) - viewLow) * ppRow;
    const xOf = (t) => nowX + (t - now) * pps;
    const [full, zero] = TOLERANCES[S.tolerance];

    // Grid: one line per row (per pitch the song uses). The gutter is a keyboard,
    // a key per row, each named; a tap plays it.
    const target = chart ? noteIndexAt (now) : -1, ref = reference();
    const liveM = liveEst && Number.isFinite (liveEst.smooth) && performance.now() - liveEst.wall < 150 ? Math.round (liveEst.smooth) : null;
    g.font = `400 ${Math.round (Math.max (7, Math.min (11, ppRow * 0.8)))}px -apple-system, system-ui, sans-serif`;
    g.textBaseline = "middle"; g.textAlign = "right";
    for (let r = Math.floor (viewLow); r <= Math.ceil (viewLow + viewSpan); ++r)
    {
        const m = pitchOfRow (r);
        const y = Math.round (H - (r - viewLow) * ppRow) + 0.5;
        const isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = isC ? C.gridC : C.grid; g.lineWidth = 1;
        g.beginPath(); g.moveTo (gutter, y); g.lineTo (W, y); g.stroke();

        const black = isSharp (m);
        const lit = pressedMidi() === m ? "#F0E442"
                  : liveM === m ? "#009E73" : target >= 0 && chart.notes[target].midi === m ? "#56B4E9"
                  : ref && ref.midi === m ? (ref.hit ? "#009E73" : "#56B4E9") : null;
        g.fillStyle = lit || (black ? "#18181e" : "#d6d6de");
        g.fillRect (0, y - ppRow / 2, gutter - 3, ppRow);
        g.strokeStyle = "#55555f";
        g.strokeRect (0.5, Math.round (y - ppRow / 2) + 0.5, gutter - 4, Math.max (1, Math.round (ppRow) - 1));
        g.fillStyle = lit ? "#101014" : black ? "#6c6c78" : "#8c8c98";
        g.fillText (label (m), gutter - 6, y);
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

        // Target bars: the halo is tZeroCents; the bar is 2 x tFullCents, but never
        // thinner than its words need - the song's text is written in the bars.
        const fs0 = Math.max (10, Math.min (17, ppRow * 0.62));
        const words = ! chart.exercise && chart.notes.some (n => n.syllable);
        chart.notes.forEach ((n, i) => {
            const x0 = xOf (n.startSeconds), x1 = xOf (n.startSeconds + n.durationSeconds);
            if (x1 < gutter || x0 > W) return;
            const t = targetMidiOf (n), y = yOf (t);
            const barH = Math.max (4, fs0 + 4, yOf (t - full / 100) - yOf (t + full / 100));
            const haloH = yOf (t - zero / 100) - yOf (t + zero / 100);
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

            // The WORDS live in the bar (a song); an exercise, or a song without
            // lyrics, gets the note's name there. A syllable longer than its bar
            // runs on up to the next note, shrinking if it has to, then clips.
            const text = words ? (n.syllable || "") : label (n.midi);
            if (! text) return;
            const next = chart.notes[i + 1];
            const room = Math.max (x1 - x0, (next ? xOf (next.startSeconds) : W) - x0) - 5;
            let fs = fs0;
            g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
            const w = g.measureText (text).width;
            if (w > room) fs = Math.max (9, Math.floor (fs * room / w));
            g.save();
            g.beginPath(); g.rect (x0, y - barH, room + 4, 2 * barH); g.clip();
            g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
            g.fillStyle = labelColour; g.textAlign = "left"; g.textBaseline = "middle";
            if (x1 - x0 < g.measureText (text).width + 6)
            {   // runs out of its bar: light text with a shadow reads on the background too
                g.shadowColor = "#000"; g.shadowBlur = 3;
                if (! active) g.fillStyle = "#e8f4fb";
            }
            g.fillText (text, x0 + 3, y + 0.5);
            g.restore();
        });
    }

    // The reference note from a tapped key: a bar from the play line on, its name in it.
    if (ref)
    {
        const y = yOf (rowOf (ref.midi)), barH = Math.max (14, Math.min (22, ppRow * 0.9)), x0 = nowX - 0.25 * pps;
        roundRect (g, x0, y - barH / 2, W - x0 - 4, barH, Math.min (4, barH / 2));
        g.fillStyle = ref.hit ? "rgba(0,158,115,0.75)" : C.barFill; g.fill();
        g.strokeStyle = ref.hit ? "rgb(0,158,115)" : C.barEdge; g.lineWidth = 1; g.stroke();
        g.font = `600 ${Math.round (Math.min (16, barH * 0.7))}px -apple-system, system-ui, sans-serif`;
        g.fillStyle = ref.hit ? "#ffffff" : "#cfe9f8"; g.textAlign = "left"; g.textBaseline = "middle";
        g.fillText (label (ref.midi), x0 + 4, y + 0.5);
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

// Tapped keys sound as a struck piano note, and light for a moment.
let staffKeys = [], pressed = null;
const pressedMidi = () => pressed && performance.now() < pressed.until ? pressed.midi : null;
const inKey = (k, x, y) => x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h;
// A black key lies over the white ones, so it is tried first.
const keyAt = (keys, x, y) => keys.find (k => k.black && inKey (k, x, y)) || keys.find (k => ! k.black && inKey (k, x, y));
// A pointer in the canvas's own coordinates, from the bounding box: offsetX/Y come
// out scaled under browser zoom. A turned #app (upright phone) swaps the box's sides.
function canvasXY (cv, ev)
{
    const r = cv.getBoundingClientRect(), turned = Math.abs (r.width - cv.clientWidth) > Math.abs (r.width - cv.clientHeight);
    if (! turned) return [(ev.clientX - r.left) * cv.clientWidth / r.width, (ev.clientY - r.top) * cv.clientHeight / r.height];
    const flip = document.documentElement.classList.contains ("flip");
    const along = flip ? r.bottom - ev.clientY : ev.clientY - r.top, across = flip ? ev.clientX - r.left : r.right - ev.clientX;
    return [along * cv.clientWidth / r.height, across * cv.clientHeight / r.width];
}

// The key last tapped stays up as a reference note to sing against: white on the
// play line, green while the voice is on it (any octave, as notes are judged).
// It stands until another key is tapped; a running song or exercise hides it.
let refMidi = null;
function reference ()
{
    if (refMidi == null || (running && chart)) return null;
    const live = liveEst && Number.isFinite (liveEst.smooth) && performance.now() - liveEst.wall < 150 ? liveEst : null;
    const cents = live ? remainder (live.smooth - refMidi, 12) * 100 : null, full = TOLERANCES[S.tolerance][0];
    // The voice wobbles around the pitch: green comes on within the tolerance, stays on
    // within twice it, and lingers a moment - else it only flickers and never reads as lit.
    const on = cents != null && Math.abs (cents) <= (refLit ? 2 * full : full);
    if (on) refHitUntil = performance.now() + 300;
    refLit = performance.now() < refHitUntil;
    return { midi: refMidi, hit: refLit };
}
let refLit = false, refHitUntil = 0;

async function playKey (midi)
{
    pressed = { midi, until: performance.now() + 350 };
    refMidi = midi;
    try { await ensureContext(); } catch (e) { $("status").textContent = e.message; return; }
    const s = ctx.createBufferSource(); s.buffer = renderSingleNote (ctx, midi); s.connect (clickGain); s.start();
}

function drawStaffPanel (now)
{
    const cv = $("staff");
    const [g, W, H] = fitCanvas (cv);
    const live = liveEst && Number.isFinite (liveEst.smooth) && performance.now() - liveEst.wall < 150 ? liveEst : null;

    // The piano roll's time axis: a note sits under its bar, barlines from the score.
    const { gutter, pps, nowX } = laneGeometry (W);
    const xOf = (t) => nowX + (t - now) * pps;
    const activeIdx = chart ? noteIndexAt (now) : -1;
    const notes = [], bars = [];
    const words = chart && ! chart.exercise && chart.notes.some (n => n.syllable);
    if (chart)
    {
        chart.notes.forEach ((n, i) => {
            const x = xOf (n.startSeconds), x1 = xOf (n.startSeconds + n.durationSeconds);
            if (x1 < gutter - 40 || x > W + 20) return;
            const st = noteStats[i];
            const past = now > n.startSeconds + n.durationSeconds;
            // Judged as the drill judges it: the voice was on it, and in tune for half of it.
            // The sung pitch is folded into the note's octave, so a miss lands next to it.
            let sung = null, ok = null;
            if (past && st.sung.length >= 5)
            {
                const c = median (st.folded);
                ok = st.hit / expectedFrames (n) >= 0.5;
                sung = { midi: Math.round (targetMidiOf (n) + c / 100), cents: c, colour: colourFor (c) };
            }
            notes.push ({ midi: n.midi, x, x1, q: n.quarters, state: i === activeIdx ? "active" : past ? "past" : "future", sung, ok,
                          syllable: words ? n.syllable : null });
        });
        for (const t of chart.barSeconds || []) bars.push (xOf (t));
    }

    let liveView = null;
    if (live)
    {
        let cents = null;
        if (activeIdx >= 0) cents = remainder (live.smooth - targetMidiOf (chart.notes[activeIdx]), 12) * 100;
        liveView = { midi: Math.round (live.smooth), cents, colour: cents == null ? "#9ad" : colourFor (cents) };
    }

    staffKeys = drawStaff (g, W, H, { mode: effectiveClef(), showNames: S.names, notes, bars, nowX, live: liveView, pressed: pressedMidi(), reference: reference(),
                          range: staffRange(), label, maxS: quickGap() * pps / 1.5, lyricsAbove: words, meter: meterAt (now) });

    // Readout under the staff.
    // The note to sing in white; green while the voice is on it (within the
    // tolerance); off it, the plan stays white and what is sung shows in red
    // beside it, with the cents. With nothing to sing, just the voice.
    const target = activeIdx >= 0 ? chart.notes[activeIdx] : null;
    const cents = (c) => ` <span class="cents">${c > 0 ? "+" : ""}${Math.round (c)}¢</span>`;
    let txt = "";
    if (target)
    {
        const ok = liveView && liveView.cents != null && Math.abs (liveView.cents) <= TOLERANCES[S.tolerance][0];
        txt += `<b class="${ok ? "hit" : "plan"}">${labelLong (target.midi)}</b>`;
        if (liveView && ! ok) txt += ` <b class="miss">${labelLong (liveView.midi)}</b>${liveView.cents != null ? cents (liveView.cents) : ""}`;
    }
    else if (liveView)
    {
        txt += `<b style="color:${liveView.colour}">${labelLong (liveView.midi)}</b>`
             + cents ((live.smooth - Math.round (live.smooth)) * 100);
    }
    $("readout").innerHTML = txt || "&nbsp;";
}

// Quarters per measure where `now` is (chart.meter, from a PDF score); null: none shown.
function meterAt (now)
{
    const m = chart?.meter;
    if (! m || ! m.length) return null;
    let cur = m[0];
    for (const x of m) if (x.timeSeconds <= now + 0.05) cur = x;
    return cur.quarters;
}

// The song's quick notes, in seconds apart (the 10th percentile, so one grace note
// does not shrink the staff): they cap the staff's size so their heads stay apart.
let gapFor = null, gapVal = 1;
function quickGap ()
{
    if (! chart || chart.notes.length < 2) return 1;
    if (gapFor !== chart)
    {
        const d = [];
        for (let i = 1; i < chart.notes.length; ++i)
        {
            const g = chart.notes[i].startSeconds - chart.notes[i - 1].startSeconds;
            if (g > 0.02) d.push (g);
        }
        d.sort ((a, b) => a - b);
        gapFor = chart; gapVal = d.length ? d[Math.floor (d.length * 0.1)] : 1;
    }
    return gapVal;
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

// The staff is scaled to the chart AND the voice's whole range, so its keyboard has every key of the voice.
function staffRange ()
{
    const c = chartRange(), [a, b] = voiceRange();
    return c ? [Math.min (c[0], a), Math.max (c[1], b)] : [a, b];
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
    checkAudio();
    checkEarlyMisses (now);
    // Only the view on screen is drawn; the readout under it is shared.
    if (S.view === "roll") { updateView (now, dt); drawHighway (now); }
    drawStaffPanel (now);
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
document.addEventListener ("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (running) requestWakeLock();
    lastWorkletMsg = performance.now();      // give the context a moment to come back by itself
    lastCheck = 0;
});
addEventListener ("pageshow", () => { lastCheck = 0; });

//==============================================================================
// UI
function voiceLabel ()
{
    $("voiceText").textContent = VOICES.find (v => v[0] === S.voice)[1];
}

function renderExercises ()
{
    const list = $("exList");
    list.innerHTML = "";
    for (const d of DEFINITIONS)
    {
        const b = document.createElement ("button");
        b.innerHTML = `${esc (d.name)}<small>${esc (d.purpose || "")}</small>`;
        b.classList.toggle ("sel", d.kind === S.kind);
        b.onclick = () => {
            S.kind = d.kind; save(); $("exSheet").hidden = true; track ("exercise", d.kind);
            syncForm(); updateTitle(); previewChart();
        };
        list.appendChild (b);
    }
}

function updateTitle ()
{
    $("title").disabled = S.mode === "free";
    document.querySelectorAll ("[data-mode]").forEach (b => b.classList.toggle ("sel", b.dataset.mode === S.mode));
    voiceLabel();
    let t;
    if (S.mode === "exercise") { const d = getDefinition (S.kind); t = d.name + (d.fixed ? "" : ` · от ${noteName (exerciseSpec().rootMidi)}`); }
    else if (S.mode === "song") t = songTitle();
    else if (S.mode === "drill" && drillChart) t = drillChart.song.title;
    else t = "Свободное пение";
    $("titleText").textContent = t;
    updatePartBtn();
}

function openSettings () { syncForm(); $("settings").hidden = false; }
function closeSettings () { $("settings").hidden = true; updateTitle(); previewChart(); }

function syncForm ()
{
    document.querySelectorAll ("[data-mode]").forEach (b => b.classList.toggle ("sel", b.dataset.mode === S.mode));
    $("exBlock").hidden = S.mode !== "exercise";
    $("kind").value = S.kind;
    $("purpose").textContent = getDefinition (S.kind).purpose;
    // Only roots that keep the exercise inside the singer's voice.
    const [ra, rb] = rootChoices (S.kind, voiceRange()), root = $("root");
    root.innerHTML = "";
    for (let m = ra; m <= rb; ++m) { const o = document.createElement ("option"); o.value = m; o.textContent = noteName (m); root.appendChild (o); }
    root.value = exerciseSpec().rootMidi;
    root.disabled = getDefinition (S.kind).fixed;
    $("bpm").value = S.bpm; $("bpmVal").textContent = S.bpm;
    $("length").value = S.length;
    $("labels").value = S.labels;
    $("clef").value = S.clef;
    $("view").value = S.view;
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
    if (S.mode === "exercise") prepareChart (exerciseChart());
    else if (S.mode === "drill" && drillChart) prepareChart (drillChart);
    else if (S.mode === "free") { chart = null; estimates = []; }
    else if (S.mode === "song" && songCache.has (S.song)) prepareChart (scaleChart (songCache.get (S.song).chart, S.tempo));
    else
    {
        chart = null;
        // The notes before Start: just the chart (small), the audio waits for ▶.
        if (S.mode === "song" && S.song) previewSongChart (S.song);
    }
    updateTitle();
}

async function previewSongChart (id)
{
    try
    {
        const e = songEntries.get (id) || {};
        const c = e.local ? (await getSong (id))?.chart
                          : await (await fetch (e.chart || `api/songs/${encodeURIComponent (id)}/chart`)).json();
        if (c && ! running && S.mode === "song" && S.song === id) prepareChart (scaleChart (c, S.tempo));
    }
    catch {}
}

function buildForm ()
{
    const kind = $("kind");
    for (const d of DEFINITIONS) { const o = document.createElement ("option"); o.value = d.kind; o.textContent = d.name; kind.appendChild (o); }

    const bind = (id, key, conv = (v) => v, after) => $(id).addEventListener ("input", () => {
        S[key] = conv ($(id).type === "checkbox" ? $(id).checked : $(id).value); save(); syncForm(); applyLevels(); after && after();
    });
    // Песня, Партия, Темп: three buttons on the main screen, each with its own chooser.
    const openSheet = (id) => { if (running) stop(); $(id).hidden = false; };
    $("songClose").onclick = () => { $("songSheet").hidden = true; };
    $("partBtn").onclick = () => openSheet ("partSheet");
    $("tempoBtn").onclick = () => { renderTempo(); openSheet ("tempoSheet"); };
    // Режимы: свободный / композиция / упражнения; the name button opens that mode's chooser.
    document.querySelectorAll ("[data-mode]").forEach (b => b.onclick = () => {
        if (running) stop();
        S.mode = b.dataset.mode; save(); syncForm(); track ("mode", S.mode);
        if (S.mode === "song") refreshSongList();
        updateTitle(); previewChart();
    });
    $("title").onclick = () => {
        if (S.mode === "free") return;
        if (S.mode === "exercise") { renderExercises(); openSheet ("exSheet"); }
        else { refreshSongList(); openSheet ("songSheet"); }
    };
    $("exClose").onclick = () => { $("exSheet").hidden = true; };
    // Тип голоса: the part of every piece opened from now on; the open piece switches too.
    $("voiceBtn").onclick = () => {
        const list = $("voiceList");
        list.innerHTML = "";
        for (const [v, name] of VOICES)
        {
            const b = document.createElement ("button");
            b.textContent = name; b.classList.toggle ("sel", v === S.voice);
            b.onclick = () => {
                // A new voice brings its own clef: a clef picked by hand gives way to auto.
                S.voice = v; S.part = v; S.clef = "auto"; save(); track ("voice", v);
                $("voiceSheet").hidden = true; voiceLabel();
                const p = currentPiece, x = p?.parts.find (y => y.part === v);
                if (x && x.id !== S.song) { S.song = x.id; save(); fillParts (p); syncDeleteButton(); songChanged(); }
                else { clefLabel(); previewChart(); }
            };
            list.appendChild (b);
        }
        openSheet ("voiceSheet");
    };
    for (const id of ["songSheet", "partSheet", "tempoSheet", "voiceSheet", "exSheet"])
        $(id).addEventListener ("click", (e) => { if (e.target === $(id)) $(id).hidden = true; });
    $("tempoDown").onclick = () => setTempo (S.tempo - 0.05);
    $("tempoUp").onclick = () => setTempo (S.tempo + 0.05);
    $("addHelp").onclick = () => { $("addHelpText").hidden = ! $("addHelpText").hidden; };
    $("viewBtn").onclick = () => { S.view = S.view === "roll" ? "staff" : "roll"; save(); applyView(); };
    bind ("kind", "kind");
    bind ("root", "root", Number, () => { S.rootVoice = S.voice; save(); });
    bind ("bpm", "bpm", Number);
    bind ("length", "length");
    bind ("labels", "labels");
    bind ("clef", "clef", v => v, clefLabel);
    bind ("view", "view", v => v, applyView);
    bind ("names", "names");
    bind ("tolerance", "tolerance");
    bind ("guideVol", "guideVol", Number);
    bind ("backVol", "backVol", Number);
    bind ("latency", "latencyMs", Number);
    $("songSearch").addEventListener ("input", renderPieces);
    $("addSongBtn").onclick = () => $("addSongFile").click();
    $("delSongBtn").onclick = deleteLocalSong;
    $("addSongFile").addEventListener ("change", () => { const f = $("addSongFile").files[0]; if (f) addSongFile (f); });

    $("menu").onclick = () => { if (running) stop(); openSettings(); };
    $("done").onclick = closeSettings;
    $("play").onclick = () => running ? stop (false, true) : start();
    $("guide").onclick = () => { S.guide = ! S.guide; save(); applyLevels(); $("guide").classList.toggle ("on", S.guide); };
    $("guide").classList.toggle ("on", S.guide);
    $("clefBtn").onclick = () => {
        const order = ["auto", "bass", "treble", "treble8", "grand"];
        S.clef = order[(order.indexOf (S.clef) + 1) % order.length]; save(); clefLabel();
    };
    clefLabel();

    // The keyboards play: the piano roll's gutter and the one left of the clef.
    $("highway").addEventListener ("pointerdown", (ev) => {
        const cv = $("highway"), { gutter } = laneGeometry (cv.clientWidth), [x, y] = canvasXY (cv, ev);
        if (x > gutter) return;
        playKey (pitchOfRow (Math.round (viewLow + (cv.clientHeight - y) * viewSpan / cv.clientHeight)));
    });
    $("staff").addEventListener ("pointerdown", (ev) => {
        const k = keyAt (staffKeys, ...canvasXY ($("staff"), ev));
        if (k) playKey (k.midi);
    });

    // Tap a note on the staff to hear it. offsetX is in the canvas's own (possibly
    // turned) coordinates; back through the time axis to the nearest note.
    $("staff").addEventListener ("click", async (ev) => {
        if (running || ! chart || keyAt (staffKeys, ...canvasXY ($("staff"), ev))) return;
        try { await ensureContext(); } catch (e) { $("status").textContent = e.message; return; }
        const { pps, nowX } = laneGeometry ($("staff").clientWidth);
        const t = lastChartNow + (ev.offsetX - nowX) / pps;
        let n = null;
        for (const x of chart.notes)
            if (! n || Math.abs (x.startSeconds + 0.1 - t) < Math.abs (n.startSeconds + 0.1 - t)) n = x;
        if (! n || Math.abs (n.startSeconds - t) > 1.5) return;
        const s = ctx.createBufferSource(); s.buffer = renderSingleNote (ctx, n.midi); s.connect (guideGain.gain.value > 0 ? guideGain : clickGain); s.start();
    });

    $("mic").onclick = toggleMic;
    setMicButton ("off");

    // Desktop: Space starts and stops, unless typing or a sheet is open.
    document.addEventListener ("keydown", (e) => {
        if (e.code !== "Space" || e.repeat || /INPUT|SELECT|TEXTAREA|BUTTON/.test (e.target.tagName)) return;
        if (! $("settings").hidden || [...document.querySelectorAll (".overlay")].some (o => ! o.hidden)) return;
        e.preventDefault();
        running ? stop (false, true) : start();
    });
}

// Clef "auto" (the default): from the notes. A choir part says what it is - soprano
// and alto read treble, tenor the octave treble, bass the bass clef. Anything else
// goes by range: more than two octaves both staves, all of it from A3 up treble,
// nothing above E4 bass, and a man's range across the middle the octave treble.
function effectiveClef ()
{
    if (S.clef !== "auto") return S.clef;
    // Free singing and exercises: the clef of the singer's voice type.
    if (! chart || ! chart.notes.length || chart.exercise) return VOICE_CLEF[S.voice] || "bass";
    const part = VOICE_CLEF[chart.song?.part];
    if (part) return part;
    let lo = Infinity, hi = -Infinity;
    for (const n of chart.notes) { lo = Math.min (lo, n.midi); hi = Math.max (hi, n.midi); }
    if (hi - lo > 24) return "grand";
    if (lo >= 57) return "treble";
    if (hi <= 64) return "bass";
    return "treble8";
}

// The notes (words over the staff) or the piano roll (words in the bars): one at a time.
function applyView ()
{
    $("app").classList.toggle ("view-staff", S.view !== "roll");
    $("app").classList.toggle ("view-roll", S.view === "roll");
    $("viewBtn").textContent = S.view === "roll" ? "ролл" : "ноты";
}

function clefLabel ()
{
    // Symbols, not words: "Бас" / "Тенор" read like choir parts next to the part names.
    const eff = effectiveClef(), auto = S.clef === "auto";
    $("clefBtn").textContent = { bass: "𝄢", treble: "𝄞", treble8: "𝄞₈", grand: "𝄞𝄢" }[eff] + (auto ? "ᴬ" : "");
    $("clefBtn").title = (auto ? "Авто: " : "") + { bass: "басовый ключ", treble: "скрипичный ключ",
                         treble8: "скрипичный, октавой ниже", grand: "оба ключа" }[eff];
    $("app").classList.toggle ("grand", eff === "grand");   // two staves need a taller panel
}

buildForm();
pageview();
applyView();
tempoLabel();
if (S.mode === "song") refreshSongList().then (previewChart); else previewChart();
requestAnimationFrame (frame);

window.addEventListener ("error", (e) => { $("status").textContent = "JS: " + e.message; });

// Which way up. With the rotation lock on the page never turns, so the app (turned
// by style.css) follows the tilt sensor: gravity along the screen's x axis says
// which side is down. From the orientation angles, which mean the same on iOS and
// Android (raw accelerometer signs do not): g = (cos b * sin g, -sin b, -cos b * cos g).
// Top to the left (gx > 0): the default turn; top to the right: html.flip. Held
// upright or lying flat, the last landscape side stays - the app is landscape only.
function watchTilt ()
{
    addEventListener ("deviceorientation", (e) => {
        if (e.beta == null || e.gamma == null) return;
        const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
        const gx = Math.cos (b) * Math.sin (g), gy = -Math.sin (b);
        if (Math.abs (gx) > 0.55 && Math.abs (gx) > Math.abs (gy))
            document.documentElement.classList.toggle ("flip", gx < 0);
    });
}
// iOS would have to ASK for the sensor ("Motion & Orientation") - the user did not want
// the prompt (2026-10-22): there the turn is fixed, top to the left. Android gives it freely.
if (matchMedia ("(pointer: coarse)").matches && "DeviceOrientationEvent" in window
    && typeof DeviceOrientationEvent.requestPermission !== "function")
    watchTilt();

// Offline use (sw.js). Not inside the Android wrapper: there the files are already local.
askMicAtLaunch();

if ("serviceWorker" in navigator && ! window.Capacitor)
    navigator.serviceWorker.register ("sw.js").catch (() => {});
