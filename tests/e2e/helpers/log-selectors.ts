import type { Locator, Page } from "@playwright/test";

export function getLogMessage(
  page: Page,
  text: string,
  viewport: "desktop" | "mobile" = "desktop",
): Locator {
  if (viewport === "mobile") {
    return page.locator('[data-testid="log-card"]').getByText(text);
  }
  return page.locator('[data-testid="log-table"] table').getByText(text);
}
