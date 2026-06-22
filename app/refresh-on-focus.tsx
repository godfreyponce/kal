"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetch the server render whenever the app becomes visible again.
 *
 * iOS standalone PWAs restore the previous session straight from memory on
 * reopen — no reload, no navigation — so a page left open overnight keeps
 * showing (and writing to) yesterday's date. `router.refresh()` re-runs the
 * Today server component, which recomputes `todayInAppTz()` and repaints with
 * the correct day. The server stays the only source of "today"; we just ask
 * again. `pageshow.persisted` covers Safari's back/forward bfcache too.
 */
export function RefreshOnFocus() {
  const router = useRouter();

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}
