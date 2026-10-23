// @ts-check
// synth.js — the click track and the struck-piano guide, ported from
// src/exercise/ExerciseAudio.cpp (same partial model, same amplitudes).

import { beatSeconds, leadInSeconds, referenceSeconds } from "./exercises.js";

const CLICK_S = 0.045, CLICK_HZ = 1000, ACCENT_HZ = 1600, CLICK_AMP = 0.10, ACCENT_AMP = 0.20;
const PARTIALS = 12, INHARM = 0.00045, HAMMER = 1 / 8, ROLLOFF = 1.9;
const T60_C4 = 6.0, T60_PER_PARTIAL = 0.55, T60_MIN = 1.8, T60_MAX = 6.5;
const ATTACK_S = 0.004, TAIL_S = 0.30, FADE_S = 0.06, SILENCE = 1e-4;
const TONE_AMP = 0.50, RESTRIKE_AMP = 0.55, RESTRIKE_BEATS = 3.0, RESTRIKE_MIN_S = 1.5, REF_AMP = 0.32;

const midiHz = (m) => 440 * Math.pow (2, (m - 69) / 12);

function addClick (buf, sr, t, hz, amp)
{
    const start = Math.round (t * sr), n = Math.min (Math.round (CLICK_S * sr), buf.length - start);
    if (start < 0 || n <= 0) return;
    const w = 2 * Math.PI * hz / sr, decay = Math.exp (-7 / n);
    let env = amp;
    for (let i = 0; i < n; ++i) { buf[start + i] += env * Math.sin (w * i); env *= decay; }
}

// Rendered notes are cached by (pitch, sustain, amplitude): an exercise is the
// same handful of notes struck over and over, so most strikes become a copy.
const cache = new Map();

function pianoNote (sr, sustain, hz, amp)
{
    const key = `${sr}|${hz.toFixed (3)}|${sustain.toFixed (3)}|${amp}`;
    if (cache.has (key)) return cache.get (key);

    const n = Math.round ((Math.max (0, sustain) + TAIL_S) * sr);
    const out = new Float32Array (n);
    const t60f = Math.min (T60_MAX, Math.max (T60_MIN, T60_C4 * Math.sqrt (261.6256 / hz)));
    const parts = [];
    let ampSum = 0;
    for (let p = 1; p <= PARTIALS; ++p)
    {
        const f = hz * p * Math.sqrt (1 + INHARM * p * p);
        if (f >= 0.45 * sr) break;
        const a = Math.pow (1 / p, ROLLOFF) * Math.abs (Math.sin (Math.PI * p * HAMMER));
        if (a <= 1e-9) continue;
        const t60 = t60f / (1 + T60_PER_PARTIAL * (p - 1));
        parts.push ({ w: 2 * Math.PI * f / sr, a, decay: Math.exp (-Math.log (1000) / (t60 * sr)) });
        ampSum += a;
    }
    const gain = amp / ampSum, attack = Math.max (1, ATTACK_S * sr);
    const fadeLen = Math.max (1, Math.round (FADE_S * sr)), fadeAt = n - fadeLen;

    for (const p of parts)
    {
        // Rotating phasor, as in the C++ — one sin/cos per partial, not per sample.
        let re = 1, im = 0, env = p.a * gain;
        const c = Math.cos (p.w), s = Math.sin (p.w);
        for (let i = 0; i < n; ++i)
        {
            out[i] += env * im;
            const r2 = re * c - im * s; im = re * s + im * c; re = r2;
            env *= p.decay;
            if ((i & 8191) === 8191) { const m = Math.hypot (re, im); re /= m; im /= m; }
            if (env < SILENCE * p.a * gain) break;
        }
    }
    for (let i = 0; i < n; ++i)
    {
        const rise = Math.min (1, i / attack), fall = i >= fadeAt ? (n - i) / fadeLen : 1;
        out[i] *= rise * fall;
    }
    cache.set (key, out);
    return out;
}

function mixAt (buf, src, start)
{
    const n = Math.min (src.length, buf.length - start);
    for (let i = 0; i < n; ++i) buf[start + i] += src[i];
}

export function renderClickTrack (ctx, chart)
{
    const spec = chart.exercise, sr = ctx.sampleRate;
    const total = chart.song.durationSeconds + 1.0;
    const buf = new Float32Array (Math.ceil (total * sr));
    const beat = beatSeconds (spec), leadIn = leadInSeconds (spec), ref = referenceSeconds (spec);

    if (ref > 0 && chart.notes.length)
        mixAt (buf, pianoNote (sr, leadIn, midiHz (chart.notes[0].midi), REF_AMP), 0);

    for (let t = ref; t < total; t += beat)
    {
        const countIn = t < leadIn - 1e-6;
        addClick (buf, sr, t, countIn ? ACCENT_HZ : CLICK_HZ, countIn ? ACCENT_AMP : CLICK_AMP);
    }
    return toAudioBuffer (ctx, buf);
}

export function renderGuideTone (ctx, chart)
{
    const sr = ctx.sampleRate;
    const buf = new Float32Array (Math.ceil ((chart.song.durationSeconds + 1.0) * sr));
    const every = Math.max (RESTRIKE_MIN_S, beatSeconds (chart.exercise) * RESTRIKE_BEATS);

    for (const note of chart.notes)
    {
        const hz = midiHz (note.midi) * Math.pow (2, (note.centsOffset || 0) / 1200);
        for (let off = 0; off < note.durationSeconds - 0.4; off += every)
            mixAt (buf, pianoNote (sr, note.durationSeconds - off, hz, off > 0 ? TONE_AMP * RESTRIKE_AMP : TONE_AMP),
                   Math.round ((note.startSeconds + off) * sr));
    }
    return toAudioBuffer (ctx, buf);
}

// One struck note, for tapping a note on the staff to hear it.
export function renderSingleNote (ctx, midi)
{
    return toAudioBuffer (ctx, pianoNote (ctx.sampleRate, 1.2, midiHz (midi), TONE_AMP));
}

function toAudioBuffer (ctx, data)
{
    const b = ctx.createBuffer (1, Math.max (1, data.length), ctx.sampleRate);
    b.copyToChannel (data, 0);
    return b;
}
