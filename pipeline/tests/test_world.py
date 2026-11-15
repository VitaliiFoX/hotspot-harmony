import duckdb
import pandas as pd

from pipeline.world import REST, SQUARE_SQL, assign_units, pool_countries, square_of, unit_filters


def counts(d: dict[int, int]) -> pd.Series:
    return pd.Series(d, dtype=int)


def test_pool_takes_the_smallest_countries_with_their_own_overlap_up_to_the_budget():
    sizes = pd.DataFrame(
        {
            "country": ["Malta", "Belgium", "Chad", "Peru", "Brazil"],  # smallest first, as country_sizes returns
            "n": [100, 4_000, 6_000, 9_000, 50_000],
            "n_fit": [10, 6_000, 5_000, 7_000, 40_000],  # Malta is under MIN_FIT_CELLDAYS (5 000)
        }
    )

    # Belgium (4 000) + Chad (6 000) reach the budget of 10 000; Peru and Brazil are not needed
    assert pool_countries(sizes, budget=10_000) == ["Belgium", "Chad"]
    assert pool_countries(sizes, budget=10_001) == ["Belgium", "Chad", "Peru"]
    assert pool_countries(sizes[sizes.country == "Malta"], budget=10_000) == []


def test_a_square_with_enough_overlap_is_its_own_unit_and_the_others_are_calibrated_together():
    # with least = 10: a unit needs 10 VIIRS and 5 MODIS cell-days of the fit period
    viirs, modis = counts({1: 30, 3: 6, 4: 5}), counts({1: 20, 3: 3, 4: 3})

    unit, default = assign_units(viirs, modis, least=10)

    assert unit == {1: 1, 3: REST, 4: REST}  # squares 3 and 4 together: 11 VIIRS, 6 MODIS
    assert default == REST  # a square that burns only outside the fit period goes with the small ones


def test_the_smallest_unit_joins_the_others_while_they_are_short():
    viirs, modis = counts({1: 30, 2: 12, 3: 4, 4: 3}), counts({1: 20, 2: 6, 3: 1, 4: 1})

    unit, _ = assign_units(viirs, modis, least=10)

    # squares 3 and 4 have 7 VIIRS cell-days: square 2, the smaller unit, joins them (19 VIIRS, 8 MODIS)
    assert unit == {1: 1, 2: REST, 3: REST, 4: REST}


def test_a_country_is_calibrated_whole_when_no_second_unit_can_stand():
    one_big, _ = assign_units(counts({1: 30, 3: 4}), counts({1: 20, 3: 1}), least=10)
    none_big, _ = assign_units(counts({3: 4, 4: 3}), counts({3: 2, 4: 1}), least=10)
    modis_only_square, _ = assign_units(counts({1: 30}), counts({1: 20, 5: 2}), least=10)

    assert set(one_big.values()) == {REST}  # square 3 alone is short, so square 1 joins it: one unit
    assert set(none_big.values()) == {REST}
    assert modis_only_square == {1: REST, 5: REST}


def test_squares_that_are_all_units_send_a_stray_square_to_the_largest():
    unit, default = assign_units(counts({1: 30, 2: 12}), counts({1: 20, 2: 6}), least=10)

    assert unit == {1: 1, 2: 2}
    assert default == 1


def test_unit_filters_cover_every_cell_day_once():
    together = unit_filters({"unit": {1: 1, 2: REST, 3: REST}, "default": REST})
    all_own = unit_filters({"unit": {1: 1, 2: 2}, "default": 1})

    assert together == {"unit_1": f"{SQUARE_SQL} in (1)", f"unit_{REST}": f"{SQUARE_SQL} not in (1)"}
    assert all_own == {"unit_1": f"{SQUARE_SQL} not in (2)", "unit_2": f"{SQUARE_SQL} in (2)"}
    assert unit_filters(None) == {"country": "true"}


def test_square_ids_agree_between_python_and_sql():
    points = pd.DataFrame({"lat": [-0.5, 55.3, 9.99, 10.0], "lon": [30.2, -179.9, -0.01, 0.0]})

    # floor(lat / 10) * 1000 + floor(lon / 10): (-1, 3), (5, -18), (0, -1), (1, 0)
    assert list(square_of(points.lat, points.lon)) == [-997, 4982, -1, 1000]
    con = duckdb.connect()
    con.register("cd", points)
    assert [r[0] for r in con.execute(f"select {SQUARE_SQL} from cd").fetchall()] == [-997, 4982, -1, 1000]
