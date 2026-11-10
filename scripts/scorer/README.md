# Scorer service

Face-consistency scorer (ArcFace, insightface `buffalo_l`, CPU). The dashboard calls it after
every save and writes `consistency_score` on each image.

## Start

```bash
scripts/scorer/run.sh
```

First run makes `scripts/scorer/.venv`, installs `requirements.txt`, and downloads the model
(~300 MB to `~/.insightface`). It listens on `127.0.0.1:8765` only.

Then add this line to `dashboard/.env.local` and restart the dashboard:

```
SCORER_URL=http://127.0.0.1:8765
```

When `SCORER_URL` is not set, or the scorer is down, scoring is skipped. Generation never waits
for it and never fails because of it.

## Check

```bash
curl -s localhost:8765/health
curl -s -X POST localhost:8765/score -H 'content-type: application/json' \
  -d '{"image_url":"https://<project>.supabase.co/storage/v1/object/public/generated-images/...","persona_id":"<uuid>"}'
```

## What the score means

Cosine similarity to the persona's canonical face (mean of identity-sheet refs, or face refs when
no sheet exists yet). Same scale as `scripts/eval_consistency.py`:

| Score | Reading |
|---|---|
| >= 0.60 | same person, confident |
| 0.45-0.60 | probably the same person |
| < 0.45 | not the same face |
| null | no face found |

## Backfill old images

With the dashboard and the scorer both running:

```bash
curl -s -X POST localhost:3000/api/scores -H 'content-type: application/json' -d '{"backfill":100}'
```

Scores up to 100 unscored images per call (newest first). Repeat until `remaining` is 0.

## Running it on a server

Run the same command on the server, bind to a private interface or put it behind the existing reverse proxy,
set `SCORER_TOKEN` on both sides, and point `SCORER_URL` at it.
