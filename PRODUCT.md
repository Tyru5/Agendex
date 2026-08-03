# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Agendex serves solo AI-coding power users and engineering teams who need a reliable way to manage the plans their coding agents create. Users may be working locally on one machine, coordinating across multiple machines, or reviewing shared cloud plans with teammates. Their core job is to find, inspect, organize, share, and track agent plans without losing context as agent activity grows.

## Product Purpose

Agendex indexes plans and sessions produced by coding agents and turns them into a searchable, navigable workspace. The product exists so users can see what their agents planned, what changed, which work matters, and where collaboration or follow-up is needed. Success means users can move from scattered local plan files to confident plan review and coordination with minimal setup, low friction, and clear provenance.

## Positioning

Agendex works with the plan and session artifacts coding agents already create. It indexes those artifacts locally, keeps local-only usage fully functional without cloud infrastructure, and adds optional synchronization and collaboration without requiring users to move agent work into a separate project-management system.

## Operating Context

Users encounter Agendex through the local web app, Cloud Pro web dashboard, CLI, background daemon, and Electron desktop wrapper. The product scans agent-owned directories and custom plan sources, watches local files for changes, and can synchronize selected plans to a shared cloud workspace. Core review work includes searching and filtering plans, reading plan content and provenance, comparing history, and coordinating through sharing and comments.

## Capabilities and Constraints

- The free OSS flow supports local indexing, search, filtering, live file watching, custom plan sources, offline recovery, and token-authenticated local API access without Convex or Stripe.
- Cloud Pro adds authentication, synchronization, share links, comments, tags, collections, plan history, workspace membership, plan creation and editing, and subscription flows.
- The CLI and daemon connect local agent artifacts to cloud workspaces while skipping unchanged content, retrying failed uploads, and preserving sync provenance.
- The Electron application wraps the shared web interface, embeds the local API, and owns a cloud sync worker when no CLI daemon is already running.
- Local and cloud behavior share plan classification and adapter logic, but cloud authentication and collaboration depend on the EE stack.

## Brand Commitments

Agendex is elegant, modern, concise, precise, and capable. The product should earn trust through polish and restraint during repeated daily use. Copy is direct, economical, and action-oriented.

Avoid cluttered project-management suites, toy AI dashboard visuals, bloated SaaS patterns, excessive decorative chrome, and interfaces that make agent work feel more complicated than the underlying plans. Agendex should not become a generic task board, novelty AI wrapper, or loud analytics product.

## Evidence on Hand

- The root `README.md` documents the product architecture, local and cloud feature split, adapter model, and supported workflows.
- `packages/cli/README.md` documents synchronization, daemon behavior, plan-value filtering, provenance, and supported runtime behavior.
- `docs/self-hosting.md` documents the deployable EE stack and its external-service requirements.
- The runnable OSS, EE, CLI, and Electron packages demonstrate the product workflows described above.
- No customer testimonials, case studies, press coverage, or externally validated product benchmarks are documented in the repository; future work must not invent them.

## Product Principles

1. Plan-first clarity: make plan title, source, recency, status, and next actions easy to find.
2. Local-to-cloud continuity: preserve one coherent workflow across local OSS use and Cloud Pro collaboration.
3. Expert control at volume: make large plan libraries fast to search, filter, scan, and review.
4. Collaboration without ceremony: help teams share and discuss plans without imposing heavyweight project management.
5. Trust through provenance: keep file sources, sync state, daemon health, and permission boundaries understandable at the point of use.

## Accessibility & Inclusion

Target WCAG AA. Core workflows should be keyboard-friendly, readable in light and dark themes, and usable with reduced motion. Status, sync, and plan-state indicators should not rely on color alone. Motion should be purposeful, optional where appropriate, and limited to opacity and transform for comfort and performance.
