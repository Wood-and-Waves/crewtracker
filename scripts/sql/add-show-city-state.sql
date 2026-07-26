-- Show city & state, e.g. "Chicago, IL".
--
-- iOS has Show.cityState and shows it on the shows list; the web port dropped
-- it, leaving `venue` as the only location field. This was the last remaining
-- schema difference from the iOS model.
--
-- Nullable, no default — existing shows simply have no value.

alter table shows
  add column if not exists city_state text;
