import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

/**
 * eslint-config-next 15.3.4 still ships legacy eslintrc-style configs
 * (`module.exports = { extends: [...] }`) and has no package `exports` map, so
 * its configs cannot be imported directly into a flat config — the shape is an
 * object, not the array a flat config spreads. FlatCompat is the supported
 * bridge, and is what create-next-app generates for this Next version.
 *
 * Revisit when eslint-config-next is upgraded to 15.5+, which ships native flat
 * configs and allows importing `eslint-config-next/core-web-vitals` directly.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'node_modules/**',
      'prisma/migrations/**',
    ],
  },
]

export default eslintConfig
