import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Sign-in entry points must be full-page navigations.
 *
 * Regression guard: a Next `<Link>` prefetches its href as an RSC request. For
 * /api/v1/auth/google/start that follows the 307 to accounts.google.com, fails CORS in the
 * console, and mints a fresh sign-in state cookie on every prefetch. The DOM cannot tell a
 * prefetching Link from a plain anchor, so this checks the source instead.
 */
const AUTH_ENTRY_POINTS = [
    'components/layout/account-nav.tsx',
    'components/auth/sign-in-choice.tsx',
] as const;

function read(file: string): string {
    return readFileSync(join(process.cwd(), file), 'utf8');
}

describe('Google sign-in entry points', () => {
    it.each(AUTH_ENTRY_POINTS)('%s never renders an /api/v1/auth href through next/link', (file) => {
        const source = read(file);

        // Any href to the auth API must not sit inside a Next Link element.
        expect(source).not.toMatch(/<Link[\s\S]{0,400}?\/api\/v1\/auth/);
        expect(source).not.toMatch(/from 'next\/link'/);
    });

    it('the header Sign in control is a plain anchor with a full-page href', () => {
        const source = read('components/layout/account-nav.tsx');

        expect(source).toMatch(/<a href="\/api\/v1\/auth\/google\/start\?next=/);
        expect(source).not.toMatch(/next\/link/);
    });
    it('the checkout "Continue with Google" control navigates with window.location', () => {
        const source = read('components/auth/sign-in-choice.tsx');

        expect(source).toMatch(/window\.location\.assign\(`\/api\/v1\/auth\/google\/start/);
        expect(source).not.toMatch(/next\/link/);
    });
});