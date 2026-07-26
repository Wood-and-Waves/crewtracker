// Normalize crew phone numbers to a single display format. Idempotent, so it's
// safe to call on already-formatted values (display + on-save both use it).
// US 10-digit → "(XXX) XXX-XXXX"; 11-digit leading 1 → same (country code
// dropped). Anything else (short codes, international) is returned trimmed
// and untouched so we never mangle a number we don't understand.
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  const ten =
    digits.length === 10 ? digits :
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) :
    null
  if (!ten) return raw.trim()
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}
