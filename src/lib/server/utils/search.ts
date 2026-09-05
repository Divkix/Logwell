export function buildSearchQuery(searchTerm: string): string {
  if (!searchTerm || typeof searchTerm !== "string") {
    return "";
  }

  const specialCharsRegex = /[&|!():*\\'"<>]/g;

  const sanitized = searchTerm.replace(specialCharsRegex, " ");

  const terms = sanitized.split(/\s+/).filter((term) => term.length > 0);

  return terms.join(" & ");
}
