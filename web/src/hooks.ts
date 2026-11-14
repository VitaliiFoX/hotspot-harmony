import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Width of an element, kept current as the layout changes. Charts draw to this width. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width); // first paint does not wait for the observer
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export type ThemeChoice = "auto" | "light" | "dark";

/** Whether the page is shown dark: the viewer's choice wins over the system setting. */
export function useDarkMode(choice: ThemeChoice): boolean {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const dark = choice === "auto" ? systemDark : choice === "dark";
  useEffect(() => {
    if (choice === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
  }, [choice]);
  return dark;
}
