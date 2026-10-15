-- Public rankings are optional. Existing accounts stay private until they opt in.
ALTER TABLE users ADD COLUMN leaderboard_enabled boolean NOT NULL DEFAULT false;
CREATE INDEX leaderboard_opted_in_accounts ON users(profile_id) WHERE leaderboard_enabled;

-- A linked profile earns its own team's result. We cannot infer assignments for
-- historical games, so existing rows deliberately remain NULL.
ALTER TABLE game_participants ADD COLUMN team_index integer CHECK(team_index IN (0,1));
ALTER TABLE game_participants ADD CONSTRAINT participant_team_fk
  FOREIGN KEY(game_id,team_index) REFERENCES teams(game_id,team_index);
CREATE INDEX participant_ranked_games ON game_participants(profile_id,game_id,team_index)
  WHERE team_index IS NOT NULL;
CREATE INDEX leaderboard_finished_games ON games(host_id,id) WHERE status='finished';

-- Normalize spelling presentation, not ownership: identical names belonging to
-- different hosts must always remain separate teams.
-- Legacy local embedded databases may use SQL_ASCII. Exact character
-- alternatives keep their existing Arabic names usable; production UTF8 also
-- folds Unicode presentation forms with NFKC.
CREATE FUNCTION leaderboard_team_key(team_name text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
  AS $$
  DECLARE normalized_name text := team_name;
  BEGIN
    -- normalize() rejects SQL_ASCII during statement compilation. PL/pgSQL
    -- compiles this assignment only when its UTF8 branch actually executes.
    IF getdatabaseencoding()='UTF8' THEN
      normalized_name := normalize(team_name,NFKC);
    END IF;
    RETURN lower(btrim(regexp_replace(regexp_replace(normalized_name,
      '(ً|ٌ|ٍ|َ|ُ|ِ|ّ|ْ|ٓ|ٔ|ٕ|ٖ|ٗ|٘|ٙ|ٚ|ٛ|ٜ|ٝ|ٞ|ٟ|ٰ|ـ)', '', 'g'), '[[:space:]]+', ' ', 'g')));
  END $$;
CREATE INDEX leaderboard_team_names ON teams(leaderboard_team_key(name),game_id);
