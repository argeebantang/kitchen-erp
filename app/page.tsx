import { redirect } from 'next/navigation'

/**
 * The bare address. The app starts at the dashboard — this was still the
 * create-next-app template, which a signed-in user (or a sign-in that
 * returned to "/", Week 12) landed on. The middleware sends a signed-out
 * visitor to /login first.
 */
export default function Home() {
  redirect('/dashboard')
}
