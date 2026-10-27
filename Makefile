.DEFAULT_GOAL := all
.PHONY: all deps check-style webapp test server-test webapp-test dist

all: check-style test dist

deps:
	npm --prefix webapp ci

check-style:
	@test -z "$$(gofmt -l server)" || (gofmt -l server; exit 1)
	go vet ./server
	npm --prefix webapp run check-types

webapp:
	npm --prefix webapp run build

server-test:
	go test -race ./server

webapp-test: webapp
	npm --prefix webapp test

test: server-test webapp-test

dist:
	python3 build/package.py
