-- Migration 009: members geo-location -- per-member coordinates for outreach mapping.
--
-- Adds optional latitude/longitude and a free-text neighbourhood to public.members
-- so the directory can be plotted and clustered for outreach planning (the
-- /members/geo-cluster endpoint). Members previously carried only a structured
-- postal address; households held the only coordinates. These columns let an
-- individual member be mapped directly, independent of any household.
--
-- Bounds match public.households.geo_lat/geo_lng so a bad geocode can't store
-- nonsense. `neighbourhood` is the clustering key (a human area name); the
-- endpoint falls back to `city` when it is null. RLS already protects members, and
-- new columns inherit the existing church-scoped select policy -- nothing to add.

alter table public.members
  add column geo_lat       numeric(9, 6) check (geo_lat is null or geo_lat between -90 and 90),
  add column geo_lng       numeric(9, 6) check (geo_lng is null or geo_lng between -180 and 180),
  add column neighbourhood text;

-- Access pattern: group/scan a church's members by neighbourhood for mapping.
create index members_church_neighbourhood_idx on public.members (church_id, neighbourhood);
