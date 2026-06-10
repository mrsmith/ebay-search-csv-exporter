'use strict';

// Load the saved eBay search results page into jsdom so we can run
// extractListings() against real DOM structure captured on 2026-06-10.
// When eBay changes their markup, update the snapshot file and re-run.

const fs   = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const SNAPSHOT = path.join(__dirname, 'data', 'search-2026-06-10.html');
const SNAPSHOT_URL = 'https://www.ebay.com/sch/i.html?_nkw=dell+7910&_sop=12';

const html = fs.readFileSync(SNAPSHOT, 'utf8');
const dom  = new JSDOM(html, { url: SNAPSHOT_URL });

// Set globals before requiring user.js so its functions pick them up at runtime.
global.window   = dom.window;
global.document = dom.window.document;

const { getCards, extractListings } = require('../ebay-search-csv-exporter.user.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let rows;

before(() => {
    rows = extractListings();
});

function byId(id) {
    return rows.find(r => r.listing_id === id);
}

// ---------------------------------------------------------------------------
// Page-level
// ---------------------------------------------------------------------------

test('dom: extracts search query from URL', () => {
    assert.ok(rows.length > 0);
    assert.equal(rows[0].search_query, 'dell 7910');
});

test('dom: page number is 1', () => {
    assert.equal(rows[0].page_number, 1);
});

test('dom: extracts a reasonable number of listings', () => {
    // Snapshot has ~240 cards; allow a wide band in case the selector
    // skips promo/ad cards.
    assert.ok(rows.length >= 50, `got ${rows.length} rows`);
});

test('dom: every row has a url or title', () => {
    const bad = rows.filter(r => !r.url && !r.title);
    assert.equal(bad.length, 0, `${bad.length} rows have neither url nor title`);
});

// ---------------------------------------------------------------------------
// Listing 365335853830 — BIN, price range, free delivery
// ---------------------------------------------------------------------------

test('dom: BIN price-range listing (365335853830)', () => {
    const r = byId('365335853830');
    assert.ok(r, 'listing not found');

    assert.equal(r.price_min,             845);
    assert.equal(r.price_max,             2545);
    assert.equal(r.is_price_range,        true);
    assert.equal(r.is_buy_it_now,         true);
    assert.equal(r.is_auction,            false);
    assert.equal(r.has_best_offer,        false);
    assert.equal(r.listing_type,          'buy_it_now');
    assert.equal(r.shipping,              0);
    assert.equal(r.buy_it_now_price,      845);
    assert.equal(r.total_min,             845);
    assert.equal(r.total_max,             2545);
    assert.equal(r.buy_it_now_total_min,  845);
    assert.equal(r.buy_it_now_total_max,  2545);
    assert.equal(r.url, 'https://www.ebay.com/itm/365335853830');
});

// ---------------------------------------------------------------------------
// Listing 267670663884 — Best Offer (fixed-price), paid shipping
// ---------------------------------------------------------------------------

test('dom: Best Offer listing with paid shipping (267670663884)', () => {
    const r = byId('267670663884');
    assert.ok(r, 'listing not found');

    assert.equal(r.price_min,             449.99);
    assert.equal(r.price_max,             449.99);
    assert.equal(r.is_price_range,        false);
    assert.equal(r.is_buy_it_now,         true);
    assert.equal(r.is_auction,            false);
    assert.equal(r.has_best_offer,        true);
    assert.equal(r.listing_type,          'fixed_price_or_best_offer');
    assert.equal(r.shipping,              29.76);
    assert.equal(r.buy_it_now_price,      449.99);
    assert.equal(r.total_min,             479.75);
    assert.equal(r.buy_it_now_total_min,  479.75);
});

// ---------------------------------------------------------------------------
// Listing 298385004559 — auction, current bid, paid shipping
// ---------------------------------------------------------------------------

test('dom: auction listing (298385004559)', () => {
    const r = byId('298385004559');
    assert.ok(r, 'listing not found');

    assert.equal(r.price_min,             222.50);
    assert.equal(r.is_auction,            true);
    assert.equal(r.is_buy_it_now,         false);
    assert.equal(r.buy_it_now_price,      null);
    assert.equal(r.shipping,              71.87);
    assert.equal(r.total_min,             294.37);
    assert.equal(r.buy_it_now_total_min,  null);
});
