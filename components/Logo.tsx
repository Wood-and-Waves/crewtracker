// PLACEHOLDER — not the real CrewTracker logo. Drop the real mark in here
// (as an inline SVG, or swap this whole file for an <img src="/logo.svg" />)
// and every screen that renders <Logo /> updates automatically.
export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M36 13H20l-7 7v8l7 7h16" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter" />
      <path d="M36 13l-5 6M36 42l-5-6" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}
