import { Meilisearch, type Index } from "meilisearch";
import type { FastifyBaseLogger } from "fastify";
import type { Database, SupabaseClient } from "@repo/db";
import { config } from "../config.js";

/**
 * Meilisearch wiring for the church directory: members, groups, and households.
 *
 * Each entity has its own shared, multi-tenant index keyed by `church_id` as a
 * filter attribute (every query filters by the caller's church) rather than an
 * index per church.
 *
 * Search is OPTIONAL infrastructure: when MEILI_HOST is unset the client is null,
 * all sync calls no-op, and the search routes return 503. The API boots and serves
 * everything else regardless. All sync is best-effort (logged, never thrown) —
 * Postgres is the source of truth; the indexes are derived, rebuildable caches
 * (rebuild with reindexAll / the `job:reindex` script).
 */

export const MEMBERS_INDEX = "members";
export const GROUPS_INDEX = "groups";
export const HOUSEHOLDS_INDEX = "households";

const REINDEX_PAGE = 1000;

// Documents -----------------------------------------------------------------

/** The light projection of a member that we index and return from search. */
export interface MemberSearchDocument {
  id: string;
  church_id: string;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state_region: string | null;
  country: string | null;
  status: string;
  created_at: string;
}

export interface GroupSearchDocument {
  id: string;
  church_id: string;
  name: string;
  description: string | null;
  group_type: string;
}

export interface HouseholdSearchDocument {
  id: string;
  church_id: string;
  name: string;
  address: string | null;
}

let cached: Meilisearch | null | undefined;

/** The Meili client, or null when search isn't configured (MEILI_HOST unset). */
export function getMeiliClient(): Meilisearch | null {
  if (cached !== undefined) return cached;
  const host = config.meili.host;
  cached = host ? new Meilisearch({ host, apiKey: config.meili.apiKey }) : null;
  return cached;
}

export function isMeiliConfigured(): boolean {
  return getMeiliClient() !== null;
}

function membersIndex(client: Meilisearch): Index<MemberSearchDocument> {
  return client.index<MemberSearchDocument>(MEMBERS_INDEX);
}
function groupsIndex(client: Meilisearch): Index<GroupSearchDocument> {
  return client.index<GroupSearchDocument>(GROUPS_INDEX);
}
function householdsIndex(client: Meilisearch): Index<HouseholdSearchDocument> {
  return client.index<HouseholdSearchDocument>(HOUSEHOLDS_INDEX);
}

/** Project a member-row-shaped value into its search document. */
export function toSearchDocument(m: MemberSearchDocument): MemberSearchDocument {
  return {
    id: m.id,
    church_id: m.church_id,
    first_name: m.first_name,
    last_name: m.last_name,
    preferred_name: m.preferred_name,
    email: m.email,
    phone: m.phone,
    city: m.city,
    state_region: m.state_region,
    country: m.country,
    status: m.status,
    created_at: m.created_at,
  };
}

export function toGroupDocument(g: GroupSearchDocument): GroupSearchDocument {
  return {
    id: g.id,
    church_id: g.church_id,
    name: g.name,
    description: g.description,
    group_type: g.group_type,
  };
}

export function toHouseholdDocument(h: HouseholdSearchDocument): HouseholdSearchDocument {
  return { id: h.id, church_id: h.church_id, name: h.name, address: h.address };
}

// Index setup ----------------------------------------------------------------

/** Create the index if absent and resolve once the create task settles. */
async function createIndexIfAbsent(client: Meilisearch, uid: string): Promise<void> {
  const created = await client.createIndex(uid, { primaryKey: "id" });
  await client.tasks.waitForTask(created.taskUid).catch(() => undefined);
}

/**
 * Create the members index if absent and (re)apply its settings. Idempotent; safe
 * on every boot. "All member fields" are searchable (name, contact, location);
 * typo tolerance (fuzzy matches like "Jon" -> "John") is Meili's default.
 */
export async function ensureMembersIndex(client: Meilisearch): Promise<void> {
  await createIndexIfAbsent(client, MEMBERS_INDEX);
  await membersIndex(client).updateSettings({
    searchableAttributes: [
      "first_name",
      "last_name",
      "preferred_name",
      "email",
      "phone",
      "city",
      "state_region",
      "country",
    ],
    filterableAttributes: ["church_id", "status"],
    sortableAttributes: ["created_at"],
    rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
  });
}

export async function ensureGroupsIndex(client: Meilisearch): Promise<void> {
  await createIndexIfAbsent(client, GROUPS_INDEX);
  await groupsIndex(client).updateSettings({
    searchableAttributes: ["name", "description"],
    filterableAttributes: ["church_id", "group_type"],
  });
}

export async function ensureHouseholdsIndex(client: Meilisearch): Promise<void> {
  await createIndexIfAbsent(client, HOUSEHOLDS_INDEX);
  await householdsIndex(client).updateSettings({
    searchableAttributes: ["name", "address"],
    filterableAttributes: ["church_id"],
  });
}

/** Ensure all three indexes exist with their settings. */
export async function ensureAllIndexes(client: Meilisearch): Promise<void> {
  await ensureMembersIndex(client);
  await ensureGroupsIndex(client);
  await ensureHouseholdsIndex(client);
}

// Sync (best-effort, no-op when unconfigured) --------------------------------

/** Upsert a member into the index. */
export async function syncMemberToIndex(
  doc: MemberSearchDocument,
  log: FastifyBaseLogger,
): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;
  try {
    await membersIndex(client).addDocuments([toSearchDocument(doc)]);
  } catch (err) {
    log.warn({ err, memberId: doc.id }, "meili index sync failed");
  }
}

/** Upsert many members into the index in one request. */
export async function syncMembersToIndex(
  docs: MemberSearchDocument[],
  log: FastifyBaseLogger,
): Promise<void> {
  const client = getMeiliClient();
  if (!client || docs.length === 0) return;
  try {
    await membersIndex(client).addDocuments(docs.map(toSearchDocument));
  } catch (err) {
    log.warn({ err, count: docs.length }, "meili batch index sync failed");
  }
}

/** Remove a member from the index, e.g. on soft-delete. */
export async function removeMemberFromIndex(id: string, log: FastifyBaseLogger): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;
  try {
    await membersIndex(client).deleteDocument(id);
  } catch (err) {
    log.warn({ err, memberId: id }, "meili index delete failed");
  }
}

/** Upsert a group into the index. */
export async function syncGroupToIndex(
  doc: GroupSearchDocument,
  log: FastifyBaseLogger,
): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;
  try {
    await groupsIndex(client).addDocuments([toGroupDocument(doc)]);
  } catch (err) {
    log.warn({ err, groupId: doc.id }, "meili group index sync failed");
  }
}

/** Remove a group from the index. */
export async function removeGroupFromIndex(id: string, log: FastifyBaseLogger): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;
  try {
    await groupsIndex(client).deleteDocument(id);
  } catch (err) {
    log.warn({ err, groupId: id }, "meili group index delete failed");
  }
}

/** Upsert a household into the index. */
export async function syncHouseholdToIndex(
  doc: HouseholdSearchDocument,
  log: FastifyBaseLogger,
): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;
  try {
    await householdsIndex(client).addDocuments([toHouseholdDocument(doc)]);
  } catch (err) {
    log.warn({ err, householdId: doc.id }, "meili household index sync failed");
  }
}

/** Remove a household from the index. */
export async function removeHouseholdFromIndex(id: string, log: FastifyBaseLogger): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;
  try {
    await householdsIndex(client).deleteDocument(id);
  } catch (err) {
    log.warn({ err, householdId: id }, "meili household index delete failed");
  }
}

// Search ---------------------------------------------------------------------

export interface SearchResult<T> {
  hits: T[];
  estimatedTotalHits: number;
  limit: number;
  offset: number;
}

const churchFilter = (churchId: string) => [`church_id = "${churchId}"`];

/** Full-text member search within one church. Throws if search isn't configured. */
export async function searchMembers(
  churchId: string,
  query: string,
  opts: { limit: number; offset: number },
): Promise<SearchResult<MemberSearchDocument>> {
  const client = getMeiliClient();
  if (!client) throw new Error("Meilisearch is not configured");
  const res = await membersIndex(client).search(query, {
    filter: churchFilter(churchId),
    limit: opts.limit,
    offset: opts.offset,
  });
  return {
    hits: res.hits,
    estimatedTotalHits: res.estimatedTotalHits ?? res.hits.length,
    limit: res.limit ?? opts.limit,
    offset: res.offset ?? opts.offset,
  };
}

/** Alias kept for the existing members route's return type. */
export type MemberSearchResult = SearchResult<MemberSearchDocument>;

/** Full-text group search within one church. Throws if search isn't configured. */
export async function searchGroups(
  churchId: string,
  query: string,
  opts: { limit: number; offset: number },
): Promise<SearchResult<GroupSearchDocument>> {
  const client = getMeiliClient();
  if (!client) throw new Error("Meilisearch is not configured");
  const res = await groupsIndex(client).search(query, {
    filter: churchFilter(churchId),
    limit: opts.limit,
    offset: opts.offset,
  });
  return {
    hits: res.hits,
    estimatedTotalHits: res.estimatedTotalHits ?? res.hits.length,
    limit: res.limit ?? opts.limit,
    offset: res.offset ?? opts.offset,
  };
}

/** Full-text household search within one church. Throws if search isn't configured. */
export async function searchHouseholds(
  churchId: string,
  query: string,
  opts: { limit: number; offset: number },
): Promise<SearchResult<HouseholdSearchDocument>> {
  const client = getMeiliClient();
  if (!client) throw new Error("Meilisearch is not configured");
  const res = await householdsIndex(client).search(query, {
    filter: churchFilter(churchId),
    limit: opts.limit,
    offset: opts.offset,
  });
  return {
    hits: res.hits,
    estimatedTotalHits: res.estimatedTotalHits ?? res.hits.length,
    limit: res.limit ?? opts.limit,
    offset: res.offset ?? opts.offset,
  };
}

// Backfill -------------------------------------------------------------------

/**
 * Rebuild all three indexes from Postgres (the `job:reindex` script). Pages through
 * live members and all groups/households and upserts them. No-op (counts 0) when
 * search isn't configured.
 */
export async function reindexAll(
  supabase: SupabaseClient<Database>,
  log: { info: (obj: unknown, msg?: string) => void },
): Promise<{ members: number; groups: number; households: number }> {
  const client = getMeiliClient();
  const counts = { members: 0, groups: 0, households: 0 };
  if (!client) {
    log.info({}, "meili not configured; reindex skipped");
    return counts;
  }
  await ensureAllIndexes(client);

  for (let from = 0; ; from += REINDEX_PAGE) {
    const { data, error } = await supabase
      .from("members")
      .select("*")
      .is("deleted_at", null)
      .range(from, from + REINDEX_PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length > 0) {
      await membersIndex(client).addDocuments(rows.map(toSearchDocument));
      counts.members += rows.length;
    }
    if (rows.length < REINDEX_PAGE) break;
  }

  for (let from = 0; ; from += REINDEX_PAGE) {
    const { data, error } = await supabase
      .from("groups")
      .select("*")
      .range(from, from + REINDEX_PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length > 0) {
      await groupsIndex(client).addDocuments(rows.map(toGroupDocument));
      counts.groups += rows.length;
    }
    if (rows.length < REINDEX_PAGE) break;
  }

  for (let from = 0; ; from += REINDEX_PAGE) {
    const { data, error } = await supabase
      .from("households")
      .select("*")
      .range(from, from + REINDEX_PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length > 0) {
      await householdsIndex(client).addDocuments(rows.map(toHouseholdDocument));
      counts.households += rows.length;
    }
    if (rows.length < REINDEX_PAGE) break;
  }

  log.info({ counts }, "meili reindex complete");
  return counts;
}
