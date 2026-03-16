# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive travel itinerary website for a Costa Rica trip (April 9–17, 2026). Static site deployed to GitHub Pages via GitHub Actions on push to `main`.

## Architecture

- **No build step** — pure HTML5 + CSS3 + vanilla JavaScript, served as static files
- **Single shared design system** — CSS variables (`:root`) are duplicated across all HTML files (same color palette, typography, spacing tokens)
- **Pages**: `index.html` (main itinerary with calendar, alerts, timeline, costs), `hospedagem.html` (accommodation options), `veiculo.html` (car rental comparison), `mapa.html` (interactive route map using Leaflet)
- **`currency.js`** — shared module that fetches USD→BRL exchange rate from `open.er-api.com`, caches it in localStorage (4h TTL), and exposes `window.BRL_RATE`, `window.toBrlText()`, `window.withBrl()`, `window.applyBrlConversion()` for inline price conversion across all pages
- All CSS is inlined in `<style>` tags within each HTML file (no external stylesheets)
- All page-specific JS is inlined in `<script>` tags at the bottom of each HTML file

## Deployment

Push to `main` triggers `.github/workflows/deploy.yml` which deploys the entire repo root to GitHub Pages. No build/compile step — files are served as-is.

## Development

Open any HTML file directly in a browser, or use a local server:
```bash
python3 -m http.server 8000
```

## Key Conventions

- Language: all UI text is in **Portuguese (pt-BR)**
- Prices are displayed in USD with automatic BRL conversion via `currency.js`
- CSS variables follow a nature-inspired naming: `--jungle`, `--canopy`, `--leaf`, `--sand`, `--lava`, `--ocean`, `--sky`, `--gold`
- Google Fonts: Playfair Display (headings), DM Sans (body), JetBrains Mono (monospace)
- Responsive design with `clamp()` and media queries
