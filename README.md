# Notion Custom Domain

Custom Domains for Notion

## Getting Started

Install dependencies:

```
yarn
```

Then deploy to Vercel with specifiying your Notion page:

```
START_PAGE=https://www.notion.so/Your-Page-83715d7703ee4b8699b5e659a4712dd8 yarn deploy:prod
```

Finally, set up a custom domain for the deployment. See [Custom Domains - Vercel Documentation](https://vercel.com/docs/v2/custom-domains)

## Development

### Run locally with `vercel dev`

```
export START_PAGE=https://www.notion.so/Your-Page-83715d7703ee4b8699b5e659a4712dd8
yarn develop
```

Then open http://localhost:3000.

### Debug with Node Inspector

```
yarn debug
```

Then open http://localhost:3000.

## Google Analytics Support

Deploying with `GA_TRACKING_ID` environment variable injects the tracking code into your Notion page:

```
export START_PAGE=https://www.notion.so/Your-Page-83715d7703ee4b8699b5e659a4712dd8
export GA_TRACKING_ID=UA-XXXXXXXXX-X
yarn deploy:prod
```

## License

[MIT](LICENSE)
