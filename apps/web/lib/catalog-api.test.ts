// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { unstable_noStore } from 'next/cache';
import { formatHarvestDate, formatPriceUpdatedAt, getCatalog } from './catalog-api';

vi.mock('next/cache', () => ({
    unstable_cache: (callback: (apiUrl: string) => Promise<unknown>) => callback,
    unstable_noStore: vi.fn(),
}));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(unstable_noStore).mockClear();
});

describe('getCatalog', () => {
    it('does not cache a failed upstream fetch', async () => {
        vi.stubEnv('API_URL', 'https://api.example.test');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

        await expect(getCatalog()).resolves.toBeNull();
        expect(unstable_noStore).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/v1/catalog',
            expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
        );
    });

    it('formats catalog dates in Africa/Lagos short-date form', () => {
        expect(formatHarvestDate('2026-10-06')).toBe('Oct 6');
        expect(formatHarvestDate('2026-10-15')).toBe('Oct 15');
        expect(formatPriceUpdatedAt('2026-10-04T09:30:00+00:00')).toBe('4 Oct');
    });
});
