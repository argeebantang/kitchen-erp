/**
 * Shared form primitives for the master-data and BOM panels. These lived in
 * MaterialsPanel and were imported by the other panels, which made a feature
 * component the de facto home of shared UI — moved here so the dependency runs
 * panel → ui rather than panel → panel.
 *
 * Deliberately NOT 'use client': nothing here has hooks or state, and server
 * pages and components/ui/states.tsx import the class strings. Through a
 * 'use client' module a server import gets a client-reference stub instead of
 * the string — EmptyState's button rendered `class="… function() { throw …"`.
 */

/*
 * bg-white / text-gray-900 are explicit on purpose. A form control that inherits
 * its colour from `body` renders invisible the moment anything changes the
 * inherited foreground — which is exactly how typed text turned white here.
 */
// text-base on a phone: iOS zooms the page into any input under 16px when it
// is tapped. From `sm` up it is text-sm as before.
export const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400'

export const primaryButtonClass =
  'rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50'

export const secondaryButtonClass =
  'rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50'

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}

export function IconButton({
  title, onClick, children, disabled = false,
}: { title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-wait disabled:opacity-50"
    >
      {children}
    </button>
  )
}
