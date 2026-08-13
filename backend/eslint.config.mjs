// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // jest.fn()-based mocks trip these rules with false positives: an
    // untyped jest.fn() property in a mock object literal makes
    // toHaveBeenCalledWith(...)'s argument position `any`, and
    // expect.objectContaining()'s return type is itself `any` — neither
    // reflects an actual type-safety issue in test code. unbound-method
    // similarly can't see through jest.Mocked<T>. supertest's
    // `res.body` is genuinely `any` (no response-shape generics), which
    // is exactly what e2e specs need to inspect. Standard exemption for
    // specs; production code still enforces all of these. `*spec.ts`
    // (no leading dot) matches both `*.spec.ts` and `*.e2e-spec.ts`.
    files: ['**/*spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
