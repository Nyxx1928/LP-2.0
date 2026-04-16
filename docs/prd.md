# Product Requirements Document (PRD)

## 1. Document Control

- Project Name: Likhang Pinas E-Commerce Platform
- Version: 2.0 (MVP)
- Date: April 2026
- Prepared by: Nicolas Lumapak
- Target Launch: 3rd Week of May 2026

## 2. Executive Summary

Likhang Pinas is a custom headless e-commerce platform for selling a curated catalog of household, wooden, electrical, and hand tools to customers in the Philippines. The store is single-seller and managed entirely by the internal team, with no third-party vendors or resellers.

By owning the full commerce stack and customer journey, the business aims to reduce marketplace dependency and fees, improve margins, and maintain full control over branding, pricing, and customer experience.

Business Goal:

- Support 200 to 2,000 active users/customers within the first 12 to 18 months
- Keep operating costs lean while maximizing net profit

## 3. Business Objectives

- Reduce dependency on large marketplaces (Lazada, Shopee) and their commission structures.
- Increase profit margins through direct sales and lower platform costs.
- Build a trustworthy online storefront with clean product presentation.
- Deliver a reliable shopping experience with fast local fulfillment and responsive support.
- Maintain compliance with Philippine tax and privacy regulations (including BIR and Data Privacy Act requirements).
- Enable straightforward internal inventory and order operations.

## 4. Target Audience and Scope

Target Users:

- Filipino households
- Small workshops
- Hobbyists and DIY enthusiasts

Geographic Focus:

- Initial focus on Quezon City and nearby NCR/proximate provinces

Traffic/Scale Expectation:

- Low to medium volume in MVP (hundreds to low thousands of users)
- No viral-scale expectation in initial release

Market Positioning:

- Affordable, reliable everyday tools and home items
- Honest product descriptions and practical value
- Local stock visibility and quick fulfillment

Out of Scope for MVP:

- Multi-vendor marketplace capabilities
- International shipping
- Subscriptions
- Advanced loyalty programs
- Native mobile app
- Heavy marketing automation

## 5. Product Catalog Requirements

Initial SKU Range:

- 50 to 150 SKUs (curated)

Primary Categories:

- TV Remotes and Accessories: Universal and brand-specific remotes, batteries, holders
- Wooden Products: Wall clocks, pizza paddles/peels, cutting boards, decorative items, utensil holders
- Electrical Items: Extension cords/wires, power strips, plugs, adapters, basic wiring tools
- Hand Tools and Hardware: Screwdrivers, pliers, measuring tapes, soldering irons, wrenches, hammers, utility knives

Mandatory Product Fields:

- Title
- Description
- Rich media (multiple photos; optional short video)
- Variants (for color, size, length, wattage, set/single, etc.)
- Pricing (regular and optional sale pricing)
- Inventory levels and low-stock indicator
- SKU
- Weight and dimensions (shipping use)
- Categories and tags

Recommended Product Fields:

- Material (example: solid wood, ABS plastic)
- Brand (where applicable)
- Simple specification table
- SEO metadata (meta title and meta description)

Catalog Management Needs:

- Bulk upload/edit capability via admin tooling
- Stock visibility states: in stock, low stock, out of stock
- Basic promotional pricing (example: category/item-level percentage discount)

## 6. Core User Features (Storefront)

Browsing and Discovery:

- Homepage with featured products and category highlights
- Product grid with filter controls (category, price, material)
- Basic keyword and category search
- Product detail pages with media gallery, variant selection, stock status, and add-to-cart

Shopping Experience:

- Persistent shopping cart sessions
- Secure checkout supporting guest and account flows
- Multiple shipping options (standard courier and optional pickup)
- Payment options: Stripe plus Philippine-local methods (GCash, Maya/PayMongo, and bank transfer option)

Customer Account:

- Registration and login via email/password (social login optional)
- Order history and status tracking
- Basic profile management including shipping addresses

Post-Purchase:

- Order confirmation and status update emails
- Product review/rating feature can be deferred to later phase

## 7. Admin and Operational Features

- Product, inventory, and order management dashboard
- Customer list and basic support utilities
- Fulfillment workflow states: packed, shipped, delivered
- Basic reporting: total orders, revenue, top products
- Easy updates for simple content pages and promotional banners

## 8. Technical Requirements

Architecture:

- Medusa.js v2 backend (TypeScript)
- Next.js 15 storefront (TypeScript)
- Turborepo monorepo setup

Data Layer:

- PostgreSQL (managed; Neon or Supabase recommended)

Core Integrations:

- Payments: Stripe + PayMongo/GCash
- Search: Meilisearch or built-in search approach
- Email: Resend or Postmark
- File storage: UploadThing or S3-compatible storage

Performance and UX:

- Fast page loads via ISR/SSR strategies
- Mobile-responsive UX
- Tailwind + shadcn/ui component strategy

Security Baseline:

- HTTPS everywhere
- Strong authentication and session protection
- Input validation for all user and API payloads
- Route-level rate limiting for sensitive paths
- Cloudflare edge protection
- PCI-safe payment tokenization (no raw card storage)

## 9. Non-Functional Requirements

- Scalability: support low-to-medium traffic with a path to scale
- Security and compliance: OWASP-aligned practices, Data Privacy Act adherence, BIR obligations
- Reliability: 99%+ availability target with daily backup strategy
- Usability: intuitive customer UX and simple team operations
- Maintainability: straightforward product/content update workflow

## 10. MVP Success Metrics

- Platform successfully launched and production-ready
- First 50 orders processed successfully
- Positive early customer feedback on checkout and delivery experience
- Internal team independently manages products/orders without developer intervention
- Improved margin versus previous marketplace-led channel
- Mobile page load target: under 2 seconds (critical pages)

## 11. Assumptions and Risks

Assumptions:

- Fulfillment and support are handled fully in-house
- Product media and descriptions are provided by the internal team

Risks and Mitigations:

- Low initial traffic: prioritize basic SEO and social amplification
- Tax/compliance changes: monitor BIR updates and keep scope manageable
- Inventory inaccuracies: combine real-time stock tracking with operational checks
- Payment disruptions: support multiple payment methods, including bank transfer fallback

## 12. Post-MVP Enhancements

- Advanced filtering and recommendations
- Wishlist and abandoned cart recovery
- Content/blog section for DIY guides and product education
- Loyalty points or referral incentives
- Courier API integration for automated shipment tracking

## 13. Approval and Sign-Off

This PRD defines the MVP baseline for scope, delivery, and operational expectations of Likhang Pinas. Changes after sign-off should go through versioned updates to preserve launch timeline and scope integrity.
