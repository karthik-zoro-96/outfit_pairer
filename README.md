# What goes with this?

Snap or upload a photo of one clothing item. Get three complementary pieces that pair with
it, each with a one-line reason and direct Google Shopping and Amazon search links.

## Run it

```bash
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
npm start          # http://localhost:3000
```

`npm run dev` restarts the server on file changes.

## How it works

- `public/index.html` is the whole UI, styled with Tailwind via the CDN script tag in a
  shadcn-like look (no build step). The file input uses `capture="environment"`, so on a
  phone it opens the camera directly. The image is resized to 1024px JPEG in the browser
  before upload.
- `server.mjs` serves the page and exposes two endpoints. `POST /api/analyze` sends the
  image plus optional occasion and style notes to Claude with a JSON schema enforced via
  structured outputs, then builds shop links from the returned search queries.
  `POST /api/swap` replaces one suggestion in the same category, passing the rejected and
  remaining items so the replacement is genuinely different.
- No database, no accounts. Shop links are plain search URLs. Product thumbnails are an
  optional layer on top via serper.dev, looked up in parallel for the three suggestions.

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Server-side only, never sent to the browser |
| `CLAUDE_MODEL` | `claude-sonnet-5` | Model to call (`claude-opus-5` for deeper suggestions) |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` for speed vs. depth |
| `AMAZON_TAG` | none | Optional Amazon affiliate tag appended to links |
| `SERPER_API_KEY` | none | Optional. Real Google Shopping listings (image, price, store) via [serper.dev](https://serper.dev). |
| `SERPAPI_API_KEY` | none | Optional. Same as above via [serpapi.com](https://serpapi.com), 100 free searches/month. |
| `PEXELS_API_KEY` | none | Optional. Stock photos via [pexels.com/api](https://www.pexels.com/api). Not shoppable, but instant signup. |
| `SHOP_GL` | `us` | Country code for shopping results, e.g. `in`, `gb`, `de` |

Set only one image key. Priority if several are present: Serper, then SerpAPI, then Pexels.
With none set, cards show text and search links only.
| `PORT` | `3000` | HTTP port |

## Decisions we locked in

- **Stack**: Node 22 built-in `http` + one static HTML page. Zero build step, one dependency.
  Tailwind loads from the CDN, so the page needs network on first load (cached after).
- **Inputs**: photo + optional occasion dropdown + optional free-text style notes.
- **Output**: exactly three complementary pieces from different categories, not full outfits.
- **Shop links**: constructed search URLs, no API keys or scraping.
- **Stateless**: nothing persisted.

## Rules for the build

1. API key lives only in the server environment.
2. Three failure paths handled explicitly in the UI: not clothing, model refusal, API error.
3. Keep the project small enough to read in ten minutes.
4. Every suggestion names a concrete, shoppable item with color and cut.
5. Test with a real photo before calling anything done.
