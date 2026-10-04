import { expect, test } from '@playwright/test';

/**
 * The admin loop the farm actually runs (SPEC §9, §11).
 *
 * Skipped unless ADMIN_EMAIL and ADMIN_PASSWORD are exported, because it needs a seeded
 * account and a real order to quote.
 *
 *   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='…12+ chars…' npm run e2e --workspace apps/web
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const ADMIN_ENABLED = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

test.describe('admin order management', () => {
    test.skip(!ADMIN_ENABLED, 'Set ADMIN_EMAIL and ADMIN_PASSWORD to run the admin flow');

    test('signs in, quotes an order, records payment and completes it', async ({ page }) => {
        await page.goto('/admin');
        await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
        await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
        await page.getByRole('button', { name: /sign in/i }).click();

        // A seeded owner must change its password before anything else (SPEC §9).
        if (page.url().includes('change-password')) {
            test.skip(true, 'Admin account still needs its starting password changed');
        }
        await expect(page).toHaveURL(/\/admin$/);

        await page.getByRole('link', { name: /view details/i }).first().click();
        await expect(page.getByRole('heading', { name: /AF-\d{4}-\d+/ })).toBeVisible();

        // Only legal transitions are offered (SPEC §9).
        const transition = page.getByRole('button', { name: /^Quoted$/ }).first();
        await expect(transition).toBeVisible();
        await transition.click();
        await expect(page.getByText(/order moved to quoted/i)).toBeVisible();

        // Quote builder: Naira in, kobo on the wire, live total in Naira.
        await page.getByLabel(/price per kg/i).fill('500');
        await page.getByLabel(/delivery fee/i).fill('2500');
        await page.getByLabel(/valid until/i).fill('2099-01-01');
        await expect(page.locator('output')).toContainText('₦');
        await page.getByRole('button', { name: /send quote/i }).click();
        await expect(page.getByText(/quote sent/i)).toBeVisible();

        // Accept the quote, which moves the order to Confirmed.
        await page.reload();
        await page.getByRole('button', { name: /^Confirmed$/ }).first().click();
        await expect(page.getByText(/order moved to confirmed/i)).toBeVisible();

        // Record the balance as paid.
        await page.getByLabel(/amount/i).fill('22500');
        await page.getByRole('button', { name: /record payment/i }).click();
        await expect(page.getByText(/payment recorded/i)).toBeVisible();
        await expect(page.getByText(/balance ₦0/)).toBeVisible();
    });

    test('revalidation hook requires the shared secret', async ({ request }) => {
        const response = await request.post('/api/revalidate', { data: { reason: 'test' } });
        // 401 with the secret unset/wrong, 503 when REVALIDATE_SECRET is not configured.
        expect([401, 503]).toContain(response.status());
    });
});
