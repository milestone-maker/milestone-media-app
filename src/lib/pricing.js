// Centralized pricing — single source of truth.
//
// public/pricing.json is the data file. This module loads it and
// re-exports each section under a stable named export so callers
// don't reach into the JSON structure directly. The marketing site
// fetches /pricing.json at runtime; the agent app imports it at
// build time via this module.
//
// To change a price, edit public/pricing.json. Do not put numbers
// in this file or in App.jsx — this is the only path.
//
// This module lives in src/lib/ to break a circular import chain
// that existed when App.jsx re-exported these constants: views
// imported them from App.jsx while App.jsx imported the views, and
// Rollup's production hoisting tripped a temporal-dead-zone error
// at runtime. lib/ has no React component dependencies, so importing
// from here from any view or from App.jsx is safe.

import PRICING from "../../public/pricing.json";

export { PRICING };

export const PACKAGES            = PRICING.packages;
export const SQFT_TIERS          = PRICING.sqftTiers;
export const ESSENTIAL_PRICING   = PRICING.essentialPricing;
export const INDIVIDUAL_SERVICES = PRICING.individualServices;
export const ADDONS              = PRICING.addons;
export const SUBSCRIPTIONS       = PRICING.subscriptions;
export const PROMOS              = PRICING.promos;
export const STRIPE_IDS          = PRICING.stripeIds;
