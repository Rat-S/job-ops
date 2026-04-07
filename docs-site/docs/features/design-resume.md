---
id: design-resume
title: Design Resume
description: Edit the local resume document that JobOps uses for tailoring, scoring, and PDF generation.
sidebar_position: 4
---

## What it is

Design Resume is JobOps' local-first resume editor.

It stores a structured resume document inside JobOps, using the same v5-compatible JSON shape as Reactive Resume. JobOps uses this local document as the primary source of truth for:

- profile context
- project catalogs
- tailoring inputs
- scoring inputs
- PDF generation

## Why it exists

Depending on Reactive Resume for every profile lookup, project read, and PDF flow makes JobOps more fragile than it needs to be.

Design Resume reduces that dependency by letting you:

- import from Reactive Resume once
- keep editing locally inside JobOps
- preserve a structured JSON resume model
- export back out when needed

## How to use it

1. Open **Design Resume** from the main navigation.
2. If this is your first time, click **Import from Reactive Resume**.
3. Edit the left-panel fields directly.
4. Watch for the local save indicator in the header.
5. Use **Export** when you want a JSON snapshot of the current document.

Current v1 scope:

- left-panel editing only
- no live resume preview yet
- the center artboard already supports zoom and pan for the future preview surface

## Common problems

- Import button fails:
  Verify your Reactive Resume mode, URL, credentials, and selected base resume in **Settings**.
- Changes do not appear in a generated PDF:
  Re-run tailoring or PDF generation after the local save finishes.
- Picture upload fails:
  Use `png`, `jpeg`, or `webp` images.
- You changed the upstream resume and want that copied over:
  Use **Re-import** to replace the local document with the current Reactive Resume base resume.

## Related pages

- [Reactive Resume](./reactive-resume)
- [Settings](./settings)
- [Orchestrator](./orchestrator)
