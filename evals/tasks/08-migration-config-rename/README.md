# Restructure flat server config into nested object

**Category:** migration

### Prompt
In config/app.json, restructure the top-level keys port and host into a nested server object: "server": { "port": 8080, "host": "localhost" }, keeping name at the top level.
