/**
 * Builds a PostgreSQL tsquery string from a search term
 * Converts space-separated terms to AND operator (&)
 * Escapes special PostgreSQL tsquery characters: & | ! ( ) : * \ ' "
 *
 * @param searchTerm - Raw search string from user input
 * @returns Sanitized tsquery string with terms joined by ' & '
 *
 * @example
 * buildSearchQuery('database connection failed')
 * // Returns: 'database & connection & failed'
 *
 * @example
 * buildSearchQuery('error! (warning)')
 * // Returns: 'error & warning'
 */
export function buildSearchQuery(searchTerm: string): string {
  if (!searchTerm || typeof searchTerm !== "string") {
    return "";
  }

  // PostgreSQL tsquery special characters that need to be removed
  // & | ! ( ) : * \ ' " < >
  const specialCharsRegex = /[&|!():*\\'"<>]/g;

  // Remove special characters, then split on whitespace
  const sanitized = searchTerm.replace(specialCharsRegex, " ");

  // Split on whitespace, filter empty strings, and join with ' & '
  const terms = sanitized.split(/\s+/).filter((term) => term.length > 0);

  return terms.join(" & ");
}
