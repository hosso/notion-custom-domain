# Notion Custom Domain

Publish a public Notion page through your own domain instead of `notion.site`.

[![Notion Custom Domain](https://user-images.githubusercontent.com/19500280/93695277-d99aa400-fb4f-11ea-8e82-5c431110ce19.png)](https://notion-custom-domain.hosso.co)

## Getting Started

Use Node.js 24, then install dependencies:

```sh
npm install
```

Link the repository to Vercel and configure your public Notion page:

```sh
npx vercel link
npx vercel env add PAGE_URL
```

Select **Production** when prompted for the target environment.

Set `PAGE_URL` to the public Notion page to publish, for example:

```text
https://your-workspace.notion.site/Your-Page-ID
```

Then create the first Production deployment:

```sh
npm run deploy:prod
```

Finally, add a custom domain for the deployment in the Vercel project. See
[Custom Domains – Vercel Docs](https://vercel.com/docs/concepts/projects/custom-domains).

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PAGE_URL` | Yes | Public Notion page URL, including its page ID |
| `GA_MEASUREMENT_ID` | No | Google Analytics measurement ID to inject |

Register variables with `npx vercel env add <VARIABLE_NAME>`, choosing which
environment(s) each one applies to: **Production** (`npm run deploy:prod`),
**Preview** (`npm run deploy`), or **Development** (`npm run vercel:dev`).

`npm run dev` does not use Vercel environment variables; it reads `.env` directly (see [Development](#development)).

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Runs the proxy locally against `.env` (copy from `.env.example`) |
| `npm run vercel:dev` | Runs the proxy through Vercel's local runtime; run `npx vercel pull` first |
| `npm run deploy` | Creates a Preview deployment |
| `npm test` | Runs the unit tests |
| `npm run check` | Runs linting, type checking, and unit tests |
| `npm run fix` | Applies Biome's safe lint and formatting fixes |

## Monitoring

A scheduled GitHub Actions workflow (`.github/workflows/monitor.yml`) checks
the deployed site every 6 hours and opens a GitHub issue on failure. Set the
repository variable `SITE_URL` to the URL to monitor.

Run the same check locally:

```sh
SITE_URL=https://notion-custom-domain.hosso.co npm run monitor:smoke
```

See [`docs/monitoring.md`](docs/monitoring.md) for what it checks and how to
investigate a failure.

## License

[MIT](LICENSE)
