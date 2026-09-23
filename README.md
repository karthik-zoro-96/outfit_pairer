# Pairer

Snap one clothing item. Get three pieces that go with it, each with a reason and a link to buy it.

The page is called **What goes with this?** A photo goes in. The look comes back as your photo plus three tiles, then a shop column for each piece.

## Run it locally

Node 22.9 or newer.

```bash
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
npm run dev
```

Open http://localhost:3000. `npm run build && npm start` runs the production server.

## Deploy on Vercel

1. Import [karthik-zoro-96/outfit_pairer](https://github.com/karthik-zoro-96/outfit_pairer).
2. Set the framework preset to **Next.js**, not Other. Build command `npm run build`. `vercel.json` already requests the Next.js builder.
3. Add `ANTHROPIC_API_KEY` in the project settings. Add a product-image key only if you want photos on the shop cards.
4. Deploy.

`/api/analyze` and `/api/swap` can run for up to 60 seconds. A Claude call plus product lookups needs that headroom.

## Using it

1. Take or upload one item. On a phone the file input opens the camera (`capture="environment"`). The browser resizes the photo to a 1024px JPEG before upload.
2. Choose who is wearing it: auto-detect, men, women, or unisex. Auto-detect sends nothing and lets the model decide.
3. Pick an occasion. Everyday sends nothing. The other cells send `Casual weekend`, `Work / office`, `Date night`, `Party / night out`, `Wedding / formal event`, `Travel`, or `Gym / athleisure`.
4. Add style notes, or tap a chip to append one.
5. Find matches.

**The look** is your photo plus three tiles (first product image, category, and item name). **Shop the pieces** is one column per suggestion: why it works, product shots when a provider is configured, Google Shopping and Amazon links, and a button that copies the search text. **Not this one** asks for a different piece in that category and fades the card while it runs.

Three failures share one block, **Couldn't pair that**: the photo is not clothing, the model refuses it, or the API errors.

Photos are printed in black and white.

## Environment

The key stays on the server. It is never sent to the browser.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Claude API key |
| `CLAUDE_MODEL` | `claude-sonnet-5` | Model. `claude-opus-5` goes deeper and slower |
| `CLAUDE_EFFORT` | `medium` | `low`, `medium`, or `high` |
| `AMAZON_TAG` | none | Optional Amazon affiliate tag on shop links |
| `SERPER_API_KEY` | none | Google Shopping listings from [serper.dev](https://serper.dev): image, price, store |
| `SERPAPI_API_KEY` | none | Same listings from [serpapi.com](https://serpapi.com) |
| `PEXELS_API_KEY` | none | Stock photos from [Pexels](https://www.pexels.com/api/). Not shoppable |
| `SHOP_GL` | `us` | Country for shopping results, such as `in`, `gb`, or `de` |

Set one image key. If several are set, Serper wins, then SerpAPI, then Pexels. With none set, the cards still show the item, the reason, and the search links.

## Layout

| Path | Role |
|---|---|
| `components/Pairer.js` | The page: photo, choices, results, errors |
| `app/pairer.css` | Layout for that page |
| `public/styles.css` | Modernist design system: color, type, spacing |
| `app/api/analyze/route.js` | `POST /api/analyze` |
| `app/api/swap/route.js` | `POST /api/swap` |
| `lib/stylist.js` | Claude prompts, shop links, product lookup |

Nothing is stored. There are no accounts. Shop links are search URLs, not scraped product pages.
