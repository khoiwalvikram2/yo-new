import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      react,
    },
  },
  {
    files: [
      'src/routes/payments/**/*.{ts,tsx}',
      'src/routes/players/profile/**/*.{ts,tsx}',
      'src/routes/players/**/*.{ts,tsx}',
    ],
    plugins: {
      react,
    },
    rules: {
      'react/forbid-dom-props': ['error', { forbid: ['style'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'Use scoped CSS modules and approved tokens instead of inline styles.',
        },
      ],
    },
  },
])
