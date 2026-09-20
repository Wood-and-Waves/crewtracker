import { formatPhone } from '@/lib/phone'

// Who to ring, on the crew's own screen.
//
// Dan, 2026-09-20: "What if we added a PM contact information on the
// individual time card. That could be helpful. Mobile tapable." Somebody
// looking at a punch that will not take, or standing at the wrong dock, had no
// way from this screen to reach anybody at all.
//
// TAPPING IS THE WHOLE POINT, so it is two real targets — `tel:` and `sms:` —
// sized for a thumb, not a phone number printed as text that has to be copied
// out by hand. Both are plain links: no JavaScript, so they work on the
// server-rendered page before anything hydrates, which matters on venue wifi.
//
// The number is stripped to digits for the href and shown formatted, because
// `tel:(214) 555-0148` is not reliably dialled by every handset while
// `tel:2145550148` is.
//
// Rendered only when a phone exists — see onsiteContact() in lib/clockSession.

export default function OnsiteContact({ name, phone }: { name: string; phone: string }) {
  const dial = phone.replace(/[^\d+]/g, '')
  const action = 'flex-1 border-2 border-ink px-3 py-3 text-center font-display text-[13px] font-bold uppercase tracking-wider text-ink'

  return (
    <section className="px-4 pb-2 pt-4">
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
        Questions on site
      </p>
      <p className="mt-0.5 text-base font-semibold text-ink">{name}</p>
      <p className="font-mono text-sm text-muted tabular-nums">{formatPhone(phone)}</p>
      <div className="mt-2 flex gap-2">
        <a href={`tel:${dial}`} className={action}>Call</a>
        <a href={`sms:${dial}`} className={action}>Text</a>
      </div>
    </section>
  )
}
