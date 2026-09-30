.PHONY: install backend frontend test lint

install: backend frontend

backend:
	cd backend && poetry install

frontend:
	cd frontend && npm install

run:
	cd backend && poetry run backlight-tracker

test:
	cd backend && poetry run pytest

lint:
	cd backend && poetry run ruff check .
