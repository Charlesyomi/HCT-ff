# Runbook

## Local development

1. Install dependencies with `npm install`.
2. Start Postgres with `docker compose up -d postgres`.
3. Run the API and web apps with the project Makefile or Docker Compose.

## Production guidance

- Keep environment variables in secret storage.
- Run daily backups of Postgres.
- Validate health and readiness endpoints before deployment.
- Keep admin credentials rotated and stored outside the repo.
