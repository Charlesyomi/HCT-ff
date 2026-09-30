import Link from 'next/link';

export default function NotFound() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4">
            <div className="max-w-md rounded-3xl border border-[#dfeae3] bg-white p-8 text-center shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">404</p>
                <h1 className="mt-3 font-display text-3xl font-bold text-[color:var(--text)]">Page not found</h1>
                <p className="mt-3 text-[#536e64]">The page you are looking for could not be found.</p>
                <Link href="/" className="mt-6 inline-flex rounded-full bg-[color:var(--brand-700)] px-5 py-3 font-semibold text-white">
                    Back to home
                </Link>
            </div>
        </main>
    );
}
