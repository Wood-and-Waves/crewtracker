// Single source of truth for org-member roles and the permission matrix.
// Plain module (no 'use client') so it is safe to import from client
// components — see CLAUDE.md "Past incidents" on the client/server export rule.

export type Role = 'admin' | 'staff' | 'pm'

export type PermissionKey =
  | 'can_manage_users'
  | 'can_manage_billing'
  | 'can_manage_crew_directory'
  | 'can_import_crew'
  | 'can_view_crew_contacts'
  | 'can_create_shows'
  | 'can_edit_all_shows'
  | 'can_archive_shows'
  | 'can_duplicate_shows'
  | 'can_edit_timecards'
  | 'can_approve_timecards'
  | 'can_view_pay_rates'
  | 'can_edit_pay_rates'
  | 'can_manage_rulesets'
  | 'can_view_reports'
  | 'can_export_reports'
  | 'can_send_reports'
  | 'view_only'

export type PermissionValues = Record<PermissionKey, boolean>

export const ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'staff', label: 'Staff' },
  { value: 'pm', label: 'PM' },
]

// The 14 permissions shown as toggles, in display order, plain-English labels.
export const VISIBLE_PERMISSIONS: { key: PermissionKey; label: string }[] = [
  { key: 'can_manage_users', label: 'Manage users' },
  { key: 'can_manage_billing', label: 'Manage billing' },
  { key: 'can_manage_crew_directory', label: 'Manage crew directory' },
  { key: 'can_import_crew', label: 'Import crew' },
  { key: 'can_create_shows', label: 'Create shows' },
  { key: 'can_edit_all_shows', label: 'Edit all shows' },
  { key: 'can_archive_shows', label: 'Archive shows' },
  { key: 'can_edit_timecards', label: 'Edit timecards' },
  { key: 'can_view_pay_rates', label: 'View pay rates' },
  { key: 'can_edit_pay_rates', label: 'Edit pay rates' },
  { key: 'can_manage_rulesets', label: 'Manage rulesets' },
  { key: 'can_view_reports', label: 'View reports' },
  { key: 'can_export_reports', label: 'Export reports' },
  { key: 'can_send_reports', label: 'Send reports' },
]

// Set by presets but never shown as toggles (3 unused + view_only which is
// inert-but-dangerous-to-expose until the next spec enforces it).
export const HIDDEN_PERMISSION_KEYS: PermissionKey[] = [
  'view_only',
  'can_approve_timecards',
  'can_view_crew_contacts',
  'can_duplicate_shows',
]

// Exact preset matrix from the design spec. admin = full access.
export const PERMISSION_PRESETS: Record<Role, PermissionValues> = {
  admin: {
    can_manage_users: true,
    can_manage_billing: true,
    can_manage_crew_directory: true,
    can_import_crew: true,
    can_view_crew_contacts: true,
    can_create_shows: true,
    can_edit_all_shows: true,
    can_archive_shows: true,
    can_duplicate_shows: true,
    can_edit_timecards: true,
    can_approve_timecards: true,
    can_view_pay_rates: true,
    can_edit_pay_rates: true,
    can_manage_rulesets: true,
    can_view_reports: true,
    can_export_reports: true,
    can_send_reports: true,
    view_only: false,
  },
  staff: {
    can_manage_users: false,
    can_manage_billing: false,
    can_manage_crew_directory: false,
    can_import_crew: false,
    can_view_crew_contacts: false,
    can_create_shows: false,
    can_edit_all_shows: false,
    can_archive_shows: false,
    can_duplicate_shows: false,
    can_edit_timecards: true,
    can_approve_timecards: false,
    can_view_pay_rates: false,
    can_edit_pay_rates: false,
    can_manage_rulesets: false,
    can_view_reports: true,
    can_export_reports: false,
    can_send_reports: false,
    view_only: false,
  },
  pm: {
    can_manage_users: false,
    can_manage_billing: false,
    can_manage_crew_directory: true,
    can_import_crew: false,
    can_view_crew_contacts: true,
    can_create_shows: true,
    can_edit_all_shows: false,
    can_archive_shows: false,
    can_duplicate_shows: false,
    can_edit_timecards: true,
    can_approve_timecards: true,
    can_view_pay_rates: true,
    can_edit_pay_rates: false,
    can_manage_rulesets: false,
    can_view_reports: true,
    can_export_reports: true,
    can_send_reports: true,
    view_only: false,
  },
}

export function presetFor(role: Role): PermissionValues {
  return { ...PERMISSION_PRESETS[role] }
}
