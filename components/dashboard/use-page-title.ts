"use client";
import { useEffect } from "react";

/**
 * Sets the browser-tab title from a client component.
 *
 * Every dashboard page (and /login) is "use client", and a client component
 * cannot export `metadata` / `generateMetadata` — those are server-only, so
 * the root layout's title template never applies to these pages. The title
 * therefore has to be set imperatively, and the brand suffix is composed here
 * by hand to match the server template in app/layout.tsx.
 *
 * Pass the SAME i18n string the page already renders as its heading — never a
 * new hardcoded one. Nothing is restored on unmount: every navigation lands on
 * a page that sets its own title (or on a server page whose metadata does).
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    if (!title) return;
    const full = `${title} — إتقان Itqan`;
    document.title = full;
    // On a HARD load Next commits its own <title> (the layout metadata) once,
    // shortly after hydration — which can land AFTER this effect and undo it.
    // Verified live 2026-08-28: soft navigations kept the page title, a fresh
    // /login load kept the site default. A timeout is a timing guess on a slow
    // phone, so watch the element instead and re-assert whenever something
    // else rewrites it. Our own write sets it to `full`, which the guard below
    // ignores, so this cannot loop.
    const el = document.querySelector("title");
    if (!el) return;
    const obs = new MutationObserver(() => {
      if (document.title !== full) document.title = full;
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [title]);
}
