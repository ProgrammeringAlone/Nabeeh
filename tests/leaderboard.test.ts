import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";

// Every test file runs in its own process. This database is also distinct from
// core.test.ts, which recreates nabeeh_test while suites may run concurrently.
const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
const url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error("Leaderboard integration tests use an isolated local PostgreSQL database.");
}
const databaseName = `nabeeh_leaderboard_${process.pid}_test`;
url.pathname = "/" + databaseName;
process.env.DATABASE_URL = url.href;
const { pool } = await import("../server/db.ts");
const { readLeaderboard, getLeaderboardPreference, setLeaderboardPreference, normalizeLeaderboardTeamName } =
  await import("../server/leaderboard.ts");
const admin = new pg.Client({ connectionString: base });
before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName} TEMPLATE template0 ENCODING 'UTF8'`);
  execFileSync("node", ["--import", "tsx", "scripts/migrate.ts"], { env: process.env });
});
after(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${databaseName}`);
  await admin.end();
});

async function account(name: string, enabled = true, guest = false) {
  const id = randomUUID();
  await pool.query("INSERT INTO profiles(id,kind) VALUES($1,$2)", [id, guest ? "guest" : "account"]);
  if (!guest) await pool.query(
    "INSERT INTO users(id,profile_id,username,password_hash,leaderboard_enabled) VALUES($1,$2,$3,'test-unused',$4)",
    [randomUUID(), id, name, enabled]);
  return id;
}
async function fixtureGame(host: string, names: [string, string], scores: [number, number],
  participants: [string, number | null][], status = "finished") {
  const id = randomUUID();
  await pool.query("INSERT INTO games(id,host_id,mode,timer,lifelines,status) VALUES($1,$2,'classic',60,'{}',$3)", [id, host, status]);
  for (const team of [0, 1]) await pool.query("INSERT INTO teams(game_id,team_index,name,score) VALUES($1,$2,$3,$4)", [id, team, names[team], scores[team]]);
  for (const [profile, team] of participants) await pool.query("INSERT INTO game_participants(game_id,profile_id,team_index) VALUES($1,$2,$3)", [id, profile, team]);
  return id;
}

test("Player ranks credit only the linked team's completed result, skip private accounts, guests and historical assignments", async () => {
  const winner = await account("rank_winner"), loser = await account("rank_loser"),
    hidden = await account("rank_hidden", false), guest = await account("unused", false, true),
    historical = await account("rank_historical");
  await fixtureGame(winner, ["الفريق الأول", "الفريق الثاني"], [1200, 400], [[winner, 0], [loser, 1], [hidden, 0], [guest, 0], [historical, null]]);
  await fixtureGame(winner, ["الفريق الأول", "الفريق الثاني"], [300, 300], [[winner, 1], [loser, 0]]);
  await fixtureGame(winner, ["الفريق الأول", "الفريق الثاني"], [9000, 10], [[winner, 0]], "active");
  await fixtureGame(winner, ["الفريق الأول", "الفريق الثاني"], [9000, 10], [[winner, 0]], "abandoned");
  const data = await readLeaderboard();
  assert.deepEqual(data.entries.find(row => row.name === "rank_winner"), { rank: 1, name: "rank_winner", points: 1500, games: 2, wins: 1 });
  assert.deepEqual(data.entries.find(row => row.name === "rank_loser"), { rank: 2, name: "rank_loser", points: 700, games: 2, wins: 0 });
  assert.equal(data.entries.some(row => ["rank_hidden", "rank_historical"].includes(row.name)), false);
  assert.equal(JSON.stringify(data).includes(winner), false);
  // Reads and repeated terminal status writes cannot add a second result.
  await pool.query("UPDATE games SET status='finished' WHERE host_id=$1 AND status='finished'", [winner]);
  assert.deepEqual(await readLeaderboard(), data);
});

test("Team rankings normalize names within one host, preserve different hosts, and exclude ambiguous same-game names", async () => {
  const host = await account("teams_host"), other = await account("teams_other"), privateHost = await account("teams_private", false);
  await fixtureGame(host, ["فُرْسَان", "النجوم"], [100, 20], []);
  await fixtureGame(host, ["  فرسـان  ", "النجوم"], [200, 50], []);
  await fixtureGame(other, ["فرسان", "السحاب"], [900, 0], []);
  await fixtureGame(privateHost, ["فرسان", "النجوم"], [9999, 0], []);
  await fixtureGame(host, ["فرسان", "فُرْسَان"], [1000, 2000], []);
  const result = await readLeaderboard({ view: "teams" });
  const teams = result.entries.filter(row => row.hostUsername?.startsWith("teams_"));
  const ours = teams.find(row => row.hostUsername === "teams_host" && normalizeLeaderboardTeamName(row.name) === "فرسان");
  assert.equal(ours?.points, 300); assert.equal(ours?.games, 2); assert.equal(ours?.wins, 2);
  assert.equal(teams.filter(row => normalizeLeaderboardTeamName(row.name) === "فرسان").length, 2);
  assert.equal(teams.some(row => row.hostUsername === "teams_private"), false);
  assert.equal(JSON.stringify(result).includes(host), false);
  const sqlKey = (await pool.query("SELECT leaderboard_team_key($1) AS key", ["\nفُرْسَان\t  TEAM  "])).rows[0].key;
  assert.equal(sqlKey, normalizeLeaderboardTeamName("\nفُرْسَان\t  TEAM  "));
});

test("Privacy defaults off, can be withdrawn immediately, rejects guests, and account removal removes public identity", async () => {
  const id = await account("privacy_player", false), guest = await account("unused", false, true);
  await fixtureGame(id, ["الخصوصية", "خصم"], [600, 0], [[id, 0]]);
  assert.deepEqual(await getLeaderboardPreference(id), { enabled: false });
  assert.equal((await readLeaderboard()).entries.some(row => row.name === "privacy_player"), false);
  await setLeaderboardPreference(id, true);
  assert.equal((await readLeaderboard()).entries.some(row => row.name === "privacy_player"), true);
  await setLeaderboardPreference(id, false);
  assert.equal((await readLeaderboard({ view: "teams" })).entries.some(row => row.hostUsername === "privacy_player"), false);
  await assert.rejects(() => getLeaderboardPreference(guest), (error: any) => error.code === "ACCOUNT_REQUIRED");
  await assert.rejects(() => setLeaderboardPreference(guest, true), (error: any) => error.code === "ACCOUNT_REQUIRED");
  await assert.rejects(() => setLeaderboardPreference(id, "true" as unknown as boolean));
  await setLeaderboardPreference(id, true);
  await pool.query("DELETE FROM users WHERE profile_id=$1", [id]);
  assert.equal((await readLeaderboard()).entries.some(row => row.name === "privacy_player"), false);
  assert.equal((await readLeaderboard({ view: "teams" })).entries.some(row => row.hostUsername === "privacy_player"), false);
});

test("Metric order, tied ranks and bounded pagination are stable and validated", async () => {
  const a = await account("tie_a"), b = await account("tie_b");
  await fixtureGame(a, ["A", "B"], [1600, 0], [[a, 0], [b, 0]]);
  const whole = await readLeaderboard({ metric: "wins" });
  const ties = whole.entries.filter(row => row.name.startsWith("tie_"));
  assert.equal(ties.length, 2); assert.equal(ties[0].rank, ties[1].rank);
  const first = await readLeaderboard({ pageSize: "1", page: "1", metric: "games" });
  const second = await readLeaderboard({ pageSize: 1, page: 2, metric: "games" });
  assert.equal(first.entries.length, 1); assert.equal(first.totalPages, first.total);
  assert.notEqual(first.entries[0].name, second.entries[0].name);
  const beyond = await readLeaderboard({ page: 999 });
  assert.equal(beyond.entries.length, 0); assert.ok(beyond.total > 0);
  await assert.rejects(() => readLeaderboard({ page: 0 }));
  await assert.rejects(() => readLeaderboard({ pageSize: 51 }));
  await assert.rejects(() => readLeaderboard({ metric: "points; DROP TABLE users" }));
  await assert.rejects(() => readLeaderboard({ page: [1] }));
});

test("Legacy SQL_ASCII databases can index team names without compiling UTF8 normalization", async () => {
  const asciiName = `nabeeh_leaderboard_${process.pid}_ascii_test`;
  const asciiUrl = new URL(base); asciiUrl.pathname = "/" + asciiName;
  await admin.query(`CREATE DATABASE ${asciiName} TEMPLATE template0 ENCODING 'SQL_ASCII' LC_COLLATE 'C' LC_CTYPE 'C'`);
  const client = new pg.Client({ connectionString: asciiUrl.href });
  try {
    execFileSync("node", ["--import", "tsx", "scripts/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: asciiUrl.href },
    });
    await client.connect();
    assert.equal((await client.query("SHOW server_encoding")).rows[0].server_encoding, "SQL_ASCII");
    const host = randomUUID(), game = randomUUID();
    await client.query("INSERT INTO profiles(id,kind) VALUES($1,'guest')", [host]);
    await client.query("INSERT INTO games(id,host_id,mode,timer,lifelines) VALUES($1,$2,'classic',60,'{}')", [game, host]);
    // The expression index invokes the function during normal game creation.
    await client.query("INSERT INTO teams(game_id,team_index,name) VALUES($1,0,$2)", [game, "\nفُرْسَان\t  TEAM  "]);
    const { rows: [row] } = await client.query("SELECT leaderboard_team_key(name) AS key FROM teams WHERE game_id=$1", [game]);
    assert.equal(row.key, normalizeLeaderboardTeamName("\nفُرْسَان\t  TEAM  "));
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE ${asciiName}`);
  }
});
