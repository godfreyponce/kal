// Fetch an owner-pasted URL (menu / nutrition page) and reduce it to readable
// text the model can extract macros from. BEST-EFFORT by design: big retailers
// (Walmart/Amazon/Target) bot-wall server fetches — those return an honest error
// and the chat rules make Kal say so and climb to the next ladder rung.

const MAX_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 10_000;

/** Strip an HTML document to readable text. Pure. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

/**
 * Reject anything that isn't public http(s): other protocols, localhost,
 * private/link-local IPv4 ranges, IP-literal IPv6. Cheap SSRF guard — the app
 * is single-user behind auth, but the fetch runs server-side.
 */
export function urlGuardError(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Not a valid URL.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return "Only http(s) URLs are supported.";
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return "Local addresses are not allowed.";
  if (host.includes(":") || host.startsWith("[")) return "IP-literal addresses are not allowed.";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      return "Private addresses are not allowed.";
    }
  }
  return null;
}

/** Fetch + strip a page. Never throws — errors come back as { ok: false }. */
export async function fetchPage(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const guard = urlGuardError(url);
  if (guard) return { ok: false, error: guard };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KalBot/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
    // redirect:"follow" can hop anywhere — re-guard the FINAL url so a public
    // link that 302s to a private address never gets its content read.
    const finalGuard = urlGuardError(res.url || url);
    if (finalGuard) return { ok: false, error: `Redirected to a blocked address. ${finalGuard}` };
    if (!res.ok) return { ok: false, error: `Fetch failed: HTTP ${res.status}.` };
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/.test(ct)) {
      return { ok: false, error: `Unsupported content type: ${ct || "unknown"}.` };
    }
    const body = await res.text();
    const text = ct.includes("text/plain")
      ? body.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS)
      : htmlToText(body);
    if (!text) return { ok: false, error: "Page had no readable text (likely bot-walled or empty)." };
    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "TimeoutError"
          ? "Fetch timed out."
          : "Fetch failed (network error or blocked).",
    };
  }
}
