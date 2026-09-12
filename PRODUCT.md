# AgroSense product context

<!-- impeccable:product-schema 1 -->

Product direction confirmed through the design interview on 2026-09-12.
This describes intended use, not features already implemented.

## Platform

web

## Users

Agricultural producers are the primary audience. Additional audiences and roles
have not been defined.

## Product Purpose

Help a producer answer: “Which field needs my attention today, why, and what
should I do next?” Success means understanding priorities and identifying the
next useful action.

## Operating Context

The computer experience should be visual: explore fields, understand conditions,
and compare information. The phone experience should be functional: identify
priorities, read concise explanations, and take quick actions. These are different
emphases within the same product.

## Brand Commitments

AgroSense should feel calm, credible, approachable, and grounded in agriculture.
Landtoken is the confirmed aesthetic reference for natural colors, real farmland
imagery, and agricultural credibility. The agreed direction is recorded in the
[style guide](docs/style-guide.md).

## Capabilities and Constraints

The current repository contains a React/Vite frontend, a Hono API on Cloudflare
Workers, and shared Zod contracts. It currently demonstrates API connectivity.
See [stack decisions](docs/stack.md).

Maps, field comparisons, alerts, and suggested actions are design intentions;
their data sources and behavior are not implemented or specified by this record.
The product's distinguishing mechanism, supported crops and regions, language,
offline needs, and concrete producer actions remain open.

## Product Principles

- Make the land visible and the next action clear.
- Organize information around the producer's decisions.
- Adapt information priority to the device, preserving meaning across views.
- Establish credibility through clear explanations and honest information.

## Evidence on Hand

The design interview establishes audience, primary job, device priorities, and
visual direction. The repository supplies a working scaffold. The interview
supplies no field data, agronomic rules, customer claims, or image licenses.
