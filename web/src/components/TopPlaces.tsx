import { monthTitle, t, tn } from "../i18n";
import type { Cells } from "../api";
import { cellAreaKm2, latLonLabel, stopLabel } from "../globe";
import { formatValue } from "../scale";

type Props = {
  top: Cells;
  /** Fly the globe to a cell and show where it burns there. */
  onShow: (cell: { lat: number; lon: number }) => void;
};

/** Where in the chosen area it burns most: the busiest grid cells of the harmonized record, with their month. */
export function TopPlaces({ top, onShow }: Props) {
  if (top.cells.length === 0) return null;
  const unit = t(top.unit);
  return (
    <section className="card top-places" aria-labelledby="top-places-title">
      <div className="card-head">
        <div>
          <h2 id="top-places-title">{t("Where in this area it burns most")}</h2>
          <p className="subtitle">
            {tn(
              top.cells.length,
              "The grid cell of the area with the most {unit} a year, {start} to {end}, harmonized record. A cell is {deg}° on a side, about {km2} km² here.",
              "The {n} grid cells of the area with the most {unit} a year, {start} to {end}, harmonized record. A cell is {deg}° on a side, about {km2} km² here.",
              { unit, start: top.start, end: top.end, deg: top.cell_deg, km2: Math.round(cellAreaKm2(top.cells[0].lat, top.cell_deg)) },
            )}
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <caption>{t("Busiest cells of the area, {unit} a year", { unit })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Cell centre")}</th>
              <th scope="col">{t("A year")}</th>
              <th scope="col">{t("Per 100 km²")}</th>
              <th scope="col">{t("Years burning")}</th>
              <th scope="col">{t("Most in")}</th>
              <th scope="col">
                <span className="dt-hidden">{t("Map")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {top.cells.map((cell) => (
              <tr key={`${cell.lat},${cell.lon}`}>
                <th scope="row">{latLonLabel(cell.lat, cell.lon)}</th>
                <td>{formatValue(cell.per_year)}</td>
                <td>{stopLabel((cell.per_year / cellAreaKm2(cell.lat, top.cell_deg)) * 100)}</td>
                <td>{t("{n} of {years}", { n: cell.years_burning, years: top.years })}</td>
                <td>{monthTitle(cell.peak_month)}</td>
                <td>
                  <button type="button" className="ghost" onClick={() => onShow(cell)}>
                    {t("Show on the globe")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
