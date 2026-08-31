import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Apps are composition roots: they may consume libs but never
            // another app.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            // The browser client is deliberately starved: the only server
            // code it may see is the shared wire contract.
            {
              sourceTag: 'scope:client',
              onlyDependOnLibsWithTags: ['scope:contracts'],
            },
            // contracts is the leaf of the graph - pure types/schemas, no
            // internal imports at all.
            {
              sourceTag: 'scope:contracts',
              onlyDependOnLibsWithTags: [],
            },
            // Provider adapters talk to external APIs only; persistence is
            // owned by the layers above them.
            {
              sourceTag: 'scope:providers',
              notDependOnLibsWithTags: ['scope:database'],
            },
            // Everything else may depend on any workspace project.
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
