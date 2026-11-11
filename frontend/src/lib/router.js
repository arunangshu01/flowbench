import { useEffect, useState } from "react";

// Minimal path router (two routes don't justify a routing dependency).
// Firebase Hosting rewrites every path to index.html, and Vite's dev server
// does the same, so deep links like /app work on refresh.

export const ROUTES = { landing: "/", app: "/app" };

export function navigate(to) {
  if (to === window.location.pathname + window.location.search + window.location.hash) return;
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

/** Click handler for <a href> links: client-side navigation, but keep
 * modifier-clicks (new tab, etc.) working as normal links. */
export function linkTo(to) {
  return {
    href: to,
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
