# QC API Explorer

Local, single-screen explorer for [QuickCommerce API](https://quickcommerceapi.com/docs): search and compare
Blinkit, Zepto, Swiggy Instamart, BigBasket, DMart, JioMart, Flipkart Minutes, Amazon, Flipkart, Myntra, Nykaa,
Meesho and UAE quick commerce (Noon Minutes, talabat mart), and track competitor brands.

## Setup

1. Node 22.9+ (no `npm install` needed: zero dependencies).
2. Open `.env` and paste your key: `QCAPI_KEY=...`
3. Start: `npm run dev` (auto-restarts when `.env` or server code changes) or `npm start`.
4. Open http://127.0.0.1:8787

## How it works

1. **Location**: press *Use my location* (browser GPS), or type a pincode / area name. Coordinates and pincode
   are looked up for you via OpenStreetMap (free, no credits). The pincode can be edited inline.
2. **Search**: pick *Products* or *Competitor brand catalog*, choose platforms, press Search.
3. **Results** (one screen): platform cards (count, ETA, open/closed, dark store), brand chips (click to filter),
   *My brand* + side-by-side brand comparison, one product table with every field, an *All fields* expander per
   row (plus full item details on demand), field coverage and raw responses.

## What a search costs

| Action | Credits |
|---|---|
| Products search | 1 per platform |
| Brand catalog | (1 + number of extra keywords) per platform |
| Delivery ETA / dark store | 1 per platform, **once per location** (cached 2 h; "Refresh delivery ETA" forces a re-fetch) |
| Full item details (row expander) | 1 |
| Location lookup, credits, platform list, History | free |

The cost is shown before you press Search. Every successful paid response is saved to `samples/` and can be
re-opened from **History** for free.

## Limits to know

- Each platform search returns one page (~24 results on Blinkit); the API has no paging. A brand's full catalog
  needs extra keywords (e.g. `paneer, curd, ghee`), each costing 1 credit per platform.
- There is no free autocomplete endpoint, so the search box does not suggest while typing.
- Platforms pad results with related items (bread and dal after "butter"). **Relevant only** (on by default)
  hides products whose name doesn't contain a search word; the hidden count is shown and it can be switched off.
- Multi-platform search (`/v1/groupsearch`) omits `rank` and `is_ad`; rank is taken from the platform's list
  order instead, and the Ad column stays "—". A platform can come back with no results while still being in
  `credit_cost`; its card then shows a warning.

## Security notes

- The key stays in the Node process. The browser never sees it.
- Server listens on 127.0.0.1 only, rejects non-local `Host` headers and requires an `X-Explorer` header,
  so other websites cannot trigger paid calls through it. Upstream redirects are refused so the key cannot leak.
- `.env` and `samples/` are git-ignored.

## Tests

```bash
npm test
```
