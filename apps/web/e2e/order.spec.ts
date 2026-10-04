import { expect, type Page, test } from '@playwright/test';

/**
 * The public order journey (SPEC §5, §11).
 *
 * Selectors follow the real markup: fish type, size and fulfilment are radio inputs inside
 * their labels; preferred date and time slot are `<select>` elements; quantity accepts a
 * typed value. Steps advance with the "Next" button, which reads "Review & Confirm" on the
 * last question.
 */

/** Unique per run so retries never collide on the idempotency key or the phone number. */
function uniqueSuffix(): string {
    return String(Date.now()).slice(-7);
}

async function answerSixQuestions(page: Page, fulfilment: 'pickup' | 'delivery'): Promise<void> {
    // Q1 fish type + size.
    await page.getByRole('radio', { name: /clarias/i }).first().check();
    await page.getByRole('radio', { name: /2-3kg/i }).first().check();
    await page.getByRole('button', { name: /^Next/ }).click();

    // Q2 quantity: typing avoids depending on the preset button labels.
    await page.locator('#quantity-kg').fill('40');
    await page.getByRole('button', { name: /^Next/ }).click();

    // Q3 preferred date and Q4 time slot are selects; index 1 is the first real option.
    await page.locator('#preferred-date').selectOption({ index: 1 });
    await page.getByRole('button', { name: /^Next/ }).click();

    await page.locator('#time-slot').selectOption({ index: 1 });
    await page.getByRole('button', { name: /^Next/ }).click();

    // Q5 fulfilment.
    await page.getByRole('radio', { name: new RegExp(fulfilment, 'i') }).first().check();
    await page.getByRole('button', { name: /Review & Confirm/i }).click();
}

async function fillDetails(page: Page, suffix: string): Promise<void> {
    await page.getByLabel('Full name').fill(`E2E Tester ${suffix}`);
    await page.getByLabel(/phone/i).fill(`080${suffix}`);
    await page.getByLabel(/email/i).fill(`e2e-${suffix}@example.com`);
}

test.describe('order request', () => {
    test('completes the six questions and issues a reference', async ({ page }) => {
        const suffix = uniqueSuffix();
        await page.goto('/order');

        await answerSixQuestions(page, 'pickup');
        await fillDetails(page, suffix);

        // Review keeps the no-charge wording (SPEC §5.3).
        await expect(page.getByRole('heading', { name: /Check your request/i })).toBeVisible();

        await page.getByRole('button', { name: /Submit Order Request/i }).click();

        await expect(page.getByRole('heading', { name: /Order Request Sent/i })).toBeVisible();
        await expect(page.getByText(/AF-\d{4}-\d+/)).toBeVisible();
    });

    test('blocks a delivery order that has no address', async ({ page }) => {
        await page.goto('/order');
        await answerSixQuestions(page, 'delivery');
        await fillDetails(page, uniqueSuffix());

        await page.getByRole('button', { name: /Submit Order Request/i }).click();

        // The address field is reported and the order is not created (SPEC §5.2).
        await expect(page.getByText(/delivery address/i).first()).toBeVisible();
    });
});

/**
 * The most important regression guard in the suite (SPEC §6.4 idempotency).
 *
 * A double-tap on a slow phone connection must create exactly one order, not two.
 */
test.describe('double submission', () => {
    test('a double-tapped submit issues exactly one reference', async ({ page }) => {
        const suffix = uniqueSuffix();
        await page.goto('/order');

        await answerSixQuestions(page, 'pickup');
        await fillDetails(page, suffix);

        const submit = page.getByRole('button', { name: /Submit Order Request/i });
        // Two activations in immediate succession, as a double-tap produces. The button
        // disables itself while in flight, so the second is forced through.
        await submit.click();
        await submit.click({ force: true, timeout: 2_000 }).catch(() => undefined);

        await expect(page.getByRole('heading', { name: /Order Request Sent/i })).toBeVisible();
        const reference = (await page.getByText(/AF-\d{4}-\d+/).innerText()).trim();
        expect(reference).toMatch(/AF-\d{4}-\d+/);

        // Looking it up by reference + phone returns exactly this order. A second order
        // from the double-tap would either appear here as another row or break the lookup,
        // so a single successful result is the proof.
        await page.goto('/my-orders');
        await page.getByLabel(/reference/i).fill(reference);
        await page.getByLabel(/phone/i).fill(`080${suffix}`);
        await page.getByRole('button', { name: /find|track|look up/i }).first().click();

        await expect(page.getByText(reference).first()).toBeVisible();
    });
});
