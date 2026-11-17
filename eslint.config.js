import js from '@eslint/js';
import globals from 'globals';

/** Lint rules: catch real mistakes (undefined names, unused code), leave formatting to Prettier. */
export default [
  { ignores: ['src/vendor/**'] }, // libraries copied as they are (src/vendor/README.md)
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/unit/**/*.js', 'build/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-var': 'error',
      'one-var': ['error', 'never'], // one declaration per statement: easier to read, diff and debug
      curly: ['error', 'all'],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off', // control characters are stripped from user text on purpose
      'preserve-caught-error': 'off',
    },
  },
];
