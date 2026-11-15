import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Region } from "../api";
import { type Country, type Place, searchPlaces } from "../countries";
import { t } from "../i18n";

type Props = {
  regions: Region[];
  /** The borders of every country; empty until they arrive, and then only the regions can be found. */
  countries: Country[];
  /** What the filters are on now: the picked country, or else the region. */
  current: string;
  onPick: (place: Place) => void;
};

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 15.5L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The region of the filters as a search: a button that names the place and opens a field to type in, over the
 * list of what the text finds. The regions come first; every other country of the world follows, marked when
 * no record is loaded for it. Arrow keys move through the list, Enter takes a line, Escape closes.
 */
export function RegionSearch({ regions, countries, current, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  // A place is found by its English name and by the name the page shows for it.
  const places = useMemo(() => searchPlaces(regions, countries, query, (name) => t(name)), [regions, countries, query]);

  function close(refocus: boolean) {
    setOpen(false);
    setQuery("");
    setActive(0);
    if (refocus) button.current?.focus();
  }
  function pick(place: Place) {
    close(true);
    onPick(place);
  }

  // A click anywhere else closes the list, as a native select does.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The line the arrow keys are on stays in view.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(0, places.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (places[active]) pick(places[active]);
    }
  }

  return (
    <div className="region-search" ref={root}>
      <span className="region-search-label" id={`${id}-label`}>
        {t("Region")}
      </span>
      <button
        ref={button}
        type="button"
        className="region-search-button"
        id={`${id}-button`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-button`}
        title={t("Search a region or a country")}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <SearchIcon />
        <span>{t(current)}</span>
      </button>
      {open && (
        <div className="region-search-pop">
          <input
            type="search"
            role="combobox"
            autoFocus
            value={query}
            placeholder={t("Search a country")}
            aria-label={t("Search a region or a country")}
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={places[active] ? `${id}-option-${active}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul ref={list} role="listbox" id={`${id}-list`} aria-label={t("Regions and countries")}>
            {places.map((place, index) => (
              <li
                key={`${place.kind}-${place.name}`}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === active}
                // Keep the focus in the field, so the list does not close before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(place)}
              >
                <span>{t(place.name)}</span>
                {place.kind === "region" ? <small>{t("record loaded")}</small> : !place.hasData && <small>{t("no record yet")}</small>}
              </li>
            ))}
            {places.length === 0 && <li className="region-search-empty">{t("No country matches")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
