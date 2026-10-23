// @ts-check
// analytics.js — anonymous usage counts via GoatCounter (no cookies, no ids, no voice or notes).
// Off until CODE is set (the site name from goatcounter.com: <CODE>.goatcounter.com) and only on the
// public site, never on the home server or localhost. Offline events are simply not sent.

const CODE = "pogrommer";
const HOSTS = ["pogrommer.github.io"];

const on = () => CODE && HOSTS.includes (location.hostname) && navigator.onLine !== false;

function hit (path, title, event)
{
    if (! on()) return;
    const q = new URLSearchParams ({ p: path, t: title || "", e: event ? "true" : "false", s: `${screen.width},${screen.height},${devicePixelRatio || 1}`,
                                     r: event ? "" : document.referrer, rnd: Math.random().toString (36).slice (2) });
    try { fetch (`https://${CODE}.goatcounter.com/count?${q}`, { mode: "no-cors", keepalive: true }).catch (() => {}); } catch {}
}

export const pageview = () => hit ("/", "Kliros", false);
// An event: ("mode", "song"), ("voice", "T"), ("exercise", "tenorG3toD4"), ("piece", "antsev-trisvyatoe"), ("start", "song").
export const track = (name, value) => hit (`${name}/${value}`, `${name}: ${value}`, true);
