# eBay Search Results CSV Exporter

A Tampermonkey userscript that adds an **Export eBay CSV** button to eBay search result pages.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the raw script URL:
   `https://raw.githubusercontent.com/mrsmith/ebay-search-csv-exporter/main/ebay-search-csv-exporter.user.js`
3. Click **Install** in Tampermonkey.
4. Navigate to an eBay search results page.
5. Click the **Export eBay CSV** button (fixed, bottom-right corner).

The file is named `ebay_<query>_p001_<date>.csv` and opens correctly in Excel.

## Features

- Exports all listings visible on the current search page
- Separates `buy_it_now_price` (fixed asking price) from `price_min` (current bid for auctions) — auction rows are kept for context but `buy_it_now_price` is blank
- Handles Buy It Now, Best Offer, auction, and variation price ranges
- Computes `total_min` / `total_max` including shipping
- Runs entirely in the browser — no data leaves your machine

## CSV Columns

| Column | Description |
|--------|-------------|
| `search_query` | Value of `_nkw` from the URL |
| `page_number` | Current page number |
| `listing_id` | eBay item ID |
| `title` | Listing title |
| `price_min` | Lowest price shown; current bid for auctions |
| `price_max` | Highest price shown; same as `price_min` for single-price listings |
| `buy_it_now_price` | Fixed asking price — blank for auction-only listings |
| `original_price` | Crossed-out / list price when shown |
| `price_raw` | Raw price text from the card |
| `is_price_range` | `true` if the listing shows a variation price range |
| `shipping` | Shipping cost in USD; `0` = free |
| `shipping_raw` | Raw shipping text from the card |
| `total_min` | `price_min` + `shipping` |
| `total_max` | `price_max` + `shipping` |
| `buy_it_now_total_min` | `buy_it_now_price` + `shipping` |
| `buy_it_now_total_max` | `buy_it_now_price` + `shipping` |
| `listing_type` | `auction` / `buy_it_now` / `fixed_price_or_best_offer` / `auction_or_best_offer` |
| `is_buy_it_now` | `true` if a fixed Buy It Now price is available |
| `is_auction` | `true` if listing is an auction |
| `has_best_offer` | `true` if Best Offer is available |
| `url` | Canonical eBay item URL (`/itm/<id>`) |
| `all_rows` | Pipe-separated raw attribute row text — useful for debugging |

**Filtering tip:** filter on `buy_it_now_price` not blank (or `is_auction = false`) to exclude pure auction rows from price analysis.

## Limitations

- Exports only the listings currently loaded on the page; does not paginate automatically.
- Variation listings appear as price ranges (`price_min` / `price_max`), not individual SKUs.
- eBay DOM changes may break extraction — update `tests/data/` snapshot and re-run tests.

## Development

```bash
npm install
npm test        # 23 unit tests + 7 DOM integration tests against a saved HTML snapshot
```

DOM tests load `tests/data/search-2026-06-10.html` through [jsdom](https://github.com/jsdom/jsdom) and assert on exact prices and listing-mode flags for three known listings. When eBay updates their markup, replace the snapshot and fix any failing assertions.

## Privacy

The script runs locally in your browser and makes no network requests.

## License

MIT — see [LICENSE](LICENSE).
