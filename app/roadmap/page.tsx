'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
// The 12-week plan lives at the repo root as a standalone .jsx artifact and is
// intentionally not part of the app's module graph beyond this page.
//
// This page carries the 'use client' directive rather than the .jsx itself:
// everything imported from a client module joins the client bundle, so the
// boundary can be declared here and the plan file left untouched. That matters
// because it is a hand-maintained planning document, not app source.
import SprintPlan from '@/kitchenERP-sprint-v3'

/**
 * Rendered outside the (protected) route group on purpose. The plan component
 * paints its own full-viewport dark canvas (minHeight: 100vh), which would sit
 * awkwardly inside the light sidebar shell and its p-6 padding.
 *
 * It is still behind auth: middleware requires a valid token on every path that
 * isn't in PUBLIC_PATHS, and no ROLE_GUARDS entry matches /roadmap, so any
 * signed-in role can read it.
 */
export default function RoadmapPage() {
  return (
    <div style={{ position: 'relative' }}>
      <Link
        href="/dashboard"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 50,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          background: '#0D0F16',
          border: '1px solid #1C2030',
          color: '#8B93B0',
          fontSize: 12,
          fontFamily: "'DM Sans','Segoe UI',sans-serif",
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={13} /> Dashboard
      </Link>

      <SprintPlan />
    </div>
  )
}
