import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**']
  },
  {
    // Extension source: ES modules throughout (service worker is type: module,
    // side panel is <script type="module">).
    files: ['*.js', 'lib/**/*.js', 'ui/**/*.js', 'storage/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker, ...globals.webextensions }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  }
]
