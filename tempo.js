// tempo.js — slower or faster without changing the pitch (WSOLA).
//
// A song's backing and guide are recordings, and playing them faster would also
// raise them. WSOLA cuts the audio into overlapping windows, lays them out at the
// new spacing, and nudges each one (within ±6 ms) to where it best continues the
// one before, so the waveform joins up: the time changes, the pitch does not.
// It runs once per song and tempo, on the decoded buffer; the result is cached
// by the caller. A 3-minute stereo song takes about a second on a phone.

const N = 2048;              // window, ~45 ms at 44.1 kHz
const HOP = N / 2;           // output hop: Hann windows at 50 % sum to one
const SEEK = 256;            // how far a window may move to fit, each way
const CMP = 512, CMP_STEP = 4, SEEK_STEP = 2;   // the fit is measured coarsely: fast, and good enough

/** factor > 1 plays faster (shorter), < 1 slower. Returns a new AudioBuffer. */
export function stretch (ctx, buf, factor)
{
    if (Math.abs (factor - 1) < 1e-3) return buf;
    const len = buf.length, outLen = Math.ceil (len / factor) + N;
    const chans = [], outs = [];
    for (let c = 0; c < buf.numberOfChannels; ++c) { chans.push (buf.getChannelData (c)); outs.push (new Float32Array (outLen)); }
    const ref = chans[0];
    const win = new Float32Array (N);
    for (let i = 0; i < N; ++i) win[i] = 0.5 - 0.5 * Math.cos (2 * Math.PI * i / N);

    let prev = 0;
    for (let k = 0, outPos = 0; outPos + N < outLen; ++k, outPos += HOP)
    {
        const ideal = Math.round (outPos * factor);
        if (ideal + N >= len) break;
        let at = ideal;
        if (k > 0)
        {
            // Best match for the natural continuation of the previous window.
            const want = prev + HOP;
            let best = -Infinity;
            for (let d = -SEEK; d <= SEEK; d += SEEK_STEP)
            {
                const cand = ideal + d;
                if (cand < 0 || cand + N >= len || want + CMP >= len) continue;
                let s = 0;
                for (let i = 0; i < CMP; i += CMP_STEP) s += ref[cand + i] * ref[want + i];
                if (s > best) { best = s; at = cand; }
            }
        }
        for (let c = 0; c < chans.length; ++c)
        {
            const src = chans[c], dst = outs[c];
            for (let i = 0; i < N; ++i) dst[outPos + i] += src[at + i] * win[i];
        }
        prev = at;
    }
    const realLen = Math.max (1, Math.ceil (len / factor));
    const out = ctx.createBuffer (buf.numberOfChannels, realLen, buf.sampleRate);
    for (let c = 0; c < outs.length; ++c) out.copyToChannel (outs[c].subarray (0, realLen), c);
    return out;
}

/** The chart on the stretched clock: every time divided by the factor. */
export function scaleChart (chart, factor)
{
    if (Math.abs (factor - 1) < 1e-3) return chart;
    const t = (x) => x / factor;
    const c = { ...chart, song: { ...chart.song, durationSeconds: t (chart.song.durationSeconds || 0) } };
    c.notes = chart.notes.map (n => ({ ...n, startSeconds: t (n.startSeconds), durationSeconds: t (n.durationSeconds) }));
    c.phrases = (chart.phrases || []).map (p => ({ ...p, startSeconds: t (p.startSeconds), endSeconds: t (p.endSeconds) }));
    if (chart.barSeconds) c.barSeconds = chart.barSeconds.map (t);
    if (chart.meter) c.meter = chart.meter.map (m => ({ ...m, timeSeconds: t (m.timeSeconds) }));
    if (chart.contour) c.contour = { ...chart.contour, startSeconds: t (chart.contour.startSeconds || 0), rateHz: chart.contour.rateHz * factor };
    return c;
}

// The usual practice steps: down to half speed, up a little past full.
export const TEMPO_STEPS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.2];
