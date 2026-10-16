import { apiError } from "#lib/server/utils/api-error.js";
import { MAX_SEARCH_LENGTH } from "#lib/shared/schemas/log.js";

/** 400 `invalid_search` for an over-long `search` parameter, or null when it is acceptable. */
export function searchLengthError(searchTerm: string | null): Response | null {
  if (!searchTerm || searchTerm.length <= MAX_SEARCH_LENGTH) return null;

  return apiError(
    400,
    "invalid_search",
    `search must be at most ${MAX_SEARCH_LENGTH} characters, got ${searchTerm.length}.`,
  );
}

export function buildSearchQuery(searchTerm: string): string {
  if (!searchTerm) {
    return "";
  }

  // Routes reject longer input with searchLengthError and the logs page loader cuts it; any
  // other caller still never sends PostgreSQL an unbounded tsquery.
  const bounded = searchTerm.slice(0, MAX_SEARCH_LENGTH);

  const specialCharsRegex = /[&|!():*\\'"<>]/g;

  const sanitized = bounded.replace(specialCharsRegex, " ");

  const terms = sanitized.split(/\s+/).filter((term) => term.length > 0);

  return terms.join(" & ");
}
