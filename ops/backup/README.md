# Local PM backups

**What runs:** Cloud Run Job `local-pm-backup` (project `local-pm`, region `us-central1`), started every night at **03:00 America/Denver** by Cloud Scheduler job `local-pm-backup-nightly`. It runs as `local-pm-backup@local-pm.iam.gserviceaccount.com`. That account can only read the `local-pm-database-uri` secret, write to the backup bucket, and run this one job.

**What it does:**
1. Dumps every collection as canonical EJSON to `gs://local-pm-backups-493763777082/YYYY-MM-DD_HHMM/`, plus a `_summary.json` with document counts.
2. Only after the dump succeeds, permanently removes Trash items older than 30 days (tickets, projects, milestones, comments). Anything purged is still in that night's backup.

**Retention:** the bucket deletes backups after **90 days**. Public access is blocked and access is uniform bucket-level.

First backup: `2026-09-25_0605`. A restore rehearsal from that backup into a scratch database came back byte-identical to live for tickets, projects, teams and statuses.

## Check it ran

```
gcloud run jobs executions list --job local-pm-backup --project local-pm --region us-central1 --limit 5
gcloud storage ls gs://local-pm-backups-493763777082/
gcloud storage cat gs://local-pm-backups-493763777082/<prefix>/_summary.json
```

## Restore

Always rehearse into a scratch database first. From this folder, run `npm install` once, then set `DATABASE_URI` from Secret Manager:

```
gcloud storage cp "gs://local-pm-backups-493763777082/<prefix>/*" ./restore-from/
DATABASE_URI="$(gcloud secrets versions access latest --secret=local-pm-database-uri --project local-pm)" \
  node restore.mjs ./restore-from local-pm-restore-test
```

Look at `local-pm-restore-test`: point a local dev server at it by changing the database name in `DATABASE_URI`. Once you're satisfied, restore into production with `node restore.mjs ./restore-from local-pm --i-mean-production`. That **drops** the production database first. Take a fresh backup immediately beforehand (`gcloud run jobs execute local-pm-backup --wait`).

`restore.mjs` also accepts a `gs://` prefix directly, if Application Default Credentials are set up.

On Jonathan's Windows PC, Node cannot resolve Atlas `mongodb+srv` addresses with the system DNS. Add `--import=file:///C:/Users/jonra/local-pm-backups/tool/dns-fix.mjs` to the `node` command there.

## Change it

```
gcloud builds submit . --project local-pm --tag us-central1-docker.pkg.dev/local-pm/local-pm-repo/backup:vN
gcloud run jobs update local-pm-backup --project local-pm --region us-central1 --image us-central1-docker.pkg.dev/local-pm/local-pm-repo/backup:vN
```
