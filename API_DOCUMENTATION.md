# DEALER-DXB Dashboard API Documentation

**Base URL:** `https://nfresetagent.com`

All API routes are prefixed with `/api`. Example: `https://nfresetagent.com/api/auth/login`

---

## Authentication

All protected endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

When `testing_mode` is enabled in settings, you can also use the `test_api_key` as a Bearer token.

---

## Public Endpoints

### Health Check

```
GET /api/healthz
```

**Auth:** None

**Response:**
```json
{ "status": "ok" }
```

---

### Get Concurrency Settings

```
GET /api/public/concurrency
```

**Auth:** None

**Response:**
```json
{
  "trigger_reset": 5,
  "check_email": 10
}
```

---

## Auth Endpoints

### Login

```
POST /api/auth/login
```

**Auth:** None

**Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response (200):**
```json
{
  "token": "jwt_token_string",
  "user": {
    "id": "string",
    "username": "string",
    "role": "admin | user",
    "credits": 100
  }
}
```

**Errors:** `400` missing fields, `401` invalid credentials

---

### Get Current User

```
GET /api/auth/me
```

**Auth:** Required

**Response (200):**
```json
{
  "id": "string",
  "username": "string",
  "role": "admin | user",
  "credits": 100
}
```

---

## Proxy / Service Endpoints

All proxy endpoints require authentication. Service endpoints deduct credits (except `GET /api/proxy/concurrency`).

### Trigger Reset (Single)

```
POST /api/proxy/trigger-reset
```

**Auth:** Required

**Body:**
```json
{
  "email": "user@example.com",
  "country": "US"
}
```

**Response (200):**
```json
{
  "status": "success | failed",
  "success": true,
  "creditsUsed": 1,
  "newCredits": 99
}
```

**Errors:** `400` missing fields, `402` insufficient credits, `500` droplet error

---

### Trigger Reset (Bulk)

```
POST /api/proxy/trigger-reset-bulk
```

**Auth:** Required

**Body:**
```json
{
  "items": [
    { "email": "user1@example.com", "country": "US" },
    { "email": "user2@example.com", "country": "IN" }
  ]
}
```

**Response (200):**
```json
{
  "results": [
    { "email": "user1@example.com", "status": "success", "creditsUsed": 1 },
    { "email": "user2@example.com", "status": "failed", "error": "reason", "creditsUsed": 1 }
  ],
  "newCredits": 98
}
```

**Notes:**
- Server processes emails in parallel using `concurrency_trigger_reset` setting (default: 5)
- All credits deducted upfront
- Each email gets its own proxy URL with country routing

**Errors:** `400` missing/empty items array, `402` insufficient credits

---

### Change Password

```
POST /api/proxy/change-password
```

**Auth:** Required

**Body:**
```json
{
  "resetUrl": "https://www.netflix.com/password/reset/...",
  "newPassword": "NewPass123",
  "country": "US (optional, default: US)"
}
```

**Response (200):**
```json
{
  "status": "success | failed",
  "success": true,
  "account": {
    "email": "user@example.com",
    "plan": "Premium"
  },
  "creditsUsed": 1,
  "newCredits": 99
}
```

**Errors:** `400` missing fields, `402` insufficient credits, `500` droplet error

---

### Change Password (Bulk)

```
POST /api/proxy/change-password-bulk
```

**Auth:** Required

**Body:**
```json
{
  "items": [
    { "resetUrl": "https://www.netflix.com/password?...", "newPassword": "Pass1", "country": "US" },
    { "resetUrl": "https://www.netflix.com/password?...", "newPassword": "Pass2", "country": "IN" }
  ]
}
```

**Response (200):**
```json
{
  "results": [
    { "resetUrl": "...", "email": "user@example.com", "status": "success", "creditsUsed": 1 },
    { "resetUrl": "...", "status": "failed", "error": "reason", "creditsUsed": 1 }
  ],
  "newCredits": 98
}
```

**Notes:**
- Server processes items in parallel using `concurrency_change_password` setting (default: 5)
- All credits deducted upfront
- Each item needs its own `resetUrl` and `newPassword`; `country` is optional (default: US)

**Errors:** `400` missing/empty items array, `402` insufficient credits

---

### Check Email / VM Email (Single)

```
POST /api/proxy/check-email
```

**Auth:** Required

**Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "email": "user@example.com",
  "status": "active | inactive | error | unknown",
  "creditsUsed": 1,
  "newCredits": 99
}
```

**Errors:** `400` missing email, `402` insufficient credits, `500` droplet error

---

### Check Email / VM Email (Bulk)

```
POST /api/proxy/check-email-bulk
```

**Auth:** Required

**Body:**
```json
{
  "emails": [
    "user1@example.com",
    "user2@example.com"
  ]
}
```

**Response (200):**
```json
{
  "results": [
    { "email": "user1@example.com", "status": "active", "creditsUsed": 1 },
    { "email": "user2@example.com", "status": "error", "error": "reason", "creditsUsed": 1 }
  ],
  "newCredits": 98
}
```

**Notes:**
- Server processes emails in parallel using `concurrency_check_email` setting (default: 10)
- All credits deducted upfront

**Errors:** `400` missing/empty emails array, `402` insufficient credits

---

### Get Concurrency (Authenticated)

```
GET /api/proxy/concurrency
```

**Auth:** Required

**Response (200):**
```json
{
  "trigger_reset": 5,
  "check_email": 10
}
```

---

## User Endpoints

All user endpoints require authentication.

### Get Pricing

```
GET /api/user/pricing
```

**Response (200):**
```json
[
  { "key": "credit_cost_trigger_reset", "value": "1" },
  { "key": "credit_cost_change_password", "value": "1" },
  { "key": "credit_cost_check_email", "value": "1" },
  { "key": "credits_per_dollar", "value": "100" },
  { "key": "min_credit_load", "value": "10" },
  { "key": "crypto_wallet", "value": "wallet_address" }
]
```

---

### Get User Logs

```
GET /api/user/logs
```

**Query Parameters:**
| Param    | Type   | Description                    |
|----------|--------|--------------------------------|
| search   | string | Filter by email (regex)        |
| type     | string | Filter: trigger-reset, change-password, check-email |
| status   | string | Filter: success, failed, error |
| limit    | number | Max results (default 2000, max 5000) |

**Response (200):**
```json
[
  {
    "id": "string",
    "userId": "string",
    "type": "trigger-reset",
    "email": "user@example.com",
    "status": "success",
    "result": {},
    "creditsUsed": 1,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Delete User Log

```
DELETE /api/user/logs/:id
```

**Response (200):**
```json
{ "success": true }
```

---

### Redeem Voucher

```
POST /api/user/credits/redeem
```

**Body:**
```json
{
  "code": "DXB-ABCDEF123456"
}
```

**Response (200):**
```json
{
  "credits": 50,
  "newBalance": 150
}
```

**Errors:** `400` no code, `404` invalid code, `409` already used

---

### Get IMAP Credentials

```
GET /api/user/imap
```

**Response (200):**
```json
[
  {
    "id": "string",
    "provider": "gmail",
    "email": "user@gmail.com",
    "imapHost": "imap.gmail.com",
    "imapPort": 993,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Add IMAP Credential

```
POST /api/user/imap
```

**Body:**
```json
{
  "provider": "gmail",
  "email": "user@gmail.com",
  "password": "app_password",
  "imapHost": "imap.gmail.com",
  "imapPort": 993
}
```

**Response (200):**
```json
{
  "id": "string",
  "provider": "gmail",
  "email": "user@gmail.com"
}
```

---

### Delete IMAP Credential

```
DELETE /api/user/imap/:id
```

**Response (200):**
```json
{ "success": true }
```

---

### Get Proxy Settings

```
GET /api/user/proxy
```

**Response (200):**
```json
{
  "id": "string",
  "host": "proxy.example.com",
  "port": 1111,
  "username": "user",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

Returns `null` if no proxy configured.

---

### Save Proxy Settings

```
POST /api/user/proxy
```

**Body:**
```json
{
  "host": "proxy.example.com",
  "port": 1111,
  "username": "user",
  "password": "pass"
}
```

**Response (200):**
```json
{ "success": true }
```

---

### Delete Proxy Settings

```
DELETE /api/user/proxy
```

**Response (200):**
```json
{ "success": true }
```

---

## Admin Endpoints

All admin endpoints require authentication + admin role.  
Base path: `/api/admin/...`

### List Users

```
GET /api/admin/users
```

**Response (200):**
```json
[
  {
    "id": "string",
    "username": "string",
    "role": "admin | user",
    "credits": 100,
    "apiKey": "dxb_...",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Create User

```
POST /api/admin/users
```

**Body:**
```json
{
  "username": "newuser",
  "password": "password123",
  "credits": 50
}
```

**Response (200):**
```json
{
  "id": "string",
  "username": "newuser",
  "role": "user",
  "credits": 50,
  "apiKey": "dxb_..."
}
```

**Errors:** `400` missing fields, `409` username exists

---

### Update User Credits

```
PUT /api/admin/users/:id/credits
```

**Body:**
```json
{
  "credits": 100,
  "operation": "set | add"
}
```

- `set` (default): Sets credits to exact value
- `add`: Adds credits to current balance

**Response (200):**
```json
{
  "id": "string",
  "username": "string",
  "credits": 100
}
```

---

### Delete User

```
DELETE /api/admin/users/:id
```

Deletes user and all their logs.

**Response (200):**
```json
{ "success": true }
```

---

### Get Settings

```
GET /api/admin/settings
```

**Response (200):**
```json
{
  "credit_cost_trigger_reset": "1",
  "credit_cost_change_password": "1",
  "credit_cost_check_email": "1",
  "concurrency_trigger_reset": "5",
  "concurrency_check_email": "10",
  "droplet_trigger_reset": "http://142.93.4.225:3000",
  "droplet_change_password": "http://159.89.172.195:3000",
  "droplet_check_email": "http://139.59.42.65:3000",
  "testing_mode": "false"
}
```

---

### Update Settings

```
PUT /api/admin/settings
```

**Body:** Key-value pairs to update:
```json
{
  "concurrency_trigger_reset": "10",
  "credit_cost_check_email": "2"
}
```

**Response (200):**
```json
{ "success": true }
```

---

### Create Vouchers

```
POST /api/admin/vouchers
```

**Body:**
```json
{
  "credits": 50,
  "count": 5
}
```

- `count` max: 100

**Response (200):**
```json
{
  "codes": [
    "DXB-A1B2C3D4E5F6",
    "DXB-F6E5D4C3B2A1"
  ]
}
```

---

### List Vouchers

```
GET /api/admin/vouchers
```

**Response (200):**
```json
[
  {
    "id": "string",
    "code": "DXB-A1B2C3D4E5F6",
    "credits": 50,
    "used": false,
    "usedAt": null,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Get Logs (Admin)

```
GET /api/admin/logs
```

**Query Parameters:**
| Param     | Type   | Description                    |
|-----------|--------|--------------------------------|
| search    | string | Filter by email (regex)        |
| user      | string | Filter by username             |
| type      | string | trigger-reset, change-password, check-email |
| status    | string | success, failed, error         |
| from_date | string | Start date (YYYY-MM-DD)        |
| to_date   | string | End date (YYYY-MM-DD)          |
| limit     | number | Max results (default 5000, max 10000) |

**Response (200):**
```json
[
  {
    "id": "string",
    "userId": "string",
    "username": "string",
    "type": "trigger-reset",
    "email": "user@example.com",
    "status": "success",
    "result": {},
    "creditsUsed": 1,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Export Logs (CSV)

```
GET /api/admin/logs/export
```

**Query Parameters:** Same as Get Logs (search, user, type, status)

**Response:** CSV file download with columns: `username, type, email, status, creditsUsed, timestamp`

---

### Get User Logs (Admin)

```
GET /api/admin/users/:id/logs
```

**Query Parameters:**
| Param  | Type   | Description             |
|--------|--------|-------------------------|
| search | string | Filter by email (regex) |

**Response (200):**
```json
{
  "user": {
    "id": "string",
    "username": "string",
    "role": "user",
    "credits": 100,
    "apiKey": "dxb_...",
    "createdAt": "2025-01-01T00:00:00.000Z"
  },
  "logs": [...]
}
```

---

### Search Logs by Email

```
GET /api/admin/search
```

**Query Parameters:**
| Param | Type   | Description              |
|-------|--------|--------------------------|
| email | string | Email to search (min 2 chars) |

**Response (200):**
```json
[
  {
    "id": "string",
    "email": "user@example.com",
    "username": "string",
    "userId": "string",
    "status": "success",
    "type": "trigger-reset",
    "creditsUsed": 1,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Droplet Health Check

```
POST /api/admin/droplet-health
```

**Body:**
```json
{
  "url": "http://142.93.4.225:3000"
}
```

**Response (200):**
```json
{ "status": "online | offline" }
```

---

### Get Droplet Logs

```
GET /api/admin/droplet-logs
```

**Query Parameters:**
| Param   | Type   | Description                               |
|---------|--------|-------------------------------------------|
| service | string | Optional: trigger-reset, change-password, check-email |
| limit   | number | Max log entries per droplet (default 100, max 500) |

**Response (200) — single service:**
```json
{
  "service": "trigger-reset",
  "status": "ok | error",
  "logs": [...]
}
```

**Response (200) — all services:**
```json
[
  { "service": "trigger-reset", "status": "ok", "logs": [...] },
  { "service": "change-password", "status": "ok", "logs": [...] },
  { "service": "check-email", "status": "ok", "logs": [...] }
]
```

---

### Deploy to Droplet

```
POST /api/admin/deploy
```

**Body:**
```json
{
  "service": "trigger-reset | change-password | check-email"
}
```

**Response (200):**
```json
{ "success": true, "service": "trigger-reset" }
```

---

### List Proxy Credentials

```
GET /api/admin/proxies
```

**Response (200):**
```json
[
  {
    "id": "string",
    "userId": "string",
    "username": "string",
    "host": "proxy.example.com",
    "port": 1111,
    "username_proxy": "proxyuser",
    "password": "proxypass",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Create/Update Proxy for User

```
POST /api/admin/proxies
```

**Body:**
```json
{
  "userId": "user_id",
  "host": "proxy.example.com",
  "port": 1111,
  "username": "proxyuser",
  "password": "proxypass"
}
```

**Response (200):**
```json
{ "success": true, "message": "Proxy created | Proxy updated" }
```

---

### Update Proxy

```
PUT /api/admin/proxies/:id
```

**Body:** Any of: `host`, `port`, `username`, `password`

**Response (200):**
```json
{ "success": true }
```

---

### Delete Proxy

```
DELETE /api/admin/proxies/:id
```

**Response (200):**
```json
{ "success": true }
```

---

### Execute Shell Command

```
POST /api/admin/shell
```

**Body:**
```json
{
  "command": "pm2 status"
}
```

**Response (200):**
```json
{
  "success": true,
  "output": "string (last 5000 chars)"
}
```

On execution failure:
```json
{
  "success": false,
  "output": "stdout + stderr (last 5000 chars)",
  "exitCode": 1
}
```

**Errors:** `400` missing command, `403` blocked command

**Notes:**
- 30 second timeout
- Dangerous commands are blocked (rm -rf /, mkfs, dd, fork bombs)

---

## Test Endpoints

### Get Test Mode Status

```
GET /api/test/status
```

**Auth:** None

**Response (200):**
```json
{ "testing_mode": false }
```

---

### Get Test Info

```
GET /api/test/info
```

**Auth:** Admin required

**Response (200):**
```json
{
  "testing_mode": true,
  "test_api_key": "string | null",
  "usage": {
    "description": "...",
    "example_curl": "..."
  }
}
```

---

### Test Ping

```
GET /api/test/ping
```

**Auth:** Required (JWT or test key)

**Response (200):**
```json
{
  "ok": true,
  "mode": "test_key | jwt",
  "user": "username",
  "message": "Test mode connection successful"
}
```

---

## Error Response Format

All errors follow this format:

```json
{
  "error": "Error description"
}
```

Common HTTP status codes:
| Code | Meaning              |
|------|----------------------|
| 400  | Bad request / missing fields |
| 401  | Not authenticated    |
| 402  | Insufficient credits |
| 403  | Forbidden / blocked  |
| 404  | Not found            |
| 409  | Conflict (duplicate) |
| 500  | Server error         |

---

## Architecture

```
User Browser
    │
    ▼
Dashboard Server (68.183.28.137:3000)
    │
    ├──► Trigger Reset Droplet (142.93.4.225:3000)
    │        └── Netflix captcha solving via Capsolver + proxy
    │
    ├──► Change Password Droplet (159.89.172.195:3000)
    │        └── Netflix password change via reset URL
    │
    └──► VM Email Check Droplet (139.59.42.65:3000)
             └── Netflix email status verification
```

Bulk endpoints process multiple emails server-side in parallel, respecting concurrency limits from admin settings. Credits are deducted upfront for all items in a bulk request.
