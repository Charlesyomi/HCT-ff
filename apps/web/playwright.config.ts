import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (Milestone 7, SPEC §11).
 *
 * These run against a real stack: the Next app on :3000 and the FastAPI API behind it.
 * The admin spec additionally needs a seeded admin account and an order to act on, so it is
 * skipped unless `ADMIN_EMAIL` / `ADMIN_PASSWORD` are exported.
 *
 * Local run:
 *   cd apps/api && python -m uvicorn app.main:app --port 8000     # with DATABASE_URL set
 *   node scripts/python-tool.mjs seed
 *   npm run e2e --workspace apps/web
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

export default defineConfig({
    testDir: './e2e',
    // A retried flaky run is worse than a reported failure for an order pipeline.
    retries: 0,
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? [['github'], ['list']] : [['list']],
    timeout: 45_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },

    projects: [
        { name: 'mobile', use: { ...devices['Pixel 7'] } },
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        {
            // The admin flow is one screen at a time and slow; desktop only.
            name: 'admin',
            testMatch: /admin\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    webServer: {
        // PORT lets a second instance run alongside a dev server on :3000.
        command: 'npm run start',
        url: `${process.env.E2E_BASE_URL ?? 'http://localhost:3000'}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { PORT: process.env.E2E_PORT ?? '3000' },
    },
});
