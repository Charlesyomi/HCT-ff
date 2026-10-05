import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { CartProvider } from '@/components/cart/cart-provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
    title: 'Adesoba Catfish Farm',
    description: 'Fresh catfish direct from the farm in Nigeria.',
    metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
    openGraph: {
        type: 'website',
        siteName: 'Adesoba Catfish Farm',
        title: 'Adesoba Catfish Farm',
        description: 'Fresh catfish direct from the farm in Nigeria.',
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className={`${inter.variable} ${plusJakarta.variable} font-sans text-[color:var(--text)] antialiased`}>
                <CartProvider>{children}</CartProvider>
            </body>
        </html>
    );
}
