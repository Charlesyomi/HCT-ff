# Adesoba Catfish Farm

This repository contains the monorepo for the Adesoba Catfish Farm order site.

## Quick start

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
make dev
```

## Included

- Next.js public site + admin shell
- FastAPI API with health endpoint and DB baseline
- Docker Compose for Postgres, API, and Web
- CI and design token foundation

## Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- Backend: FastAPI, SQLModel, Alembic, PostgreSQL
- Ops: Docker, GitHub Actions
