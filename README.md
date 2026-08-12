# Pixel Grade AI — Server

The REST API backend for Pixel Grade AI, built with **Node.js**, **Express**, **TypeScript**, and **MongoDB**. Provides role-based access control, Google OAuth, OTP-based email verification, Cloudinary file uploads, Redis-backed sessions, and Socket.io real-time support.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Framework | Express.js v5 |
| Language | TypeScript |
| Database | MongoDB + Mongoose |
| Cache / Session | Redis |
| Auth | JWT (access + refresh tokens), Passport.js (Google OAuth + local) |
| Real-time | Socket.io (Redis adapter) |
| File Uploads | Multer + Cloudinary |
| Email | Nodemailer (SMTP) + EJS templates |
| Validation | Zod |
| Docs | Swagger (OpenAPI 3.0) |
| Security | Helmet, Bcrypt, rate limiting, XSS + Mongo sanitization |
| Testing | Jest + Supertest |
| Deployment | AWS Elastic Beanstalk / Docker / Vercel |

---

## Project Structure

```
src/
├── server.ts                  # Entry point — DB/Redis connect, graceful shutdown
├── app.ts                     # Express app, middleware setup
├── socket/                    # Socket.io setup
└── app/
    ├── config/
    │   ├── index.ts           # Typed env config (Zod-validated)
    │   ├── cloudinary.config.ts
    │   ├── multer.config.ts
    │   ├── passport.ts        # Google OAuth + local strategy
    │   ├── redis.config.ts
    │   └── swagger.config.ts
    ├── constants.ts
    ├── interfaces/            # Express Request augmentation, error types
    ├── errorHelpers/
    │   └── AppError.ts        # Custom operational error class
    ├── helpers/               # Error normalizers (cast, duplicate, validation, zod)
    ├── middlewares/
    │   ├── checkAuth.ts       # JWT guard + RBAC
    │   ├── validateRequest.ts # Zod schema validation
    │   ├── globalErrorHandler.ts
    │   └── notFound.ts
    ├── routes/
    │   └── index.ts           # Aggregates module routes under /api/v1
    ├── modules/
    │   ├── auth/              # Login, logout, refresh, password, Google OAuth
    │   ├── auth_identity/     # Linked auth providers per user
    │   ├── user/              # Register, profile, admin user management
    │   ├── otp/               # OTP generation and verification
    │   ├── upload/            # Cloudinary file uploads
    │   ├── device_token/      # Push notification device tokens
    │   └── health/            # Liveness / readiness probes
    └── utils/
        ├── catchAsync.ts
        ├── sendResponse.ts
        ├── sendEmail.ts
        ├── setCookie.ts
        ├── jwt.ts
        ├── userTokens.ts
        ├── QueryBuilder.ts    # Filterable/paginated query builder
        ├── logger.ts          # Winston logger
        ├── seedAdmin.ts
        ├── seedSuperAdmin.ts
        └── templates/         # EJS email templates (OTP, forgot password)
```

---

## API Endpoints

Application routes are prefixed with `/api/v1`.

### Auth — `/api/v1/auth`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/login` | Public | Credentials login (rate-limited) |
| POST | `/refresh-token` | Public | Get new access token |
| POST | `/logout` | Public | Logout |
| POST | `/change-password` | All roles | Change password |
| POST | `/set-password` | All roles | Set password (OAuth users) |
| POST | `/forgot-password` | Public | Send reset link via email |
| POST | `/reset-password` | Reset token | Reset password |
| GET | `/google` | Public | Initiate Google OAuth |
| GET | `/google/callback` | Public | Google OAuth callback |

### User — `/api/v1/user`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/register` | Public | Register new user |
| GET | `/all-users` | Admin, Super Admin | Get all users |
| GET | `/me` | All roles | Get own profile |
| DELETE | `/me` | All roles | Delete own account |
| GET | `/:id` | Admin, Super Admin | Get user by ID |
| PATCH | `/:id` | All roles | Update user profile |
| DELETE | `/:id` | Admin, Super Admin | Delete user |

### OTP — `/api/v1/otp`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/send` | Public | Send OTP to email (rate-limited) |
| POST | `/verify` | Public | Verify OTP |

### Upload — `/api/v1/upload`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/` | All roles | Upload 1–10 files to Cloudinary |

Send 1 file to get a single `{ url, publicId }` object back; send 2–10 to get an array.

### Device Token — `/api/v1/device-token`

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/` | All roles | Register/update device token |
| DELETE | `/` | All roles | Remove device token |

### Health — `/health`

Mounted outside `/api/v1` so infrastructure probes don't need auth headers.

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/health` | Public | Readiness check (DB + Redis) |
| GET | `/health/live` | Public | Liveness check |

### API Docs

Available in non-production environments at `/api/docs` (Swagger UI) and `/api/docs.json` (raw OpenAPI spec).

---

## Roles

| Role | Description |
|------|-------------|
| `super_admin` | Full platform access |
| `admin` | Manage users |
| `user` | Standard account |

---

## Standard Response Format

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation successful",
  "meta": { "page": 1, "limit": 10, "total": 100 },
  "data": {}
}
```

---

## Environment Variables

Create a `.env` file in the project root. Values are validated with Zod at startup — the server exits immediately if a required variable is missing or malformed.

```env
# Server
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=mongodb://localhost/pixel-grade-ai

# JWT (secrets must be at least 8 characters)
JWT_ACCESS_SECRET=your_access_secret
JWT_ACCESS_EXPIRES=1d
JWT_REFRESH_SECRET=your_refresh_secret
JWT_REFRESH_EXPIRES=30d
JWT_RESET_SECRET=your_reset_secret

# Auth (passwords must be at least 8 characters)
BCRYPT_SALT_ROUND=10

# Seeded Admin Accounts
SUPER_ADMIN_EMAIL=superadmin@example.com
SUPER_ADMIN_PASSWORD=superadmin_password
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin_password

# Session
EXPRESS_SESSION_SECRET=your_session_secret

# CORS — comma-separated list of allowed origins; first entry is used for email/redirect links
FRONTEND_URL=http://localhost:3000

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/v1/auth/google/callback

# Stripe (optional)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret

# Cloudinary (optional)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Email / SMTP (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com

# Redis (optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=default
REDIS_PASSWORD=
```

Required: `DATABASE_URL`, all three JWT secrets, both admin email/password pairs, and `EXPRESS_SESSION_SECRET`. Everything else has a default or is optional.

---

## Getting Started

**Prerequisites:** Node.js 22+, MongoDB, Redis

```bash
# 1. Install dependencies
npm install

# 2. Create a .env file and fill in the environment variables (see above)

# 3. Start the development server
npm run dev

# 4. Build for production
npm run build

# 5. Start the production server
npm start
```

### Docker

Brings up the API alongside MongoDB and Redis:

```bash
docker compose up
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot-reload via `tsx watch` |
| `npm run dev:local` | Same, but loads `.env` explicitly |
| `npm run build` | Compile TypeScript to `dist/` and copy email templates |
| `npm start` | Run compiled server from `dist/server.js` |
| `npm run lint` | Run ESLint |
| `npm test` | Run Jest tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with a coverage report |

---

## Key Features

- **Typed env config**: All environment variables are validated with Zod at startup, so misconfiguration fails fast with a readable error instead of at runtime.
- **Auto-seeding**: Super admin and admin accounts are seeded automatically on startup from `.env` credentials.
- **Graceful shutdown**: Handles `SIGTERM`, `SIGINT`, `unhandledRejection`, and `uncaughtException` — closes DB and Redis connections cleanly.
- **Swagger docs**: OpenAPI spec generated from JSDoc annotations on each route, served at `/api/docs` outside production.
- **Modular architecture**: Each feature is self-contained with its own controller, service, model, validation, and route.
- **QueryBuilder**: Reusable utility for filtering, sorting, and paginating Mongoose queries.
- **Security defaults**: Helmet, CORS, rate limiting on auth and OTP routes, XSS and Mongo-injection sanitization, and httpOnly cookies.
