# Deploying to a VPS

One small Linux server runs two containers:

- **app**: the Node server (API + site). Not reachable from outside directly.
- **caddy**: HTTPS in front of it. Gets and renews the certificate automatically,
  compresses responses and adds security headers (see `Caddyfile`).

## 1. Get a server

Ubuntu 24.04, **4 vCPUs** recommended (a night search takes ~1.5 s on 4 cores and ~3 s
on 2), 2 GB RAM or more. The app uses ~300 MB. Hetzner, DigitalOcean, Vultr and others all
have plans in this range; compare current prices.

Add your SSH key when creating it.

## 2. Point the domain at it

At your domain registrar's DNS settings, add an A record with the server's public IP.
For a subdomain such as `stars.vijaya.io`, the record's host/name is just `stars`:

| Type | Host | Value |
|---|---|---|
| A | `stars` (or `@` for a bare domain) | server IPv4 |

Wait until `dig +short stars.vijaya.io` shows the IP. Caddy can only get the certificate
once DNS points at the server.

## 3. Set up the server (once)

```sh
ssh root@SERVER_IP

# Docker
curl -fsSL https://get.docker.com | sh

# Firewall: SSH + web only
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
```

## 4. Get the code and start

The repo is private, so give the server read access: create a deploy key
(`ssh-keygen -t ed25519 -f ~/.ssh/deploy -N ""`, then add `~/.ssh/deploy.pub` under
GitHub → repo → Settings → Deploy keys, read-only).

```sh
GIT_SSH_COMMAND="ssh -i ~/.ssh/deploy" git clone git@github.com:vijaya22/written-in-the-stars.git
cd written-in-the-stars
git config core.sshCommand "ssh -i ~/.ssh/deploy"

echo "DOMAIN=stars.vijaya.io" > .env
docker compose up -d --build
```

Check it:

```sh
docker compose ps                  # app should say "healthy"
docker compose logs -f caddy       # watch the certificate being issued
curl https://stars.vijaya.io/api/health
```

## 5. Updating

```sh
cd written-in-the-stars
git pull
docker compose up -d --build
```

The app restarts with the new code; searches in progress finish first.

## Settings

In `.env` next to `DOMAIN`:

| Variable | Default | |
|---|---|---|
| `DOMAIN` | (required) | the site's domain, without `https://` |
| `WORKERS` | one per CPU core | matching threads |

Limits are in `server/index.ts`: 20 night searches per minute per visitor (bursts of 10),
and new searches are refused while the server is working through a long queue.

## Troubleshooting

- **No certificate / browser warning**: DNS isn't pointing at the server yet, or ports
  80/443 are blocked. `docker compose logs caddy` says which.
- **Site is slow**: `docker stats` shows CPU; more cores help directly.
- **Restart everything**: `docker compose restart`. Containers also restart on their own
  after a crash or a server reboot.

Nothing needs backing up: the site has no database. Caddy's certificates live in a
Docker volume and are re-issued automatically if lost.
