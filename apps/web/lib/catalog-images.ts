const FISH_IMAGES: Record<string, string> = {
    clarias: "/images/hct/clarias.jpg",
    hybrid: "/images/hct/hybrid.jpg",
};

const SIZE_IMAGES: Record<string, string> = {
    "1-1-5kg": "/images/hct/size-smoking-bbq.jpg",
    "1-5-2kg": "/images/hct/size-medium.jpg",
    "2-3kg": "/images/hct/size-table.jpg",
    "3kg-plus": "/images/hct/size-large.jpg",
};

function placeholderFallbackPath(currentPath: string, replacement: string): string {
    return currentPath.includes("placeholder") ? replacement : currentPath;
}

export function fishImagePath(slug: string, currentPath: string): string {
    return placeholderFallbackPath(currentPath, FISH_IMAGES[slug] ?? "/images/hct/catalog-fish.jpg");
}

export function sizeImagePath(slug: string, currentPath: string): string {
    return placeholderFallbackPath(currentPath, SIZE_IMAGES[slug] ?? "/images/hct/catalog-fish.jpg");
}