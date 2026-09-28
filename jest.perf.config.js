/** Wall-clock tests only, run serially: `npm run test:perf`. */
const base = require("./jest.config");

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testMatch: ["**/tests/perf/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
};
