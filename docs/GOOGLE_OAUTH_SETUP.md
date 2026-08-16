# Google OAuth Setup — Founder Runbook

This is the checklist for turning on "Continue with Google" in production. The
app code already ships this feature (Sprint 74) and is safe to deploy before
you do any of this — until the two env vars below are set on the server,
`/sign-in` and `/sign-up` show a "sign-in is being finalized" message instead
of a broken button. Nothing here requires a code change or a redeploy; it's
all Google Cloud Console configuration plus one env-var update on the box.

**Do this in order.** Step 2 needs a working `/privacy` URL, which already
exists (`https://predictfuture-web.duckdns.org/privacy`), so there's no
blocker — just don't skip ahead of Step 2 while it's blank in the console.

---

## Prerequisites

- A Google account you're willing to administer this OAuth client under (your
  own Gmail is fine — this doesn't need a Google Workspace account).
- SSH access to the EC2 box (`ubuntu@13.126.37.16`, key
  `~/Downloads/predict-future-key.pem`). If SSH times out, the box's security
  group only allows one whitelisted IP for port 22 — update it in **AWS
  Console → EC2 → Security Groups → the box's SG → SSH (22) → Edit → My IP**.
  (Port 443 stays open to the world regardless, so the site itself is never
  affected by this.)

---

## Step 1 — Create or select a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Top-left project dropdown → **New Project** (or pick an existing one you
   want to use for this). Name it something recognizable, e.g. `predict-future`.

## Step 2 — Configure the OAuth consent screen

1. In the left sidebar: **APIs & Services → OAuth consent screen**.
2. **User type:** choose **External** (this app has no Google Workspace
   organization to restrict sign-in to).
3. Fill in the required fields:
   - **App name:** `Predict Future`
   - **User support email:** your email
   - **App logo:** optional, skip for now
   - **Application home page:** `https://predictfuture-web.duckdns.org`
   - **Application privacy policy link:** `https://predictfuture-web.duckdns.org/privacy`
   - **Application terms of service link:** `https://predictfuture-web.duckdns.org/terms`
   - **Authorized domain:** `duckdns.org`
   - **Developer contact email:** your email
4. **Scopes:** the app only requests the default `openid`, `email`, and
   `profile` scopes (name, email, profile photo) — you don't need to add
   anything here.
5. **Test users:** while the app is in "Testing" publishing status, only
   Google accounts you explicitly add here can sign in — add your own email
   and any other founder/dev accounts you want to test with first.
6. Save.

**Publishing status — Testing vs. In production:** a brand-new consent screen
starts in "Testing" mode, which caps sign-in to the test users you listed
above. To let the public sign up, go back to the OAuth consent screen and
click **Publish App** to move to "In production." Because this app only
requests the basic `openid`/`email`/`profile` scopes (not any "sensitive" or
"restricted" scope), this generally does **not** require Google's manual
verification review — but Google's exact requirements can change, so if the
console asks you to submit for verification, that's expected and not a sign
something's broken; follow its prompts. Until you publish, real users outside
your test-user list will see an "Access blocked" screen, not a working
sign-in.

## Step 3 — Create the OAuth Client ID

1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. **Application type:** `Web application`.
3. **Name:** `Predict Future Web` (internal label only, not user-facing).
4. **Authorized JavaScript origins** — add both:
   ```
   https://predictfuture-web.duckdns.org
   http://localhost:3000
   ```
5. **Authorized redirect URIs** — add all three (NextAuth's callback path is
   fixed at `/api/auth/callback/<provider>`, so these must be exact):
   ```
   https://predictfuture-web.duckdns.org/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   https://predictfuture.app/api/auth/callback/google
   ```
   The third one is for later — `predictfuture.app` isn't pointed at this box
   yet (still on the `duckdns.org` subdomain). Adding it now costs nothing and
   saves you a trip back here once DNS is switched over: it's the same
   client, just one more URI on the same list, no new client needed.
6. Click **Create**. A dialog shows your **Client ID** and **Client Secret** —
   copy both somewhere safe now (you can always come back to **Credentials**
   to view the Client ID again later, but the Secret may not be re-shown in
   full).

## Step 4 — Set the env vars on the server and restart the container

SSH into the box and edit the web app's env file:

```bash
ssh -i ~/Downloads/predict-future-key.pem ubuntu@13.126.37.16
nano ~/.env.web
```

Add these two lines (alongside the existing `NEXTAUTH_SECRET`/`NEXTAUTH_URL`
entries already in that file — do not touch those two, and do not add
`ALLOW_CREDENTIALS_LOGIN` here: leaving it unset is what keeps production
Google-only per Sprint 74):

```
GOOGLE_CLIENT_ID="<paste the Client ID from Step 3>"
GOOGLE_CLIENT_SECRET="<paste the Client Secret from Step 3>"
```

Save and exit, then cycle the container. **This must be `docker rm` + `docker
run`, not `docker restart`** — env files are only read when a container is
created, so a plain restart will keep running with the old (Google-absent)
environment indefinitely:

```bash
docker stop pf-web
docker rm pf-web
docker run -d --name pf-web --restart always --network pf-net \
  -p 127.0.0.1:3000:3000 --env-file ~/.env.web predict-future-web:local
```

If you're not sure the flags above still match how `pf-web` is actually
configured (they may have changed since this doc was written), check first
with `docker inspect pf-web --format '{{json .Config}}' | python3 -m json.tool`
and match the `run` command's flags to what's already there before you `rm`
it.

## Step 5 — Verify it worked

1. `curl -s https://predictfuture-web.duckdns.org/api/auth/providers` — the
   JSON response should now include a `"google"` key (it won't have one
   before this step).
2. Visit `https://predictfuture-web.duckdns.org/sign-in` — you should see a
   "Continue with Google" button instead of the "finalizing" message.
3. Click it and sign in with an account you added as a test user in Step 2
   (or any account, once you've published the app in Step 2). You should land
   back on the site signed in.
4. **If that Google account matches the email of an existing account on the
   site** (e.g. your own founder/dev account that was created with a
   password), you should land on that *same* existing account — same
   username, same wallet balance, same history — not a fresh second account.
   This is expected: it's how all pre-existing accounts get a Google sign-in
   path with zero data migration.
5. Sign in with a brand-new Google account that's never touched the site
   before — you should get a fresh account with a generated username, a
   starting wallet balance, and a welcome notification, same as any other new
   sign-up.

## Troubleshooting

- **`redirect_uri_mismatch` error from Google** — the URI Google is
  redirecting to doesn't exactly match one of the three in Step 3 (trailing
  slash, http vs https, or wrong domain are the usual culprits). Re-check
  Credentials → your OAuth client → Authorized redirect URIs.
- **"Access blocked: this app's request is invalid" or "Access blocked" for a
  real user** — the app is still in "Testing" publishing status and that
  account isn't in your test-user list (Step 2). Either add them as a test
  user or publish the app.
- **`/sign-in` still shows "finalizing" after Step 4** — the container almost
  certainly wasn't actually recreated (a `docker restart` was used instead of
  `rm`+`run`, or the env file edit didn't save). Re-run Step 4 and confirm
  with `docker exec pf-web env | grep GOOGLE_CLIENT_ID` that the running
  container actually has the value set.
- **New Google sign-up seems to fail or 500s** — this would point at the
  account-creation path itself (Sprint 74's `createUser` override), not this
  console setup; that path was QA-verified against the dev database before
  ship, but if you hit this, capture the error and it needs a code-level look,
  not another console change.

---

_Domain reference: production is `https://predictfuture-web.duckdns.org` as of
this writing. `predictfuture.app` is reserved in this doc's redirect URI list
for when DNS is pointed at this box, per Sprint 74's plan — it is not live yet._
