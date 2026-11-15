import { describe, expect, it } from "vitest";
import { openingView, shareLink, viewText } from "./address";

describe("openingView", () => {
  it("takes the view of a link when the address carries one", () => {
    const view = openingView("?region=Ukraine&series=raw", "region=Argentina&lang=uk");
    expect(view.get("region")).toBe("Ukraine");
    expect(view.get("series")).toBe("raw");
    // A link is a whole view: nothing of the tab's earlier view leaks into it.
    expect(view.get("lang")).toBeNull();
  });

  it("falls back to the view the tab kept when the address is clean", () => {
    const view = openingView("", "region=Argentina&lang=uk");
    expect(view.get("region")).toBe("Argentina");
    expect(view.get("lang")).toBe("uk");
  });

  it("is empty for a clean address in a new tab", () => {
    expect(openingView("", null).toString()).toBe("");
    expect(openingView("?", null).toString()).toBe("");
  });
});

describe("viewText", () => {
  it("keeps commas, colons and semicolons readable and encodes the rest", () => {
    const view = new URLSearchParams();
    view.set("box", "22,44,40.3,52.5");
    view.set("time", "16:44");
    view.set("area", "30,51;31,51;31,52");
    view.set("country", "Côte d'Ivoire");
    expect(viewText(view)).toBe("box=22,44,40.3,52.5&time=16:44&area=30,51;31,51;31,52&country=C%C3%B4te+d%27Ivoire");
  });

  it("reads back to the same view", () => {
    const view = new URLSearchParams({ box: "22,44,40.3,52.5", time: "16:44", area: "30,51;31,51;31,52" });
    expect([...new URLSearchParams(viewText(view))]).toEqual([...view]);
  });
});

describe("shareLink", () => {
  it("joins the page's address and the view", () => {
    const view = new URLSearchParams({ region: "Ukraine", start: "2000-11", date: "2025-08-20", time: "16:44" });
    expect(shareLink("http://localhost:5173/", view)).toBe(
      "http://localhost:5173/?region=Ukraine&start=2000-11&date=2025-08-20&time=16:44",
    );
  });

  it("is the bare address when the view is empty", () => {
    expect(shareLink("https://example.org/app/", new URLSearchParams())).toBe("https://example.org/app/");
  });
});
