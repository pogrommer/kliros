// staff.js — five-line notation: what to sing, and what was sung.
//
// Unlike the highway's staff background (true-pitch spacing, see DESIGN.md
// M6++), this is real notation: diatonic spacing, clefs, ledger lines, sharps.
// It is a second view of the same notes, for reading, not for aiming.
//
// Modes: "bass", "treble", "treble8" (tenor-style treble, sounding an octave
// lower), "grand" (treble + bass, C4 and above on the treble staff).

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
    good: "#009E73", bad: "#D55E00", text: "#9a9aa6",
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
      mode, showNames,
      notes: [{ midi, state: "past" | "active" | "future", syllable,
                sung: { midi, cents, colour } | null }],
      live:  { midi (rounded, true octave), cents, colour } | null,
    }
*/
export function drawStaff (g, W, H, view)
{
    g.clearRect (0, 0, W, H);
    const defs = staffDefs (view.mode);
    const items = view.notes || [];

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

    const nameRows = view.showNames ? 2 : 0;
    // Total height in half-spaces: staff = 8, plus overflows, plus margins.
    let halfSpaces;
    if (defs.length === 2) halfSpaces = 8 + 8 + Math.max (6, under[0] + over[1] + 2) + over[0] + under[1] + 6;
    else halfSpaces = 8 + over[0] + under[0] + 7;
    halfSpaces += nameRows * 2.6;

    // Line gap: fit the height, but also the width — each note needs ~2.3
    // spaces (its head, the sung head beside it, air), plus clef and live column.
    const widthFit = W / (Math.max (1, items.length) * 2.3 + 3.4 + 1.2 + (items.length ? 3 : 0));
    const s = Math.max (6, Math.min (24, (H / halfSpaces) * 2, widthFit));
    const h = s / 2;

    // Staff centre lines.
    const top = (H - halfSpaces * h) / 2 + (3 + over[0]) * h;
    const centres = [];
    centres[0] = top + 4 * h;
    if (defs.length === 2) centres[1] = centres[0] + 8 * h + Math.max (6, under[0] + over[1] + 2) * h;

    const clefW = s * 3.4, left = s * 0.6, right = W - s * 0.6;
    const yFor = (staff, d) => centres[staff] - (d - defs[staff].mid) * h;

    // Staff lines and clefs.
    g.lineWidth = Math.max (1, s * 0.08);
    g.strokeStyle = COLOURS.line;
    defs.forEach ((def, i) => {
        for (let k = -2; k <= 2; ++k)
        {
            const y = Math.round (centres[i] + k * s) + 0.5;
            g.beginPath(); g.moveTo (left, y); g.lineTo (right, y); g.stroke();
        }
        if (def.clef === "G") drawTrebleClef (g, left + s * 0.5, centres[i] + s, s, def.eight);
        else                  drawBassClef   (g, left + s * 0.4, centres[i] - s, s);
    });
    if (defs.length === 2)
    {
        g.beginPath(); g.moveTo (left + 0.5, centres[0] - 2 * s); g.lineTo (left + 0.5, centres[1] + 2 * s); g.stroke();
    }

    // Columns.
    // The live voice's column on the right is ALWAYS reserved when there are
    // notes, used or not: reserving it only while it was in use squeezed every
    // column (and ran the names together) each time the voice came and went.
    const reserve = items.length > 0;
    const liveCol = reserve && view.live && ! items.some (n => n.state === "active");
    const x0 = left + clefW, usable = right - x0 - s - (reserve ? s * 3 : 0);
    const n = Math.max (1, items.length);
    const step = Math.min (s * 4.5, usable / n);
    const colX = (i) => x0 + step * (i + 0.5);

    items.forEach ((note, i) => {
        const x = colX (i);
        const tgt = place (view.mode, note.midi);
        const colour = note.state === "active" ? COLOURS.active : note.state === "past" ? COLOURS.dim : COLOURS.head;

        drawLedgers (g, defs, tgt, x, s, centres, h);
        drawHead (g, x, yFor (tgt.staff, tgt.d), s, colour, true, defs[tgt.staff].mid > tgt.d);
        if (isSharp (note.midi)) drawSharp (g, x - s * 1.25, yFor (tgt.staff, tgt.d), s, colour);

        if (note.state === "active")
        {
            g.fillStyle = "rgba(86,180,233,0.10)";
            g.fillRect (x - step / 2 + 1, centres[0] - 2 * s - 3 * h, step - 2,
                        (centres[centres.length - 1] - centres[0]) + 4 * s + 6 * h);
        }

        const sung = note.sung || (note.state === "active" ? view.live : null);
        if (sung)
        {
            const p = place (view.mode, sung.midi);
            const sx = x + s * 1.05;
            drawLedgers (g, defs, p, sx, s * 0.85, centres, h);
            drawHead (g, sx, yFor (p.staff, p.d), s * 0.85, sung.colour, note.state !== "active", false, true);
            if (isSharp (sung.midi)) drawSharp (g, sx + s * 0.95, yFor (p.staff, p.d), s * 0.7, sung.colour);
        }

        if (view.showNames)
        {
            const yText = centres[centres.length - 1] + 2 * s + (2.2 + under[defs.length - 1]) * h + s * 0.9;
            g.textAlign = "center"; g.textBaseline = "alphabetic";
            g.font = `${Math.round (Math.max (10, Math.min (s * 0.9, step * 0.55)))}px -apple-system, system-ui, sans-serif`;
            g.fillStyle = note.state === "active" ? COLOURS.active : COLOURS.text;
            const name = view.label || midiName;
            g.fillText (name (note.midi), x, yText);
            if (sung)
            {
                g.fillStyle = sung.colour;
                g.fillText (name (sung.midi), x, yText + s * 1.15);
            }
        }
    });

    if (liveCol)
    {
        const x = right - s * 1.6, p = place (view.mode, view.live.midi);
        g.strokeStyle = COLOURS.dim; g.lineWidth = 1;
        g.beginPath(); g.moveTo (x - s * 1.5, centres[0] - 2 * s); g.lineTo (x - s * 1.5, centres[centres.length - 1] + 2 * s); g.stroke();
        drawLedgers (g, defs, p, x, s, centres, h);
        drawHead (g, x, yFor (p.staff, p.d), s, view.live.colour, true, false, true);
        if (isSharp (view.live.midi)) drawSharp (g, x - s * 1.1, yFor (p.staff, p.d), s * 0.8, view.live.colour);
    }

    // Free sing: no targets, one live head in the middle.
    if (items.length === 0 && view.live)
    {
        const x = (x0 + right) / 2, p = place (view.mode, view.live.midi);
        drawLedgers (g, defs, p, x, s, centres, h);
        drawHead (g, x, yFor (p.staff, p.d), s * 1.1, view.live.colour, true, false);
        if (isSharp (view.live.midi)) drawSharp (g, x - s * 1.4, yFor (p.staff, p.d), s, view.live.colour);
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
