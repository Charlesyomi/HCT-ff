/** @type {import('next').NextConfig} */
const apiUrl = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

const nextConfig = {
    reactStrictMode: true,
    // Emit a minimal server bundle with only the runtime deps, so the container image
    // does not need the full node_modules tree or the build toolchain (Milestone 8).
    output: 'standalone',
    experimental: {
        typedRoutes: true,
    },
    // Addendum §A4: the browser calls /api/v1/* on the web origin and Next proxies it to the
    // API, so the Google session cookie is same-origin and needs no third-party cookie rules.
    async rewrites() {
        return [
            { source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` },
            { source: '/health', destination: `${apiUrl}/health` },
            { source: '/ready', destination: `${apiUrl}/ready` },
        ];
    },
};

export default nextConfig;
