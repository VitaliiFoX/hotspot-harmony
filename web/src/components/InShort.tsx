import { t } from "../i18n";

/** The area in a few sentences, each built from a figure the page shows: no generated text, no figure of its own. */
export function InShort({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="card in-short" aria-labelledby="in-short-title">
      <h2 id="in-short-title">{t("In short")}</h2>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
