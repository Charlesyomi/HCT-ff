import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Admin | Adesoba Catfish Farm',
    robots: { index: false, follow: false },
};

export default function AdminPage() {
    return (
        <main className="mx-auto max-w-5xl p-8">
            <h1 className="font-display text-3xl font-bold text-[color:var(--text)]">Admin dashboard</h1>
            <p className="mt-4 text-[#586d66]">Foundation shell for the operational dashboard.</p>
        </main>
    );
}
