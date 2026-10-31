-- The placement monitor already emits this signal. Keep its storage and API contracts aligned.
ALTER TYPE "public"."betting_pattern_type" ADD VALUE IF NOT EXISTS 'HIGH_ODDS';
