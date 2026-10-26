import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['release/**', '.data/**', '**/dist/**', '**/out/**', '**/release/**', 'node_modules/**', 'backend/**', 'frontend/**', 'src/**', 'main.js', 'models/**', '**/fontData.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
