import type { ImageSourcePropType } from "react-native";
import { imageUrl } from "./config";

const SIZE_IMAGES: Record<string, ImageSourcePropType> = {
    "1-1-5kg": require("../assets/catalog/size-smoking-bbq.jpg"),
    "1-5-2kg": require("../assets/catalog/size-medium.jpg"),
    "2-3kg": require("../assets/catalog/size-table.jpg"),
    "3kg-plus": require("../assets/catalog/size-large.jpg"),
};

export function catalogImageSource(sizeSlug: string, currentPath: string): ImageSourcePropType {
    if (currentPath.includes("placeholder") && SIZE_IMAGES[sizeSlug]) return SIZE_IMAGES[sizeSlug];
    return { uri: imageUrl(currentPath) };
}