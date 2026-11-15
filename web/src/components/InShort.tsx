import type { MouseEvent } from "react";
import { t } from "../i18n";
import type { SummaryLine } from "../insights";

/** Scroll to the card a line sums up and move the focus there, so the keyboard carries on from that card. */
function goTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const card = document.getElementById(id);
  if (!card) return; // no card on screen: let the browser follow the link
  event.preventDefault();
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");
  card.focus({ preventScroll: true });
}

/**
 * The area in a few lines, each built from a figure the page shows (no generated text, no figure of its own): the
 * figure first, the explanation after, and the whole line a link to the card it sums up.
 */
export function InShort({ lines }: { lines: SummaryLine[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="card in-short" aria-labelledby="in-short-title">
      <h2 id="in-short-title">{t("In short")}</h2>
      <ul>
        {lines.map((line) => (
          <li key={`${line.target}-${line.figure}`}>
            <a href={`#${line.target}`} onClick={(event) => goTo(event, line.target)}>
              <strong className="in-short-figure">{line.figure}</strong>
              <span className="in-short-text">{line.text}</span>
              <span className="in-short-go" aria-hidden="true">
                ↓
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
