import { t } from "../i18n";

/** A grey bar in the shape of the text or chart that will take its place. */
function Bar({ width, height = 14 }: { width: string; height?: number }) {
  return <span className="skeleton-bar" style={{ width, height }} />;
}

/**
 * The record's cards drawn in outline while it loads: the headline and the calendar keep their place, so nothing
 * jumps when the figures arrive. Screen readers hear one line instead.
 */
export function RecordSkeleton() {
  return (
    <div className="content skeleton" role="status" aria-live="polite">
      <span className="dt-hidden">{t("Loading the record...")}</span>
      <section className="card skeleton-card" aria-hidden="true">
        <Bar width="46%" height={22} />
        <Bar width="22%" height={56} />
        <Bar width="70%" />
        <Bar width="58%" />
      </section>
      <section className="card skeleton-card" aria-hidden="true">
        <Bar width="34%" height={20} />
        <Bar width="62%" />
        <span className="skeleton-block" />
      </section>
    </div>
  );
}

/** The date panel's figures in outline while the hotspots of a day load. */
export function ReadoutSkeleton() {
  return (
    <div className="skeleton skeleton-readout" aria-hidden="true">
      <Bar width="38%" height={30} />
      <Bar width="64%" />
      <Bar width="82%" />
    </div>
  );
}
