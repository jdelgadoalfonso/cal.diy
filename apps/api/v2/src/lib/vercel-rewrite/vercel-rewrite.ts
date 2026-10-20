import qs from "qs";

/**
 * Path of the serverless entry point declared in `apps/api/v2/vercel.json`
 * (`outputDirectory` is `dist/apps/api/v2`, so the compiled handler lives at `src/main.js`).
 */
export const FUNCTION_ENTRY_PATH = "/src/main.js";

/**
 * Query parameter the Vercel rewrite appends with the original request path.
 * `vercel.json` rewrites `/:path*` to the function entry, and Vercel passes named
 * rewrite parameters through the query string, so `/v2/bookings?status=accepted`
 * reaches the handler as `/src/main.js?path=v2/bookings&status=accepted`.
 */
export const ORIGINAL_PATH_QUERY_PARAM = "path";

/**
 * Rebuilds the URL the Nest app knows how to route from the URL Vercel hands to the
 * serverless handler.
 *
 * A Vercel rewrite replaces the request path with the rewrite destination, so without
 * this the handler only ever sees `/src/main.js` and every route answers 404
 * (`Cannot GET /src/main.js`). Requests that do not target the function entry, or that
 * arrive without the appended parameter (local `nest start`, or a rewrite that does not
 * pass the path through), are returned untouched.
 */
export function restoreRewrittenUrl(url: string): string {
  const queryStartIndex = url.indexOf("?");
  const requestPath = queryStartIndex === -1 ? url : url.slice(0, queryStartIndex);

  if (requestPath !== FUNCTION_ENTRY_PATH) {
    return url;
  }

  const queryString = queryStartIndex === -1 ? "" : url.slice(queryStartIndex + 1);
  const parsedQuery = qs.parse(queryString, { arrayLimit: 1000 });
  const originalPath = parsedQuery[ORIGINAL_PATH_QUERY_PARAM];

  if (typeof originalPath !== "string") {
    return url;
  }

  delete parsedQuery[ORIGINAL_PATH_QUERY_PARAM];

  const restoredPath = `/${originalPath.replace(/^\/+/, "")}`;
  const restoredQuery = qs.stringify(parsedQuery);

  return restoredQuery ? `${restoredPath}?${restoredQuery}` : restoredPath;
}
