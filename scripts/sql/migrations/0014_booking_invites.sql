-- Asking crew to confirm a booking, by emailed link, with no login.
--
-- WHY A TABLE AND NOT JUST A COLUMN
-- ---------------------------------
-- booking_status already lives on each timecard, per day. The ASK is a
-- different shape: it is one conversation with one person about one show. An
-- eight-day show would otherwise mean eight links in one email.
--
-- So the token is per (crew member, show) while the status stays per timecard.
-- That split is deliberate and it is what makes partial-show requests possible
-- later without a migration — "I can do Monday and Friday" becomes checkboxes
-- writing per-timecard status against the same invite.
--
-- TODAY A DECLINE IS FOR THE WHOLE SHOW. Dan: "A decline is for the entire
-- show. They would need to work everything." The response therefore applies to
-- every timecard that invite covers.

create table if not exists public.booking_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  crew_member_id uuid not null references public.crew_members(id) on delete cascade,
  -- Denormalized and filled by the trigger below, mirroring
  -- set_show_assignment_organization_id(). Every policy can then be
  -- self-contained (organization_id = my_organization_id()) and never reference
  -- shows. The RLS recursion incident showed Postgres's guard is structural and
  -- cannot be indirected away with a function, so the fix is to not need the
  -- reference at all.
  organization_id uuid not null references public.organizations(id),
  email text,
  sent_by uuid references public.profiles(id),
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  response text check (response in ('confirmed', 'declined')),
  note text,
  created_at timestamptz not null default now(),
  -- One live conversation per person per show. Re-sending rotates the token on
  -- this row rather than making a second one, which kills the old link.
  unique (show_id, crew_member_id)
);

create index if not exists booking_invites_show_id_idx on public.booking_invites (show_id);
create index if not exists booking_invites_crew_member_idx on public.booking_invites (crew_member_id);

create or replace function public.set_booking_invite_organization_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select s.organization_id into new.organization_id
  from shows s where s.id = new.show_id;
  return new;
end;
$$;

create trigger set_booking_invite_org
  before insert on public.booking_invites
  for each row execute function public.set_booking_invite_organization_id();

alter table public.booking_invites enable row level security;

-- All four policies in the same migration as the table. rls_auto_enable
-- force-enables RLS on every new table, so a table with no policies is one
-- nobody can read — a silent, total failure. show_assignments shipped
-- SELECT-only and had to be retrofitted; not repeating it.
--
-- Note the public response page does NOT read through these: it uses the
-- service role, with the unguessable token as the authorization. These policies
-- govern the staff side only.
create policy "Members see booking invites in their org"
  on public.booking_invites for select
  using (organization_id = my_organization_id());

create policy "Timecard editors create booking invites"
  on public.booking_invites for insert
  with check (organization_id = my_organization_id() and my_perm('can_edit_timecards'));

create policy "Timecard editors update booking invites"
  on public.booking_invites for update
  using (organization_id = my_organization_id() and my_perm('can_edit_timecards'));

create policy "Timecard editors delete booking invites"
  on public.booking_invites for delete
  using (organization_id = my_organization_id() and my_perm('can_edit_timecards'));

grant select, insert, update, delete on public.booking_invites to authenticated;
