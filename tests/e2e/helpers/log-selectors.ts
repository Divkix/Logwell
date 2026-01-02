import type { Locator, Page } from '@playwright/test';

/**
 * Log selector helpers for E2E tests
 *
 * These helpers ensure consistent selection of log elements across different viewport sizes.
 * - Mobile: Uses card-based layout ([data-testid="log-card"])
 * - Desktop/Tablet: Uses table-based layout ([data-testid="log-table"] table)
 */

/**
 * Get a log card locator, optionally filtered by text content.
 * Use this for mobile viewport tests where logs are displayed as cards.
 *
 * @param page - Playwright page object
 * @param options - Optional filter options
 * @param options.hasText - Filter cards containing this text
 * @returns Locator for the log card(s)
 */
export function getLogCard(page: Page, options?: { hasText?: string }): Locator {
  const baseLocator = page.locator('[data-testid="log-card"]');
  if (options?.hasText) {
    return baseLocator.filter({ hasText: options.hasText });
  }
  return baseLocator;
}

/**
 * Get a log message locator scoped to the appropriate layout container.
 *
 * @param page - Playwright page object
 * @param text - The text to search for
 * @param viewport - The viewport type ('desktop' or 'mobile'). Defaults to 'desktop'.
 * @returns Locator for the log message element
 */
export function getLogMessage(
  page: Page,
  text: string,
  viewport: 'desktop' | 'mobile' = 'desktop',
): Locator {
  if (viewport === 'mobile') {
    // Mobile uses card layout
    return page.locator('[data-testid="log-card"]').getByText(text);
  }
  // Desktop/tablet uses table layout
  return page.locator('[data-testid="log-table"] table').getByText(text);
}

/**
 * Get a level badge locator scoped to the appropriate layout container.
 *
 * @param page - Playwright page object
 * @param level - The level text to search for (e.g., 'INFO', 'ERROR')
 * @param viewport - The viewport type ('desktop' or 'mobile'). Defaults to 'desktop'.
 * @returns Locator for the level badge element
 */
export function getLevelBadge(
  page: Page,
  level: string,
  viewport: 'desktop' | 'mobile' = 'desktop',
): Locator {
  if (viewport === 'mobile') {
    return page.locator('[data-testid="log-card"]').getByText(level);
  }
  return page.locator('[data-testid="log-table"] table').getByText(level);
}
