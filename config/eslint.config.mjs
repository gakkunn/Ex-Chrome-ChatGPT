import { fileURLToPath } from 'node:url';

import eslint from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

const tsconfigRootDir = fileURLToPath(new URL('..', import.meta.url));

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir,
        projectService: true,
      },
    },
    plugins: {
      import: pluginImport,
    },
    settings: {
      'import/internal-regex': '^@/',
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
        node: {
          extensions: ['.ts', '.tsx', '.js'],
        },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'import/order': [
        'warn',
        {
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
        },
      ],
      'import/no-unresolved': [
        'error',
        {
          ignore: ['^@/', '^chrome$'],
        },
      ],
      'prettier/prettier': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'vite.config.ts'],
  }
);
