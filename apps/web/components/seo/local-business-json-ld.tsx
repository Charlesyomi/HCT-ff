type LocalBusinessJsonLdProps = {
    phone: string;
    address: string;
    hours: string[];
};

export function LocalBusinessJsonLd({ phone, address, hours }: LocalBusinessJsonLdProps) {
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'Adesoba Catfish Farm',
        description: 'Fresh catfish direct from the farm in Nigeria.',
        telephone: phone,
        address: {
            '@type': 'PostalAddress',
            streetAddress: address,
            addressCountry: 'NG',
        },
        openingHours: hours,
        image: '/images/farm-pond-placeholder.svg',
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
        />
    );
}
