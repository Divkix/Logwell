import type { Locator, Page } from "@playwright/test";

export function getLogCard(page: Page, options?: { hasText?: string }): Locator {
  const baseLocator = page.locator('[data-testid="log-card"]');
  if (options?.hasText) {
    return baseLocator.filter({ hasText: options.hasText });
  }
  return baseLocator;
}

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

export function getLevelBadge(
  page: Page,
  level: string,
  viewport: "desktop" | "mobile" = "desktop",
): Locator {
  if (viewport === "mobile") {
    return page.locator('[data-testid="log-card"]').getByText(level);
  }
  return page.locator('[data-testid="log-table"] table').getByText(level);
}
