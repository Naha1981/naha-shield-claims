import tsParser from '@typescript-eslint/parser';
export default [
  { ignores: ['dist/**', 'node_modules/**', 'db/**', 'public/**', 'staging-synthetic/**', 'load/**', 'scripts/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'tests/**/*.ts', 'vite.config.ts', 'server.ts'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      'no-redeclare': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-debugger': 'error',
      'no-var': 'error',
      'no-duplicate-imports': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'prefer-const': 'warn',
      'eqeqeq': 'warn',
    },
  },
];
