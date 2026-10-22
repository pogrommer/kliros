// i18n.js — Russian (the source) or English. Strings stay Russian in the code and
// the page; t() looks the English up by the Russian text. The language is read from
// the saved settings at load, before any module builds its labels, and a change of
// language reloads the page (app.js), so nothing has to be re-rendered in place.

export const LANGS = [["ru", "Русский"], ["en", "English"]];

export const lang = (() => {
    try { const l = JSON.parse (localStorage.getItem ("vt-web") || "{}").lang; if (l === "en" || l === "ru") return l; } catch {}
    return "ru";            // Russian unless English is chosen in the settings
}) ();

const EN = {
    // Top bar, buttons (one case for all of them: a capital first letter)
    "Тип голоса": "Voice type", "Определить тип голоса": "Find out your voice type", "Свободный": "Free", "Композиция": "Piece", "Упражнение": "Exercise",
    "Выбрать": "Choose", "Партия": "Part", "Партитура в PDF": "The score as a PDF", "Партия: I или II": "Part: I or II", "Темп: медленнее или быстрее": "Tempo: slower or faster",
    "Настройки": "Settings", "Ноты или piano roll": "Notation or piano roll", "Вид": "View", "Ноты": "Notes", "Ролл": "Roll",
    "Ключ": "Clef", "Подсказка (пианино / голос)": "Guide (piano / voice)", "Подсказка": "Guide", "Микрофон": "Microphone",
    "Старт": "Start", "Стоп": "Stop",
    "Сопрано": "Soprano", "Альт": "Alto", "Тенор": "Tenor", "Бас": "Bass",
    "Сопрано I": "Soprano I", "Сопрано II": "Soprano II", "Альт I": "Alto I", "Альт II": "Alto II",
    "Тенор I": "Tenor I", "Тенор II": "Tenor II", "Бас I": "Bass I", "Бас II": "Bass II",
    // Song sheet
    "Песня": "Song", "Готово": "Done", "Поиск: название, автор, слова, дата письма": "Search: title, composer, words, letter date",
    "Загрузить с устройства (zip)…": "Load from device (zip)…", "Справка": "Help", "Что за файл": "What file",
    "Удалить с телефона": "Delete from phone",
    "Пакет песни — zip-архив:": "A song package is a zip archive:",
    "(ноты, слова, время) и звук, который он называет: голос-подсказка и минус, в WAV, FLAC, MP3 или M4A. Песня может лежать в корне архива или в папке; несколько папок с chart.json (партии хора) добавятся разом. Такой архив можно прислать в Telegram: на iPhone «Сохранить в Файлы», на Android он в «Загрузках». Песня хранится только на этом телефоне и работает без сети.":
        "(notes, words, timing) and the sound it names: the guide voice and the backing, in WAV, FLAC, MP3 or M4A. The song may sit at the top of the archive or in a folder; several folders with chart.json (choir parts) are added at once. Such an archive can be sent in Telegram: on an iPhone “Save to Files”, on Android it is in Downloads. The song is kept on this phone only and works offline.",
    "Композиция открывается в партии вашего голоса.": "A piece opens in your voice's part.",
    "Темп": "Tempo",
    "Медленнее или быстрее без изменения высоты. Песня перестраивается под темп за пару секунд.":
        "Slower or faster without changing the pitch. A song is rebuilt for the tempo in a couple of seconds.",
    // Settings
    "Стартовая нота": "Starting note", "Темп:": "Tempo:", "Длительность": "Length",
    "Коротко (~45 с)": "Short (~45 s)", "Средне (~1:45)": "Medium (~1:45)", "Долго (~3:30)": "Long (~3:30)",
    "Нотная запись, текст над нотами": "Notation, words above the notes", "Piano roll, текст на полосках": "Piano roll, words in the bars",
    "Нотный стан": "Staff", "Авто — по голосу и партии": "Auto — from your voice and the part",
    "Басовый ключ": "Bass clef", "Скрипичный ключ": "Treble clef", "Скрипичный, октавой ниже (теноровый)": "Treble, an octave lower (tenor)",
    "Оба (фортепианная система)": "Both (grand staff)",
    "Подписи нот — везде: на полосках, слева, в строке, под станом": "Note names — everywhere: in the bars, on the keys, in the readout, under the staff",
    "до, ре, ми… (до = C)": "do, re, mi… (fixed, do = C)", "do, re, mi… от тоники упражнения": "do, re, mi… from the exercise's tonic",
    "Названия: G3, A3, B3…": "Letters: G3, A3, B3…", "Подписывать ноты под станом": "Name the notes under the staff",
    "Точность": "Accuracy", "Выступление (±50¢)": "Performance (±50¢)", "Практика (±25¢)": "Practice (±25¢)", "Точно (±10¢)": "Precise (±10¢)",
    "Громкость подсказки": "Guide volume", "Громкость минуса": "Backing volume", "Компенсация задержки:": "Latency compensation:", "мс": "ms",
    "Пойте в наушниках: иначе микрофон слышит подсказку из динамика.": "Sing with headphones: otherwise the microphone hears the guide from the speaker.",
    "Язык": "Language",
    // Messages
    "Микрофон доступен только по https. Откройте адрес https://… (см. инструкцию).": "The microphone needs https. Open the https://… address (see the instructions).",
    "Нет доступа к микрофону: ": "No access to the microphone: ",
    "Коснитесь экрана, чтобы вернуть микрофон": "Tap the screen to bring the microphone back",
    "Микрофон включён — нажмите, чтобы выключить": "Microphone on — tap to turn it off",
    "Микрофон выключен — нажмите, чтобы включить": "Microphone off — tap to turn it on",
    "Загрузка песни…": "Loading the song…", "Ошибка: ": "Error: ",
    "песня недоступна: сервер на ПК не отвечает, а в телефоне сохранена только последняя открытая песня":
        "song unavailable: the PC server does not answer, and the phone keeps only the last song opened",
    "песня не найдена на телефоне - добавьте zip ещё раз": "song not found on the phone - add the zip again",
    "минус": "backing", "подсказку": "guide",
    "не удалось раскодировать {0} ({1}, {2} КБ): {3}": "could not decode the {0} ({1}, {2} KB): {3}",
    "Сервер недоступен": "Server unavailable", "Сервер недоступен, сохранённых песен нет": "Server unavailable, no songs saved",
    "В библиотеке нет песен": "No songs in the library", "Ничего не найдено": "Nothing found", "(без сервера)": "(offline)",
    "{0} из {1}": "{0} of {1}", "⚠ разбор под вопросом: {0}": "⚠ parse in doubt: {0}", "письмо {0}": "letter {0}",
    "Готовлю темп {0}%…": "Preparing tempo {0}%…",
    "нужен zip-архив песни: chart.json + голос и минус (WAV, FLAC, MP3 или M4A)": "needs a song zip: chart.json + guide and backing (WAV, FLAC, MP3 or M4A)",
    "Уже есть на телефоне: {0}. Заменить?": "Already on the phone: {0}. Replace?", "Отменено.": "Cancelled.",
    "сохраняю на телефоне…": "saving on the phone…", "✓ Добавлено: {0}.": "✓ Added: {0}.", "Выбрана — «Готово» и ▶.": "Selected — Done, then ▶.",
    "Не добавлено: {0}": "Not added: {0}", "Удалить с телефона «{0}»?": "Delete “{0}” from the phone?", "Удалено: {0}.": "Deleted: {0}.",
    "Много промахов": "Many misses", "Попали в {0} из {1} нот. Чаще всего:": "Hit {0} of {1} notes. Most often:",
    "Упражнение на эти места": "Drill these places", "Продолжить": "Carry on", "Начать сначала": "Start over",
    "{0}% в тоне": "{0}% in tune", "нет данных": "no data", "Отработать частую ошибку": "Drill the frequent miss",
    "Отработать {0} частые ошибки": "Drill {0} frequent misses", "Назад к песне": "Back to the song", "Назад к упражнению": "Back to the exercise",
    "Закрыть": "Close", "Ещё не получилось:": "Not right yet:", "Все места спеты чисто. Продолжить — ещё раз то же:": "All places sung clean. Carry on — the same again:",
    "Продолжить упражнение": "Continue the drill", "Песню с места паузы": "The song from the pause", "Песню сначала": "The song from the top",
    "Закончить": "Finish", "фраза {0}%": "phrase {0}%", " · от {0}": " · from {0}", "Свободное пение": "Free singing",
    "Авто: ": "Auto: ", "басовый ключ": "bass clef", "скрипичный ключ": "treble clef", "скрипичный, октавой ниже": "treble, an octave lower", "оба ключа": "both clefs",
    ", неустойчиво": ", unsteady", ", пели выше на {0}": ", sung {0} high", ", пели ниже на {0}": ", sung {0} low",
    // Exercises
    "Упражнение на ошибки ({0})": "Drill on misses ({0})", "{0}. Тянуть {1}": "{0}. Hold {1}",
    "Долгая нота ": "Long note ", "Вверх": "Up", "Вниз": "Down", "Арпеджио ": "Arpeggio ", "Пробег ": "Run ", "Спуск ": "Descent ",
    "Переход ": "Passage ", "Октава ": "Octave ", "Квинта ": "Fifth ", "Терции вверх": "Thirds up", "Терции вниз": "Thirds down",
    "Большая терция ": "Major third ", "Малая терция ": "Minor third ",
    "Квинта на месте (1-2-3-4-5-4-3-2-1)": "Fifth in place (1-2-3-4-5-4-3-2-1)",
    "На одних и тех же нотах в нижней половине вашего диапазона: на квинту вверх и обратно. Стартовая нота не учитывается.":
        "On the same notes in the lower half of your range: up a fifth and back. The starting note is not used.",
    "Девять нот (1-2-3-4-5-4-3-2-1)": "Nine notes (1-2-3-4-5-4-3-2-1)",
    "Основная распевка. Поступенно через средний голос, каждый раз на полутон выше, до верха вашего диапазона.":
        "The basic warm-up. Step by step through the middle voice, a semitone higher each time, to the top of your range.",
    "Нисходящие пять (5-4-3-2-1)": "Descending five (5-4-3-2-1)",
    "Начинается с верхней ноты и спускается. Сохраняет лёгкую головную координацию на спуске.":
        "Starts on the top note and comes down. Keeps a light head-voice coordination on the way down.",
    "Арпеджио через переход (1-3-5-3-1)": "Arpeggio through the passaggio (1-3-5-3-1)",
    "Скачки через переходную зону, к верху вашего диапазона. Следить за верхом каждого повтора.":
        "Leaps through the passaggio, towards the top of your range. Watch the top of each repeat.",
    "Октавное арпеджио (1-5-8-5-1)": "Octave arpeggio (1-5-8-5-1)",
    "Диапазон и позиция. Доходит до октавы над стартовой нотой, поэтому начинается снизу.":
        "Range and placement. Reaches an octave above the starting note, so it starts low.",
    "Долгие ноты": "Long tones", "Опора дыхания и ровность. Держать каждую ноту неподвижно.": "Breath support and evenness. Hold each note perfectly still.",
    "Пять нот (1-2-3-2-1)": "Five notes (1-2-3-2-1)", "Стандартная распевка. Каждый раз на полутон выше.": "The standard warm-up. A semitone higher each time.",
    "Мажорная гамма": "Major scale", "Поступенная точность вверх и вниз. На спуске большинство занижает.": "Stepwise accuracy up and down. Most people go flat on the way down.",
    "Натуральный минор": "Natural minor", "Пониженные 3, 6 и 7 ступени обычно поют слишком высоко.": "The lowered 3rd, 6th and 7th are usually sung too high.",
    "Мажорная пентатоника": "Major pentatonic", "Без полутонов — изолирует точность интервалов. Хорошая первая гамма.": "No semitones — isolates interval accuracy. A good first scale.",
    "Мажорное арпеджио (1-3-5-8)": "Major arpeggio (1-3-5-8)", "Скачки внутри аккорда. Учит слышать следующую ноту до того, как её спеть.": "Leaps within the chord. Teaches you to hear the next note before you sing it.",
    "Терции по гамме (1-3, 2-4, 3-5…)": "Thirds up the scale (1-3, 2-4, 3-5…)",
    "Мажорная гамма терциями вверх до октавы и обратно. Терция — основа хорового строя: держать большие и малые точно.":
        "The major scale in thirds up to the octave and back. The third is the core of choir tuning: keep major and minor ones exact.",
    "Скачки на терцию (1-3-1, 1-♭3-1)": "Third leaps (1-3-1, 1-♭3-1)",
    "Большая терция, затем малая от той же ноты. Слышать разницу в полтона. Каждый повтор на полутон выше.":
        "A major third, then a minor one from the same note. Hear the semitone between them. A semitone higher each repeat.",
    "Скачки на квинту (1-5-1)": "Fifth leaps (1-5-1)", "Самый частый интервал в мелодиях. Каждый повтор на полутон выше.": "The most common interval in melodies. A semitone higher each repeat.",
    "Скачки на октаву (1-8-1)": "Octave leaps (1-8-1)", "Работа над диапазоном.": "Range work.",
    "Все интервалы (12)": "All intervals (12)", "Каждый интервал от малой секунды до октавы, с возвратом к тонике.": "Every interval from a minor second to the octave, back to the tonic each time.",
    "Хроматическая гамма": "Chromatic scale", "Каждый полутон. Самый трудный тест строя.": "Every semitone. The hardest test of tuning.",
    // localsongs.js
    "это не zip-архив (или он повреждён / не догрузился)": "this is not a zip archive (or it is damaged / not fully downloaded)",
    "архив в формате ZIP64 (больше 4 ГБ) не поддерживается": "ZIP64 archives (over 4 GB) are not supported",
    "оглавление zip повреждено": "the zip directory is damaged", "в архиве опасный путь: {0}": "unsafe path in the archive: {0}",
    "повреждён файл в архиве: {0}": "damaged file in the archive: {0}",
    "этот браузер не умеет распаковывать zip (нужен iOS 16.4+ или свежий Chrome)": "this browser cannot unpack zip (needs iOS 16.4+ or a recent Chrome)",
    "неподдерживаемое сжатие в архиве ({0}): {1}": "unsupported compression in the archive ({0}): {1}",
    "файл распаковался не целиком: {0}": "file unpacked only in part: {0}",
    "не JSON-объект": "not a JSON object", "версия формата {0}, нужна 1.0": "format version {0}, 1.0 needed", "нет раздела song": "no song section",
    "нет списка нот": "no note list", "в партии нет нот": "the part has no notes", "нота {0} без времени или высоты": "note {0} has no time or pitch",
    "phrases - не список": "phrases is not a list", "архив слишком большой (больше 1,5 ГБ в распакованном виде)": "archive too big (over 1.5 GB unpacked)",
    "в архиве нет chart.json - это не пакет песни": "no chart.json in the archive - not a song package", "проверяю {0}…": "checking {0}…",
    "chart.json{0} не читается: {1}": "chart.json{0} cannot be read: {1}", "голос (подсказка)": "voice (guide)",
    "chart.json{0}: не указан файл {1}": "chart.json{0}: no {1} file named", "chart.json{0}: путь {1} выходит за папку песни": "chart.json{0}: path {1} leaves the song folder",
    "в архиве нет файла: {0} ({1})": "file missing from the archive: {0} ({1})", "{0}: {1} - нужен WAV, FLAC, MP3 или M4A": "{0}: {1} - WAV, FLAC, MP3 or M4A needed",
    "распаковываю {0} ({1} МБ)…": "unpacking {0} ({1} MB)…", "{0} - не настоящий {1} (повреждён?)": "{0} - not a real {1} (damaged?)",
    "в архиве две песни с одним id: {0}": "two songs with one id in the archive: {0}",
    "на телефоне не хватает места для приложения: нужно {0} МБ": "not enough room on the phone for the app: {0} MB needed",
    "на телефоне не хватает места для приложения": "not enough room on the phone for the app", "не удалось сохранить: {0}": "could not save: {0}",
};

// t ("Попали в {0} из {1} нот.", 3, 5): the English when the language is English, the
// Russian otherwise, with {0}, {1}... filled in.
export function t (ru, ...args)
{
    const s = lang === "en" && EN[ru] != null ? EN[ru] : ru;
    return args.length ? s.replace (/\{(\d+)\}/g, (_, i) => args[+i] ?? "") : s;
}

// Capital first letter: every button reads the same (the user, 2026-10-22).
export const cap = (s) => s ? s[0].toUpperCase() + s.slice (1) : s;

// The static page: text nodes and the title / aria-label / data-label / placeholder
// attributes, matched by their Russian with the whitespace folded.
export function translatePage (root = document.body)
{
    document.documentElement.lang = lang;
    if (lang !== "en") return;
    const walk = document.createTreeWalker (root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode())
    {
        const raw = n.nodeValue, key = raw.replace (/\s+/g, " ").trim();
        if (! key || EN[key] == null) continue;
        n.nodeValue = raw.match (/^\s*/)[0] + EN[key] + raw.match (/\s*$/)[0];
    }
    for (const el of root.querySelectorAll ("[title], [aria-label], [data-label], [placeholder]"))
        for (const a of ["title", "aria-label", "data-label", "placeholder"])
        {
            const v = el.getAttribute (a);
            if (v && EN[v] != null) el.setAttribute (a, EN[v]);
        }
}
