import type { MetadataRoute } from 'next';

const siteUrl = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: `${siteUrl}/`, changeFrequency: 'weekly', priority: 1 },
        { url: `${siteUrl}/order`, changeFrequency: 'monthly', priority: 0.9 },
        { url: `${siteUrl}/our-fish`, changeFrequency: 'weekly', priority: 0.8 },
        { url: `${siteUrl}/about`, changeFrequency: 'monthly', priority: 0.6 },
        { url: `${siteUrl}/contact`, changeFrequency: 'monthly', priority: 0.7 },
        { url: `${siteUrl}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
        { url: `${siteUrl}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    ];
}
