type LocalBusinessJsonLdProps = {
    phone: string;
    address: string;
    hours: string[];
};

export function LocalBusinessJsonLd({ phone, address, hours }: LocalBusinessJsonLdProps) {
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'HCT Fish Farms',
        description: 'Fresh catfish from HCT Fish Farms in Nigeria.',
        telephone: phone,
        address: {
            '@type': 'PostalAddress',
            streetAddress: address,
            addressCountry: 'NG',
        },
        openingHours: hours,
        image: '/images/hct/farm-pond.jpg',
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
        />
    );
}
