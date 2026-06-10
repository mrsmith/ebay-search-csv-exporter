'use strict';

// Stub browser globals so user.js loads in Node without errors.
// window.top !== window.self causes App.once() to exit early, preventing DOM calls.
global.window = { top: {}, self: {} };
global.document = {};

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    moneyOrNull,
    parseMoney,
    parsePriceRange,
    parseShippingFromRows,
    parseListingMode,
    inferBuyItNowPrice,
} = require('../ebay-search-csv-exporter.user.js');

// ---------------------------------------------------------------------------
// moneyOrNull
// ---------------------------------------------------------------------------

test('moneyOrNull: rounds to 2 dp', () => {
    assert.equal(moneyOrNull(1.234), 1.23);
});

test('moneyOrNull: returns null for null/NaN', () => {
    assert.equal(moneyOrNull(null), null);
    assert.equal(moneyOrNull(NaN), null);
});

// ---------------------------------------------------------------------------
// parseMoney
// ---------------------------------------------------------------------------

test('parseMoney: parses plain dollar string', () => {
    assert.equal(parseMoney('$449.99'), 449.99);
});

test('parseMoney: parses dollar string with comma', () => {
    assert.equal(parseMoney('$1,234.56'), 1234.56);
});

test('parseMoney: returns null for empty/non-money string', () => {
    assert.equal(parseMoney(''), null);
    assert.equal(parseMoney('Free shipping'), null);
});

// ---------------------------------------------------------------------------
// parsePriceRange
// ---------------------------------------------------------------------------

test('parsePriceRange: single price', () => {
    const r = parsePriceRange('$449.99');
    assert.equal(r.price_min, 449.99);
    assert.equal(r.price_max, 449.99);
    assert.equal(r.original_price, null);
    assert.equal(r.is_price_range, false);
});

test('parsePriceRange: explicit range with "to"', () => {
    const r = parsePriceRange('$845.00 to $2,545.00');
    assert.equal(r.price_min, 845.00);
    assert.equal(r.price_max, 2545.00);
    assert.equal(r.is_price_range, true);
});

test('parsePriceRange: sale price + crossed-out original (no "to")', () => {
    const r = parsePriceRange('$629.99$899.99');
    assert.equal(r.price_min, 629.99);
    assert.equal(r.price_max, 629.99);
    assert.equal(r.original_price, 899.99);
    assert.equal(r.is_price_range, false);
});

test('parsePriceRange: empty string', () => {
    const r = parsePriceRange('');
    assert.equal(r.price_min, null);
    assert.equal(r.price_max, null);
    assert.equal(r.is_price_range, false);
});

// ---------------------------------------------------------------------------
// parseShippingFromRows
// ---------------------------------------------------------------------------

test('parseShippingFromRows: free shipping', () => {
    const r = parseShippingFromRows(['$449.99', 'Free shipping']);
    assert.equal(r.shipping, 0);
});

test('parseShippingFromRows: paid shipping', () => {
    const r = parseShippingFromRows(['$449.99', '$12.99 shipping']);
    assert.equal(r.shipping, 12.99);
});

test('parseShippingFromRows: no shipping row', () => {
    const r = parseShippingFromRows(['$449.99', 'Buy It Now']);
    assert.equal(r.shipping, null);
    assert.equal(r.shipping_raw, '');
});

test('parseShippingFromRows: returns row not free delivery', () => {
    const r = parseShippingFromRows(['$9.99 delivery', 'Free returns']);
    assert.equal(r.shipping, 9.99);
});

// ---------------------------------------------------------------------------
// parseListingMode
// ---------------------------------------------------------------------------

test('parseListingMode: plain Buy It Now', () => {
    const r = parseListingMode(['$499.99', 'Buy It Now', 'Free shipping']);
    assert.equal(r.is_buy_it_now, true);
    assert.equal(r.is_auction, false);
    assert.equal(r.has_best_offer, false);
    assert.equal(r.listing_type, 'buy_it_now');
});

test('parseListingMode: BIN + Best Offer', () => {
    const r = parseListingMode(['$499.99', 'Buy It Now', 'or Best Offer']);
    assert.equal(r.is_buy_it_now, true);
    assert.equal(r.has_best_offer, true);
    assert.equal(r.listing_type, 'fixed_price_or_best_offer');
});

test('parseListingMode: auction only', () => {
    const r = parseListingMode(['$15.00', '3 bids', 'Free shipping']);
    assert.equal(r.is_auction, true);
    assert.equal(r.is_buy_it_now, false);
    assert.equal(r.listing_type, 'auction');
});

test('parseListingMode: auction + Best Offer', () => {
    const r = parseListingMode(['$15.00', '3 bids', 'or Best Offer']);
    assert.equal(r.is_auction, true);
    assert.equal(r.has_best_offer, true);
    assert.equal(r.listing_type, 'auction_or_best_offer');
});

test('parseListingMode: Best Offer without BIN keyword is treated as fixed-price', () => {
    const r = parseListingMode(['$499.99', 'or Best Offer']);
    assert.equal(r.is_buy_it_now, true);
    assert.equal(r.is_auction, false);
});

// ---------------------------------------------------------------------------
// inferBuyItNowPrice
// ---------------------------------------------------------------------------

const fixedMode  = { is_auction: false, is_buy_it_now: true,  has_best_offer: false };
const auctMode   = { is_auction: true,  is_buy_it_now: false, has_best_offer: false };
const hybridMode = { is_auction: true,  is_buy_it_now: true,  has_best_offer: false };
const priceInfo  = { price_min: 449.99, price_max: 449.99 };

test('inferBuyItNowPrice: fixed/BIN copies price_min/max', () => {
    const r = inferBuyItNowPrice(priceInfo, [], fixedMode);
    assert.equal(r.buy_it_now_price_min, 449.99);
    assert.equal(r.buy_it_now_price_max, 449.99);
});

test('inferBuyItNowPrice: auction-only returns nulls', () => {
    const r = inferBuyItNowPrice(priceInfo, ['$15.00', '3 bids'], auctMode);
    assert.equal(r.buy_it_now_price_min, null);
    assert.equal(r.buy_it_now_price_max, null);
});

test('inferBuyItNowPrice: auction+BIN with explicit "Buy It Now $499.99"', () => {
    const rows = ['$15.00', '3 bids', 'Buy It Now $499.99', 'Free shipping'];
    const r = inferBuyItNowPrice(priceInfo, rows, hybridMode);
    assert.equal(r.buy_it_now_price_min, 499.99);
    assert.equal(r.buy_it_now_price_max, 499.99);
});

test('inferBuyItNowPrice: auction+BIN with "$499.99 Buy It Now" order', () => {
    const rows = ['$15.00', '3 bids', '$499.99 Buy It Now'];
    const r = inferBuyItNowPrice(priceInfo, rows, hybridMode);
    assert.equal(r.buy_it_now_price_min, 499.99);
});

test('inferBuyItNowPrice: auction+BIN with no explicit price returns nulls', () => {
    const rows = ['$15.00', '3 bids'];
    const r = inferBuyItNowPrice(priceInfo, rows, hybridMode);
    assert.equal(r.buy_it_now_price_min, null);
    assert.equal(r.buy_it_now_price_max, null);
});
