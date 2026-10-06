const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  { ignores: ["lib/api/schema.d.ts", "node_modules/**", ".expo/**"] },
]);