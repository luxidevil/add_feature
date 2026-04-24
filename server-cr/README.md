# crunchyroll-login

Standalone Express service that checks Crunchyroll account credentials and returns the subscription tier.
Supports bulk checking with concurrent proxy rotation so every account hits a different IP.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | ❌ | Service status |
| GET | `/logs?limit=100` | ✅ | Recent check log |
| POST | `/check` | ✅ | Check one account |
| POST | `/check-bulk` | ✅ | Check many accounts (NDJSON stream) |

### POST `/check`

```json
{
  "email": "user@example.com",
  "password": "secret",
  "proxyUrl": "http://USER:PASS@host:port"  // optional, overrides PROXY_URL
}
```

Response:
```json
{
  "status": "valid",
  "email": "user@example.com",
  "tier": "mega_fan",
  "containerType": "mega_fan",
  "durationMs": 2400
}
```

`status` values: `valid` | `invalid` | `error`
`tier` values:   `mega_fan` | `fan` | `free` | `null`

### POST `/check-bulk`

```json
{
  "accounts": [
    { "email": "a@x.com", "password": "pass1" },
    { "email": "b@x.com", "password": "pass2", "proxyUrl": "http://..." }
  ],
  "concurrency": 5
}
```

Response is a streaming NDJSON (one JSON per line).
Progress lines look like `{ "__progress": true, "completed": 3, "total": 10 }`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Port to listen on (default: 3000) |
| `CR_SERVICE_KEY` | No | API key required in `X-Service-Key` header |
| `PROXY_URL` | Yes* | Proxy URL used for all requests |
| `PROXY_COUNTRIES` | No | Comma-separated country codes to rotate (default: us,gb,ca,au,de,fr,jp,sg,nl,br,mx,kr,it,es) |
| `CONCURRENCY` | No | Max concurrent checks (default: 5, max: 20) |

*Required if you don't pass `proxyUrl` per request.

## Proxy URL Formats

```
# Country rotation — rotates through PROXY_COUNTRIES on each check
http://USER:PASS_country-us@host:1111

# Session rotation — unique sticky IP per check (replaces {session} placeholder)
http://USER:PASS_session-{session}@host:1111

# Both
http://USER:PASS_session-{session}_country-us@host:1111

# Plain — same IP for all (not recommended for bulk)
http://USER:PASS@host:1111
```

## Setup

```bash
cp .env.example .env
# Fill in .env

npm install
npm start
```

## PM2

```bash
pm2 start index.js --name cr-login
pm2 save
```
