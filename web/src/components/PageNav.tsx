import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { SeriesName } from "../api";
import type { ThemeChoice } from "../hooks";
import { LANGUAGES, type Lang, language, t } from "../i18n";
import { type Section, activeSection } from "../nav";

type Props = {
  /** The sections of the report that are on the page, in page order. */
  sections: Section[];
  /** The record on screen and the switch between the two; left out until the filters are known. */
  series?: SeriesName;
  available?: SeriesName[];
  onSeries?: (series: SeriesName) => void;
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
  onLanguage: (lang: Lang) => void;
};

const THEMES: ThemeChoice[] = ["auto", "light", "dark"];
const THEME_NAMES: Record<ThemeChoice, string> = { auto: "System", light: "Light", dark: "Dark" };

function still(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  if (theme === "light") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" />
        <path
          d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </svg>
  );
}

/**
 * The head of the page, over the map, and the bar that stays at the top of the window all the way down: the name
 * of the project, where the reader is (the map, or a section of the report under it), the switch between the two
 * records, the language and the theme. Its links scroll the page and leave the address as it is.
 */
export function PageNav({ sections, series, available = [], onSeries, theme, onTheme, onLanguage }: Props) {
  const bar = useRef<HTMLElement>(null);
  const links = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>("map");
  const [stuck, setStuck] = useState(false);
  const ids = sections.map((section) => section.id).join(",");

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = bar.current?.getBoundingClientRect();
      if (!box) return;
      const tops = ids
        .split(",")
        .map((id) => ({ id, element: document.getElementById(id) }))
        .filter((item) => item.element)
        .map((item) => ({ id: item.id, top: item.element!.getBoundingClientRect().top }));
      const page = document.documentElement;
      const atEnd = window.innerHeight + window.scrollY >= page.scrollHeight - 2;
      // A section counts from a little before its label reaches the bar, so a jump to it lands inside it. Before
      // the first one does, the reader is on the map.
      setActive(activeSection(tops, box.bottom + 32, atEnd) ?? "map");
      setStuck(window.scrollY > 2);
    };
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
    };
  }, [ids]);

  // On a narrow screen the links scroll sideways: the one for the section on screen goes to the middle of the row.
  useEffect(() => {
    const row = links.current;
    const link = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !link) return;
    if (row.scrollWidth <= row.clientWidth) return;
    const left = link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: still() ? "auto" : "smooth" });
  }, [active]);

  function go(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const target = id === "map" ? document.querySelector<HTMLElement>(".stage") : document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  return (
    <header className={stuck ? "bar is-stuck" : "bar"} ref={bar}>
      <div className="bar-inner">
        <a className="bar-brand" href="#map" onClick={(event) => go(event, "map")} title={t("Back to the map")}>
          <i className="bar-mark" aria-hidden="true" />
          <h1>Hotspot Harmony</h1>
        </a>
        <nav className="bar-links" aria-label={t("Sections of the page")} ref={links}>
          <a href="#map" aria-current={active === "map" ? "true" : undefined} onClick={(event) => go(event, "map")}>
            {t("Map")}
          </a>
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              onClick={(event) => go(event, section.id)}
            >
              {section.label}
            </a>
          ))}
        </nav>
        <div className="bar-tools">
          {series && onSeries && (
            <div className="segmented bar-record" role="group" aria-label={t("Record")}>
              {(["harmonized", "raw"] as SeriesName[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={series === name}
                  disabled={!available.includes(name)}
                  onClick={() => onSeries(name)}
                >
                  {name === "raw" ? t("Raw") : t("Harmonized")}
                </button>
              ))}
            </div>
          )}
          <div className="segmented bar-lang" role="group" aria-label={t("Language")}>
            {LANGUAGES.map((item) => (
              <button
                key={item.lang}
                type="button"
                lang={item.lang}
                title={item.name}
                aria-label={item.name}
                aria-pressed={language() === item.lang}
                onClick={() => language() !== item.lang && onLanguage(item.lang)}
              >
                {item.lang.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="bar-theme"
            title={`${t("Theme")}: ${t(THEME_NAMES[theme])}`}
            aria-label={`${t("Theme")}: ${t(THEME_NAMES[theme])}`}
            onClick={() => onTheme(next)}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </div>
    </header>
  );
}
