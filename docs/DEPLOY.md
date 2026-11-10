# Running the dashboard on a VPS (written 2026-11-09, not yet done)

Works on any VPS with root (Hostinger KVM, or the existing Hetzner box). Does not work on shared hosting: generation requests stream for up to 5 minutes, and the app needs `sharp`, `ffmpeg` and a Python process.

## Before anything: the two blockers
1. **The app has no login.** Anyone who reaches the URL can spend fal and WaveSpeed credit. Put it behind Cloudflare Access or Tailscale. Basic auth in Caddy (below) is the minimum.
2. **Rotate the keys first** (Wavespeed, Grok, Supabase, fal). They passed through chat. Put only the new ones on the server.

Also know: every table uses an `anon_all` policy, so the Supabase anon key gives full read/write. It is only in server-side env today. Keep it that way; never expose it as `NEXT_PUBLIC_*`.

## Size
2 vCPU / 8 GB is enough. The scorer (ArcFace, CPU) takes about 1.5 GB RAM. Models run at fal and WaveSpeed, not on the box.

## Steps (Ubuntu 24.04)
```bash
# 1. packages
sudo apt update && sudo apt install -y git ffmpeg python3-venv caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2

# 2. code (private repo: use a deploy key)
git clone <repo> ~/create-ai && cd ~/create-ai/dashboard
npm ci
# copy .env.local from the Mac with the NEW keys; set SCORER_URL=http://127.0.0.1:8765 and MAX_DAILY_SPEND_USD
npm run build

# 3. processes
pm2 start "npm run start -- -p 3000 -H 127.0.0.1" --name dashboard
pm2 start ../scripts/scorer/run.sh --name scorer --interpreter bash
pm2 save && pm2 startup    # run the line it prints
```

`/etc/caddy/Caddyfile` (HTTPS is automatic once DNS points at the box):
```
studio.example.com {
    basic_auth {
        admin <hash from: caddy hash-password>
    }
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1          # SSE: do not buffer the generation streams
        transport http { read_timeout 10m }
    }
}
```
`sudo systemctl reload caddy`.

## Things that differ from the Mac
- `/api/dev/manifest` is dev-only and off in a production build. Refresh manifests with `npm run manifests` on the Mac and commit.
- The scorer needs the canonical faces: it reads the approved dataset images from Supabase, so nothing to copy.
- `gdrive-sync` writes to a local folder (`../seedream-local`); it has no purpose on a server.
- Update: `git pull && npm ci && npm run build && pm2 restart dashboard`.

## Hetzner or Hostinger
Same steps. The Hetzner box already exists and already runs an agent; use it unless the dashboard should be isolated from that agent (a second box is cleaner if the agent has shell access, because `.env.local` holds every key).
