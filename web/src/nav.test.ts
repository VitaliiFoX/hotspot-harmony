import { describe, expect, it } from "vitest";
import { activeSection, monthAllowed, pickMonth, sectionNumber, yearsBetween } from "./nav";

describe("the section the reader is in", () => {
  // Three sections down the page; the sticky bar ends 60 px from the top of the window.
  const tops = (scrolled: number) => [
    { id: "overview", top: 900 - scrolled },
    { id: "months", top: 1700 - scrolled },
    { id: "trust", top: 2600 - scrolled },
  ];

  it("is none while the map is still on screen", () => {
    expect(activeSection(tops(0), 60)).toBeNull();
    expect(activeSection(tops(839), 60)).toBeNull();
  });
  it("is the last section whose top has reached the bar", () => {
    expect(activeSection(tops(840), 60)).toBe("overview");
    expect(activeSection(tops(1639), 60)).toBe("overview");
    expect(activeSection(tops(1640), 60)).toBe("months");
    expect(activeSection(tops(2540), 60)).toBe("trust");
  });
  it("is the last section at the end of the page, even when its top never reaches the bar", () => {
    expect(activeSection(tops(2300), 60)).toBe("months");
    expect(activeSection(tops(2300), 60, true)).toBe("trust");
  });
  it("is none on a page with no sections", () => {
    expect(activeSection([], 60, true)).toBeNull();
  });
});

describe("the number over a section", () => {
  it("counts the sections that are on the page, from 01", () => {
    const sections = [
      { id: "overview", label: "Overview" },
      { id: "months", label: "Calendar" },
      { id: "trust", label: "Trust" },
    ];
    expect(sectionNumber(sections, "overview")).toBe("01");
    expect(sectionNumber(sections, "trust")).toBe("03");
  });
});

describe("the months a period field offers", () => {
  it("lists every year of the record", () => {
    expect(yearsBetween("2000-11", "2003-02")).toEqual([2000, 2001, 2002, 2003]);
    expect(yearsBetween("2025-01", "2025-12")).toEqual([2025]);
  });
  it("allows the months inside the range, its ends included", () => {
    expect(monthAllowed(2000, 10, "2000-11", "2025-12")).toBe(false);
    expect(monthAllowed(2000, 11, "2000-11", "2025-12")).toBe(true);
    expect(monthAllowed(2025, 12, "2000-11", "2025-12")).toBe(true);
    expect(monthAllowed(2026, 1, "2000-11", "2025-12")).toBe(false);
  });
  it("moves a month that falls out of the range to its nearest end", () => {
    expect(pickMonth(2010, 6, "2000-11", "2025-12")).toBe("2010-06");
    expect(pickMonth(2000, 3, "2000-11", "2025-12")).toBe("2000-11");
    expect(pickMonth(2025, 12, "2000-11", "2020-08")).toBe("2020-08");
  });
});
