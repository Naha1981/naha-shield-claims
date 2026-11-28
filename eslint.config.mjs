import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

// ClaimTrace lint: bug-focused rules over the TS/TSX source, plus the
// Firestore rules security plugin. Style/formatting stays out of scope.
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'db/**',
      'public/**',
      'staging-synthetic/**',
      'load/**',
      'scripts/**',
      'eslint.candidate.mjs',
    ],
  },
  {
    files: [
      'src/**/*.{ts,tsx}',
      'server/**/*.ts',
      'tests/**/*.ts',
      'vite.config.ts',
      'server.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
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
      eqeqeq: 'warn',
      'prefer-const': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
