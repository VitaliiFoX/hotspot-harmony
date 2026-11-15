import type { Cells } from "../api";
import { cellAreaKm2, latLonLabel, stopLabel } from "../globe";
import { MONTHS_LONG, formatValue } from "../scale";

type Props = {
  top: Cells;
  /** Fly the globe to a cell and show where it burns there. */
  onShow: (cell: { lat: number; lon: number }) => void;
};

/** Where in the chosen area it burns most: the busiest grid cells of the harmonized record, with their month. */
export function TopPlaces({ top, onShow }: Props) {
  if (top.cells.length === 0) return null;
  return (
    <section className="card top-places" aria-labelledby="top-places-title">
      <div className="card-head">
        <div>
          <h2 id="top-places-title">Where in this area it burns most</h2>
          <p className="subtitle">
            {`The ${top.cells.length === 1 ? "grid cell" : `${top.cells.length} grid cells`} of the area with the most ${top.unit} a year, ${top.start} to ${top.end}, harmonized record. A cell is ${top.cell_deg}° on a side, about ${Math.round(cellAreaKm2(top.cells[0].lat, top.cell_deg))} km² here.`}
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <caption>{`Busiest cells of the area, ${top.unit} a year`}</caption>
          <thead>
            <tr>
              <th scope="col">Cell centre</th>
              <th scope="col">A year</th>
              <th scope="col">Per 100 km²</th>
              <th scope="col">Years burning</th>
              <th scope="col">Most in</th>
              <th scope="col">
                <span className="dt-hidden">Map</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {top.cells.map((cell) => (
              <tr key={`${cell.lat},${cell.lon}`}>
                <th scope="row">{latLonLabel(cell.lat, cell.lon)}</th>
                <td>{formatValue(cell.per_year)}</td>
                <td>{stopLabel((cell.per_year / cellAreaKm2(cell.lat, top.cell_deg)) * 100)}</td>
                <td>{`${cell.years_burning} of ${top.years}`}</td>
                <td>{MONTHS_LONG[cell.peak_month - 1]}</td>
                <td>
                  <button type="button" className="ghost" onClick={() => onShow(cell)}>
                    Show on the globe
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
