# Foldable Frontmatter Groups

Adds collapsible group headers to the native Properties panel, keeps frontmatter keys in a canonical order, applies folder-scoped field templates, and provides cleanup tooling for stale or empty fields. All of it is configured from a settings UI, with no source edits.

<!-- Add a screenshot of the grouped Properties panel here:
![Foldable Frontmatter Groups](assets/screenshot.png) -->

## Why this exists

The native Properties panel renders every frontmatter key as a flat, unordered list. On a metadata-rich vault, AI-system fields, hidden fields, CRM fields, and content fields all pile up with no structure. As you adopt more metadata conventions, the clutter only grows.

Foldable Frontmatter Groups adds the structure the panel lacks: collapsible sections, a consistent key order, folder-appropriate defaults, and a way to find and scrub fields you no longer want, so the panel shows what matters for each note type.

## Features

- **Collapsible groups.** Group frontmatter rows under folding headers in the Properties panel. Each group matches by an ordered list of literal names and `prefix*` wildcards (for example `ai_*`, `aic_*`, `_*`), or by a regex for power use. First match wins by settings order.
- **Properties Order.** Pin chosen keys to the top of the panel in a fixed order, above the folding groups.
- **Per-field icons.** Map any frontmatter key to a Lucide icon, overriding the type-based row icon.
- **Folder templates.** Per folder-path prefix, insert default fields (with type-aware seed values and `<today>` / `<now>` markers), a per-template key order, an optional group assignment, and optional note-body scaffolding (evaluated through Templater when installed).
- **Auto-reconcile.** Optionally, when you open or leave a note, insert missing template defaults, scrub cleanup-flagged empty values, and reorder keys to the canonical order in a single write. Idempotent: an already-correct note is never rewritten.
- **Exclusions.** Exempt specific files from reconcile (and hide their Properties panel entirely), and exclude folder / MOC notes by default with per-note and per-folder whitelists.
- **Cleanup tab.** A frontmatter-management surface: an in-scope key catalog with null/coverage counts, remove-null and remove-all actions, a per-field occurrence inspector, and a migrate-field (rename across the vault) tool. Every scrub and migrate is written to a recoverable scrub log.
- **Orphan handling.** Passively tint any property no template claims, and optionally (off by default) scrub orphaned null values during reconcile.
- **Panel affordances.** A settings gear next to "Add property," a per-group-header gear that jumps to that group's template settings, and a refresh button that reconciles the active file on demand.
- **Desktop and mobile.** Works on both; verified on iPhone.

## Install

This plugin is not yet in the Community Plugins directory. Install it via BRAT.

### Via BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from the Community plugins directory.
2. In Obsidian: Settings → BRAT → **Add Beta plugin**.
3. Paste: `cwagner223355/obsidian-foldable-frontmatter-groups`
4. Enable **Foldable Frontmatter Groups** in Community plugins.

## Settings

Settings live on three tabs.

| Tab | What it configures |
|---|---|
| **Grouping** | The master folding toggle and auto-reconcile toggle (with the exclude-list editor and the opt-in orphan-null scrub); Properties Order; global folder templates; and the groups, each with its matcher, fold-by-default state, and linked templates. |
| **Customize Icons** | Per-field Lucide icon overrides. |
| **Cleanup** | The in-scope key catalog with counts, per-field cleanup scope, remove-null / remove-all, the field-occurrence inspector, migrate field, and the scrub-log viewer. |

Key toggles:

| Setting | Default | Description |
|---|---|---|
| Group folding | on | Master switch. When off, the plugin unwraps every group and leaves the native panel untouched; settings below dim but persist. |
| Auto-reconcile frontmatter | off | When on, reconcile fires on both file open and file leave. Manual commands run regardless. |
| Exclude folder notes | on | Automatically exempt folder / MOC notes from reconcile, with per-note and per-folder whitelists. |
| Scrub orphaned nulls | off | During reconcile, delete null values whose key no matching template claims. Opt-in. |

## Commands

| Command | Action |
|---|---|
| Reconcile frontmatter order (active file) | Run the full reconcile pass (defaults, cleanup, reorder) on the active file, regardless of the auto-reconcile toggle. |
| Apply default frontmatter (active file) | Same pass, surfaced as a defaults-first action. |

## How reconcile works

Each reconcile does three things in one `processFrontMatter` write: it inserts template defaults into missing or empty keys (never overwriting a value that already holds data), scrubs cleanup-flagged null values, and reorders keys to the canonical order (Properties Order keys first, then unmatched keys in place, then each group's matching-template order). A key that any matching template lists as a default is never scrubbed by the cleanup pass, so a field configured as both is stable. When the note is already correct, no file is written.

Reconcile is triggered only by you opening or leaving a note, never by a background vault watcher. Any DOM or write error leaves the native Properties UI untouched.

## Recovering scrubbed fields

Every remove-null, remove-all, and migrate action appends the removed `{ path, value }` pairs to `scrub-log.json` in the plugin folder (capped at 500 entries). The "View scrub log" modal renders them newest-first with a date-range JSON export. Recovery is manual (there is no one-click restore yet).

## License

MIT — see [LICENSE](LICENSE).
