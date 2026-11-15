import { useEffect, useState } from "react";
import { currentLink, showLinkInAddress } from "../address";
import { t } from "../i18n";

/** Copy text without the async clipboard API, which needs a secure context (plain http on a LAN address has none). */
function copyByHand(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

/**
 * Share the view on screen. The address bar stays clean (see address.ts), so the link is written here. A phone opens
 * its share sheet; elsewhere the link is copied, and where nothing can copy it is put into the address bar.
 */
export function ShareButton({ className }: { className?: string }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2200);
    return () => window.clearTimeout(timer);
  }, [note]);

  async function share() {
    const url = currentLink();
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (reason) {
        if ((reason as Error).name === "AbortError") return; // the share sheet was closed
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote(t("Link copied"));
    } catch {
      if (copyByHand(url)) {
        setNote(t("Link copied"));
      } else {
        showLinkInAddress();
        setNote(t("Copy the address from the browser bar"));
      }
    }
  }

  return (
    <button type="button" className={className} onClick={share} aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span>{note ?? t("Share this view")}</span>
    </button>
  );
}
