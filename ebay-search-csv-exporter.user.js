// ==UserScript==
// @name         eBay Search Results CSV Exporter
// @namespace    https://github.com/mrsmith/ebay-search-csv-exporter
// @version      0.1.0
// @description  Export eBay search result listings to CSV with price, shipping, listing ID, URL, auction flag, and Buy It Now price.
// @author       Alexey Kuznetsov <kuznecov.alexey@pm.me>
// @match        https://www.ebay.com/sch/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/mrsmith/ebay-search-csv-exporter
// @supportURL   https://github.com/mrsmith/ebay-search-csv-exporter/issues
// @downloadURL  https://raw.githubusercontent.com/mrsmith/ebay-search-csv-exporter/main/ebay-search-csv-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/mrsmith/ebay-search-csv-exporter/main/ebay-search-csv-exporter.user.js
// ==/UserScript==

// Architecture overview:
//   extractListings()  — walks DOM cards → array of row objects
//   downloadCsv()      — calls extractListings, serialises to CSV, triggers download
//   App.debug / window.ebayCsvDebug — browser console helpers (see bottom of file)
//
// DOM selectors that break when eBay updates their markup:
//   ul.srp-results > li.s-card[data-listingid]   card container
//   .s-card__title                                listing title
//   .s-card__price / .s-card__attribute-row       price and metadata rows
//   a.s-card__link[href*="/itm/"]                 listing URL
(function() {
    'use strict';

    const App = {
        once(key, fn) {
            const fullKey = `__EBAY_CSV_EXPORTER_ONCE_${key}__`;

            if (window.top !== window.self) return;
            if (window[fullKey]) return;

            window[fullKey] = true;
            return fn();
        },
    };

    const CSV_COLUMNS = [
        'search_query',
        'page_number',
        'listing_id',
        'title',
        'price_min',
        'price_max',
        'buy_it_now_price',
        'original_price',
        'price_raw',
        'is_price_range',
        'shipping',
        'shipping_raw',
        'total_min',
        'total_max',
        'buy_it_now_total_min',
        'buy_it_now_total_max',
        'listing_type',
        'is_buy_it_now',
        'is_auction',
        'has_best_offer',
        'url',
        'all_rows',
    ];

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    function text(el) {
        return (el?.innerText || el?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function moneyOrNull(value) {
        if (value == null || Number.isNaN(value)) return null;
        return Number(value.toFixed(2));
    }

    function getSearchQuery() {
        const url = new URL(window.location.href);

        const nkw = url.searchParams.get('_nkw');
        if (nkw) return nkw.trim();

        const pageTitle = document.title || '';
        const titleMatch = pageTitle.match(/^(.+?)\s+\|?\s*eBay/i);
        if (titleMatch) return titleMatch[1].trim();

        return '';
    }

    function getPageNumber() {
        const url = new URL(window.location.href);

        const pageFromUrl = Number(url.searchParams.get('_pgn'));
        if (Number.isFinite(pageFromUrl) && pageFromUrl > 0) {
            return pageFromUrl;
        }

        const currentPageEl = document.querySelector('.pagination__item[aria-current="page"]');
        const pageFromDom = Number(text(currentPageEl));

        if (Number.isFinite(pageFromDom) && pageFromDom > 0) {
            return pageFromDom;
        }

        const headingText = text(document.querySelector('.pagination h2.clipped'));
        const headingMatch = headingText.match(/Page\s+(\d+)/i);

        if (headingMatch) {
            const pageFromHeading = Number(headingMatch[1]);
            if (Number.isFinite(pageFromHeading) && pageFromHeading > 0) {
                return pageFromHeading;
            }
        }

        return 1;
    }

    function cleanUrl(rawUrl) {
        if (!rawUrl) return '';

        try {
            const url = new URL(rawUrl, window.location.href);

            const match = url.pathname.match(/\/itm\/(\d+)/);
            if (match) {
                return `https://www.ebay.com/itm/${match[1]}`;
            }

            return url.href;
        } catch {
            return rawUrl;
        }
    }

    // -------------------------------------------------------------------------
    // Parsing — pure functions, no DOM, fully unit-tested
    // -------------------------------------------------------------------------

    function parseMoney(raw) {
        if (!raw) return null;

        const match = String(raw).replace(/,/g, '').match(/\$([0-9]+(?:\.[0-9]{2})?)/);
        if (!match) return null;

        return Number(match[1]);
    }

    function parsePriceRange(priceText) {
        // Examples:
        // "$449.99"
        // "$845.00 to $2,545.00"  => variation range
        // "$629.99$899.99"        => sale price + crossed-out original price
        const raw = String(priceText || '');
        const normalized = raw.replace(/,/g, '');

        const prices = [...normalized.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)/g)]
            .map(m => Number(m[1]));

        const explicitlyRange =
            /\bto\b/i.test(raw) ||
            /\bfrom\b/i.test(raw);

        const isPriceRange = explicitlyRange && prices.length > 1;

        if (isPriceRange) {
            return {
                price_min: moneyOrNull(prices[0] ?? null),
                price_max: moneyOrNull(prices[prices.length - 1] ?? prices[0] ?? null),
                original_price: null,
                price_raw: raw,
                is_price_range: true,
            };
        }

        // Multiple prices without "to/from" are usually current price + crossed-out/list price.
        return {
            price_min: moneyOrNull(prices[0] ?? null),
            price_max: moneyOrNull(prices[0] ?? null),
            original_price: moneyOrNull(prices.length > 1 ? prices[1] : null),
            price_raw: raw,
            is_price_range: false,
        };
    }

    function parseShippingFromRows(rowTexts) {
        const shippingRow = rowTexts.find(t =>
            /delivery|shipping/i.test(t) &&
            !/returns/i.test(t)
        ) || '';

        let shipping = null;

        if (/free/i.test(shippingRow)) {
            shipping = 0;
        } else {
            shipping = parseMoney(shippingRow);
        }

        return {
            shipping: moneyOrNull(shipping),
            shipping_raw: shippingRow,
        };
    }

    function parseListingMode(rowTexts) {
        const joined = rowTexts.join(' | ');

        const hasBestOffer = /best offer/i.test(joined);

        const isAuction =
            /\bbid\b|\bbids\b|auction/i.test(joined) &&
            !/for parts/i.test(joined);

        // eBay often shows fixed-price-with-offer as "or Best Offer",
        // without explicitly saying "Buy It Now".
        const isBuyItNow =
            /buy it now/i.test(joined) ||
            (hasBestOffer && !isAuction);

        let listing_type = '';

        if (isAuction && hasBestOffer) {
            listing_type = 'auction_or_best_offer';
        } else if (isAuction) {
            listing_type = 'auction';
        } else if (isBuyItNow && hasBestOffer) {
            listing_type = 'fixed_price_or_best_offer';
        } else if (isBuyItNow) {
            listing_type = 'buy_it_now';
        }

        return {
            listing_type,
            is_buy_it_now: isBuyItNow,
            is_auction: isAuction,
            has_best_offer: hasBestOffer,
        };
    }

    function inferBuyItNowPrice(priceInfo, rowTexts, modeInfo) {
        const joined = rowTexts.join(' | ');

        if (modeInfo.is_auction && !modeInfo.is_buy_it_now) {
            return {
                buy_it_now_price_min: null,
                buy_it_now_price_max: null,
            };
        }

        if (!modeInfo.is_auction && modeInfo.is_buy_it_now) {
            return {
                buy_it_now_price_min: priceInfo.price_min,
                buy_it_now_price_max: priceInfo.price_max,
            };
        }

        // Auction + Buy It Now: try to find explicit BIN price in row text.
        const binPatterns = [
            /buy it now\s*\$([0-9,]+(?:\.[0-9]{2})?)/i,
            /\$([0-9,]+(?:\.[0-9]{2})?)\s*buy it now/i,
        ];

        for (const pattern of binPatterns) {
            const match = joined.match(pattern);
            if (match) {
                const value = Number(match[1].replace(/,/g, ''));
                return {
                    buy_it_now_price_min: moneyOrNull(value),
                    buy_it_now_price_max: moneyOrNull(value),
                };
            }
        }

        return {
            buy_it_now_price_min: null,
            buy_it_now_price_max: null,
        };
    }

    // -------------------------------------------------------------------------
    // DOM extraction
    // -------------------------------------------------------------------------

    function getCards() {
        return [...document.querySelectorAll('ul.srp-results > li.s-card[data-listingid]')];
    }

    function extractListing(card) {
        const pageNumber = getPageNumber();

        const listingId =
            card.getAttribute('data-listingid') ||
            card.id?.replace(/^item/, '') ||
            '';

        const titleEl = card.querySelector('.s-card__title');

        const title = text(titleEl)
            .replace(/ Opens in a new window or tab$/i, '')
            .replace(/^NEW LISTING\s*/i, '')
            .trim();

        const linkEl =
            card.querySelector('.su-card-container__header a.s-card__link[href*="/itm/"]') ||
            card.querySelector('a.s-card__link[href*="/itm/"]') ||
            card.querySelector('a[href*="/itm/"]');

        const url = cleanUrl(linkEl?.href || '');

        const priceText =
            text(card.querySelector('.s-card__price')?.closest('.s-card__attribute-row')) ||
            text(card.querySelector('.s-card__price'));

        const priceInfo = parsePriceRange(priceText);

        const rowTexts = [...card.querySelectorAll('.s-card__attribute-row')]
            .map(text)
            .filter(Boolean);

        const shippingInfo = parseShippingFromRows(rowTexts);
        const modeInfo = parseListingMode(rowTexts);
        const buyItNowInfo = inferBuyItNowPrice(priceInfo, rowTexts, modeInfo);

        const shippingForTotal = shippingInfo.shipping ?? 0;

        const totalMin = moneyOrNull(
            priceInfo.price_min == null
                ? null
                : priceInfo.price_min + shippingForTotal
        );

        const totalMax = moneyOrNull(
            priceInfo.price_max == null
                ? null
                : priceInfo.price_max + shippingForTotal
        );

        const buyItNowTotalMin = moneyOrNull(
            buyItNowInfo.buy_it_now_price_min == null
                ? null
                : buyItNowInfo.buy_it_now_price_min + shippingForTotal
        );

        const buyItNowTotalMax = moneyOrNull(
            buyItNowInfo.buy_it_now_price_max == null
                ? null
                : buyItNowInfo.buy_it_now_price_max + shippingForTotal
        );

        return {
            search_query: getSearchQuery(),
            page_number: pageNumber,
            listing_id: listingId,
            title,
            price_min: priceInfo.price_min,
            price_max: priceInfo.price_max,
            buy_it_now_price: buyItNowInfo.buy_it_now_price_min,
            original_price: priceInfo.original_price,
            price_raw: priceInfo.price_raw,
            is_price_range: priceInfo.is_price_range,
            shipping: shippingInfo.shipping,
            shipping_raw: shippingInfo.shipping_raw,
            total_min: totalMin,
            total_max: totalMax,
            buy_it_now_total_min: buyItNowTotalMin,
            buy_it_now_total_max: buyItNowTotalMax,
            listing_type: modeInfo.listing_type,
            is_buy_it_now: modeInfo.is_buy_it_now,
            is_auction: modeInfo.is_auction,
            has_best_offer: modeInfo.has_best_offer,
            url,
            all_rows: rowTexts.join(' | '),
        };
    }

    function extractListings() {
        return getCards()
            .map(extractListing)
            .filter(row => row.listing_id || row.title || row.url);
    }

    // -------------------------------------------------------------------------
    // CSV serialisation
    // -------------------------------------------------------------------------

    function csvEscape(value) {
        if (value == null) return '';

        const s = String(value);

        if (/[",\n\r]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }

        return s;
    }

    function rowsToCsv(rows, columns = CSV_COLUMNS) {
        const header = columns.map(csvEscape).join(',');

        const body = rows.map(row =>
            columns.map(col => csvEscape(row[col])).join(',')
        );

        return [header, ...body].join('\r\n');
    }

    function makeFileSafeName(s) {
        return String(s || '')
            .trim()
            .replace(/[^\w.-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80) || 'ebay_search';
    }

    function downloadCsv() {
        const rows = extractListings();
        const csv = rowsToCsv(rows);

        const searchQuery = getSearchQuery();
        const pageNumber = getPageNumber();
        const date = new Date().toISOString().slice(0, 10);

        const pagePart = `p${String(pageNumber).padStart(3, '0')}`;
        const filename = `ebay_${makeFileSafeName(searchQuery)}_${pagePart}_${date}.csv`;

        // UTF-8 BOM helps Excel open it correctly.
        const blob = new Blob(['\ufeff', csv], {
            type: 'text/csv;charset=utf-8',
        });

        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;

        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

        console.log(`[eBay CSV Exporter] Downloaded ${rows.length} rows: ${filename}`);
    }

    function addExportButton() {
        const existing = document.getElementById('ebay-csv-export-button');
        if (existing) return;

        const button = document.createElement('button');
        button.id = 'ebay-csv-export-button';
        button.textContent = 'Export eBay CSV';

        Object.assign(button.style, {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            zIndex: '999999',
            padding: '10px 14px',
            borderRadius: '8px',
            border: '1px solid #888',
            background: 'white',
            color: 'black',
            fontSize: '14px',
            fontFamily: 'system-ui, sans-serif',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        });

        button.addEventListener('click', downloadCsv);

        document.body.appendChild(button);
    }

    // -------------------------------------------------------------------------
    // Browser console debug API  (window.ebayCsvDebug)
    //   .print()      console.table of all extracted rows
    //   .copyJson()   copy rows as JSON to clipboard
    //   .copyCsv()    copy rows as CSV to clipboard
    //   .downloadCsv() trigger file download
    //   .cards()      raw card elements
    //   .rows()       raw row objects
    // -------------------------------------------------------------------------

    App.debug = {
        cards: getCards,
        rows: extractListings,
        rowsToCsv,

        print() {
            const rows = extractListings();
            console.table(rows);
            return rows;
        },

        copyJson() {
            const rows = extractListings();
            copy(JSON.stringify(rows, null, 2));
            console.log(`[eBay CSV Exporter] Copied ${rows.length} rows as JSON`);
        },

        copyCsv() {
            const rows = extractListings();
            copy(rowsToCsv(rows));
            console.log(`[eBay CSV Exporter] Copied ${rows.length} rows as CSV`);
        },

        downloadCsv,
    };

    window.ebayCsvDebug = App.debug;

    if (typeof module !== 'undefined') {
        module.exports = {
            moneyOrNull,
            parseMoney,
            parsePriceRange,
            parseShippingFromRows,
            parseListingMode,
            inferBuyItNowPrice,
            getCards,
            extractListings,
        };
    }

    App.once('init', function init() {
        console.log('[eBay CSV Exporter] Loaded');
        console.log('[eBay CSV Exporter] Search query:', getSearchQuery());
        console.log('[eBay CSV Exporter] Page:', getPageNumber());
        console.log('[eBay CSV Exporter] Cards:', getCards().length);
        console.log('[eBay CSV Exporter] Try: ebayCsvDebug.print()');

        addExportButton();
    });
})();
