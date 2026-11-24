import type { Font } from '@react-pdf/renderer'

/**
 * Settings every PDF shares. react-pdf keeps them process-wide, so they live
 * here and every document applies them — set inside one document, they would
 * change the others depending on which happened to load first.
 *
 * Takes react-pdf's Font rather than importing it: lib/report-pdf.ts loads
 * the ESM-only renderer with import() so the worker (CommonJS under tsx) can
 * use it, and a static import here would break that.
 *
 * No hyphenation: react-pdf breaks words to fill lines by default, which
 * split "Kitchen-ERP", branch names and material names. A word moves to the
 * next line whole instead.
 */
export function applyPdfDefaults(font: typeof Font): void {
  font.registerHyphenationCallback(word => [word])
}
