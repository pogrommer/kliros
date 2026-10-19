// exercises.js — a port of src/exercise/ExerciseLibrary.cpp. Same patterns,
// same triangle-wave transposition, same lead-in, same chart shape, so a
// warm-up on the phone is the same warm-up as on the desktop.

export const LOWEST_MIDI = 36, HIGHEST_MIDI = 84;
const MAX_NOTES = 1200, MAX_REPEATS = 72, MAX_CLIMB = 12;

export const LENGTHS = { short: 45, medium: 105, long: 210 };

const SOLFEGE = ["do", "di", "re", "me", "mi", "fa", "fi", "sol", "le", "la", "te", "ti"];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const noteName = (midi) => NAMES[((midi % 12) + 12) % 12] + (Math.floor (midi / 12) - 1);
const solfegeFor = (o) => (o === 12 || o === -12) ? "do" : SOLFEGE[((o % 12) + 12) % 12];

const INTERVALS = ["Unison", "Minor 2nd", "Major 2nd", "Minor 3rd", "Major 3rd", "Perfect 4th",
                   "Tritone", "Perfect 5th", "Minor 6th", "Major 6th", "Minor 7th", "Major 7th", "Octave"];

// kind, name (ru), purpose (ru), defaultRepeats, transposeStep, ceilingMidi, fixedRootMidi
export const DEFINITIONS = [
    ["tenorG3toD4",   "Тенор: G3–D4 (1-2-3-4-5-4-3-2-1)",
     "Фиксированный диапазон: G3 вверх до D4 и обратно, на одних и тех же нотах. Стартовая нота не учитывается. Нижне-средний регистр, до переходной зоны.", 6, 0, 0, 55],
    ["tenorNineNote", "Тенор: девять нот (1-2-3-4-5-4-3-2-1)",
     "Основная теноровая распевка. Поступенно через средний голос, каждый раз на полутон выше, разворот на B4. Начинать около G3.", 4, 1, 71],
    ["tenorDescFive", "Тенор: нисходящие пять (5-4-3-2-1)",
     "Начинается с верхней ноты и спускается. Сохраняет лёгкую головную координацию на спуске. Начинать около C4.", 5, 1, 71],
    ["tenorPassaggio","Тенор: арпеджио через переход (1-3-5-3-1)",
     "Скачки через переходную зону (примерно E4–G4). Начинать около C4 и следить за верхом каждого повтора.", 6, 1, 71],
    ["tenorOctaveArp","Тенор: октавное арпеджио (1-5-8-5-1)",
     "Диапазон и позиция. Доходит до октавы над стартовой нотой — начинать низко (около F3).", 4, 1, 71],
    ["sustainedTone", "Долгие ноты",
     "Опора дыхания и ровность. Держать каждую ноту неподвижно.", 4, 0],
    ["fiveNoteRun",   "Пять нот (1-2-3-2-1)",
     "Стандартная распевка. Каждый раз на полутон выше.", 5, 1],
    ["majorScale",    "Мажорная гамма",
     "Поступенная точность вверх и вниз. На спуске большинство занижает.", 2, 1],
    ["minorScale",    "Натуральный минор",
     "Пониженные 3, 6 и 7 ступени обычно поют слишком высоко.", 2, 1],
    ["pentatonicScale","Мажорная пентатоника",
     "Без полутонов — изолирует точность интервалов. Хорошая первая гамма.", 2, 1],
    ["majorArpeggio", "Мажорное арпеджио (1-3-5-8)",
     "Скачки внутри аккорда. Учит слышать следующую ноту до того, как её спеть.", 2, 1],
    ["fifthLeaps",    "Скачки на квинту (1-5-1)",
     "Самый частый интервал в мелодиях. Каждый повтор на полутон выше.", 5, 1],
    ["octaveLeaps",   "Скачки на октаву (1-8-1)",
     "Работа над диапазоном.", 3, 1],
    ["intervalDrill", "Все интервалы (12)",
     "Каждый интервал от малой секунды до октавы, с возвратом к тонике.", 1, 0],
    ["chromaticScale","Хроматическая гамма",
     "Каждый полутон. Самый трудный тест строя.", 1, 1],
].map (([kind, name, purpose, repeats, step, ceiling = 0, fixedRoot = 0]) =>
    ({ kind, name, purpose, repeats, step, ceiling, fixedRoot }));

export const getDefinition = (kind) => DEFINITIONS.find (d => d.kind === kind) || DEFINITIONS[0];

export function makeSpec (kind, rootMidi, bpm, targetSeconds, useSolfege = true)
{
    const def = getDefinition (kind);
    const spec = {
        kind, bpm: clamp (bpm, 30, 200), useSolfege,
        rootMidi: clamp (rootMidi, LOWEST_MIDI, HIGHEST_MIDI),
        transposeStep: def.step, ceilingMidi: def.ceiling, repeats: 1,
        referenceBeats: 2, countInBeats: 4, descending: false,
    };
    if (def.fixedRoot > 0) { spec.rootMidi = def.fixedRoot; spec.transposeStep = 0; }
    spec.repeats = Math.max (1, def.repeats, repeatsForTarget (spec, targetSeconds));
    return spec;
}

const clamp = (v, lo, hi) => Math.min (hi, Math.max (lo, v));
export const beatSeconds = (s) => 60 / clamp (s.bpm, 20, 300);
export const referenceSeconds = (s) => beatSeconds (s) * Math.max (0, s.referenceBeats);
export const leadInSeconds = (s) => referenceSeconds (s) + beatSeconds (s) * Math.max (0, s.countInBeats);

function beatsPerRepetition (spec)
{
    const one = { ...spec, repeats: 1, transposeStep: 0 };
    return buildPattern (one).events.reduce ((a, e) => a + e.beats, 0);
}

function repeatsForTarget (spec, targetSeconds)
{
    const per = beatsPerRepetition (spec) * beatSeconds (spec);
    if (per <= 0) return 1;
    let repeats = Math.round (Math.max (0, targetSeconds - leadInSeconds (spec)) / per);
    const notesPer = buildPattern ({ ...spec, repeats: 1 }).events.filter (e => ! e.rest).length;
    if (notesPer > 0) repeats = Math.min (repeats, Math.floor (MAX_NOTES / notesPer));
    return clamp (repeats, 1, MAX_REPEATS);
}

function midiRange (spec)
{
    let lo = spec.rootMidi, hi = spec.rootMidi;
    for (const e of buildPattern (spec).events)
        if (! e.rest) { lo = Math.min (lo, spec.rootMidi + e.offset); hi = Math.max (hi, spec.rootMidi + e.offset); }
    return [lo, hi];
}

function climbSteps (spec)
{
    if (spec.transposeStep === 0) return 0;
    const [lo, hi] = midiRange ({ ...spec, repeats: 1, transposeStep: 0 });
    const step = Math.abs (spec.transposeStep);
    const top = spec.ceilingMidi > 0 ? Math.min (HIGHEST_MIDI, spec.ceilingMidi) : HIGHEST_MIDI;
    const headroom = spec.transposeStep > 0 ? top - hi : lo - LOWEST_MIDI;
    return Math.max (0, Math.min (Math.floor (Math.max (0, headroom) / step),
                                  Math.floor (MAX_CLIMB / step),
                                  Math.floor (clamp (spec.repeats, 1, MAX_REPEATS) / 2)));
}

export function buildPattern (spec)
{
    const events = [], labels = [];
    const repeats = clamp (spec.repeats, 1, MAX_REPEATS);
    const sign = spec.descending ? -1 : 1;
    const phrase = (label) => { labels.push (label); return labels.length - 1; };
    const notes = (offsets, beats, transpose, ph) => { for (const o of offsets) events.push ({ offset: o + transpose, beats, phrase: ph }); };
    const rest = (beats) => events.push ({ beats, rest: true });

    const climb = climbSteps (spec);
    const tr = (r) => { if (climb <= 0) return 0; const p = 2 * climb, m = r % p; return (m <= climb ? m : p - m) * spec.transposeStep; };

    switch (spec.kind)
    {
        case "sustainedTone":
            for (let r = 0; r < repeats; ++r) { notes ([0], 8, tr (r), phrase ("Долгая нота " + (r + 1))); rest (4); }
            break;

        case "majorScale": case "minorScale": case "pentatonicScale": case "chromaticScale":
        {
            let up, down;
            if (spec.kind === "majorScale")      { up = [0,2,4,5,7,9,11,12]; down = [11,9,7,5,4,2,0]; }
            else if (spec.kind === "minorScale") { up = [0,2,3,5,7,8,10,12]; down = [10,8,7,5,3,2,0]; }
            else if (spec.kind === "pentatonicScale") { up = [0,2,4,7,9,12]; down = [9,7,4,2,0]; }
            else { up = [...Array (13).keys()]; down = [...Array (12).keys()].reverse(); }
            for (let r = 0; r < repeats; ++r)
            {
                const sfx = repeats > 1 ? " " + (r + 1) : "";
                notes (up, 1, tr (r), phrase ("Вверх" + sfx));
                notes (down, 1, tr (r), phrase ("Вниз" + sfx));
                rest (2);
            }
            break;
        }

        case "majorArpeggio":
            for (let r = 0; r < repeats; ++r) { notes ([0,4,7,12,7,4,0], 1, tr (r), phrase ("Арпеджио " + (r + 1))); rest (2); }
            break;

        case "fiveNoteRun":
            for (let r = 0; r < repeats; ++r) { notes ([0,2,4,2,0], 1, tr (r), phrase ("Пробег " + (r + 1))); rest (1); }
            break;

        case "tenorNineNote": case "tenorG3toD4": case "tenorDescFive": case "tenorPassaggio": case "tenorOctaveArp":
        {
            const [shape, name] = {
                tenorNineNote:  [[0,2,4,5,7,5,4,2,0], "Пробег "],
                tenorG3toD4:    [[0,2,4,5,7,5,4,2,0], "Пробег "],
                tenorDescFive:  [[7,5,4,2,0],         "Спуск "],
                tenorPassaggio: [[0,4,7,4,0],         "Переход "],
                tenorOctaveArp: [[0,7,12,7,0],        "Октава "],
            }[spec.kind];
            for (let r = 0; r < repeats; ++r) { notes (shape, 1, tr (r), phrase (name + (r + 1))); rest (2); }
            break;
        }

        case "fifthLeaps":
            for (let r = 0; r < repeats; ++r) { notes ([0, 7 * sign, 0], 1, tr (r), phrase ("Квинта " + (r + 1))); rest (1); }
            break;

        case "octaveLeaps":
            for (let r = 0; r < repeats; ++r) { notes ([0, 12 * sign, 0], 2, tr (r), phrase ("Октава " + (r + 1))); rest (2); }
            break;

        case "intervalDrill":
            for (let r = 0; r < repeats; ++r)
                for (let i = 1; i <= 12; ++i)
                {
                    notes ([0, i * sign, 0], 1, tr (r), phrase (INTERVALS[i]));
                    rest (2);
                }
            break;
    }
    return { events, labels };
}

// Returns a chart in the same shape as chart.json (the subset the page reads).
export function buildChart (spec)
{
    const { events, labels } = buildPattern (spec);
    const beat = beatSeconds (spec);
    const [lo, hi] = midiRange (spec);
    let root = spec.rootMidi;
    if (hi > HIGHEST_MIDI) root -= hi - HIGHEST_MIDI;
    if (lo < LOWEST_MIDI)  root += LOWEST_MIDI - lo;

    const notes = [], builds = labels.map (() => ({ start: -1, end: 0, first: -1, ids: [] }));
    let t = leadInSeconds (spec), id = 0;

    for (const e of events)
    {
        const dur = e.beats * beat;
        if (e.rest) { t += dur; continue; }
        if (id >= MAX_NOTES) break;
        const midi = root + e.offset;
        notes.push ({
            id, startSeconds: t, durationSeconds: Math.max (0.08, dur - 0.06), midi, centsOffset: 0,
            type: "normal", syllable: spec.useSolfege ? solfegeFor (e.offset) : noteName (midi), phraseId: e.phrase,
        });
        const b = builds[e.phrase];
        if (b.start < 0) { b.start = t; b.first = midi; }
        b.end = t + dur; b.ids.push (id);
        ++id; t += dur;
    }

    const phrases = [];
    labels.forEach ((label, i) => {
        const b = builds[i];
        if (b.start < 0) return;
        phrases.push ({ id: i, startSeconds: b.start, endSeconds: b.end, noteIds: b.ids,
                        text: spec.transposeStep !== 0 ? `${label} (${noteName (b.first)})` : label });
    });

    const def = getDefinition (spec.kind);
    return {
        song: { id: "exercise-" + spec.kind, title: `${def.name}`, artist: `${spec.bpm} bpm`, durationSeconds: t + 1.5 },
        notes, phrases, exercise: spec,
    };
}

// An exercise made from a take: its most frequent misses (app.js missedSpots).
// spots = [{ notes: [{ midi, syllable, name, missed }], text }] - each is the note
// before the miss (the approach: the interval is usually what goes wrong) and the
// missed note. For each place, first every note of the step ALONE, held long (a
// slow, sustained landing on the pitch), with a breath after each; only then the
// step itself, `reps` times, the missed note held two beats so the voice settles.
// Same lead-in as every exercise: the first note struck, then a count-in.
export function buildDrillChart (spots, bpm = 60, reps = 3, holdBeats = 4)
{
    const spec = { kind: "drill", bpm, rootMidi: spots[0].notes[0].midi, useSolfege: false,
                   transposeStep: 0, ceilingMidi: 0, repeats: 1, referenceBeats: 2, countInBeats: 4, descending: false };
    const beat = beatSeconds (spec);
    const notes = [], phrases = [];
    let t = leadInSeconds (spec);
    const phrase = (group, text) => {
        const ids = [], start = t;
        for (const [n, beats] of group)
        {
            const dur = beats * beat;
            notes.push ({ id: notes.length, startSeconds: t, durationSeconds: Math.max (0.08, dur - 0.06), midi: n.midi,
                          centsOffset: 0, type: "normal", syllable: n.syllable || noteName (n.midi), phraseId: phrases.length });
            ids.push (notes.length - 1);
            t += dur;
        }
        phrases.push ({ id: phrases.length, startSeconds: start, endSeconds: t, noteIds: ids, text });
    };
    spots.forEach ((spot, k) => {
        // 1. Each pitch of the step on its own, long (a repeated note only once).
        const seen = new Set();
        for (const n of spot.notes)
        {
            if (seen.has (n.midi)) continue;
            seen.add (n.midi);
            phrase ([[n, holdBeats]], `${k + 1}. Тянуть ${n.name || noteName (n.midi)}`);
            t += 2 * beat;                              // breathe
        }
        // 2. Then the step itself.
        if (spot.notes.length > 1)
            for (let r = 0; r < reps; ++r)
            {
                phrase (spot.notes.map (n => [n, n.missed ? 2 : 1]), `${k + 1}. ${spot.text} (${r + 1}/${reps})`);
                t += beat;                              // breathe
            }
        t += beat;                                      // and between places
    });
    return { song: { id: "drill", title: `Упражнение на ошибки (${spots.length})`, artist: `${bpm} bpm`, durationSeconds: t + 1.5 },
             notes, phrases, exercise: spec };
}
