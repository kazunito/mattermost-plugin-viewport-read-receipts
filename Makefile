.PHONY: test dist webapp
webapp:
	npm run typecheck
	npm run build:webapp
test: webapp
	go test -race ./server
	go vet ./server
	npm test
dist:
	npm run package
