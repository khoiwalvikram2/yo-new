-- Player panel theme (presets, key colours, sport icon style); see
-- docs/superpowers/specs/2026-11-01-app-config-theme-banners-icons-design.md. The legacy `theme` column stays as it
-- is. Only gw's saved sport icon style carries over; no colours do, so every site keeps today's look. Safe to re-run.
ALTER TABLE app_configs ADD COLUMN IF NOT EXISTS player_theme jsonb;
--> statement-breakpoint
UPDATE app_configs SET player_theme = jsonb_build_object('sportsIconStyle', theme->>'sportsIconStyle')
WHERE player_theme IS NULL AND theme->>'sportsIconStyle' IN ('flat', '3d');
