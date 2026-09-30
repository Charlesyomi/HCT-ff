import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
    theme: {
        extend: {
            colors: {
                brand: {
                    900: '#0B3D2A',
                    700: '#0F5F3E',
                    100: '#E8F3EC',
                },
                accent: {
                    400: '#F6B93B',
                },
                status: {
                    available: '#8CC63F',
                },
                whatsapp: '#1E8E4E',
                canvas: 'var(--surface)',
                'canvas-soft': 'var(--surface-soft)',
                'canvas-tint': 'var(--surface-tint)',
                line: 'var(--border)',
                'line-soft': 'var(--border-soft)',
                'line-strong': 'var(--border-strong)',
                'line-accent': 'var(--border-accent)',
                'header-glass': 'var(--header-glass)',
                ink: 'var(--text)',
                'ink-muted': 'var(--text-muted)',
                'ink-secondary': 'var(--text-secondary)',
                'ink-on-dark': 'var(--text-on-dark)',
                'ink-on-accent': 'var(--text-on-accent)',
                'ink-hero': 'var(--text-hero)',
                'ink-hero-bright': 'var(--text-hero-bright)',
                'status-error': 'var(--status-error)',
                'status-limited-bg': 'var(--availability-limited-bg)',
                'status-limited-text': 'var(--availability-limited-text)',
                'status-available-bg': 'var(--availability-available-bg)',
                'status-available-text': 'var(--availability-available-text)',
                'status-sold-out-bg': 'var(--availability-sold-out-bg)',
                'status-neutral-text': 'var(--availability-neutral-text)',
                'status-unavailable-border': 'var(--availability-unavailable-border)',
            },
            fontFamily: {
                sans: ['var(--font-sans)', 'sans-serif'],
                display: ['var(--font-display)', 'sans-serif'],
            },
        },
    },
    plugins: [],
};

export default config;
