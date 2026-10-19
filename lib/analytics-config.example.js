/*
 * Google Analytics 4 (Measurement Protocol) configuration.
 * Copy this file to lib/analytics-config.js and fill in your own values.
 * While these placeholders are present, analytics is a silent no-op
 * (no network requests, no client id is created).
 */
var GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
var GA_API_SECRET = 'REPLACE_ME';
if (typeof module !== 'undefined' && module.exports) module.exports = { GA_MEASUREMENT_ID: GA_MEASUREMENT_ID, GA_API_SECRET: GA_API_SECRET };