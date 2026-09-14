const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'api:integration',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
    // `pdfjs-dist`'s Node ("legacy") build, used by `renderPdfCover`
    // (`@scriptorium/providers`), ships as real ESM with no CJS fallback.
    // See `packages/providers/jest.config.cts` for the full rationale.
    '^.+\\.mjs$': ['@swc/jest', swcJestConfig],
  },
  transformIgnorePatterns: ['node_modules/(?!.*pdfjs-dist)'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  testMatch: ['<rootDir>/src/**/*.integration-spec.ts'],
  coverageDirectory: 'test-output/jest/coverage-integration',
};
