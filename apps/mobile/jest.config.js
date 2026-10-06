module.exports = {
    preset: "jest-expo",
    testMatch: ["**/*.test.ts", "**/*.test.tsx"],
    clearMocks: true,
    setupFiles: ["<rootDir>/jest.setup.js"],
};