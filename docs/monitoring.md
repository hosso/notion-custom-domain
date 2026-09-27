# Monitoring Runbook

This document explains how to investigate production monitoring failures.

## Trigger

The workflow at `.github/workflows/monitor.yml` opens or updates the issue
`Monitoring alert: production smoke test failed` when the scheduled smoke check
fails.

## What To Check First

1. Open the failed workflow run and download the `monitor-artifacts-*` artifact.
2. Review `summary.json` to see which check failed.
3. Review `headers.txt` and `response.html` to determine whether the problem is:
   - upstream Notion markup changed
   - our HTML/script/style injection no longer matches
   - the deployment returned a non-HTML response or an error page
   - the custom domain itself is unavailable

## Local Investigation

`npm run dev` reads the repository-root `.env` file. To run the app against the
same page locally:

```sh
cp .env.example .env
# Set PAGE_URL in .env, then:
npm run dev
```

Run the same smoke check locally against your local server:

```sh
SITE_URL=http://localhost:3000 npm run monitor:smoke
```

If the production domain and the local server behave differently, compare the
captured HTML between environments first.

## Fix Workflow

1. Create a branch for the fix.
2. Reproduce the issue locally if possible.
3. Update the relevant module in `src/` or the monitor checks.
4. Run:

```sh
npm run check
SITE_URL=http://localhost:3000 npm run monitor:smoke
```

5. Open a PR with the reproduction and the fix summary.

## Resolution

After the fix is deployed:

1. Run the monitoring workflow manually from GitHub Actions.
2. Confirm the smoke check passes.
3. Close the monitoring issue with a short note linking the fixing PR.
