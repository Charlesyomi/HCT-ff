import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * On-demand revalidation hook (SPEC §8).
 *
 * The API calls this after an admin changes availability, a harvest window or a site
 * setting, so the public pages stop serving a stale catalog immediately instead of waiting
 * out their 60s window. The public pages also revalidate on a timer, which is the backstop
 * when this hook is unreachable or unset.
 *
 * Security: guarded by a shared secret. Without it the endpoint is disabled outright rather
 * than left open, because anyone who can reach it can force a rebuild of every cached page.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret) {
        return NextResponse.json(
            { revalidated: false, reason: 'REVALIDATE_SECRET is not configured.' },
            { status: 503 },
        );
    }

    const provided = request.headers.get('x-revalidate-secret');
    if (!provided || provided !== secret) {
        return NextResponse.json({ revalidated: false, reason: 'Invalid secret.' }, { status: 401 });
    }

    let reason = 'unknown';
    try {
        const body: unknown = await request.json();
        if (body && typeof body === 'object' && 'reason' in body) {
            reason = String((body as { reason: unknown }).reason);
        }
    } catch {
        // A body is optional; the secret check above is what actually authorises this.
    }

    revalidateTag('catalog');

    return NextResponse.json({ revalidated: true, reason, tag: 'catalog' });
}
