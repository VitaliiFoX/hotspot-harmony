// Where the view of the page is kept: its filters, its day on the globe, its theme and its language.
// The address bar stays clean. The view lives in memory and in the tab's session storage, so a reload keeps it.
// A link that carries a view (?region=Ukraine&start=...) is read once when the page opens and then taken out of the
// address; "Share this view" (ShareButton.tsx) writes that link again on demand.

const STORE_KEY = "hotspot-harmony-view";

/** The view a page opens with: the link's when the address carries one, else the one the tab kept from before. */
export function openingView(search: string, stored: string | null): URLSearchParams {
  const linked = new URLSearchParams(search);
  return linked.toString() ? linked : new URLSearchParams(stored ?? "");
}

/** A view as the query of a link, keeping the commas, colons and semicolons of its values readable. */
export function viewText(view: URLSearchParams): string {
  return view.toString().replaceAll("%2C", ",").replaceAll("%3A", ":").replaceAll("%3B", ";");
}

/** The link that opens a view: the page's own address (`base`, with no query) followed by the view. */
export function shareLink(base: string, view: URLSearchParams): string {
  const text = viewText(view);
  return text ? `${base}?${text}` : base;
}

let view: URLSearchParams | null = null;

function stored(): string | null {
  try {
    return window.sessionStorage.getItem(STORE_KEY);
  } catch {
    // Storage can be switched off; the view then lives for as long as the page does.
    return null;
  }
}

/** The page's own address without a query: what the address bar shows, and what a link starts with. */
function pageBase(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** The view of the page, as a copy: change it and hand it to `saveView`. The first call takes it from the address. */
export function currentView(): URLSearchParams {
  if (view === null) {
    const opened = openingView(window.location.search, stored());
    saveView(opened);
    return new URLSearchParams(opened);
  }
  return new URLSearchParams(view);
}

/** Keep a view as the page's own, for the rest of the visit and over a reload, and leave the address bar clean. */
export function saveView(next: URLSearchParams): void {
  view = new URLSearchParams(next);
  try {
    window.sessionStorage.setItem(STORE_KEY, viewText(view));
  } catch {
    // See `stored`.
  }
  if (window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
}

/** The link to the view on screen. */
export function currentLink(): string {
  return shareLink(pageBase(), currentView());
}

/** Put the view back into the address bar, for a browser that will not let the page copy it. */
export function showLinkInAddress(): void {
  const text = viewText(currentView());
  if (text) window.history.replaceState(null, "", `?${text}${window.location.hash}`);
}
