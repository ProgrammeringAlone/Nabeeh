import { z } from "zod";
import { AppError, pool } from "./db.ts";

export type LeaderboardView = "players" | "teams";
export type LeaderboardMetric = "points" | "games" | "wins";
export type LeaderboardEntry = {
  rank: number;
  name: string;
  hostUsername?: string;
  points: number;
  games: number;
  wins: number;
};
export type LeaderboardPage = {
  view: LeaderboardView;
  metric: LeaderboardMetric;
  entries: LeaderboardEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
export function normalizeLeaderboardTeamName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}
const integerParameter = (maximum: number, fallback: number) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().min(1).max(maximum))
    .default(fallback);
const querySchema = z.object({
  view: z.enum(["players", "teams"]).default("players"),
  metric: z.enum(["points", "games", "wins"]).default("points"),
  page: integerParameter(10_000, 1),
  pageSize: integerParameter(50, 20),
});

/** Only public, registered accounts with a recorded team assignment qualify. */
const playerAggregates = `
  SELECT u.profile_id AS identity, u.username AS name, NULL::text AS host_username,
    sum(t.score)::bigint AS points, count(*)::bigint AS games,
    count(*) FILTER (WHERE t.score > opponent.score)::bigint AS wins
  FROM users u
  JOIN game_participants gp ON gp.profile_id=u.profile_id AND gp.team_index IS NOT NULL
  JOIN games g ON g.id=gp.game_id AND g.status='finished'
  JOIN teams t ON t.game_id=g.id AND t.team_index=gp.team_index
  JOIN teams opponent ON opponent.game_id=g.id AND opponent.team_index<>t.team_index
  WHERE u.leaderboard_enabled
  GROUP BY u.profile_id,u.username`;

/** Host ownership is part of the group key; team names alone are not identities. */
const teamAggregates = `
  SELECT g.host_id AS identity, leaderboard_team_key(t.name) AS team_key,
    (array_agg(t.name ORDER BY g.created_at DESC,g.id DESC,t.team_index))[1] AS name,
    u.username AS host_username, sum(t.score)::bigint AS points,
    count(*)::bigint AS games,
    count(*) FILTER (WHERE t.score > opponent.score)::bigint AS wins
  FROM users u
  JOIN games g ON g.host_id=u.profile_id AND g.status='finished'
  JOIN teams t ON t.game_id=g.id
  JOIN teams opponent ON opponent.game_id=g.id AND opponent.team_index<>t.team_index
  WHERE u.leaderboard_enabled
    AND leaderboard_team_key(t.name)<>leaderboard_team_key(opponent.name)
  GROUP BY g.host_id,leaderboard_team_key(t.name),u.username`;

export async function readLeaderboard(
  input: unknown = {},
): Promise<LeaderboardPage> {
  const { view, metric, page, pageSize } = querySchema.parse(input);
  // metric is an enum, never raw request text. One statement keeps the count and
  // page consistent when another account changes visibility during the request.
  const {
    rows: [result],
  } = await pool.query(
    `
    WITH aggregates AS (${view === "players" ? playerAggregates : teamAggregates}),
    ranked AS (
      SELECT *, rank() OVER (ORDER BY ${metric} DESC) AS rank FROM aggregates
    ), selected AS (
      SELECT rank,name,host_username,points,games,wins FROM ranked
      ORDER BY ${metric} DESC,lower(name),identity${view === "teams" ? ",team_key" : ""}
      LIMIT $1 OFFSET $2
    )
    SELECT (SELECT count(*) FROM aggregates)::integer AS total,
      coalesce((SELECT json_agg(selected) FROM selected),'[]'::json) AS entries`,
    [pageSize, (page - 1) * pageSize],
  );
  const total = Number(result.total);
  return {
    view,
    metric,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    entries: result.entries.map((row: Record<string, unknown>) => ({
      rank: Number(row.rank),
      name: String(row.name),
      ...(view === "teams" ? { hostUsername: String(row.host_username) } : {}),
      points: Number(row.points),
      games: Number(row.games),
      wins: Number(row.wins),
    })),
  };
}

export async function getLeaderboardPreference(
  profileId: string,
): Promise<{ enabled: boolean }> {
  const {
    rows: [user],
  } = await pool.query(
    "SELECT leaderboard_enabled FROM users WHERE profile_id=$1",
    [profileId],
  );
  if (!user)
    throw new AppError(
      401,
      "ACCOUNT_REQUIRED",
      "سجّل الدخول إلى حسابك لإدارة ظهورك في لوحة الصدارة.",
    );
  return { enabled: user.leaderboard_enabled };
}

export async function setLeaderboardPreference(
  profileId: string,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const valid = z.boolean().parse(enabled);
  const {
    rows: [user],
  } = await pool.query(
    "UPDATE users SET leaderboard_enabled=$2 WHERE profile_id=$1 RETURNING leaderboard_enabled",
    [profileId, valid],
  );
  if (!user)
    throw new AppError(
      401,
      "ACCOUNT_REQUIRED",
      "سجّل الدخول إلى حسابك لإدارة ظهورك في لوحة الصدارة.",
    );
  return { enabled: user.leaderboard_enabled };
}
