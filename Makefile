dev:
	docker compose up --build

up:
	docker compose up -d postgres

test:
	npm test

lint:
	npm run lint

typecheck:
	npm run typecheck

migrate:
	npm run migrate

seed:
	npm run seed
