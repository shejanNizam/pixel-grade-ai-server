/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/app/utils/seed*.ts",
  ],
  coverageReporters: ["text", "lcov"],
  setupFiles: ["<rootDir>/src/__tests__/setup.ts"],
};

module.exports = config;
