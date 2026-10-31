# Matka-Worli Domain

Purpose: manage Worli instances, schedules, realtime updates, and risk rules.

Boundaries:
- Resolvers in `resolvers/` delegate to services; services use repos for DB access.
- Bootstrap and realtime services should never query DB directly outside repos.
- Keep Worli-specific validation and risk logic inside this domain only.

