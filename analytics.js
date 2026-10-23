// @ts-check
// analytics.js — anonymous usage counts via GoatCounter (no cookies, no ids, no voice or notes).
// Off until CODE is set (the site name from goatcounter.com: <CODE>.goatcounter.com) and only on the
// public site, never on the home server or localhost. Offline events are simply not sent.

const CODE = "pogrommer";
const HOSTS = ["pogrommer.github.io"];
// A browser can opt out: the settings checkbox, or opening the site once with ?me=1 (?me=0 undoes it).
const SKIP = "kliros-nostats";

export const counting = () => { try { return localStorage.getItem (SKIP) !== "1"; } catch { return true; } };
export const setCounting = (yes) => { try { yes ? localStorage.removeItem (SKIP) : localStorage.setItem (SKIP, "1"); } catch {} };

const me = new URLSearchParams (location.search).get ("me");
if (me === "1" || me === "0")
{
    setCounting (me === "0");
    const u = new URL (location.href); u.searchParams.delete ("me"); history.replaceState (null, "", u);
}

const on = () => CODE && HOSTS.includes (location.hostname) && navigator.onLine !== false && counting();

function hit (path, title, event)
{
    if (! on()) return;
    const q = new URLSearchParams ({ p: path, t: title || "", e: event ? "true" : "false", s: `${screen.width},${screen.height},${devicePixelRatio || 1}`,
                                     r: event ? "" : document.referrer, rnd: Math.random().toString (36).slice (2) });
    try { fetch (`https://${CODE}.goatcounter.com/count?${q}`, { mode: "no-cors", keepalive: true }).catch (() => {}); } catch {}
}

// An event: ("mode", "song"), ("voice", "T"), ("exercise", "tenorG3toD4"), ("piece", "antsev-trisvyatoe"), ("start", "song").
export const track = (name, value) => hit (`${name}/${value}`, `${name}: ${value}`, true);

// Unique browsers, without sending any id: each browser remembers locally that it has already said
// "new" / "today" / "this week", so the counts of device/new, device/day and device/week events are
// browsers ever, per day and per week. One person with Chrome + the Claude app + an icon = 3 browsers.
const once = (key, value) => { try { if (localStorage.getItem (key) === value) return false; localStorage.setItem (key, value); return true; } catch { return false; } };
const ymd = (d) => `${d.getFullYear()}-${String (d.getMonth() + 1).padStart (2, "0")}-${String (d.getDate()).padStart (2, "0")}`;

export function pageview ()
{
    hit ("/", "Kliros", false);
    if (! on()) return;
    const now = new Date(), monday = new Date (now);
    monday.setDate (now.getDate() - (now.getDay() + 6) % 7);
    if (once ("kliros-seen", "1")) track ("device", "new");
    if (once ("kliros-day", ymd (now))) track ("device", "day");
    if (once ("kliros-week", ymd (monday))) track ("device", "week");
}
