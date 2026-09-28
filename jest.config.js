/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  // Wall-clock tests are skewed by parallel suites; they run on their own via
  // jest.perf.config.js (`npm run test:perf`).
  testPathIgnorePatterns: ["/node_modules/", "/tests/perf/"],
  moduleNameMapper: {
    // Mock obsidian since it's not available in test environment
    "^obsidian$": "<rootDir>/tests/__mocks__/obsidian.ts",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
};
