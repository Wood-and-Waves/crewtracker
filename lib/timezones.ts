// The timezones a show can take place in.
//
// Plain module (no 'use client') so both client components and Server
// Components can import it — see CLAUDE.md "Past incidents" on the
// client/server export rule.
//
// One list, because New Show and Edit Show had drifted: New Show offered four
// zones and Edit Show six, so an Alaska or Hawaii show could not be created —
// you had to create it as Central and immediately correct it.
//
// Note on Honolulu: iOS uses `America/Honolulu`, this app uses the canonical
// IANA name `Pacific/Honolulu`. They are aliases for the same zone, so nothing
// miscomputes, but the stored strings differ between the two apps.

export type ShowTimezone = { value: string; label: string }

export const SHOW_TIMEZONES: readonly ShowTimezone[] = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HIT)' },
]

export const DEFAULT_SHOW_TIMEZONE = 'America/Chicago'
