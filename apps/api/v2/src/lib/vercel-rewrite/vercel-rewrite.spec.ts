import qs from "qs";
import { restoreRewrittenUrl } from "./vercel-rewrite";

const parseQuery = (url: string): qs.ParsedQs => qs.parse(url.slice(url.indexOf("?") + 1));

describe("restoreRewrittenUrl", () => {
  it("rebuilds the original path when the rewrite appended it as a query parameter", () => {
    expect(restoreRewrittenUrl("/src/main.js?path=v2/bookings&status=accepted")).toBe(
      "/v2/bookings?status=accepted"
    );
  });

  it("rebuilds the api/v2 prefixed path", () => {
    expect(restoreRewrittenUrl("/src/main.js?path=api/v2/bookings")).toBe("/api/v2/bookings");
  });

  it("rebuilds the path when Vercel percent-encodes the appended value", () => {
    expect(restoreRewrittenUrl("/src/main.js?path=%2Fv2%2Fbookings&status=accepted")).toBe(
      "/v2/bookings?status=accepted"
    );
  });

  it("rebuilds the root path from an empty appended value", () => {
    expect(restoreRewrittenUrl("/src/main.js?path=")).toBe("/");
  });

  it("keeps a repeated query parameter as an array", () => {
    const restored = restoreRewrittenUrl("/src/main.js?path=v2/bookings&status=accepted&status=pending");

    expect(restored.startsWith("/v2/bookings?")).toBe(true);
    expect(parseQuery(restored)).toEqual({ status: ["accepted", "pending"] });
  });

  it("keeps nested query parameters parseable", () => {
    const restored = restoreRewrittenUrl("/src/main.js?path=v2/bookings&ids%5B%5D=1&ids%5B%5D=2");

    expect(restored.startsWith("/v2/bookings?")).toBe(true);
    expect(parseQuery(restored)).toEqual({ ids: ["1", "2"] });
  });

  it("leaves a request untouched when it does not target the function entry", () => {
    expect(restoreRewrittenUrl("/v2/bookings?status=accepted")).toBe("/v2/bookings?status=accepted");
  });

  it("does not consume a path parameter sent by a client of a real endpoint", () => {
    expect(restoreRewrittenUrl("/v2/bookings?path=%2Fsome%2Ffile")).toBe("/v2/bookings?path=%2Fsome%2Ffile");
  });

  it("leaves the function entry untouched when the rewrite did not append the path", () => {
    expect(restoreRewrittenUrl("/src/main.js?status=accepted")).toBe("/src/main.js?status=accepted");
  });

  it("leaves the function entry untouched without a query string", () => {
    expect(restoreRewrittenUrl("/src/main.js")).toBe("/src/main.js");
  });
});
