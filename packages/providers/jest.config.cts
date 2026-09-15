const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  passWithNoTests: true,
  displayName: 'providers',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
    // `pdfjs-dist`'s Node ("legacy") build ships as real ESM (`import.meta`,
    // top-level `import`/`export`) with no CJS fallback. Jest's default
    // `transformIgnorePatterns` skips all of `node_modules`, so without this
    // it reaches Jest's CJS loader untransformed and fails on `import.meta`
    // outside a module. Running it through the same swc transform as our own
    // source (rather than mocking it away, as the client does for jsdom)
    // lets `render-pdf-cover.spec.ts` exercise the real render path.
    '^.+\\.mjs$': ['@swc/jest', swcJestConfig],
  },
  transformIgnorePatterns: ['node_modules/(?!.*pdfjs-dist)'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
