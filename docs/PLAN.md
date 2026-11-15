# Plan to submission

Written on Saturday 2026-11-14 at 23:55 Kyiv time. The hard stop is **Sunday 2026-11-15 at 23:59
Kyiv time** (21:59 UTC). After it, nobody may commit, push, merge or tag. All times below are Kyiv
time.

Tick a box in the PR that does the work, and put your GitHub login in the Owner column when you take
a row.

## Where we are

- Merged to `main`: pipeline, harmonization with five methods chosen per country, validation, API,
  the dashboard, the globe with the daily hotspot explorer, and CSV/PNG downloads (#1-#17, #19).
- Open: #18, the review fixes for #9 and #12. Its CI is green. The validation run that writes its
  numbers is still in progress.
- Not done yet:
  - a public demo (README still says "not deployed yet");
  - critical periods: the challenge asks when burning is usually at its highest in an area, and the
    app only shows it indirectly, through the seasonal chart;
  - a calendar by day and by week: the challenge asks for days, weeks and months, and the calendar
    is by month only (single days exist on the globe);
  - showing in the app how far the numbers can be trusted;
  - the video or slides;
  - the project page.

## Must do: without these the entry is weak or ineligible

From the Space Apps rules and the judging criteria (Impact, Creativity, Validity, Relevance,
Presentation, each 1-5).

- [ ] **A public demo link that opens without a login.** Judges look at it first.
- [ ] **A video of 30 seconds at most, or a deck of 7 slides at most, behind a public link.**
  Going over the limit makes the entry ineligible.
- [ ] **Everything on the project page and in linked material is in English.**
- [ ] **NASA data named as the source:** "NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m)". If the
  globe stays, also credit the NASA GIBS imagery.
- [ ] **How AI tools were used, described** on the project page and in the README section "Use of
  AI tools". Add what is new since the section was written: the AI-assisted code review and the
  competitor scan.
- [ ] **Submit for Judging on the team's Project tab, by 21:00 at the latest.** That leaves three
  hours of margin before the hard stop.
- [ ] **#18 merged.** The validation figures we quote must come from the run where the method choice
  never saw the held-out year (`make validate NESTED=1`).
- [ ] **README true at submission:** the demo link, the Status table and the reference numbers.

## Timeline

### Saturday night, until 03:00: get the demo online

| # | Task | Done when | Owner | |
|---|---|---|---|---|
| 1 | Finish #18: regenerate `docs/VALIDATION.md` and the reference values in `CLAUDE.md`, then merge | #18 is in `main` and the numbers in the docs match `data/agg/harmonization_report.json` | | [ ] |
| 2 | Deploy the API as a Docker image with its data (about 110 MB: `data/points` plus the files the API reads from `data/agg`). Proposed host: Fly.io, which does not sleep like a free Render instance | `/api/health` answers on a public URL within a second | | [ ] |
| 3 | Deploy the web app on GitHub Pages, built with `VITE_API_URL` pointing at the API | the link opens in a private window; the calendar and the globe both work | | [ ] |
| 4 | Put the demo link in the README | — | | [ ] |

If the deployment is still not working after 2 hours, fall back to a static site with precomputed
JSON for the two countries and no API.

### Sunday 09:00-14:00: what a judge sees first

| # | Task | Estimate | Why | Owner | |
|---|---|---|---|---|---|
| 5 | "How far to trust this" block: held-out error, the two baselines, where the numbers come from (`harmonization_report.json`) | 1.5 h | Validity, where we lead every competitor we read | VitaliiFoX | [x] |
| 6 | The raw record as a thin line over the harmonized bars on the yearly chart, so the 2012 jump is visible without the switch | 1 h | It answers the challenge at first glance | VitaliiFoX | [x] |
| 7 | Log scale for the calendar by default. The headline figure shows the peak of the last season instead of December | 1 h | Today the calendar looks washed out and the headline figure is a quiet month | | [ ] |
| 8 | Draw an area on the globe (done as a polygon, sent to the API as its geometry; the `box` filter shows its bounds) | 2-3 h | Every strong competitor has it; the README promises it | vovikLXUS | [x] |
| 8a | "Peak burning months" card for the chosen area: the fewest months that together hold 60% of a typical year (the sum of the monthly medians in `climatology`), with a table view. Web only: a pure function in `web/src/scale.ts` under test, and the term in `GLOSSARY.md`. Call it burning activity, not risk: we do not measure risk | 1.5 h | The challenge asks for critical periods by name, and the API already returns what the card needs | VitaliiFoX | [x] |

**Feature freeze at 14:00.** After that, only fixes and packaging.

### Sunday 14:00-18:00: validity and content (only if 1-8a are done)

| # | Task | Estimate | Owner | |
|---|---|---|---|---|
| 9 | A "MODIS alone" line across 2012, next to the raw and the harmonized record. It explains the 0.66x jump ratio in Argentina, where burning really fell | 1 h | | [ ] |
| 10 | Hatch sensor gap days in the calendar so that "no data" never reads as zero | 1 h | | [ ] |
| 11 | Ukraine presets: Chornobyl exclusion zone (April 2020), the southern steppe | 1 h | | [ ] |
| 11a | Optional, the first row to drop: a calendar of the days of one chosen year for the area, with weeks as sums of the same days. Needs a new API endpoint over `data/points`, because `/api/hotspots/days` counts the whole record, not the area. `harmonized.parquet` is monthly, so this view is in hotspots of one sensor and must say so; comparing years stays on the monthly harmonized calendar. If it is dropped, say in the README that single days are on the globe | 3-4 h | | [ ] |
| 12 | README: the Status table, "Use of AI tools", full NASA GIBS credit, links to METHOD and VALIDATION | 1 h | | [ ] |

### Sunday 18:00-21:00: submission

| # | Task | Owner | |
|---|---|---|---|
| 13 | Video of 30 s at most: raw to harmonized, the 2012 jump disappears, draw an area, read its anomaly. Or a deck of 7 slides at most | | [ ] |
| 14 | Project page in English: description, demo link, repository, video; NASA FIRMS as the data source; use of AI | | [ ] |
| 15 | Open every link in a private window and on a phone | | [ ] |
| 16 | **Submit for Judging, by 21:00** | | [ ] |

21:00-23:59: critical fixes only. At 23:59 all commits stop.

## Not doing

- **World mode in production.** It needs about 50 GB and has not been run on the full archive.
- **2026 data.** Out of scope by the mentor's call.
- **Forecasts or an AI chat.**
- **New harmonization models.** The method already beats every competitor we read, and what is
  left to gain is under half a point.

## Risks

| Risk | What we do |
|---|---|
| The deployment takes longer than planned | It goes first; the static fallback is described above |
| Two people edit the same files | One person works in `pipeline/` and `api/`, the other in `web/`. Small PRs, merged often, fetch before starting |
| Globe tiles from NASA GIBS do not load on venue Wi-Fi or a phone | Check early; the calendar works without them |
| The Mac sleeps in the middle of a long run (cost three hours on Saturday) | Run long jobs under `caffeinate` |

## Open decisions

1. **Hosting:** Fly.io plus GitHub Pages, or something else.
2. **Who takes which rows.**
3. **Format:** a video of 30 seconds or a deck of 7 slides. A video shows the interface better.

## Competitors in one paragraph

On 14 November about 208 public repositories targeted this challenge, and 63 of them link a demo.
The strongest let the user draw an area, and some cover the whole world or run to November 2026.
Where we lead:

- the method: a weight per VIIRS fire cell-day by fire power on a 1 km grid;
- the held-out error, the lowest published for the same countries;

  | Country | Us, per month | Best other entry we read |
  |---|---|---|
  | Ukraine | about 6% | 14% |
  | Argentina | about 7% | 8.2-8.3% |

- a validated Terra-only start in 2000-2002;
- a commit history that starts on the first day of the event.

Where we trail: a live demo and drawing an area. Hence the order above.
