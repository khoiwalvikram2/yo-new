import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
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
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Warn about inline styles - prefer Tailwind classes or CSS utilities
      // Allowed exceptions (use eslint-disable-next-line):
      // - CSS variables: style={{ '--vip-tier-color': color } as React.CSSProperties}
      // - Dynamic runtime values: width, height, transform, gridTemplateColumns
      // - Safe-area padding: paddingBottom: 'calc(env(safe-area-inset-bottom) + ...)'
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'JSXAttribute[name.name="style"]',
          message: 'Avoid inline styles. Use Tailwind classes or CSS utilities instead. For exceptions (CSS variables, dynamic values, safe-area), add: // eslint-disable-next-line no-restricted-syntax',
        },
      ],
    },
  },
])
