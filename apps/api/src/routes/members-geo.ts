import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSupabaseAdminClient } from "@repo/db";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import type { ZodTypeProvider } from "../lib/zod.js";
import { errorZ, memberStatusZ } from "../lib/schemas.js";

/**
 * Geo-mapping data for outreach planning (GET /members/geo-cluster). Returns the
 * church's geocoded members grouped by neighbourhood (falling back to city, then
 * "Unassigned"), each cluster with a count, a centroid, and its members' pins.
 * Members without coordinates are summarised as `unmapped`.
 *
 * Coordinates live on the member row (members.geo_lat/geo_lng, migration
 * 20260618120000). Requires members.read; church scope is from the JWT.
 */

const GEO_ROW_CAP = 10000;

const geoQueryZ = z.object({
  status: memberStatusZ.optional(),
});

const geoMemberZ = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
});

const geoClusterZ = z.object({
  neighbourhood: z.string(),
  count: z.number().int(),
  centroid: z.object({ lat: z.number(), lng: z.number() }),
  members: z.array(geoMemberZ),
});

function displayName(m: {
  preferred_name: string | null;
  first_name: string;
  last_name: string | null;
}): string {
  return m.preferred_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || m.first_name;
}

export async function membersGeoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/members/geo-cluster",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["members"],
        summary: "Member geo-clusters for outreach mapping",
        description:
          "Returns the church's geocoded members grouped by neighbourhood (centroid + pins), plus a " +
          "count of members without coordinates. Optional ?status filter. Requires members.read.",
        security: [{ bearerAuth: [] }],
        querystring: geoQueryZ,
        response: {
          200: z.object({
            clusters: z.array(geoClusterZ),
            unmapped: z.number().int(),
            totalMapped: z.number().int(),
          }),
          400: errorZ,
          401: errorZ,
          403: errorZ,
          500: errorZ,
        },
      },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const { status } = req.query;
      const supabase = createSupabaseAdminClient();

      // Geocoded members (both coordinates present).
      let mappedQuery = supabase
        .from("members")
        .select("id, first_name, last_name, preferred_name, neighbourhood, city, geo_lat, geo_lng")
        .eq("church_id", auth.churchId)
        .is("deleted_at", null)
        .not("geo_lat", "is", null)
        .not("geo_lng", "is", null);
      if (status) mappedQuery = mappedQuery.eq("status", status);

      // Active members missing a coordinate (the "unmapped" count).
      let unmappedQuery = supabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("church_id", auth.churchId)
        .is("deleted_at", null)
        .or("geo_lat.is.null,geo_lng.is.null");
      if (status) unmappedQuery = unmappedQuery.eq("status", status);

      const [mappedRes, unmappedRes] = await Promise.all([
        mappedQuery.limit(GEO_ROW_CAP),
        unmappedQuery,
      ]);

      if (mappedRes.error || unmappedRes.error) {
        req.log.error(
          { err: mappedRes.error ?? unmappedRes.error },
          "geo-cluster query failed",
        );
        return reply.code(500).send({
          error: "GeoClusterFailed",
          message: "Could not load geo data. Please try again.",
        });
      }

      const rows = mappedRes.data ?? [];
      const groups = new Map<
        string,
        { sumLat: number; sumLng: number; members: z.infer<typeof geoMemberZ>[] }
      >();

      for (const m of rows) {
        if (m.geo_lat === null || m.geo_lng === null) continue;
        const lat = Number(m.geo_lat);
        const lng = Number(m.geo_lng);
        const key = m.neighbourhood?.trim() || m.city?.trim() || "Unassigned";
        const bucket = groups.get(key) ?? { sumLat: 0, sumLng: 0, members: [] };
        bucket.sumLat += lat;
        bucket.sumLng += lng;
        bucket.members.push({ id: m.id, name: displayName(m), lat, lng });
        groups.set(key, bucket);
      }

      const clusters = [...groups.entries()]
        .map(([neighbourhood, b]) => ({
          neighbourhood,
          count: b.members.length,
          centroid: { lat: b.sumLat / b.members.length, lng: b.sumLng / b.members.length },
          members: b.members,
        }))
        .sort((a, b) => b.count - a.count);

      return reply.code(200).send({
        clusters,
        unmapped: unmappedRes.count ?? 0,
        totalMapped: rows.length,
      });
    },
  );
}
