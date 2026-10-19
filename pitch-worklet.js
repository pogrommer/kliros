/*
    pitch-worklet.js — the browser port of the app's analysis chain.

    Same numbers as DESIGN.md §5 and src/dsp: 65 Hz high-pass, 7.2 kHz
    anti-alias, resample to 16 kHz, 1024-sample MPM/NSDF window every 128
    samples (125 estimates/s), voicing gate with hysteresis and 120 ms hold,
    clarity gate 0.85, 3-tap median, 1-Euro (fcmin 1 Hz, beta 0.5) on
    fractional MIDI. The tau search is narrowed to +-1 octave around the
    target note the page sends, exactly as AudioEngine does for a loaded chart.

    Each estimate is stamped with the AudioContext time of its window CENTRE
    (DESIGN.md "timestamp-correct rendering"), so the page can draw it at its
    true chart position instead of at the now-line.
*/

const RATE = 16000;
const WIN = 1024;
const HOP = 128;
const N_FFT = 2048;

const CLARITY_MIN = 0.85;
const KEY_MAX_K = 0.90;
const OPEN_DB = 15, CLOSE_DB = 9, ABS_FLOOR_DB = -55, HOLD_S = 0.120;
const NOISE_WINDOW_S = 3.0;
const RMS_SAMPLES = 320;                 // 20 ms at 16 kHz

//------------------------------------------------------------------------------
class FFT
{
    constructor (n)
    {
        this.n = n;
        this.cos = new Float64Array (n / 2);
        this.sin = new Float64Array (n / 2);
        for (let i = 0; i < n / 2; ++i)
        {
            this.cos[i] = Math.cos (2 * Math.PI * i / n);
            this.sin[i] = -Math.sin (2 * Math.PI * i / n);
        }
        this.rev = new Uint32Array (n);
        const bits = Math.log2 (n);
        for (let i = 0; i < n; ++i)
        {
            let r = 0;
            for (let b = 0; b < bits; ++b) r |= ((i >> b) & 1) << (bits - 1 - b);
            this.rev[i] = r;
        }
    }

    // In-place forward transform.
    run (re, im)
    {
        const n = this.n;
        for (let i = 0; i < n; ++i)
        {
            const j = this.rev[i];
            if (j > i)
            {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let size = 2; size <= n; size <<= 1)
        {
            const half = size >> 1, step = n / size;
            for (let start = 0; start < n; start += size)
                for (let k = 0; k < half; ++k)
                {
                    const c = this.cos[k * step], s = this.sin[k * step];
                    const a = start + k, b = a + half;
                    const tr = re[b] * c - im[b] * s;
                    const ti = re[b] * s + im[b] * c;
                    re[b] = re[a] - tr; im[b] = im[a] - ti;
                    re[a] += tr;        im[a] += ti;
                }
        }
    }
}

//------------------------------------------------------------------------------
class OneEuro
{
    constructor (minCutoff = 1.0, beta = 0.5, dCutoff = 1.0)
    {
        this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
        this.reset();
    }
    reset () { this.x = null; this.dx = 0; }
    static alpha (cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
    filter (x, dt)
    {
        if (this.x === null) { this.x = x; this.dx = 0; return x; }
        const dxRaw = (x - this.x) / dt;
        this.dx += OneEuro.alpha (this.dCutoff, dt) * (dxRaw - this.dx);
        const cutoff = this.minCutoff + this.beta * Math.abs (this.dx);
        this.x += OneEuro.alpha (cutoff, dt) * (x - this.x);
        return this.x;
    }
}

//------------------------------------------------------------------------------
class PitchProcessor extends AudioWorkletProcessor
{
    constructor ()
    {
        super();
        const sr = sampleRate;

        // 2nd-order Butterworth high-pass at 65 Hz (RBJ cookbook, Q = 1/sqrt 2).
        {
            const w0 = 2 * Math.PI * 65 / sr, cw = Math.cos (w0), al = Math.sin (w0) / (2 * Math.SQRT1_2);
            const a0 = 1 + al;
            this.hb0 = ((1 + cw) / 2) / a0; this.hb1 = -(1 + cw) / a0; this.hb2 = this.hb0;
            this.ha1 = (-2 * cw) / a0;      this.ha2 = (1 - al) / a0;
            this.hx1 = this.hx2 = this.hy1 = this.hy2 = 0;
        }

        // 63-tap windowed-sinc anti-alias low-pass at 7.2 kHz.
        const taps = 63;
        this.fir = new Float32Array (taps);
        {
            const fc = 7200 / sr; let sum = 0;
            for (let i = 0; i < taps; ++i)
            {
                const m = i - (taps - 1) / 2;
                const sinc = m === 0 ? 2 * fc : Math.sin (2 * Math.PI * fc * m) / (Math.PI * m);
                const w = 0.42 - 0.5 * Math.cos (2 * Math.PI * i / (taps - 1)) + 0.08 * Math.cos (4 * Math.PI * i / (taps - 1));
                this.fir[i] = sinc * w; sum += this.fir[i];
            }
            for (let i = 0; i < taps; ++i) this.fir[i] /= sum;
        }
        this.firBuf = new Float32Array (taps * 2);
        this.firPos = 0;
        this.firDelayS = (taps - 1) / 2 / sr;

        // Fractional resampler state (linear interpolation of the low-passed signal).
        this.ratio = sr / RATE;
        this.phase = 0;
        this.prevSample = 0;

        // 16 kHz analysis ring.
        this.ring = new Float32Array (WIN);
        this.ringPos = 0;
        this.sinceHop = 0;
        this.filled = 0;

        this.fft = new FFT (N_FFT);
        this.re = new Float64Array (N_FFT);
        this.im = new Float64Array (N_FFT);
        this.frame = new Float64Array (WIN);
        this.nsdf = new Float64Array (WIN);

        // Gate.
        this.floorDb = -100; this.floorInit = false;
        this.dbHistory = new Float32Array (Math.round (NOISE_WINDOW_S * RATE / HOP)).fill (0);
        this.dbHistPos = 0; this.dbHistCount = 0;
        this.gateOpen = false; this.holdLeft = 0;

        this.medianBuf = [];
        this.euro = new OneEuro();
        this.lastVoiced = false;

        this.targetMidi = 0;     // 0 = free sing, full 80-1100 Hz
        this.port.onmessage = (e) => {
            if (e.data && typeof e.data.targetMidi === "number") this.targetMidi = e.data.targetMidi;
        };
    }

    hpf (x)
    {
        const y = this.hb0 * x + this.hb1 * this.hx1 + this.hb2 * this.hx2 - this.ha1 * this.hy1 - this.ha2 * this.hy2;
        this.hx2 = this.hx1; this.hx1 = x; this.hy2 = this.hy1; this.hy1 = y;
        return y;
    }

    lowpass (x)
    {
        const taps = this.fir.length;
        this.firBuf[this.firPos] = x;
        this.firBuf[this.firPos + taps] = x;
        this.firPos = (this.firPos + 1) % taps;
        let acc = 0;
        // firBuf[firPos .. firPos+taps-1] is oldest..newest
        for (let i = 0; i < taps; ++i) acc += this.fir[i] * this.firBuf[this.firPos + i];
        return acc;
    }

    process (inputs)
    {
        const input = inputs[0];
        if (! input || input.length === 0) return true;
        const ch = input[0];
        const n = ch.length;
        const blockStart = currentTime;

        for (let i = 0; i < n; ++i)
        {
            const y = this.lowpass (this.hpf (ch[i]));

            // Emit every 16 kHz sample that falls between prevSample and y.
            while (this.phase <= 1.0)
            {
                const s = this.prevSample + (y - this.prevSample) * this.phase;
                this.push16k (s, blockStart + i / sampleRate);
                this.phase += this.ratio;
            }
            this.phase -= 1.0;
            this.prevSample = y;
        }
        return true;
    }

    push16k (s, inputTime)
    {
        this.ring[this.ringPos] = s;
        this.ringPos = (this.ringPos + 1) % WIN;
        if (this.filled < WIN) ++this.filled;

        if (++this.sinceHop >= HOP)
        {
            this.sinceHop = 0;
            if (this.filled >= WIN) this.analyse (inputTime - this.firDelayS - (WIN / 2) / RATE);
        }
    }

    updateGate (db)
    {
        const dt = HOP / RATE;
        this.dbHistory[this.dbHistPos] = db;
        this.dbHistPos = (this.dbHistPos + 1) % this.dbHistory.length;
        if (this.dbHistCount < this.dbHistory.length) ++this.dbHistCount;

        let rawMin = Infinity;
        for (let i = 0; i < this.dbHistCount; ++i) rawMin = Math.min (rawMin, this.dbHistory[i]);

        if (! this.floorInit) { this.floorDb = rawMin; this.floorInit = true; }
        else if (rawMin <= this.floorDb) this.floorDb = rawMin;
        else this.floorDb += (rawMin - this.floorDb) * (1 - Math.exp (-dt / NOISE_WINDOW_S));

        const aboveOpen  = db >= this.floorDb + OPEN_DB  && db >= ABS_FLOOR_DB;
        const aboveClose = db >= this.floorDb + CLOSE_DB && db >= ABS_FLOOR_DB;

        if (! this.gateOpen)
        {
            if (aboveOpen) { this.gateOpen = true; this.holdLeft = HOLD_S; }
        }
        else if (aboveClose) this.holdLeft = HOLD_S;
        else
        {
            this.holdLeft -= dt;
            if (this.holdLeft <= 0) this.gateOpen = false;
        }
        return this.gateOpen;
    }

    analyse (centreTime)
    {
        const x = this.frame;
        for (let i = 0; i < WIN; ++i) x[i] = this.ring[(this.ringPos + i) % WIN];

        // RMS over the newest 20 ms.
        let p = 0;
        for (let i = WIN - RMS_SAMPLES; i < WIN; ++i) p += x[i] * x[i];
        const rmsDb = 10 * Math.log10 (p / RMS_SAMPLES + 1e-12);
        const gate = this.updateGate (rmsDb);

        let midi = NaN, clarity = 0;

        if (gate)
        {
            // Lag range: target +-1 octave, or the full free-sing range.
            let fMin = 80, fMax = 1100;
            if (this.targetMidi > 0)
            {
                const f = 440 * Math.pow (2, (this.targetMidi - 69) / 12);
                fMin = Math.max (60, f / 2); fMax = Math.min (1500, f * 2);
            }
            const tauMin = Math.max (2, Math.floor (RATE / fMax));
            const tauMax = Math.min (WIN - 2, Math.ceil (RATE / fMin));

            const r = this.mpm (x, tauMin, tauMax);
            if (r)
            {
                clarity = r.clarity;
                if (clarity >= CLARITY_MIN) midi = 69 + 12 * Math.log2 (RATE / r.tau / 440);
            }
        }

        // 3-tap median on fractional MIDI, then 1-Euro for the display dot.
        let raw = NaN, smooth = NaN;
        if (Number.isFinite (midi))
        {
            this.medianBuf.push (midi);
            if (this.medianBuf.length > 3) this.medianBuf.shift();
            const sorted = [...this.medianBuf].sort ((a, b) => a - b);
            raw = sorted[Math.floor (sorted.length / 2)];
            if (! this.lastVoiced) this.euro.reset();
            smooth = this.euro.filter (raw, HOP / RATE);
            this.lastVoiced = true;
        }
        else
        {
            this.medianBuf.length = 0;
            this.lastVoiced = false;
        }

        this.port.postMessage ({ t: centreTime, raw, smooth, clarity, rmsDb, gate });
    }

    mpm (x, tauMin, tauMax)
    {
        const re = this.re, im = this.im;
        re.fill (0); im.fill (0);
        for (let i = 0; i < WIN; ++i) re[i] = x[i];

        this.fft.run (re, im);
        for (let i = 0; i < N_FFT; ++i) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
        this.fft.run (re, im);          // power spectrum is real & even: forward == inverse * N

        const nsdf = this.nsdf;
        let m = 0;
        for (let i = 0; i < WIN; ++i) m += 2 * x[i] * x[i];
        for (let tau = 0; tau < WIN; ++tau)
        {
            if (tau > 0) m -= x[tau - 1] * x[tau - 1] + x[WIN - tau] * x[WIN - tau];
            const r = re[tau] / N_FFT;
            nsdf[tau] = m > 1e-12 ? 2 * r / m : 0;
        }

        // Key maxima: one per positive lobe (between a positive-going and the
        // next negative-going zero crossing), skipping the tau = 0 lobe.
        const peaks = [];
        let tau = 1;
        while (tau < tauMax && nsdf[tau] > 0) ++tau;       // leave the zero-lag lobe
        while (tau < tauMax)
        {
            while (tau < tauMax && nsdf[tau] <= 0) ++tau;
            let best = -1, bestTau = -1;
            while (tau < WIN - 1 && nsdf[tau] > 0)
            {
                if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; }
                ++tau;
            }
            if (bestTau >= tauMin && bestTau <= tauMax) peaks.push (bestTau);
        }
        if (peaks.length === 0) return null;

        let globalMax = 0;
        for (const t of peaks) globalMax = Math.max (globalMax, nsdf[t]);
        const chosen = peaks.find (t => nsdf[t] >= KEY_MAX_K * globalMax);

        const a = nsdf[chosen - 1], b = nsdf[chosen], c = nsdf[chosen + 1];
        const denom = a - 2 * b + c;
        const shift = Math.abs (denom) > 1e-12 ? 0.5 * (a - c) / denom : 0;
        return { tau: chosen + shift, clarity: b - 0.25 * (a - c) * shift };
    }
}

registerProcessor ("pitch-processor", PitchProcessor);
