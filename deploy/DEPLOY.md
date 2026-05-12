# deploy/DEPLOY.md

Step-by-step for getting `cranberrylabs-hr` running on the homelab box for the
first time. Everything happens on the host — not inside any container.

---

## 0. Prerequisites

Verify these are already in place. If anything is missing, fix it before starting.

- [ ] Docker + `docker compose` installed
- [ ] Existing Caddy reverse proxy running, fronting other `*.cranberrylabs.net`
      services. **Check the Caddy version** — anything from 2.10.0 through
      2.11.1 has CVE-2026-30851 (forward_auth identity header injection).
      Confirm with `docker exec <caddy-container> caddy version`. If you're on
      an affected version, plan to upgrade to 2.11.2+ before exposing the new
      subdomain publicly. The Caddyfile snippet here mitigates the bug, but
      patching is the durable fix.
- [ ] Authelia running at `login.cranberrylabs.net` with at least one user
      account that should have access to the HR dashboard
- [ ] DNS: `hr.cranberrylabs.net` resolves to the same target as the other
      subdomains (A/AAAA or CNAME)
- [ ] The shared Docker network used by Caddy exists. Find its name:
      `docker network ls`. The compose file calls it `cranberrylabs` — if
      yours is named differently, edit `docker-compose.yml` accordingly.

---

## 1. Get the code on the box

```bash
git clone <your-repo-url> cranberrylabs-hr
cd cranberrylabs-hr
```

---

## 2. Create production config

```bash
cp config/production.yaml.example config/production.yaml
```

Open `config/production.yaml` and check the values. Defaults are sane for
docker-compose; the only thing you'd commonly change is `server.host` if
binding behavior needs to differ. Confirm `auth.dev_bypass_user` is `null` —
this file should NEVER set it in production.

`production.yaml` is gitignored. Keep it out of version control.

---

## 3. Create runtime directories

These are bind-mounted into the container; they need to exist on the host
first.

```bash
mkdir -p data storage redis-data
```

The container runs as UID 1000 (`hr` user, created in the Dockerfile). If your
host UID differs, ownership of these dirs may matter. Quick fix if needed:

```bash
sudo chown -R 1000:1000 data storage redis-data
```

---

## 4. Verify the network exists, or create it

```bash
docker network ls | grep cranberrylabs
```

If it's there, great. If not, either:

- Edit `docker-compose.yml` to set `external: false`, in which case this
  stack will create the network itself — but Caddy then needs to join it.
- Or create the network now and join Caddy to it separately:

```bash
docker network create cranberrylabs
# then add to Caddy's compose: networks: [cranberrylabs]
```

---

## 5. Build the image

```bash
docker compose build
```

First build takes a few minutes — better-sqlite3 compiles natively. Subsequent
builds are fast thanks to layer caching on `package.json`.

---

## 6. Run migrations

The schema is empty until migrations run. Best to do this once explicitly
before the first server start, so any migration failure is obvious instead of
buried in startup logs.

```bash
docker compose run --rm hr node /app/api/dist/services/db/migrate-cli.js
```

You should see something like:

```
... INFO [migrate-cli] collected migrations {"count":1,"modules":["sources"]}
... INFO [migrations] applying {"id":"sources_001_init"}
... INFO [migrate-cli] done
```

Verify the database file appeared:

```bash
ls -la data/
# cranberrylabs-hr.sqlite should exist
```

---

## 7. Start the stack

```bash
docker compose up -d
docker compose logs -f hr
```

Look for:

```
... INFO [server] listening {"host":"0.0.0.0","port":3000}
... INFO [module-loader] all modules loaded
```

If you see a missing-file error for `production.yaml`, it means `CONFIG_PATH`
points at a file that doesn't exist. Re-do step 2.

---

## 8. Add the Caddy block

Paste `deploy/Caddyfile.snippet` into your existing Caddyfile. Reload Caddy:

```bash
# If Caddy is in Docker:
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
# Or restart:
docker compose -f /path/to/caddy/compose.yml restart caddy
```

Check Caddy's logs for any complaints about the new block.

---

## 9. End-to-end verification

From inside the docker network (skips Authelia):

```bash
docker compose exec hr wget -qO- http://127.0.0.1:3000/health
# {"status":"ok","uptime":...}
```

From outside, via Caddy + Authelia:

```bash
curl -i https://hr.cranberrylabs.net/health
# Should hit the API directly (no auth on /health) → 200 OK

curl -i https://hr.cranberrylabs.net/api/sources
# Should get an Authelia redirect (302 / 303) since unauthenticated

# In a browser, visit https://hr.cranberrylabs.net — Authelia login appears,
# then after login you should see the placeholder text:
#   "cranberrylabs-hr is running. The SPA has not been built yet."
```

Test the SSE pipe once authenticated. From the browser dev tools:

```js
const ev = new EventSource('/api/events');
ev.onmessage = e => console.log(e.data);
// You should see a heartbeat event within a second, then every 15s.
```

---

## 10. Useful commands going forward

```bash
docker compose logs -f hr              # tail API logs
docker compose logs -f hr-redis        # tail redis
docker compose restart hr              # restart just the API
docker compose down                    # stop everything
docker compose up -d --build           # rebuild + restart after code changes
sqlite3 data/cranberrylabs-hr.sqlite   # inspect the DB from the host
```

---

## Rollback

If something is wrong:

```bash
docker compose down
# Your data/, storage/, redis-data/ all survive on the host.
# Fix the issue, rebuild, bring it back up.
```

If you need to wipe everything (only when you're sure):

```bash
docker compose down
rm -rf data storage redis-data
```
