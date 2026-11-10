# Personal Expense Tracker

A budgeting app for tracking spending against a weekly or monthly allowance. Each budget period starts with a set balance, and you log expenses against it as you go. When a period ends, whatever is left over (or overspent) rolls into a running **reserve**.

## Features

- **Weekly or monthly budgets.** You can switch at any time:
  - Weekly → monthly: the current week becomes the rest of this month and keeps its expenses.
  - Monthly → weekly: the month closes early, its leftover goes to the reserve, and this week's expenses move into a new week.
- **Expense logging.** Each expense has an item name, an amount, and an optional category (such as a brand or store). You can delete expenses, including ones in periods that have already closed, and the reserve is adjusted to match.
- **Reserve.** A running total of unspent or overspent money from closed periods. While the current period is over budget, the app also shows a projected reserve.
- **Accounts.** Email and password sign-up with httpOnly JWT cookies. Logging out revokes the token on the server.
- **Hardening.** Rate limits on login and registration are stored in MongoDB, so they still work on serverless hosts. The app also sets a strict CSP and security headers, validates input with shared limits, and never sends stack traces to clients.

## Tech stack

| Part   | Stack |
| ------ | ----- |
| Client | React 19, Vite, Tailwind CSS 4, Vitest |
| Server | Node 20+, Express 5, Mongoose (MongoDB), JWT, bcrypt, Helmet |
| Tests  | `node --test`, Supertest, mongodb-memory-server |
| Deploy | Vercel (`vercel.json`) |

## Project structure

```
.
├── api/index.js        # Vercel serverless entry (re-exports server/app.js)
├── client/             # React + Vite frontend
│   └── src/
│       ├── components/ # AuthForm, Topbar, PeriodExpenses, Bottominput, Settings, Receipt
│       └── util/       # expense math (+ tests)
├── server/
│   ├── app.js          # Express app: middleware, routes, static client
│   ├── index.js        # Long-running server entry (local dev / npm start)
│   ├── configuration/  # MongoDB connection (cached across invocations)
│   ├── middleware/     # requireAuth, rate limiting
│   ├── model/          # User, Period, RevokedToken, RateLimit
│   ├── routes/         # auth, period, settings
│   ├── scripts/        # one-off data migrations
│   ├── util/           # period/date logic, input limits
│   └── tests/
└── vercel.json
```

## Getting started

### Prerequisites

- Node.js 20 or newer
- A MongoDB connection string, such as a free MongoDB Atlas cluster

### 1. Install dependencies

```bash
npm install --prefix server
npm install --prefix client
```

### 2. Configure the server

Create `server/config.env`. It is gitignored.

```env
ATLAS_URI=mongodb+srv://<user>:<password>@<cluster>/
JWT_SECRET=<a long random string>
# optional
PORT=3000
NODE_ENV=development
```

| Variable     | Required | Description |
| ------------ | -------- | ----------- |
| `ATLAS_URI`  | yes      | MongoDB connection string. The app uses the `ExpenseTracker` database. |
| `JWT_SECRET` | yes      | Secret for signing auth tokens. The server refuses to start without it. |
| `PORT`       | no       | Port for the API server (default `3000`). |
| `NODE_ENV`   | no       | Set to `production` to enable secure cookies and `upgrade-insecure-requests`. |

You can generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Run in development

Use two terminals:

```bash
# terminal 1: API on http://localhost:3000
npm start --prefix server

# terminal 2: client on http://localhost:5173 (proxies /api to :3000)
npm run dev --prefix client
```

Open http://localhost:5173.

### Production build (local)

```bash
npm run build   # installs deps and builds client/dist
npm start       # Express serves the API and the built client on PORT
```

## Testing

```bash
npm test --prefix server   # API, security, and period logic tests against an in-memory MongoDB
npm test --prefix client   # Vitest unit tests for expense calculations
npm run lint --prefix client
```

The server tests start their own throwaway MongoDB through `mongodb-memory-server`, so they don't need `config.env` or a real database. The first run downloads a MongoDB binary.

## API

All routes are under `/api`. Every route except `health`, `register`, `login`, and `logout` needs the auth cookie. Amounts are integers in **cents**.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/health` | Health check |
| POST   | `/api/auth/register` | `{ email, password }`. Creates an account and signs in |
| POST   | `/api/auth/login` | `{ email, password }` |
| POST   | `/api/auth/logout` | Revokes the current token and clears the cookie |
| GET    | `/api/auth/me` | The current user |
| GET    | `/api/period/current` | The current period plus the user. Closes any periods that have finished |
| POST   | `/api/period/current/expenses` | `{ itemName, amount, category? }` |
| DELETE | `/api/period/:periodId/expenses/:expenseId` | Removes an expense |
| PATCH  | `/api/settings` | `{ budgetPeriod?, weeklyAllowance?, monthlyAllowance? }` |

### Limits

| Limit | Value |
| ----- | ----- |
| Password length | 8 characters to 72 bytes |
| Email length | 254 characters |
| Item name / category length | 100 / 50 characters |
| Amount per expense or allowance | up to $1,000,000 |
| Expenses per period | 500 per week, 2,000 per month |
| Failed logins | 20 per IP and 10 per account, per 15 minutes |
| Registrations | 5 per IP per hour |

## Deployment

The app is deployed on Vercel. `vercel.json` builds the client into `client/dist` and sends `/api/*` to the serverless function in `api/index.js`. All other paths fall back to `index.html`. Set `ATLAS_URI` and `JWT_SECRET` (and `NODE_ENV=production`) in the project's environment variables.

The security headers are defined in two places: in `server/app.js` (Helmet) and in `vercel.json`, which covers static files on Vercel. If you change one, change the other to match.

## Data migrations

`server/scripts/migratePeriodFields.js` converts older week-only records (`weekKey`/`weekStart`) to the current period shape. It runs as a dry run unless you pass `--apply`, and each step is safe to rerun:

```bash
cd server
node scripts/migratePeriodFields.js backfill [--apply]   # before deploying the Period code
node scripts/migratePeriodFields.js cleanup  [--apply]   # after it's deployed
```
