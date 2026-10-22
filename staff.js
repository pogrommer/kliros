// staff.js — five-line notation: what to sing, and what was sung.
//
// Unlike the highway's staff background (true-pitch spacing, see DESIGN.md
// M6++), this is real notation: diatonic spacing, clefs, ledger lines, sharps.
// It is a second view of the same notes, for reading, not for aiming.
//
// Modes: "bass", "treble", "treble8" (tenor-style treble, sounding an octave
// lower), "grand" (treble + bass, C4 and above on the treble staff).
//
// The staff runs on the piano roll's time axis: every note is drawn at the x of
// its bar above, barlines where the score has them, one shared "now" line. So
// the two views are one picture, read two ways.

const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SHARP  = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const NAMES  = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const diatonic = (midi) => (Math.floor (midi / 12) - 1) * 7 + LETTER[((midi % 12) + 12) % 12];
export const isSharp  = (midi) => SHARP[((midi % 12) + 12) % 12] === 1;
export const midiName = (midi) => NAMES[((midi % 12) + 12) % 12] + (Math.floor (midi / 12) - 1);

const TREBLE_MID = 34;   // B4
const BASS_MID   = 22;   // D3

export const COLOURS = {
    line: "#7c7c8a", head: "#e6e6ee", dim: "#5a5a66", active: "#56B4E9",
    good: "#009E73", bad: "#D55E00", text: "#9a9aa6", miss: "#E5484D",
};

// Which staff a note belongs to, and the diatonic position it is DRAWN at.
function place (mode, midi)
{
    switch (mode)
    {
        case "treble":  return { staff: 0, d: diatonic (midi) };
        case "treble8": return { staff: 0, d: diatonic (midi + 12) };
        case "grand":   return midi >= 60 ? { staff: 0, d: diatonic (midi) } : { staff: 1, d: diatonic (midi) };
        default:        return { staff: 0, d: diatonic (midi) };
    }
}

function staffDefs (mode)
{
    if (mode === "grand")  return [{ clef: "G", mid: TREBLE_MID }, { clef: "F", mid: BASS_MID }];
    if (mode === "bass")   return [{ clef: "F", mid: BASS_MID }];
    return [{ clef: "G", mid: TREBLE_MID, eight: mode === "treble8" }];
}

/*
    view = {
      mode, showNames, label, range: [lo, hi] | null,
      notes: [{ midi, x, x1, q, state: "past" | "active" | "future",
                ok: true | false | null,                     past: in tune for at least half of it
                sung: { midi, cents, colour } | null }],      sung: the pitch sung, folded to the note's octave
                                                               x, x1 = start, end;
                                                               q = written value in quarters
                                                               (absent: drawn as a quarter)
      meter: quarters per measure now | null                   time signature, by the clef
      bars:  [x],                                              barlines
      nowX, maxS,                                              play line; largest line gap
      lyricsAbove                                              notes carry syllable: print it over the staff
      live:  { midi (rounded, true octave), cents, colour } | null,
    }
*/
export function drawStaff (g, W, H, view)
{
    g.clearRect (0, 0, W, H);
    const defs = staffDefs (view.mode);
    let items = view.notes || [];

    // Vertical extent needed beyond the staff, in diatonic steps.
    let over = [0, 0], under = [0, 0];
    const consider = (midi) => {
        const p = place (view.mode, midi), mid = defs[Math.min (p.staff, defs.length - 1)].mid;
        over[p.staff]  = Math.max (over[p.staff],  p.d - (mid + 4));
        under[p.staff] = Math.max (under[p.staff], (mid - 4) - p.d);
    };
    // The scale is fixed by the whole chart's range, never by what is being
    // sung: sizing to the live voice made the staff zoom in and out every time
    // a note strayed above or below the phrase.
    if (view.range) { consider (view.range[0]); consider (view.range[1]); }
    else { for (const n of items) consider (n.midi); if (view.live) consider (view.live.midi); }
    // A tapped reference note gets room too: it changes only when a key is tapped.
    if (view.reference) consider (view.reference.midi);

    // The words over the staff take a band of their own, above anything on ledger lines.
    // 4.5: the syllables' own height (1.15 s) and their gap above the top ledger (1.2 s), less MARGIN.
    const lyricRows = view.lyricsAbove ? 4.5 : 0;
    // Margins kept tight: every half-space saved makes the notes and the keys bigger.
    // Above, a half-space and a bit; below, the names (gap, the name, a missed name) or the same bit.
    const MARGIN = 1.5, below = view.showNames ? 5.2 : MARGIN;
    // Total height in half-spaces: staff = 8, plus overflows, plus margins.
    let halfSpaces;
    if (defs.length === 2) halfSpaces = 8 + 8 + Math.max (6, under[0] + over[1] + 2) + over[0] + under[1];
    else halfSpaces = 8 + over[0] + under[0];
    halfSpaces += MARGIN + below + lyricRows;

    // Line gap: fit the height, and no larger than the song's quick notes allow
    // (maxS, from the time axis) so their heads do not run into each other.
    // 24 px is plenty on a phone; a desktop window may go to 40.
    const s = Math.max (6, Math.min (40, (H / halfSpaces) * 2, view.maxS || 40));
    const h = s / 2;

    // Staff centre lines.
    // Room left over goes mostly above: no gap between the names and the screen's bottom.
    const top = (H - halfSpaces * h) * 0.85 + (MARGIN + over[0] + lyricRows) * h;
    const centres = [];
    centres[0] = top + 4 * h;
    if (defs.length === 2) centres[1] = centres[0] + 8 * h + Math.max (6, under[0] + over[1] + 2) * h;

    const meterW = view.meter ? s * 1.9 : 0;
    // A short piano keyboard stands on its side left of the clef, a key per staff step.
    // Folded (view.kbFolded) it is a narrow tab that opens it.
    const kbW = view.kbFolded ? s * 0.9 : s * 2.34;
    const clefW = s * 2.4, left = kbW + s * 0.3, right = W - s * 0.6, x0 = left + clefW + meterW;
    // The play line comes in close behind the clef: the piano roll's two seconds of
    // history are dead room on the staff, a past note or two is enough. Everything
    // in time moves left by dx (keys.dx tells a tap where the time axis went).
    const dx = view.nowX != null ? Math.min (0, x0 + s * 2.5 - view.nowX) : 0;
    const nowX = view.nowX != null ? view.nowX + dx : null;
    if (dx) items = items.map (n => ({ ...n, x: n.x + dx, x1: n.x1 + dx }));
    const bars = (view.bars || []).map (bx => bx + dx);
    const yFor = (staff, d) => centres[staff] - (d - defs[staff].mid) * h;
    const yTop = centres[0] - 2 * s, yBot = centres[centres.length - 1] + 2 * s;

    // Staff lines.
    g.lineWidth = Math.max (1, s * 0.08);
    g.strokeStyle = COLOURS.line;
    defs.forEach ((def, i) => {
        for (let k = -2; k <= 2; ++k)
        {
            const y = Math.round (centres[i] + k * s) + 0.5;
            g.beginPath(); g.moveTo (left, y); g.lineTo (right, y); g.stroke();
        }
    });

    // Everything that scrolls is clipped to the right of the clef.
    g.save();
    g.beginPath(); g.rect (x0, 0, W - x0, H); g.clip();

    // Barlines, through both staves of a grand staff.
    g.lineWidth = Math.max (1, s * 0.1);
    for (const bx of bars)
    {
        if (bx < x0 - 2 || bx > right) continue;
        const x = Math.round (bx) + 0.5;
        g.beginPath(); g.moveTo (x, yTop); g.lineTo (x, yBot); g.stroke();
    }

    // The note being sung: a band over its whole length, as the bar above is lit.
    for (const note of items)
        if (note.state === "active")
        {
            g.fillStyle = "rgba(86,180,233,0.10)";
            g.fillRect (note.x - s * 0.8, yTop - 3 * h, Math.max (s * 1.6, note.x1 - note.x + s * 0.8), yBot - yTop + 6 * h);
        }

    let nameEnd = -Infinity;
    const name = view.label || midiName;
    const yText = yBot + (2.2 + under[defs.length - 1]) * h + s * 0.7;
    for (const note of items)
    {
        // Heads sit just right of the note's start, so the head is under its bar.
        const x = note.x + s * 0.62;
        const tgt = place (view.mode, note.midi);
        // Timing is not judged, only pitch - so nothing is drawn beside a note. A note
        // sung in tune turns green itself; a missed one keeps its colour and the pitch
        // that WAS sung is drawn red in the same column, over it where they meet.
        const missed = note.state === "past" && note.ok === false && note.sung;
        const colour = note.state === "active" ? COLOURS.active
                     : note.state === "past" && note.ok ? COLOURS.good
                     : note.state === "past" ? COLOURS.dim : COLOURS.head;

        drawLedgers (g, defs, tgt, x, s, centres, h);
        drawNote (g, x, yFor (tgt.staff, tgt.d), s, colour, note.q, defs[tgt.staff].mid > tgt.d, tgt.d % 2 === 0);
        if (isSharp (note.midi)) drawSharp (g, x - s * 1.25, yFor (tgt.staff, tgt.d), s, colour);

        if (missed)
        {
            const p = place (view.mode, note.sung.midi);
            drawLedgers (g, defs, p, x, s, centres, h);
            drawHead (g, x, yFor (p.staff, p.d), s * 0.92, COLOURS.miss, true, false, true);
            if (isSharp (note.sung.midi)) drawSharp (g, x + s * 1.0, yFor (p.staff, p.d), s * 0.75, COLOURS.miss);
        }
        // The voice now, as a ring over the note being sung: its colour says how close.
        if (note.state === "active" && view.live)
        {
            const p = place (view.mode, view.live.midi);
            drawLedgers (g, defs, p, x, s, centres, h);
            drawHead (g, x, yFor (p.staff, p.d), s * 1.05, view.live.colour, false, false, true);
            if (isSharp (view.live.midi)) drawSharp (g, x + s * 1.0, yFor (p.staff, p.d), s * 0.75, view.live.colour);
        }

        if (view.showNames)
        {
            // A name that would print over the one before it is left out.
            g.textAlign = "center"; g.textBaseline = "alphabetic";
            g.font = `${Math.round (Math.max (9, s * 0.62))}px -apple-system, system-ui, sans-serif`;
            const t = name (note.midi), w = g.measureText (t).width;
            if (x - w / 2 > nameEnd + 3 || note.state === "active")
            {
                g.fillStyle = note.state === "active" ? COLOURS.active : COLOURS.text;
                g.fillText (t, x, yText);
                if (missed) { g.fillStyle = COLOURS.miss; g.fillText (name (note.sung.midi), x, yText + s * 0.8); }
                nameEnd = x + w / 2;
            }
        }
    }

    if (view.lyricsAbove)
    {
        // Each syllable starts over its note; one that would print over the one
        // before it moves right, as words do under a staff.
        const fs = Math.round (Math.max (14, Math.min (34, s * 1.15)));
        const y = yTop - Math.max (over[0] * h, 0) - s * 1.2;
        g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
        g.textAlign = "left"; g.textBaseline = "alphabetic";
        let end = -Infinity;
        for (const note of items)
        {
            if (! note.syllable) continue;
            const x = Math.max (note.x, end + fs * 0.35);
            g.fillStyle = note.state === "active" ? "#ffffff" : note.state === "past" ? "#F0E442" : "#b8b8c4";
            g.fillText (note.syllable, x, y);
            end = x + g.measureText (note.syllable).width;
        }
    }

    // A reference note (a tapped key) on the play line, where nothing else is to be sung:
    // a whole note, white; on a hit its head alone turns green, nothing drawn over it.
    const ref = view.reference && ! items.some (n => n.state === "active") ? view.reference : null;
    if (ref && nowX != null)
    {
        const x = nowX + s * 1.6, p = place (view.mode, ref.midi);
        drawLedgers (g, defs, p, x, s, centres, h);
        // A hit fills the head: the round lights up green.
        if (ref.hit) drawHead (g, x, yFor (p.staff, p.d), s, COLOURS.good, true, false, true);
        else drawNote (g, x, yFor (p.staff, p.d), s, COLOURS.head, 4, false, p.d % 2 === 0);
        if (isSharp (ref.midi)) drawSharp (g, x - s * 1.25, yFor (p.staff, p.d), s, COLOURS.head);
        if (view.showNames)
        {
            g.font = `600 ${Math.round (Math.max (9, s * 0.62))}px -apple-system, system-ui, sans-serif`;
            g.textAlign = "center"; g.textBaseline = "alphabetic";
            g.fillStyle = COLOURS.text; g.fillText (name (ref.midi), x, yText);
        }
    }

    // The voice where there is no note to sing: on the play line.
    // Against a reference note it is a ring over it, as over a note being sung.
    if (view.live && ! items.some (n => n.state === "active") && nowX != null && ! (ref && ref.hit))
    {
        const x = nowX + s * (ref ? 1.6 : 0.62), p = place (view.mode, view.live.midi);
        drawLedgers (g, defs, p, x, s, centres, h);
        drawHead (g, x, yFor (p.staff, p.d), s * (ref ? 1.05 : 1), view.live.colour, ! ref, false, true);
        if (isSharp (view.live.midi)) drawSharp (g, x - s * 1.1, yFor (p.staff, p.d), s * 0.8, view.live.colour);
    }

    // Play line, the same as the piano roll's.
    if (nowX != null)
    {
        g.strokeStyle = "#8a8a96"; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo (nowX, yTop - 2 * h); g.lineTo (nowX, yBot + 2 * h); g.stroke();
    }
    g.restore();

    // Clefs last, on a plain ground, so the notes scroll in from under them.
    g.fillStyle = view.background || "#131318";
    g.fillRect (0, 0, x0 - 1, H);
    g.lineWidth = Math.max (1, s * 0.08);
    g.strokeStyle = COLOURS.line;
    defs.forEach ((def, i) => {
        for (let k = -2; k <= 2; ++k)
        {
            const y = Math.round (centres[i] + k * s) + 0.5;
            g.beginPath(); g.moveTo (left, y); g.lineTo (x0, y); g.stroke();
        }
        // Clefs a little under engraving size: they only name the lines, the room goes to the notes.
        if (def.clef === "G") drawTrebleClef (g, left + s * 0.5, centres[i] + s, s * 0.8, def.eight);
        else                  drawBassClef   (g, left + s * 0.25, centres[i] - s, s * 0.7);
        if (view.meter) drawMeter (g, left + clefW + meterW / 2, centres[i], s, view.meter);
    });
    if (defs.length === 2)
    {
        g.beginPath(); g.moveTo (left + 0.5, yTop); g.lineTo (left + 0.5, yBot); g.stroke();
    }

    // keys.toggle: where a tap folds or opens the keyboard — the tab, or the clef.
    if (view.kbFolded)
    {
        const x = s * 0.25, y = yTop - s, hh = yBot - yTop + 2 * s;
        g.fillStyle = "#2a2a32"; g.fillRect (x, y, kbW, hh);
        g.fillStyle = "#8c8c98"; g.font = `400 ${Math.round (s * 0.9)}px -apple-system, system-ui, sans-serif`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText ("»", x + kbW / 2, (yTop + yBot) / 2);
        const keys = [];
        keys.toggle = { x: 0, y, w: left, h: hh };
        keys.dx = dx;
        return keys;
    }
    const active = items.find (n => n.state === "active");
    const keys = drawKeyboard (g, view, defs, centres, s, h, kbW, H, over, under, name,
                               active ? active.midi : ref ? ref.midi : null, view.live ? view.live : null);
    keys.toggle = { x: left, y: yTop - s, w: clefW, h: yBot - yTop + 2 * s };
    keys.dx = dx;
    return keys;
}

// The keyboard turned on its side: low notes at the bottom, the black keys at
// the back (left), each white key level with its line or space, so a note and
// its key are read on one level. In treble8 the keys sound an octave below
// where they stand, as the notes do.
const WHITE = [0, 2, 4, 5, 7, 9, 11];
// Returns the keys as [{ x, y, w, h, midi, black }], for tapping.
function drawKeyboard (g, view, defs, centres, s, h, kbW, H, over, under, name, target, live)
{
    const keys = [];
    const x = s * 0.25, bw = s * 1.12, shift = view.mode === "treble8" ? 12 : 0;
    const midiAt = (d) => (Math.floor (d / 7) + 1) * 12 + WHITE[((d % 7) + 7) % 7] - shift;
    const fill = (m) => view.pressed === m ? "#F0E442" : live && live.midi === m ? live.colour : target === m ? COLOURS.active : null;
    const fs = Math.max (7, Math.min (h * 1.0, s * 0.9));

    defs.forEach ((def, i) => {
        let lo = def.mid - 5 - under[i], hi = def.mid + 5 + over[i];
        if (view.mode === "grand") { if (i === 0) lo = diatonic (60); else hi = diatonic (59); }
        const yOf = (d) => centres[i] - (d - def.mid) * h;
        while (yOf (hi) - h / 2 < 0) --hi;
        while (yOf (lo) + h / 2 > H) ++lo;

        // White keys, labelled at the front.
        g.lineWidth = 1;
        for (let d = lo; d <= hi; ++d)
        {
            const m = midiAt (d), y = yOf (d);
            g.fillStyle = fill (m) || "#d6d6de";
            g.fillRect (x, y - h / 2, kbW, h);
            keys.push ({ x, y: y - h / 2, w: kbW, h, midi: m, black: false });
            g.strokeStyle = "#55555f";
            g.strokeRect (x + 0.5, Math.round (y - h / 2) + 0.5, kbW - 1, Math.round (h));
            {
                // Names quiet: there to look up, not to read all the time.
                g.fillStyle = fill (m) ? "#1c1c22" : "#8c8c98";
                g.font = `400 ${Math.round (fs)}px -apple-system, system-ui, sans-serif`;
                g.textAlign = "right"; g.textBaseline = "middle";
                g.fillText (name (m), x + kbW - s * 0.18, y + 0.5);
            }
        }
        // Black keys, on the border above C D F G A.
        for (let d = lo; d < hi; ++d)
        {
            if (! [0, 1, 3, 4, 5].includes (((d % 7) + 7) % 7)) continue;
            const m = midiAt (d) + 1, y = yOf (d) - h / 2, bh = h * 0.8;
            g.fillStyle = fill (m) || "#18181e";
            g.fillRect (x, y - bh / 2, bw, bh);
            keys.push ({ x, y: y - bh / 2, w: bw, h: bh, midi: m, black: true });
            g.strokeStyle = "#000";
            g.strokeRect (x + 0.5, y - bh / 2 + 0.5, bw - 1, bh - 1);
            // Every key is named: a long name shrinks to fit its key, never below 7 px.
            let bf = Math.max (7, Math.min (bh, s * 0.7));
            g.font = `400 ${Math.round (bf)}px -apple-system, system-ui, sans-serif`;
            const tw = g.measureText (name (m)).width, room = bw - s * 0.2;
            if (tw > room) { bf = Math.max (7, bf * room / tw); g.font = `400 ${Math.round (bf)}px -apple-system, system-ui, sans-serif`; }
            {
                g.fillStyle = fill (m) ? "#101014" : "#6c6c78";
                g.textAlign = "right"; g.textBaseline = "middle";
                g.fillText (name (m), x + bw - s * 0.12, y + 0.5);
            }
        }
    });
    return keys;
}

// The time signature from the measure's length in quarters: 4 -> 4/4, 1.5 -> 3/8.
function drawMeter (g, x, yMid, s, quarters)
{
    const eighths = Math.round (quarters * 2) % 2 === 1;
    const top = String (eighths ? Math.round (quarters * 2) : Math.round (quarters)), bottom = eighths ? "8" : "4";
    g.save();
    g.fillStyle = COLOURS.head;
    g.font = `bold ${Math.round (s * 2.15)}px Georgia, "Times New Roman", serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText (top, x, yMid - s * 0.95);
    g.fillText (bottom, x, yMid + s * 1.05);
    g.restore();
}

// A note by its written value: whole and half hollow, flags for eighths and
// sixteenths, a dot for dotted values. A value that is none of these (a reciting
// note, as long as its words) is drawn as a breve: hollow, no stem, side bars.
const VALUES = { 4: [0, false], 6: [0, true], 2: [1, false], 3: [1, true], 1: [2, false], 1.5: [2, true],
                 0.5: [3, false], 0.75: [3, true], 0.25: [4, false], 0.375: [4, true] };
function drawNote (g, x, y, s, colour, q, stemUp, onLine)
{
    const v = q == null ? [2, false] : VALUES[q];
    if (! v)
    {
        drawHead (g, x, y, s, colour, false, false, true);
        g.strokeStyle = colour; g.lineWidth = Math.max (1, s * 0.12);
        for (const dx of [-0.95, -0.78, 0.78, 0.95])
        { g.beginPath(); g.moveTo (x + dx * s, y - s * 0.6); g.lineTo (x + dx * s, y + s * 0.6); g.stroke(); }
        return;
    }
    const [kind, dotted] = v;            // 0 whole, 1 half, 2 quarter, 3 eighth, 4 sixteenth
    drawHead (g, x, y, s, colour, kind >= 2, false, true);
    if (kind >= 1)
    {
        const sx = stemUp ? x + s * 0.56 : x - s * 0.56, end = stemUp ? y - s * 3.3 : y + s * 3.3;
        g.strokeStyle = colour; g.lineWidth = Math.max (1, s * 0.1);
        g.beginPath(); g.moveTo (sx, y + (stemUp ? -0.1 : 0.1) * s); g.lineTo (sx, end); g.stroke();
        for (let f = 0; f < kind - 2; ++f)
        {
            const fy = end + (stemUp ? 1 : -1) * f * s * 0.75;
            g.lineWidth = Math.max (1.5, s * 0.2);
            g.beginPath(); g.moveTo (sx, fy);
            g.bezierCurveTo (sx + s * 0.2, fy + (stemUp ? 1 : -1) * s * 0.6, sx + s * 1.1, fy + (stemUp ? 1 : -1) * s * 0.9,
                             sx + s * 0.75, fy + (stemUp ? 1 : -1) * s * 1.7);
            g.stroke();
        }
    }
    if (dotted)
    {
        // On a line the dot moves up into the space, as engraved.
        g.fillStyle = colour;
        g.beginPath(); g.arc (x + s * 1.05, y - (onLine ? s * 0.5 : 0), s * 0.15, 0, Math.PI * 2); g.fill();
    }
}

function drawLedgers (g, defs, p, x, s, centres, h)
{
    const mid = defs[p.staff].mid, c = centres[p.staff];
    g.strokeStyle = COLOURS.line;
    g.lineWidth = Math.max (1, s * 0.08);
    const w = s * 0.95;
    for (let d = mid + 6; d <= p.d; d += 2) line (c - (d - mid) * h);
    for (let d = mid - 6; d >= p.d; d -= 2) line (c - (d - mid) * h);
    function line (y) { y = Math.round (y) + 0.5; g.beginPath(); g.moveTo (x - w, y); g.lineTo (x + w, y); g.stroke(); }
}

function drawHead (g, x, y, s, colour, filled, stemUp, ring = false)
{
    g.save();
    g.translate (x, y);
    g.rotate (-0.35);
    g.beginPath();
    g.ellipse (0, 0, s * 0.62, s * 0.42, 0, 0, Math.PI * 2);
    if (filled) { g.fillStyle = colour; g.fill(); }
    else { g.lineWidth = Math.max (1.5, s * 0.16); g.strokeStyle = colour; g.stroke(); }
    g.restore();

    if (! ring)
    {
        // Stem: up for notes below the middle line, down otherwise.
        g.strokeStyle = colour;
        g.lineWidth = Math.max (1, s * 0.1);
        g.beginPath();
        if (stemUp) { g.moveTo (x + s * 0.56, y - s * 0.1); g.lineTo (x + s * 0.56, y - s * 3.3); }
        else        { g.moveTo (x - s * 0.56, y + s * 0.1); g.lineTo (x - s * 0.56, y + s * 3.3); }
        g.stroke();
    }
}

function drawSharp (g, x, y, s, colour)
{
    g.strokeStyle = colour;
    g.lineWidth = Math.max (1, s * 0.1);
    g.beginPath();
    g.moveTo (x - s * 0.15, y - s * 0.95); g.lineTo (x - s * 0.15, y + s * 0.95);
    g.moveTo (x + s * 0.15, y - s * 1.05); g.lineTo (x + s * 0.15, y + s * 0.85);
    g.stroke();
    g.lineWidth = Math.max (1.5, s * 0.22);
    g.beginPath();
    g.moveTo (x - s * 0.38, y - s * 0.2);  g.lineTo (x + s * 0.38, y - s * 0.42);
    g.moveTo (x - s * 0.38, y + s * 0.42); g.lineTo (x + s * 0.38, y + s * 0.2);
    g.stroke();
}

// G clef, drawn around the G line at (x, yG). Units of one staff space.
function drawTrebleClef (g, x, yG, s, eight)
{
    g.save();
    g.translate (x, yG);
    g.scale (s, s);
    g.strokeStyle = COLOURS.head;
    g.fillStyle = COLOURS.head;
    g.lineCap = "round"; g.lineJoin = "round";

    g.lineWidth = 0.17;
    g.beginPath();
    g.moveTo (0.85, 0.30);
    g.bezierCurveTo (0.50, 0.55, 0.05, 0.25, 0.20, -0.30);
    g.bezierCurveTo (0.35, -0.85, 1.45, -0.85, 1.45, 0.05);
    g.bezierCurveTo (1.45, 0.85, 0.20, 1.00, -0.15, 0.30);
    g.bezierCurveTo (-0.45, -0.35, 0.25, -1.15, 0.75, -1.85);
    g.bezierCurveTo (1.25, -2.55, 1.35, -3.55, 1.05, -4.15);
    g.bezierCurveTo (0.75, -4.65, 0.30, -4.05, 0.45, -3.00);
    g.stroke();

    g.lineWidth = 0.13;
    g.beginPath();
    g.moveTo (0.45, -3.00);
    g.lineTo (0.95, 1.85);
    g.bezierCurveTo (1.02, 2.55, 0.45, 2.85, 0.12, 2.45);
    g.stroke();
    g.beginPath(); g.arc (0.30, 2.25, 0.28, 0, Math.PI * 2); g.fill();

    if (eight)
    {
        g.font = "bold 1.1px -apple-system, system-ui, sans-serif";
        g.textAlign = "center"; g.textBaseline = "top";
        g.fillText ("8", 0.75, 3.0);
    }
    g.restore();
}

// F clef, its dot on the F line at (x, yF).
function drawBassClef (g, x, yF, s)
{
    g.save();
    g.translate (x, yF);
    g.scale (s, s);
    g.strokeStyle = COLOURS.head;
    g.fillStyle = COLOURS.head;
    g.lineCap = "round";
    g.beginPath(); g.arc (0.32, 0.0, 0.32, 0, Math.PI * 2); g.fill();
    g.lineWidth = 0.2;
    g.beginPath();
    g.moveTo (0.05, 0.0);
    g.bezierCurveTo (0.0, -1.05, 1.75, -1.25, 1.85, -0.05);
    g.bezierCurveTo (1.95, 1.25, 0.95, 2.15, 0.0, 2.75);
    g.stroke();
    g.beginPath(); g.arc (2.35, -0.5, 0.17, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc (2.35,  0.5, 0.17, 0, Math.PI * 2); g.fill();
    g.restore();
}
