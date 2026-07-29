# Deploying the backend to Render

The frontend deploys separately to Netlify. Do the backend first — the frontend
needs its URL.

---

## 1. Push this folder as its own repository

```bash
git init
git add .
git commit -m "Initial backend"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

`.gitignore` keeps `.env`, `node_modules/` and `dist/` out. **Confirm `.env` is not
in the commit before pushing** — it holds your database, AI and mailbox credentials:

```bash
git status --short
```

---

## 2. Create the Render service

New → **Web Service** → connect the repository.

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/v1/health` |
| Plan | Free (see the keep-awake note below) |

---

## 3. Environment variables

Set these in Render → **Environment**. Never commit them.

**Required**

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | your MongoDB Atlas connection string |
| `PUBLIC_BASE_URL` | your Render URL, e.g. `https://ai-leads-api.onrender.com` |
| `CLIENT_ORIGIN` | your Netlify URL, e.g. `https://yourapp.netlify.app` |
| `JWT_ACCESS_SECRET` | random 32+ characters |
| `JWT_REFRESH_SECRET` | random 32+ characters, different from the above |
| `UNSUBSCRIBE_SECRET` | random 32+ characters, different again |

`PUBLIC_BASE_URL` must be publicly reachable — unsubscribe links in sent mail
point at it. The app refuses to start with a `localhost` value once outreach is
enabled.

**AI**

| Key | Value |
|---|---|
| `AI_PROVIDER` | `groq` |
| `GROQ_API_KEY` | your key from console.groq.com |

**Email**

| Key | Value |
|---|---|
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | your mailbox address |
| `SMTP_PASSWORD` | your mailbox password |
| `IMAP_ENABLED` | `true` |
| `IMAP_HOST` | `imap.hostinger.com` |
| `IMAP_PORT` | `993` |
| `IMAP_USER` | same as `SMTP_USER` |
| `IMAP_PASSWORD` | same as `SMTP_PASSWORD` |

**Safety flags — deploy with these first**

| Key | Value |
|---|---|
| `EMAIL_DRY_RUN` | `true` |
| `OUTREACH_ENABLED` | `false` |
| `SCHEDULER_ENABLED` | `false` |

Verify the deployment works before letting it send anything.

---

## 4. Allow Render to reach Atlas

Atlas blocks unknown IPs by default. In Atlas → **Network Access**, add
`0.0.0.0/0` (allow from anywhere) — Render free services do not have a fixed
outbound IP, so an allowlist is not possible.

The database is still protected by its username and password.

---

## 5. Check it

```bash
curl https://YOUR-SERVICE.onrender.com/api/v1/health
```

Expect `{"success":true,...,"status":"ok"}`.

Render's **Shell** tab can also run the full credential check, which sends no email:

```bash
npm run check
```

---

## 6. Go live

Once the frontend is deployed and you have approved a draft you are happy with,
change in Render → Environment:

```
EMAIL_DRY_RUN=false
OUTREACH_ENABLED=true
SCHEDULER_ENABLED=true
```

Then activate the campaign in Settings. Changing an env var redeploys the service.

---

## Keeping the free plan awake

Render's free plan sleeps after ~15 minutes without a request, and a sleeping
service runs no cron jobs.

Create a free job at [cron-job.org](https://cron-job.org) hitting
`https://YOUR-SERVICE.onrender.com/api/v1/health` every **10 minutes**.

Downtime is not destructive — approved mail is sent when the service wakes, and
the IMAP poll looks back 14 days — but sends are delayed until it does.

---

## Frontend on Netlify

From the `frontend` folder:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Env var | `VITE_API_BASE_URL` = `https://YOUR-SERVICE.onrender.com/api/v1` |

The name must be exactly `VITE_API_BASE_URL`. Anything else is ignored and the
app silently falls back to `http://localhost:5000/api/v1`, which fails in a browser.

`frontend/public/_redirects` is already committed so SPA deep links do not 404:

```
/*  /index.html  200
```

After deploying, set `CLIENT_ORIGIN` in Render to the Netlify URL or the browser
will block API calls with a CORS error.

---

## Troubleshooting

**"PUBLIC_BASE_URL must be publicly reachable"** — it is still `localhost`. Set it
to the Render URL.

**CORS errors in the browser** — `CLIENT_ORIGIN` does not exactly match the
Netlify origin. No trailing slash.

**Cannot connect to MongoDB** — Atlas Network Access is missing `0.0.0.0/0`.

**SMTP connection refused** — some hosts block outbound SMTP. Run `npm run check`
in the Render shell to confirm.

**First request takes ~50 seconds** — the free service was asleep. Expected;
the keep-alive ping prevents it.
