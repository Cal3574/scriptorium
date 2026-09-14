const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // `@napi-rs/canvas` (used by `renderPdfCover`, `@scriptorium/providers` -
  // pulled in transitively here since this app imports other things from
  // that package) is a native N-API package: its own `js-binding.js`
  // conditionally `require`s one of ~20 per-platform sub-packages and, for
  // whichever one happens to be installed on the machine actually running
  // the build, a real `.node` binary. This build bundles npm packages
  // directly (no default `externalDependencies`), and unlike the harmless
  // "can't resolve" warning for the platform packages that are *not*
  // installed, webpack tries to parse that installed binary as JS and fails
  // outright. Marking the package external - `mergeExternals: true` below is
  // what stops `NxAppWebpackPlugin` discarding this in favour of its own
  // default (empty) externals - makes it a plain runtime `require(...)`
  // instead, resolved against the deployed image's own `node_modules`
  // (populated for the correct platform by
  // `pnpm --filter=@scriptorium/api --prod deploy`, see `docker/api.Dockerfile`).
  externals: [{ '@napi-rs/canvas': 'commonjs @napi-rs/canvas' }],
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
      mergeExternals: true,
    }),
  ],
};
