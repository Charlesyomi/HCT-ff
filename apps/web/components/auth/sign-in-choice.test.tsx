// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SignInChoice } from './sign-in-choice';

const assign = vi.fn();

function mockAuthMe(response: Response | null) {
    vi.mocked(fetch).mockImplementation(() =>
        response ? Promise.resolve(response) : Promise.reject(new Error('offline')),
    );
}

describe('SignInChoice (Addendum §A4)', () => {
    beforeEach(() => {
        assign.mockReset();
        vi.stubGlobal('fetch', vi.fn());
        vi.stubGlobal('location', { assign });
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('offers two equal options and never blocks phone checkout', async () => {
        mockAuthMe(null);
        render(<SignInChoice next="/checkout" account={null} onAccountChange={() => {}} />);

        expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeDisabled();
        expect(screen.getByText('Continue with phone number')).toBeInTheDocument();
        // Sign-in is optional: a failing probe leaves the guest path untouched.
        expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    });

    it('shows the signed-in account and can sign out', async () => {
        const onAccountChange = vi.fn();
        mockAuthMe({ ok: true, json: async () => ({ email: 'ada@example.com', name: 'Ada Okafor' }) } as Response);
        render(<SignInChoice next="/checkout" account={{ email: 'ada@example.com', name: 'Ada Okafor' }} onAccountChange={onAccountChange} />);

        expect(screen.getByText('Ada Okafor')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument());
    });
});
