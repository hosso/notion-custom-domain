# Notion Custom Domain

Custom domains for your Notion pages. You can publish your page to your own domain instead of `notion.site`.

[![Notion Custom Domain](https://user-images.githubusercontent.com/19500280/93695277-d99aa400-fb4f-11ea-8e82-5c431110ce19.png)](https://notion-custom-domain.hosso.co)

## Getting Started

Use Node.js 24, then install dependencies:

```
npm install
```

Link the repository to Vercel and configure your public Notion page:

```
npx --yes vercel@latest link
npx --yes vercel@latest env add PAGE_URL
```

Then deploy it:

```
npm run deploy:prod
```

Finally, set up a custom domain for the deployment on the Vercel Dashboard. See [Custom Domains – Vercel Docs](https://vercel.com/docs/concepts/projects/custom-domains)

![](https://user-images.githubusercontent.com/19500280/169642461-c31df143-a8a5-4d37-8494-e5b04b01c7b1.png)

## Development

### Run locally

```
PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID> \
npm run dev
```

Then open http://localhost:3000.

### Debug with Node Inspector

```
PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID> \
npm run debug
```

Then open http://localhost:3000.

## Google Analytics Support

Configuring `GA_MEASUREMENT_ID` injects the tracking code into your public Notion page:

```
npx --yes vercel@latest env add GA_MEASUREMENT_ID
```

## Using Environment Variables on the Vercel Dashboard

You can use environment variables on the Vercel Dashboard. After linking the
project, run `npm run vc:dev`, `npm run deploy`, or `npm run deploy:prod`
without setting environment variables in your shell.
![](https://github.com/hosso/notion-custom-domain/assets/19500280/e234a2eb-8ba7-4be0-a1dd-fa58ce0327ab)

## Production Monitoring

This repository includes a scheduled GitHub Actions workflow at `.github/workflows/monitor.yml`.
It runs every 6 hours and can also be started manually from the Actions tab.

Set the repository variable `SITE_URL` to the deployed custom domain URL you want to monitor, for example:

```text
https://notion-custom-domain.hosso.co
```

The monitor checks that the site:

- returns an HTTP success status
- serves HTML
- injects the custom location proxy script
- injects the custom style override

When the check fails, the workflow:

- uploads the HTML, headers, and JSON summary as artifacts
- opens or updates a GitHub issue titled `Monitoring alert: production smoke test failed`

The investigation steps are documented in [`docs/monitoring.md`](docs/monitoring.md).

You can also run the same check locally:

```sh
SITE_URL=https://notion-custom-domain.hosso.co npm run monitor:smoke
```

## Quality Checks

Run the same checks used by CI:

```sh
npm run check
```

Use `npm run fix` to apply Biome's safe lint and formatting fixes.

## License

[MIT](LICENSE)
