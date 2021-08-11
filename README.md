# Notion Custom Domain

Custom domains for your public Notion pages. You can publish your page to your own domain instead of `notion.site`.

[![Notion Custom Domain](https://user-images.githubusercontent.com/19500280/93695277-d99aa400-fb4f-11ea-8e82-5c431110ce19.png)](https://notion-custom-domain.hosso.co)

## Getting Started

Install dependencies:

```
yarn
```

Then deploy to Vercel with specifiying your public Notion page:

```
PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID> yarn deploy:prod
```

For example:

```
PAGE_URL=https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8 yarn deploy:prod
```

Finally, set up a custom domain for the deployment. See [Custom Domains - Vercel Documentation](https://vercel.com/docs/v2/custom-domains)

## Development

### Run locally with `vercel dev`

```
export PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID>
yarn develop
```

Then open http://localhost:3000.

### Debug with Node Inspector

```
yarn debug
```

Then open http://localhost:3000.

## Google Analytics Support

Deploying with `GA_TRACKING_ID` environment variable injects the tracking code into your public Notion page:

```
export PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID>
export GA_TRACKING_ID=UA-XXXXXXXXX-X
yarn deploy:prod
```

## License

[MIT](LICENSE)
