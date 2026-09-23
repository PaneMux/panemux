# PaneMux Design System

## What's being fixed
The current theme (big glowing neon circle, CRT scanlines, skewed glitch animations) reads as dated "hacker terminal" pastiche rather than a tool people actually want to look at all day, and the mode-indicator orb physically overlaps page content instead of living in its own space. This doc replaces it.

## Principles
1. **Dark by design, not just dark-colored** — layered surfaces (base / raised / overlay), not one flat black
2. **Quiet until needed** — chrome recedes at rest, animates briefly on state change, then settles back down
3. **Never obstruct content** — every HUD element either lives in a reserved strip or is small enough and low-opacity enough at rest to never matter
4. **Legible over decorative** — glow and motion are accents, not the headline

## Color Tokens

| Token | Value | Use |
|---|---|---|
| `--surface-base` | `#0B0B0F` | Page-level HUD background |
| `--surface-raised` | `#16161C` | Palette, panels, chips |
| `--border-subtle` | `#2A2A33` | 1px hairline borders |
| `--text-primary` | `#E4E4E7` | Primary HUD text |
| `--text-muted` | `#8A8A94` | Secondary/at-rest text |

Mode accents — softer, modern, desaturated compared to the old pure neon:

| Mode | Color |
|---|---|
| Normal | `#34D399` (emerald) |
| Insert | `#FBBF24` (amber) |
| Visual | `#A78BFA` (violet) |
| Command | `#38BDF8` (sky) |
| Operator-pending | `#FB7185` (rose) |

## Typography
- UI chrome (labels, palette copy): `Inter`, fallback `system-ui`
- Keys/commands/code: `JetBrains Mono`
- Scale: 11 / 13 / 15 / 20px

## Elevation & Motion
- Shadow: `0 8px 24px rgba(0,0,0,0.35)` — soft, not glowing
- Radius: 10px small elements, 14px palette
- Motion: 120–180ms ease-out, fade + scale only — **no skew, no glitch effects**
- Respect `prefers-reduced-motion`: disable all non-essential animation when set

## Component Redesigns

### Mode Indicator (the thing currently blocking content)
**Default: a slim status strip, not a floating blob.** Pin a 24px-tall bar to the very bottom edge of the viewport — like a code editor's status bar. It sits in its own reserved strip, so it structurally cannot cover page content. Left side: mode name in muted text with a small colored dot in the current mode's accent. Right side: reserved for future info (macro recording indicator, register in use, etc.).

If a floating element is preferred instead: shrink it to a 64×24px pill, inset 16px from the bottom-right corner, `surface-raised` background with backdrop-blur, a 4px colored left-edge bar for the mode color (not a full glowing ring), label in `text-muted`. Sits at 55% opacity at rest, animates to 100% opacity + 1.05 scale for 400ms on mode change, then eases back down. Container uses `pointer-events: none` except on itself, so it never intercepts clicks or scrolls meant for the page underneath.

### Command Palette
Appears ~15% from the top, max-width 560px, `surface-raised` background, `border-subtle` 1px border. Entrance: fade + scale from 0.97 → 1 over 150ms ease-out. No skew/glitch.

### Keystroke Trail
Bottom-left, small monospace chips (`surface-raised` bg, `border-subtle` border, `text-muted` text), each fades out via opacity + slight upward drift over 1.2s.

### Panels (undo tree, minimap)
`surface-raised` background, `border-subtle` dividers, no added glow — rely on the elevation shadow only.

## Explicitly removed from the old theme
- CRT scanline overlay (fine as an opt-in easter egg in settings, but **off by default**)
- Thick outer halo/glow around the mode indicator
- Skewed glitch-in entrance animation

## Implementation Notes
- Define every value above as a CSS custom property under one scope (e.g. `:root[data-panemux-theme]`) so all HUD components read from a single source of truth
- The HUD's root container must be `position: fixed`, sized to its actual content (never full-viewport), with `pointer-events: none` on the container and `pointer-events: auto` only on interactive children
- Never use `z-index` tricks to sit *on top of* content when a reserved-space layout (like the bottom status strip) avoids the conflict entirely
