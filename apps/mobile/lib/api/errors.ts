export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly fields: Record<string, string[]> = {},
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export function apiError(status: number, body: unknown): ApiError {
    if (typeof body === "object" && body !== null && "error" in body) {
        const error = body.error;
        if (typeof error === "object" && error !== null && "message" in error) {
            const message = error.message;
            const fields: Record<string, string[]> = {};
            if ("fields" in error && typeof error.fields === "object" && error.fields !== null) {
                for (const [field, value] of Object.entries(error.fields)) {
                    if (typeof value === "string") fields[field] = [value];
                    else if (Array.isArray(value)) fields[field] = value.filter((item): item is string => typeof item === "string");
                }
            }
            if (typeof message === "string") return new ApiError(message, status, fields);
        }
    }
    return new ApiError("The request could not be completed. Please try again.", status);
}

export function throwIfError(status: number, body: unknown): void {
    if (status >= 400) throw apiError(status, body);
}