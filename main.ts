import {
  Plugin,
  PluginSettingTab,
  App,
  Setting,
  AbstractInputSuggest,
  TFile,
  TFolder,
  Menu,
  Modal,
  Notice,
  setIcon,
  getIconIds,
  MarkdownView,
  debounce,
} from "obsidian";

// ── Serializable settings schema ──────────────────────────────────────────────

interface StoredGroupConfig {
  id: string;
  name: string;
  matcherType: "unified" | "regex";
  matcherValues: string[];
  defaultFolded: boolean;
  fieldOrder: string[];
}

interface IconOverride {
  name: string;
  icon: string;
}

interface TemplateField {
  name: string;
  value?: unknown;
}

interface FolderTemplate {
  id: string;
  name: string;
  pathPrefixes: string[];
  excludedPathPrefixes: string[];
  // Optional id of the single group this template's fields belong to for
  // Properties-panel display. Undefined = no group context (standalone /
  // global template). Replaces the older linkedGroups: string[] array.
  group?: string;
  fields: TemplateField[];
  fieldOrder: string[];
  excludedFields: string[];
  lintFields: string[];
  noGroupFields: string[];
  bodyTemplatePath?: string;
}

interface ScrubLogFileEntry {
  path: string;
  value: unknown;
}

interface SettingsUpdateDecision {
  id: string;
  label: string;
  sourceValue: unknown;
  targetValue: unknown;
  targetHadEntry: boolean;
  choice: "source" | "target";
  apply: (chosen: "source" | "target") => void;
}

interface SettingsUpdatePlan {
  cleanUpdates: Array<{ label: string; apply: () => void }>;
  decisions: SettingsUpdateDecision[];
}

interface ScrubLogEntry {
  ts: number;
  action: "remove-null" | "remove-all" | "migrate";
  scope: string;
  field: string;
  // For migrate: target field name. Omitted for other actions.
  targetField?: string;
  files: ScrubLogFileEntry[];
  // For migrate: each file's target value before write, when overwriting.
  // Indexed parallel to `files`. Omitted for other actions.
  targetValuesBefore?: unknown[];
}

interface PluginSettings {
  groupFoldingEnabled: boolean;
  reconcileOnLeave: boolean;
  reconcileExcludedFiles: string[];
  // When true, every "folder note" (file whose basename equals its parent
  // folder's name) is treated as if it were on reconcileExcludedFiles.
  excludeFolderNotes: boolean;
  // Folder notes listed here are exempt from the excludeFolderNotes rule:
  // they show frontmatter and participate in auto-reconcile normally. The
  // manual reconcileExcludedFiles list still takes precedence over whitelist.
  folderNoteWhitelist: string[];
  // Folder-path prefixes (vault-relative, trailing-slash normalized). Any
  // folder note inside one of these folders (at any depth) is whitelisted.
  folderNoteWhitelistFolders: string[];
  scrubOrphanNulls: boolean;
  topZone: { fieldOrder: string[] };
  groups: StoredGroupConfig[];
  iconOverrides: IconOverride[];
  folderTemplates: FolderTemplate[];
  cleanupAdHocFields: string[];
  globalLintFields: string[];
}

const DEFAULT_SETTINGS: PluginSettings = {
  groupFoldingEnabled: true,
  reconcileOnLeave: false,
  reconcileExcludedFiles: [],
  excludeFolderNotes: true,
  folderNoteWhitelist: [],
  folderNoteWhitelistFolders: [],
  scrubOrphanNulls: false,
  topZone: { fieldOrder: [] },
  groups: [
    {
      id: "ai",
      name: "AI Properties",
      matcherType: "unified",
      matcherValues: ["ai_*", "claude_*"],
      defaultFolded: true,
      fieldOrder: [],
    },
    {
      id: "hidden",
      name: "Hidden Properties",
      matcherType: "unified",
      matcherValues: ["_*"],
      defaultFolded: true,
      fieldOrder: [],
    },
  ],
  iconOverrides: [],
  folderTemplates: [],
  cleanupAdHocFields: [],
  globalLintFields: [],
};

function orderByFieldOrder(props: HTMLElement[], fieldOrder: string[]): HTMLElement[] {
  const byKey = new Map<string, HTMLElement>();
  for (const p of props) byKey.set(p.dataset.propertyKey ?? "", p);
  const result: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const key of fieldOrder) {
    const p = byKey.get(key);
    if (p) {
      result.push(p);
      seen.add(p);
    }
  }
  for (const p of props) if (!seen.has(p)) result.push(p);
  return result;
}

// ── Runtime types ─────────────────────────────────────────────────────────────

interface RuntimeGroup {
  id: string;
  name: string;
  // True for ANY claim (template OR non-template). Kept for back-compat /
  // callsites without file context.
  matcher: (key: string) => boolean;
  // Wildcards, regex, and the group's own literal matcher entries. These
  // apply vault-wide regardless of which file is being rendered.
  nonTemplateMatcher: (key: string) => boolean;
  // Literals contributed by linked templates' show-in-group rows. Each maps
  // to the templates that contributed it; at runtime we only consider this
  // literal a group claim if the file is matched by one of those templates.
  templateLiteralOwners: Map<string, FolderTemplate[]>;
  defaultFolded: boolean;
  fieldOrder: string[];
}

function getGroupLiteralFields(g: StoredGroupConfig): string[] {
  if (g.matcherType === "regex") return g.fieldOrder ?? [];
  return (g.matcherValues ?? []).filter((v) => v && !v.endsWith("*"));
}

// Alphabetical summary of every field this group covers:
//   - legacy group literals (no template origin)
//   - every linked template's show-in-group field, with all contributing
//     templates listed if a name appears in more than one.
function getGroupTemplateContributedLiterals(
  g: StoredGroupConfig,
  templates: FolderTemplate[]
): Array<{ name: string; originTemplates: string[] }> {
  const map = new Map<string, string[]>();
  for (const lit of getGroupLiteralFields(g)) {
    if (lit && !map.has(lit)) map.set(lit, []);
  }
  for (const t of templates) {
    if (t.group !== g.id) continue;
    const skip = new Set(t.noGroupFields ?? []);
    const label = t.name || t.id;
    for (const f of t.fields) {
      if (!f.name || skip.has(f.name)) continue;
      const arr = map.get(f.name) ?? [];
      if (!arr.includes(label)) arr.push(label);
      map.set(f.name, arr);
    }
  }
  return Array.from(map.entries())
    .map(([name, originTemplates]) => ({ name, originTemplates }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Literal entries (from the group's own matcher AND from linked templates'
// show-in-group fields) plus every vault frontmatter key that matches any of
// the group's wildcards (and any regex pattern, for regex matchers). Used
// wherever "what fields does this group cover" matters.
// Compile a group's matcher into a key-test predicate. Returns null when the
// group has no usable matcher entries (in which case the wildcard set is empty).
function compileGroupMatcher(
  g: StoredGroupConfig
): ((key: string) => boolean) | null {
  if (g.matcherType === "regex") {
    const regexes: RegExp[] = [];
    for (const v of g.matcherValues ?? []) {
      try {
        regexes.push(new RegExp(v));
      } catch {
        // Invalid pattern silently contributes nothing.
      }
    }
    if (regexes.length === 0) return null;
    return (key) => regexes.some((re) => re.test(key));
  }
  const prefixes: string[] = [];
  for (const v of g.matcherValues ?? []) {
    if (v && v.endsWith("*")) {
      const p = v.slice(0, -1);
      if (p.length > 0) prefixes.push(p);
    }
  }
  if (prefixes.length === 0) return null;
  return (key) => {
    for (const p of prefixes) {
      if (key.startsWith(p) && key.length > p.length) return true;
    }
    return false;
  };
}

// One full vault scan to expand a group's matcher into the set of keys that
// currently exist in vault frontmatter. Sorted for stable iteration order.
// Use FoldableFrontmatterGroupsPlugin.cachedWildcardKeys() for hot paths.
function computeGroupWildcardKeys(g: StoredGroupConfig, app: App): string[] {
  const matches = compileGroupMatcher(g);
  if (!matches) return [];
  const matched = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;
    for (const k of Object.keys(fm)) {
      if (!k || k === "position") continue;
      if (matched.has(k)) continue;
      if (matches(k)) matched.add(k);
    }
  }
  return Array.from(matched).sort();
}

function getGroupEffectiveFields(
  g: StoredGroupConfig,
  app: App,
  templates?: FolderTemplate[]
): string[] {
  const contributedLiterals = templates
    ? getGroupTemplateContributedLiterals(g, templates).map((e) => e.name)
    : getGroupLiteralFields(g);
  const seen = new Set(contributedLiterals);
  const out = [...contributedLiterals];
  for (const k of computeGroupWildcardKeys(g, app)) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

// Sort templates the way they appear on the Grouping tab: Global Templates
// first (no group), then by each group's position in settings; within each
// section preserve the templates' array order.
function sortTemplatesByGroupingOrder(
  templates: FolderTemplate[],
  groups: StoredGroupConfig[]
): FolderTemplate[] {
  const groupIndex = new Map(groups.map((g, i) => [g.id, i]));
  const naturalIndex = new Map(templates.map((t, i) => [t.id, i]));
  return [...templates].sort((a, b) => {
    const aSection = a.group ? groupIndex.get(a.group) ?? Number.MAX_SAFE_INTEGER : -1;
    const bSection = b.group ? groupIndex.get(b.group) ?? Number.MAX_SAFE_INTEGER : -1;
    if (aSection !== bSection) return aSection - bSection;
    return (naturalIndex.get(a.id) ?? 0) - (naturalIndex.get(b.id) ?? 0);
  });
}

function toRuntimeGroup(
  g: StoredGroupConfig,
  templates: FolderTemplate[] = []
): RuntimeGroup {
  const values = (g.matcherValues ?? []).filter((v) => v && v.length > 0);
  let nonTemplateMatcher: (key: string) => boolean;
  let fieldOrder: string[];

  // Literals contributed by linked templates (show-in-group rows), tagged
  // with their owning template(s). The runtime uses owners to decide whether
  // a template literal applies on a given file (only when an owner's
  // pathPrefixes match the file path).
  const templateLiteralOwners = new Map<string, FolderTemplate[]>();
  for (const t of templates) {
    if (t.group !== g.id) continue;
    const skip = new Set(t.noGroupFields ?? []);
    for (const f of t.fields) {
      if (!f.name || skip.has(f.name)) continue;
      const list = templateLiteralOwners.get(f.name) ?? [];
      if (!list.includes(t)) list.push(t);
      templateLiteralOwners.set(f.name, list);
    }
  }

  if (g.matcherType === "regex") {
    const regexes: RegExp[] = [];
    for (const v of values) {
      try {
        regexes.push(new RegExp(v));
      } catch {
        // Invalid regex silently contributes nothing.
      }
    }
    nonTemplateMatcher = (key) => regexes.some((re) => re.test(key));
    fieldOrder = [
      ...templateLiteralOwners.keys(),
      ...(g.fieldOrder ?? []),
    ];
  } else {
    // unified: literal entries + `prefix*` wildcards
    const groupOwnLiterals = new Set<string>();
    const prefixes: string[] = [];
    for (const entry of values) {
      if (entry.endsWith("*") && entry.length > 1) {
        prefixes.push(entry.slice(0, -1));
      } else {
        groupOwnLiterals.add(entry);
      }
    }
    nonTemplateMatcher = (key) => {
      if (groupOwnLiterals.has(key)) return true;
      for (const p of prefixes) {
        if (key.startsWith(p)) return true;
      }
      return false;
    };
    const groupLiteralOrder = values.filter((v) => !v.endsWith("*"));
    fieldOrder = [
      ...groupLiteralOrder,
      ...Array.from(templateLiteralOwners.keys()).filter(
        (n) => !groupLiteralOrder.includes(n)
      ),
    ];
  }

  // Back-compat: combined matcher returns true for any claim. Callsites
  // without file context fall back to this; the path-aware classifier in
  // processContainer / computeCanonicalOrder uses templateLiteralOwners.
  const matcher = (key: string) =>
    nonTemplateMatcher(key) || templateLiteralOwners.has(key);

  return {
    id: g.id,
    name: g.name,
    defaultFolded: g.defaultFolded,
    fieldOrder,
    matcher,
    nonTemplateMatcher,
    templateLiteralOwners,
  };
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class FoldableFrontmatterGroupsPlugin extends Plugin {
  settings!: PluginSettings;
  private observer: MutationObserver | null = null;
  private foldState = new WeakMap<HTMLElement, Map<string, boolean>>();
  private isProcessing = false;
  private lastActiveFile: TFile | null = null;
  // Cache of vault-wide wildcard expansion per group. Key encodes matcher
  // state so any settings edit that changes matching naturally produces a
  // miss without explicit cleanup. Cleared wholesale on saveSettings and on
  // metadataCache changes (debounced).
  private wildcardExpansionCache = new Map<string, string[]>();
  // Single cached scan of every frontmatter key in the vault. All per-group
  // wildcard expansion filters this set instead of re-scanning all files per
  // group (the old hot path cost N full vault scans). Rebuilt on invalidation.
  private allVaultKeysCache: Set<string> | null = null;
  // Gates metadataCache "changed" invalidation until the initial vault index
  // has settled. During cold start the cache fires for thousands of files; left
  // ungated it nukes the wildcard cache repeatedly and forces the panel to
  // re-scan the whole vault mid-load (the mobile 3s stall). Flipped true once
  // after layout-ready + first "resolved" (or a safety timer on warm starts).
  private indexReady = false;
  private metadataCacheInvalidationTimer: number | null = null;
  private contextMenuBoundContainers = new WeakSet<HTMLElement>();
  // Reference to the settings tab so Properties-panel affordances (e.g. the
  // per-group settings icon) can drive navigation into the settings UI.
  settingTab: FfgSettingTab | null = null;
  // Debounced persistence for per-keystroke settings inputs (template names,
  // path prefixes, icon names, seed values). Fires once, 400ms after the last
  // keystroke, so typing doesn't trigger a data.json write + wildcard-cache
  // invalidation + full panel reprocess per character. Toggles and buttons
  // still call saveSettings() directly.
  saveSettingsDebounced = debounce(() => void this.saveSettings(), 400, true);
  // Timers that must not fire after unload (they would repaint or reconcile
  // on a dead plugin). Cleared wholesale in onunload.
  private pendingTimers = new Set<number>();

  async onload() {
    console.log(`[FFG] loading v${this.manifest.version}`);
    await this.loadSettings();
    this.settingTab = new FfgSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.app.workspace.onLayoutReady(() => {
      // Process whatever panels exist now, then start observing. Installing the
      // observer here (not in onload) keeps it from churning through the entire
      // workspace DOM construction before there's anything for us to do.
      this.processAllContainers();
      this.lastActiveFile = this.app.workspace.getActiveFile();
      this.installObserver();

      // Register the create handler HERE, not in onload. Obsidian fires
      // vault "create" for every existing file during vault init; registering
      // in onload would run applyDefaultsOnCreate (frontmatter writes + a full
      // vault.read for body templates) across the whole vault at startup. The
      // layoutReady guard is belt-and-suspenders against any same-tick storm.
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (!this.app.workspace.layoutReady) return;
          if (file instanceof TFile && file.extension === "md") {
            if (this.isFileExcludedFromReconcile(file.path)) return;
            void this.applyDefaultsOnCreate(file);
          }
        })
      );

      // Flip indexReady once the initial vault index settles, then do one
      // expansion + repaint so wildcard groups pick up the full key universe.
      // Idempotent: whichever of "resolved" / the safety timer fires first
      // wins. The timer covers warm starts where "resolved" never re-fires
      // (otherwise indexReady would stay false and new keys would stop folding
      // until a reload).
      const markReady = () => {
        if (this.indexReady) return;
        this.indexReady = true;
        this.invalidateWildcardCache();
        this.processAllContainers();
      };
      // "resolved" is the real signal (initial index complete). The timer is
      // only a long backstop for warm starts where it never re-fires; kept
      // generous so it won't preempt a slow mobile cold-start index.
      this.registerEvent(this.app.metadataCache.on("resolved", markReady));
      this.scheduleTimeout(markReady, 10000);
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const newFile = this.app.workspace.getActiveFile();
        const previous = this.lastActiveFile;
        this.lastActiveFile = newFile;

        if (!this.settings.reconcileOnLeave) return;
        if (!this.settings.groupFoldingEnabled) return;
        if (!previous) return;
        if (previous === newFile) return;
        if (previous.extension !== "md") return;
        if (this.isFileExcludedFromReconcile(previous.path)) return;

        void this.reconcileFrontmatter(previous);
      })
    );

    this.addCommand({
      id: "reconcile-frontmatter-order",
      name: "Reconcile frontmatter order (active file)",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice("[FFG] No active markdown file");
          return;
        }
        const result = await this.reconcileFrontmatter(file);
        if (result === "rewrote") new Notice("[FFG] Frontmatter updated");
        else if (result === "noop") new Notice("[FFG] Already in canonical order");
        else if (result === "no-frontmatter") new Notice("[FFG] No frontmatter");
        else if (result === "error") new Notice("[FFG] Error, see console");
      },
    });

    this.addCommand({
      id: "apply-default-frontmatter",
      name: "Apply default frontmatter (active file)",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice("[FFG] No active markdown file");
          return;
        }
        const result = await this.reconcileFrontmatter(file);
        if (result === "rewrote") new Notice("[FFG] Frontmatter updated");
        else if (result === "noop") new Notice("[FFG] No changes needed");
        else if (result === "no-frontmatter") new Notice("[FFG] No frontmatter");
        else if (result === "error") new Notice("[FFG] Error, see console");
      },
    });

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this.isFileExcludedFromReconcile(file.path)) return;
        // Only fire body insertion if the new path matches a template the
        // old path did NOT match. Avoids re-insertion when shuffling within
        // an already-matching folder.
        const wasMatch = this.computeBodyTemplateForFile(oldPath);
        const isMatch = this.computeBodyTemplateForFile(file.path);
        if (!isMatch || wasMatch === isMatch) return;
        void this.maybeInsertBodyTemplate(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || file.extension !== "md") return;
        if (!this.settings.reconcileOnLeave) return;
        if (!this.settings.groupFoldingEnabled) return;
        if (this.isFileExcludedFromReconcile(file.path)) return;
        // Defer to next tick so the file-open paint isn't blocked by the
        // synchronous compute phase of reconcile.
        this.scheduleTimeout(() => {
          void this.reconcileFrontmatter(file);
        }, 0);
      })
    );

    // When an open file is modified externally, check shortly after whether
    // the open view's content still diverges from disk (Obsidian sometimes
    // misses the reload). If stale, reload the view from disk.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (!this.isFileOpenInAnyLeaf(file)) return;
        const tModify = performance.now();
        // Snapshot view content now. If the view changes before the check
        // fires, the user is actively editing and we must not clobber their work.
        const viewSnapshot = new Map<object, string>();
        this.app.workspace.iterateAllLeaves((leaf) => {
          const view = leaf.view as unknown as { file?: TFile; getViewData?: () => string };
          if (view?.file === file && typeof view.getViewData === "function") {
            viewSnapshot.set(leaf, view.getViewData());
          }
        });
        this.scheduleTimeout(() => {
          void this.checkAndFixStaleView(file, tModify, viewSnapshot);
        }, 500);
      })
    );

    // Invalidate the wildcard cache when vault frontmatter changes, so newly
    // added keys flow into group expansion without a plugin reload. Debounced
    // to keep cache hot during open-many-files bursts (vault load, link
    // walks, etc).
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        // Ignore the indexing storm during cold start; markReady does the one
        // post-index expansion. Only live edits past that point invalidate.
        if (!this.indexReady) return;
        if (this.metadataCacheInvalidationTimer !== null) {
          window.clearTimeout(this.metadataCacheInvalidationTimer);
        }
        this.metadataCacheInvalidationTimer = window.setTimeout(() => {
          this.metadataCacheInvalidationTimer = null;
          this.invalidateWildcardCache();
        }, 750);
      })
    );

    // Right-click on a property row triggers our "Add to / Remove from
    // template" items, appended into Obsidian's native context menu (Property
    // type, Cut/Copy/Paste/Remove, etc) rather than replacing it. The
    // listener is bound per-container (in processContainer) rather than at
    // document level, which avoided the global-event-stomping bugs from the
    // earlier left-click attempt.
  }

  onunload() {
    console.log("[FFG] unloading");
    // Persist any settings edit still sitting in the debounce window, without
    // running the saveSettings repaint path on a dead plugin.
    this.saveSettingsDebounced.cancel();
    void this.saveData(this.settings);
    for (const id of this.pendingTimers) window.clearTimeout(id);
    this.pendingTimers.clear();
    this.observer?.disconnect();
    this.observer = null;
    document
      .querySelectorAll<HTMLElement>(".metadata-container")
      .forEach((c) => this.deactivate(c));
    // Remove the whole actions wrapper, not just the buttons inside it. An
    // empty leftover .ffg-panel-actions made ensureSettingsGear's idempotency
    // check refuse to re-inject the gear/refresh buttons after a plugin reload.
    document
      .querySelectorAll(".ffg-panel-actions, .ffg-settings-gear")
      .forEach((el) => el.remove());
  }

  // setTimeout wrapper whose callbacks are cancelled on unload.
  private scheduleTimeout(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.pendingTimers.delete(id);
      fn();
    }, ms);
    this.pendingTimers.add(id);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.groups)) {
      this.settings.groups = DEFAULT_SETTINGS.groups;
    }
    if (!this.settings.topZone || !Array.isArray(this.settings.topZone.fieldOrder)) {
      this.settings.topZone = { fieldOrder: [] };
    }
    for (const g of this.settings.groups) {
      if (!Array.isArray(g.fieldOrder)) g.fieldOrder = [];
      if (!Array.isArray(g.matcherValues)) {
        const legacy = (g as unknown as { matcherValue?: string }).matcherValue;
        if (typeof legacy === "string" && legacy.length > 0) {
          g.matcherValues =
            g.matcherType === "regex"
              ? [legacy]
              : legacy.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          g.matcherValues = [];
        }
        delete (g as unknown as { matcherValue?: string }).matcherValue;
      }
      // Migrate pre-v1.1 matcher types (prefix / list) into the unified shape.
      const mt = g.matcherType as string;
      if (mt === "prefix") {
        const literals = g.fieldOrder ?? [];
        const wildcards = (g.matcherValues ?? []).map((v) =>
          v.endsWith("*") ? v : v + "*"
        );
        g.matcherValues = [...literals, ...wildcards];
        g.fieldOrder = [];
        g.matcherType = "unified";
      } else if (mt === "list") {
        const fieldOrder = g.fieldOrder ?? [];
        const matcherValues = g.matcherValues ?? [];
        const merged = [...fieldOrder];
        for (const v of matcherValues) {
          if (!merged.includes(v)) merged.push(v);
        }
        g.matcherValues = merged;
        g.fieldOrder = [];
        g.matcherType = "unified";
      }
    }
    if (!Array.isArray(this.settings.iconOverrides)) {
      this.settings.iconOverrides = [];
    }
    if (!Array.isArray(this.settings.cleanupAdHocFields)) {
      this.settings.cleanupAdHocFields = [];
    }
    this.settings.cleanupAdHocFields = this.settings.cleanupAdHocFields.filter(
      (s) => typeof s === "string" && s.length > 0
    );
    if (!Array.isArray(this.settings.globalLintFields)) {
      this.settings.globalLintFields = [];
    }
    this.settings.globalLintFields = this.settings.globalLintFields.filter(
      (s) => typeof s === "string" && s.length > 0
    );
    if (!Array.isArray(this.settings.reconcileExcludedFiles)) {
      this.settings.reconcileExcludedFiles = [];
    }
    this.settings.reconcileExcludedFiles =
      this.settings.reconcileExcludedFiles.filter(
        (s) => typeof s === "string" && s.length > 0
      );
    if (typeof this.settings.excludeFolderNotes !== "boolean") {
      this.settings.excludeFolderNotes = true;
    }
    if (!Array.isArray(this.settings.folderNoteWhitelist)) {
      this.settings.folderNoteWhitelist = [];
    }
    this.settings.folderNoteWhitelist = this.settings.folderNoteWhitelist.filter(
      (s) => typeof s === "string" && s.length > 0
    );
    if (!Array.isArray(this.settings.folderNoteWhitelistFolders)) {
      this.settings.folderNoteWhitelistFolders = [];
    }
    this.settings.folderNoteWhitelistFolders =
      this.settings.folderNoteWhitelistFolders
        .filter((s) => typeof s === "string" && s.length > 0)
        .map((s) => (s.endsWith("/") ? s : s + "/"));

    // Collect legacy lint rule names (top-level `lintRules`) for later migration
    // into a Global lint template.
    const legacyLintNames = new Set<string>();
    const legacyLintRules = (
      this.settings as unknown as { lintRules?: { name?: string }[] }
    ).lintRules;
    if (Array.isArray(legacyLintRules)) {
      for (const r of legacyLintRules) {
        if (typeof r?.name === "string" && r.name) legacyLintNames.add(r.name);
      }
    }
    delete (this.settings as unknown as { lintRules?: unknown }).lintRules;

    // Migrate legacy `fields` array (pre-v1.1 prerelease) into split arrays.
    const legacyFields = (
      this.settings as unknown as {
        fields?: { name?: string; icon?: string; lintRemoveWhenEmpty?: boolean }[];
      }
    ).fields;
    if (Array.isArray(legacyFields)) {
      for (const f of legacyFields) {
        if (typeof f?.name !== "string" || !f.name) continue;
        if (typeof f.icon === "string" && f.icon) {
          if (!this.settings.iconOverrides.some((o) => o.name === f.name)) {
            this.settings.iconOverrides.push({ name: f.name, icon: f.icon });
          }
        }
        if (f.lintRemoveWhenEmpty === true) {
          legacyLintNames.add(f.name);
        }
      }
      delete (this.settings as unknown as { fields?: unknown }).fields;
    }
    for (const o of this.settings.iconOverrides) {
      if (typeof o.name !== "string") o.name = "";
      if (typeof o.icon !== "string") o.icon = "";
    }
    if (!Array.isArray(this.settings.folderTemplates)) {
      this.settings.folderTemplates = [];
    }
    // Migrate legacy `fieldDefaults` (per-field popover model) into folderTemplates.
    const legacyFD = (
      this.settings as unknown as {
        fieldDefaults?: {
          fieldName?: string;
          folders?: { pathPrefix?: string; value?: unknown }[];
        }[];
      }
    ).fieldDefaults;
    if (Array.isArray(legacyFD)) {
      for (const fd of legacyFD) {
        const fieldName = typeof fd?.fieldName === "string" ? fd.fieldName : "";
        if (!fieldName || !Array.isArray(fd.folders)) continue;
        for (const folder of fd.folders) {
          const prefix =
            typeof folder?.pathPrefix === "string" ? folder.pathPrefix : "";
          let tpl: FolderTemplate | undefined = this.settings.folderTemplates.find(
            (t) => t.pathPrefixes.length === 1 && t.pathPrefixes[0] === prefix
          );
          if (!tpl) {
            tpl = {
              id: Date.now().toString(36) + Math.random().toString(36).slice(2),
              name: "",
              pathPrefixes: [prefix],
              excludedPathPrefixes: [],
              fields: [],
              fieldOrder: [],
              excludedFields: [],
              lintFields: [],
              noGroupFields: [],
            };
            this.settings.folderTemplates.push(tpl);
          }
          if (!tpl.fields.some((f) => f.name === fieldName)) {
            tpl.fields.push({ name: fieldName, value: folder.value });
          }
        }
      }
      delete (this.settings as unknown as { fieldDefaults?: unknown }).fieldDefaults;
    }
    for (const t of this.settings.folderTemplates) {
      if (typeof t.id !== "string" || !t.id) {
        t.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      }
      if (typeof t.name !== "string") t.name = "";
      // Migrate single `pathPrefix` (pre-multi-prefix release) to pathPrefixes[].
      const legacyPrefix = (t as unknown as { pathPrefix?: string }).pathPrefix;
      if (!Array.isArray(t.pathPrefixes)) {
        t.pathPrefixes =
          typeof legacyPrefix === "string" ? [legacyPrefix] : [];
      }
      delete (t as unknown as { pathPrefix?: string }).pathPrefix;
      t.pathPrefixes = t.pathPrefixes.filter((p) => typeof p === "string");
      // Migrate legacy linkedGroups: string[] to group: string (first entry).
      const legacyLinked = (t as unknown as { linkedGroups?: string[] })
        .linkedGroups;
      if (Array.isArray(legacyLinked)) {
        const first = legacyLinked.find((id) => typeof id === "string" && !!id);
        if (first && !t.group) t.group = first;
        delete (t as unknown as { linkedGroups?: string[] }).linkedGroups;
      }
      if (typeof t.group !== "string" || !t.group) delete t.group;
      if (!Array.isArray(t.fields)) t.fields = [];
      for (const f of t.fields) {
        if (typeof f.name !== "string") f.name = "";
      }
      if (!Array.isArray(t.excludedFields)) t.excludedFields = [];
      t.excludedFields = t.excludedFields.filter((s) => typeof s === "string");
      if (!Array.isArray(t.lintFields)) t.lintFields = [];
      t.lintFields = t.lintFields.filter((s) => typeof s === "string");
      if (!Array.isArray(t.excludedPathPrefixes)) t.excludedPathPrefixes = [];
      t.excludedPathPrefixes = t.excludedPathPrefixes.filter(
        (s) => typeof s === "string"
      );
      if (!Array.isArray(t.fieldOrder)) t.fieldOrder = [];
      t.fieldOrder = t.fieldOrder.filter((s) => typeof s === "string");
      if (!Array.isArray(t.noGroupFields)) t.noGroupFields = [];
      t.noGroupFields = t.noGroupFields.filter((s) => typeof s === "string");
      if (typeof t.bodyTemplatePath !== "string") {
        delete t.bodyTemplatePath;
      } else if (t.bodyTemplatePath.trim() === "") {
        delete t.bodyTemplatePath;
      }
    }

    // Materialize any legacy global lint rule names into a Global lint template.
    if (legacyLintNames.size > 0) {
      let globalTpl = this.settings.folderTemplates.find(
        (t) =>
          t.pathPrefixes.length === 1 &&
          t.pathPrefixes[0] === "" &&
          !t.group
      );
      if (!globalTpl) {
        globalTpl = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          name: "Global lint",
          pathPrefixes: [""],
          excludedPathPrefixes: [],
          fields: [],
          fieldOrder: [],
          excludedFields: [],
          lintFields: [],
          noGroupFields: [],
        };
        this.settings.folderTemplates.push(globalTpl);
      }
      for (const name of legacyLintNames) {
        if (!globalTpl.lintFields.includes(name)) globalTpl.lintFields.push(name);
        if (!globalTpl.excludedFields.includes(name)) {
          globalTpl.excludedFields.push(name);
        }
        if (!globalTpl.fields.some((f) => f.name === name)) {
          globalTpl.fields.push({ name, value: undefined });
        }
      }
    }

    // Absorb global-scoped template lintFields into globalLintFields.
    // Pure auto-migrated "Global lint" templates get removed entirely.
    for (const t of this.settings.folderTemplates) {
      const isGlobal =
        t.pathPrefixes.length === 1 &&
        t.pathPrefixes[0] === "" &&
        !t.group;
      if (!isGlobal || t.lintFields.length === 0) continue;
      const migrated = t.lintFields.slice();
      for (const name of migrated) {
        if (!this.settings.globalLintFields.includes(name)) {
          this.settings.globalLintFields.push(name);
        }
      }
      t.lintFields = [];
      for (const name of migrated) {
        t.fields = t.fields.filter(
          (f) => !(f.name === name && f.value === undefined)
        );
        t.excludedFields = t.excludedFields.filter((n) => n !== name);
      }
    }
    this.settings.folderTemplates = this.settings.folderTemplates.filter((t) => {
      const isGlobal =
        t.pathPrefixes.length === 1 &&
        t.pathPrefixes[0] === "" &&
        !t.group;
      if (!isGlobal) return true;
      return (
        t.fields.length > 0 ||
        t.excludedFields.length > 0 ||
        t.lintFields.length > 0
      );
    });

    // Drop any earlier legacy keys.
    delete (this.settings as unknown as { defaultRules?: unknown }).defaultRules;

    // ── v1.3 migration: hoist group literals into linked templates ──
    // Each group's literal matcher entries (non-wildcard, unified-matcher only)
    // move into the FIRST template that links the group. Already-present rows
    // in any linked template are left alone. Wildcards stay on the group.
    // Groups with no linked templates keep their literals (no destination).
    for (const g of this.settings.groups) {
      if (g.matcherType === "regex") continue;
      const linkedTpls = this.settings.folderTemplates.filter(
        (t) => t.group === g.id
      );
      if (linkedTpls.length === 0) continue;
      const target = linkedTpls[0];
      const literals = (g.matcherValues ?? []).filter(
        (v) => v && !v.endsWith("*")
      );
      if (literals.length === 0) continue;
      for (const name of literals) {
        // If ANY linked template already has this field as an explicit row,
        // we don't need to re-add it.
        const present = linkedTpls.some((t) =>
          t.fields.some((f) => f.name === name)
        );
        if (!present) {
          target.fields.push({ name });
        }
      }
      // Strip literals from the group; wildcards remain.
      g.matcherValues = (g.matcherValues ?? []).filter(
        (v) => v && v.endsWith("*")
      );
    }

    // ── Heal lint-only fields ──
    // Older popover writes pushed a name into tpl.lintFields without adding a
    // row to tpl.fields, leaving the Cleanup tab showing "on" for a template
    // whose Grouping-tab card had no row for the field. Create the missing row
    // (eye-off so default insertion stays off — pure cleanup semantics).
    for (const tpl of this.settings.folderTemplates) {
      for (const name of tpl.lintFields) {
        if (!name) continue;
        if (tpl.fields.some((f) => f.name === name)) continue;
        tpl.fields.push({ name, value: undefined });
        if (!tpl.excludedFields.includes(name)) {
          tpl.excludedFields.push(name);
        }
      }
    }
  }

  // Shared healer: ensure a template owns a row for any field flagged for
  // cleanup, so the Grouping tab and Cleanup tab stay in sync.
  ensureTemplateOwnsField(tpl: FolderTemplate, fieldName: string): void {
    if (!fieldName) return;
    if (tpl.fields.some((f) => f.name === fieldName)) return;
    tpl.fields.push({ name: fieldName, value: undefined });
    if (!tpl.excludedFields.includes(fieldName)) {
      tpl.excludedFields.push(fieldName);
    }
  }

  async saveSettings() {
    this.invalidateWildcardCache();
    await this.saveData(this.settings);
    this.onSettingsChanged();
  }

  private onSettingsChanged() {
    this.isProcessing = true;
    try {
      document
        .querySelectorAll<HTMLElement>(".metadata-container")
        .forEach((c) => {
          if (c.isConnected) this.processContainer(c);
        });
    } finally {
      this.isProcessing = false;
    }
  }

  private get runtimeGroups(): RuntimeGroup[] {
    const templates = this.settings.folderTemplates;
    return this.settings.groups.map((g) => toRuntimeGroup(g, templates));
  }

  // Cached wildcard expansion for a single group. Walks the vault once per
  // (groupId + matcher signature) and reuses the sorted result until the
  // cache is invalidated.
  private cachedWildcardKeys(g: StoredGroupConfig): string[] {
    const key =
      g.id +
      "|" +
      g.matcherType +
      "|" +
      (g.matcherValues ?? []).join(",");
    let cached = this.wildcardExpansionCache.get(key);
    if (cached) return cached;
    const matches = compileGroupMatcher(g);
    if (!matches) {
      cached = [];
    } else {
      const matched: string[] = [];
      for (const k of this.getAllVaultFrontmatterKeys()) {
        if (matches(k)) matched.push(k);
      }
      matched.sort();
      cached = matched;
    }
    this.wildcardExpansionCache.set(key, cached);
    return cached;
  }

  // The universe of frontmatter keys in the vault, scanned once and cached.
  // Per-group wildcard expansion filters this set, so the expensive vault walk
  // happens once total rather than once per wildcard group. Cleared alongside
  // the per-group cache on invalidation.
  private getAllVaultFrontmatterKeys(): Set<string> {
    if (this.allVaultKeysCache) return this.allVaultKeysCache;
    const keys = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      for (const k of Object.keys(fm)) {
        if (!k || k === "position") continue;
        keys.add(k);
      }
    }
    this.allVaultKeysCache = keys;
    return keys;
  }

  // Drop-in replacement for free-function getGroupEffectiveFields that uses
  // the plugin's wildcard cache. Use this anywhere group → field expansion
  // is needed in a hot path.
  getGroupEffectiveFieldsCached(
    g: StoredGroupConfig,
    templates?: FolderTemplate[]
  ): string[] {
    const contributedLiterals = templates
      ? getGroupTemplateContributedLiterals(g, templates).map((e) => e.name)
      : getGroupLiteralFields(g);
    const seen = new Set(contributedLiterals);
    const out = [...contributedLiterals];
    for (const k of this.cachedWildcardKeys(g)) {
      if (!seen.has(k)) {
        out.push(k);
        seen.add(k);
      }
    }
    return out;
  }

  invalidateWildcardCache(): void {
    this.wildcardExpansionCache.clear();
    this.allVaultKeysCache = null;
  }

  // True if this file is on the user's auto-reconcile exclude list, or if the
  // "Auto-exclude folder notes" toggle is on and the file is a folder note
  // (basename equals immediate parent folder's name). Used to hide all
  // frontmatter in the Properties panel and skip defaults insertion, lint
  // scrubbing, canonical-order reorder, and body-template insertion. Manual
  // command invocations still run.
  isFileExcludedFromReconcile(filePath: string): boolean {
    if (this.settings.reconcileExcludedFiles.includes(filePath)) return true;
    if (this.settings.excludeFolderNotes && isFolderNotePath(filePath)) {
      if (this.settings.folderNoteWhitelist.includes(filePath)) return false;
      for (const folder of this.settings.folderNoteWhitelistFolders) {
        if (filePath.startsWith(folder)) return false;
      }
      return true;
    }
    return false;
  }

  // Set of frontmatter keys "known" to any template that matches `filePath`:
  // template.fields rows + linked-group wildcard expansion. Used by the
  // orphan-null scrub pass to identify keys no template claims for this file.
  knownFieldsForFile(filePath: string): Set<string> {
    const out = new Set<string>();
    for (const tpl of this.settings.folderTemplates) {
      if (this.templateMatchScore(tpl, filePath) < 0) continue;
      for (const f of tpl.fields) {
        if (f.name) out.add(f.name);
      }
      if (tpl.group) {
        const group = this.settings.groups.find((g) => g.id === tpl.group);
        if (group) {
          for (const name of this.getGroupEffectiveFieldsCached(group, [])) {
            out.add(name);
          }
        }
      }
    }
    return out;
  }

  // Path-aware group claim. Wildcards/regex/group-own-literals always apply.
  // Template-contributed literals only apply when at least one owning
  // template's pathPrefixes match the current file. When filePath is null
  // (callsite has no file context) falls back to the file-agnostic matcher.
  matchGroupForFile(
    g: RuntimeGroup,
    key: string,
    filePath: string | null
  ): boolean {
    if (g.nonTemplateMatcher(key)) return true;
    const owners = g.templateLiteralOwners.get(key);
    if (!owners || owners.length === 0) return false;
    if (!filePath) return true;
    for (const tpl of owners) {
      if (this.templateMatchScore(tpl, filePath) >= 0) return true;
    }
    return false;
  }

  // Resolve which file's Properties panel a given .metadata-container belongs to.
  // Walks up to the closest workspace-leaf and matches via iterateAllLeaves.
  // Falls back to the active file if no match is found.
  private fileForContainer(container: HTMLElement): TFile | null {
    const leafEl = container.closest(".workspace-leaf") as HTMLElement | null;
    if (!leafEl) return this.app.workspace.getActiveFile();
    let found: TFile | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const containerEl = (leaf as unknown as { containerEl?: HTMLElement })
        .containerEl;
      if (containerEl === leafEl) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file instanceof TFile) {
          found = view.file;
        }
      }
    });
    return found ?? this.app.workspace.getActiveFile();
  }

  // Ordered name list for a template. Sibling-template inheritance is gone:
  // each template owns its own fields. Wildcard-matched vault keys and any
  // legacy group-only literals still flow in (they aren't owned by any
  // template). Honors tpl.fieldOrder; appends new names at the end.
  templateOrderedFieldNames(tpl: FolderTemplate): string[] {
    const inheritedNames = new Set<string>();
    if (tpl.group) {
      const groupId = tpl.group;
      const group = this.settings.groups.find((g) => g.id === groupId);
      if (group) {
      // Legacy group-owned literals (rare; only when no template owns them)
      for (const lit of getGroupLiteralFields(group)) {
        if (lit) inheritedNames.add(lit);
      }
      // Wildcard / regex matches against actual vault keys
      const wildcardExpanded = this.getGroupEffectiveFieldsCached(group, []);
      const legacyLits = new Set(getGroupLiteralFields(group));
      for (const n of wildcardExpanded) {
        if (n && !legacyLits.has(n)) inheritedNames.add(n);
      }
      }
    }
    const allNames: string[] = [];
    const seen = new Set<string>();
    for (const n of inheritedNames) {
      if (!seen.has(n)) {
        allNames.push(n);
        seen.add(n);
      }
    }
    for (const f of tpl.fields) {
      if (f.name && !seen.has(f.name)) {
        allNames.push(f.name);
        seen.add(f.name);
      }
    }
    const ordered: string[] = [];
    const placed = new Set<string>();
    for (const n of tpl.fieldOrder ?? []) {
      if (seen.has(n) && !placed.has(n)) {
        ordered.push(n);
        placed.add(n);
      }
    }
    for (const n of allNames) {
      if (!placed.has(n)) {
        ordered.push(n);
        placed.add(n);
      }
    }
    return ordered;
  }

  // For a given file, find the best-matching template per linked group and
  // return a map of groupId → preferred fieldOrder for that file. Used by
  // processContainer to give each Properties panel its template-respecting order.
  private perFileGroupOrders(filePath: string | null): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (!filePath) return result;
    for (const g of this.settings.groups) {
      let bestTpl: FolderTemplate | null = null;
      let bestLen = -1;
      for (const tpl of this.settings.folderTemplates) {
        if (tpl.group !== g.id) continue;
        const len = this.templateMatchScore(tpl, filePath);
        if (len > bestLen) {
          bestLen = len;
          bestTpl = tpl;
        }
      }
      if (!bestTpl) continue;
      const skip = new Set(bestTpl.noGroupFields ?? []);
      const ordered = this.templateOrderedFieldNames(bestTpl).filter(
        (n) => !skip.has(n)
      );
      if (ordered.length > 0) result.set(g.id, ordered);
    }
    return result;
  }

  private installObserver() {
    this.observer = new MutationObserver((mutations) => {
      if (this.isProcessing) return;

      const containers = new Set<HTMLElement>();
      for (const m of mutations) {
        const target = m.target as Node;
        if (target.nodeType === Node.ELEMENT_NODE) {
          const el = target as HTMLElement;
          const container = el.closest(".metadata-container") as HTMLElement | null;
          if (container) containers.add(container);
        }
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(".metadata-container")) containers.add(node);
          node
            .querySelectorAll?.<HTMLElement>(".metadata-container")
            .forEach((c) => containers.add(c));
        });
      }

      if (containers.size === 0) return;

      this.isProcessing = true;
      try {
        containers.forEach((c) => {
          if (c.isConnected) this.processContainer(c);
        });
      } finally {
        this.isProcessing = false;
      }
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private processAllContainers() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      document
        .querySelectorAll<HTMLElement>(".metadata-container")
        .forEach((c) => this.processContainer(c));
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Virtual grouping (CSS-order based; no DOM moves) ───────────────────────

  private static readonly TOP_BASE = 0;
  private static readonly UNMATCHED_BASE = 10000;
  private static readonly GROUP_BLOCK_BASE = 100000;
  private static readonly GROUP_BLOCK_SIZE = 10000;
  private static readonly ADD_BUTTON_ORDER = 999999;

  private processContainer(container: HTMLElement) {
    try {
      this.ensureSettingsGear(container);
      this.ensureAddButtonOrder(container);
      this.ensureContextMenuBinding(container);

      const allProps = Array.from(
        container.querySelectorAll<HTMLElement>(".metadata-property")
      );
      this.applyIconOverrides(allProps);

      if (!this.settings.groupFoldingEnabled) {
        this.deactivate(container);
        container.classList.remove("ffg-excluded");
        return;
      }

      container.classList.add("ffg-active");

      // Per-file fieldOrder override: the matching template for this file
      // determines how its linked groups order their members in the panel.
      const fileForPanel = this.fileForContainer(container);

      // If this file is on the auto-reconcile exclude list, hide all
      // frontmatter. Strip any group decoration, mark the container, and
      // class-tag the "Properties" heading (wherever it sits in the DOM) so
      // CSS can hide it too.
      const excluded =
        !!fileForPanel && this.isFileExcludedFromReconcile(fileForPanel.path);
      this.applyExcludedHeadingTag(container, excluded);
      if (excluded) {
        container
          .querySelectorAll<HTMLElement>(".ffg-group-header")
          .forEach((h) => h.remove());
        for (const p of allProps) {
          this.clearGroupTagging(p);
          p.classList.remove("ffg-property-orphan");
          if (p.style.order) p.style.removeProperty("order");
        }
        container.classList.add("ffg-excluded");
        return;
      }
      container.classList.remove("ffg-excluded");
      const perFileOrders = this.perFileGroupOrders(fileForPanel?.path ?? null);
      const groups = this.runtimeGroups.map((g) => {
        const override = perFileOrders.get(g.id);
        if (!override) return g;
        // Merge: template's order first, then any other group-claimed names
        // (e.g. wildcard-matched fields) appended.
        const seen = new Set(override);
        const merged = [
          ...override,
          ...g.fieldOrder.filter((n) => !seen.has(n)),
        ];
        return { ...g, fieldOrder: merged };
      });

      // Initialize / extend per-container fold state.
      let state = this.foldState.get(container);
      if (!state) {
        state = new Map();
        this.foldState.set(container, state);
      }
      for (const g of groups) {
        if (!state.has(g.id)) state.set(g.id, g.defaultFolded);
      }

      const topSet = new Set(this.settings.topZone.fieldOrder);

      type Bucket =
        | { kind: "top"; index: number }
        | { kind: "unmatched"; fileIndex: number }
        | { kind: "group"; groupId: string; index: number };

      const bucketByEl = new Map<HTMLElement, Bucket>();
      const groupMembers = new Map<string, HTMLElement[]>();

      for (let i = 0; i < allProps.length; i++) {
        const p = allProps[i];
        const key = p.dataset.propertyKey ?? "";

        if (topSet.has(key)) {
          bucketByEl.set(p, {
            kind: "top",
            index: this.settings.topZone.fieldOrder.indexOf(key),
          });
          continue;
        }

        let matchedGroupId: string | null = null;
        for (const g of groups) {
          if (this.matchGroupForFile(g, key, fileForPanel?.path ?? null)) {
            matchedGroupId = g.id;
            break;
          }
        }

        if (matchedGroupId) {
          const arr = groupMembers.get(matchedGroupId) ?? [];
          arr.push(p);
          groupMembers.set(matchedGroupId, arr);
        } else {
          bucketByEl.set(p, { kind: "unmatched", fileIndex: i });
        }
      }

      // Within-group ordering: explicit fieldOrder first, then unlisted in file order.
      for (const g of groups) {
        const members = groupMembers.get(g.id) ?? [];
        if (members.length === 0) continue;
        const ordered = orderByFieldOrder(members, g.fieldOrder);
        for (let i = 0; i < ordered.length; i++) {
          bucketByEl.set(ordered[i], { kind: "group", groupId: g.id, index: i });
        }
      }

      const knownGroupIds = new Set(groups.map((g) => g.id));

      // Apply tags + order to each property.
      for (const p of allProps) {
        const b = bucketByEl.get(p);
        if (!b) continue;

        let order: number;
        // Orphan highlight: any property not claimed by Top Zone or any group.
        // Used so the user can spot fields no template owns at a glance.
        if (b.kind === "unmatched") {
          if (!p.classList.contains("ffg-property-orphan")) {
            p.classList.add("ffg-property-orphan");
          }
        } else if (p.classList.contains("ffg-property-orphan")) {
          p.classList.remove("ffg-property-orphan");
        }
        if (b.kind === "top") {
          order = FoldableFrontmatterGroupsPlugin.TOP_BASE + b.index;
          this.clearGroupTagging(p);
        } else if (b.kind === "unmatched") {
          order = FoldableFrontmatterGroupsPlugin.UNMATCHED_BASE + b.fileIndex;
          this.clearGroupTagging(p);
        } else {
          const groupIdx = groups.findIndex((g) => g.id === b.groupId);
          order =
            FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_BASE +
            groupIdx * FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_SIZE +
            1 +
            b.index;
          const folded = state.get(b.groupId) ?? false;
          if (p.dataset.ffgGroup !== b.groupId) p.dataset.ffgGroup = b.groupId;
          const foldVal = folded ? "true" : "false";
          if (p.dataset.ffgFolded !== foldVal) p.dataset.ffgFolded = foldVal;
        }

        const orderStr = String(order);
        if (p.style.order !== orderStr) p.style.order = orderStr;
      }

      this.ensureGroupHeaders(container, groups, groupMembers, state, knownGroupIds);
    } catch (e) {
      console.error("[FFG] processContainer error", e);
    }
  }

  // Per-container right-click listener. Does NOT preventDefault: Obsidian's
  // native context menu opens, and a MutationObserver watches for its DOM
  // node to be added so we can append our template items. Scoped to the
  // property container so no global event traffic.
  private ensureContextMenuBinding(container: HTMLElement): void {
    if (this.contextMenuBoundContainers.has(container)) return;
    this.contextMenuBoundContainers.add(container);
    // registerDomEvent (not raw addEventListener) so the listener dies with
    // the plugin; a raw listener survived unload and produced doubled context
    // menus after a plugin reload.
    this.registerDomEvent(
      container,
      "contextmenu",
      (e) => this.handlePropertyContextMenu(e),
      true
    );
  }

  private handlePropertyContextMenu(e: MouseEvent): void {
    if (!this.settings.groupFoldingEnabled) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const propRow = target.closest(
      ".metadata-property"
    ) as HTMLElement | null;
    if (!propRow) return;
    const key = propRow.dataset.propertyKey ?? "";
    if (!key) return;

    e.preventDefault();
    e.stopPropagation();

    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(`"${key}"`);
      item.setDisabled(true);
    });
    menu.addSeparator();

    // Property type submenu (mirrors Obsidian's native left-click icon menu).
    // Uses the undocumented metadataTypeManager API; falls back silently if
    // the API surface changes in a future Obsidian release.
    const mtm = (this.app as unknown as {
      metadataTypeManager?: {
        setType?: (key: string, type: string) => void;
        getAssignedType?: (key: string) => string | undefined;
        properties?: Record<
          string,
          { type?: string; widget?: string } | undefined
        >;
      };
    }).metadataTypeManager;
    if (mtm && typeof mtm.setType === "function") {
      const currentType =
        mtm.getAssignedType?.(key) ??
        mtm.properties?.[key]?.widget ??
        mtm.properties?.[key]?.type ??
        "text";
      const types: Array<{ id: string; label: string; icon: string }> = [
        { id: "text", label: "Text", icon: "text" },
        { id: "multitext", label: "List", icon: "list" },
        { id: "number", label: "Number", icon: "binary" },
        { id: "checkbox", label: "Checkbox", icon: "check-square" },
        { id: "date", label: "Date", icon: "calendar" },
        { id: "datetime", label: "Date & time", icon: "clock" },
      ];
      menu.addItem((item) => {
        item.setTitle("Property type");
        item.setIcon("type");
        const sub = (item as unknown as {
          setSubmenu: () => Menu;
        }).setSubmenu();
        for (const t of types) {
          sub.addItem((sub2) => {
            sub2.setTitle(t.label);
            sub2.setIcon(t.icon);
            if (currentType === t.id) {
              sub2.setChecked(true);
            }
            sub2.onClick(() => {
              try {
                mtm.setType!(key, t.id);
              } catch (err) {
                console.error("[FFG] setType error", err);
              }
            });
          });
        }
      });
      menu.addSeparator();
    }

    // Remove property (uses Obsidian's frontmatter API).
    menu.addItem((item) => {
      item.setIcon("trash");
      item.setTitle("Remove property");
      item.onClick(async () => {
        const file = this.fileForContainer(propRow.closest(
          ".metadata-container"
        ) as HTMLElement);
        if (!file) return;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            delete fm[key];
          });
        } catch (err) {
          console.error("[FFG] remove property error", err);
          new Notice("[FFG] Remove failed, see console");
        }
      });
    });

    menu.addSeparator();

    // Template add/remove.
    const ordered = sortTemplatesByGroupingOrder(
      this.settings.folderTemplates,
      this.settings.groups
    );

    if (ordered.length === 0) {
      menu.addItem((item) => {
        item.setTitle("No templates defined.");
        item.setDisabled(true);
      });
    } else {
      for (const tpl of ordered) {
        const present = tpl.fields.some((f) => f.name === key);
        const label = tpl.name || "(unnamed template)";
        menu.addItem((item) => {
          item.setIcon(present ? "minus" : "plus");
          item.setTitle(
            present ? `Remove from "${label}"` : `Add to "${label}"`
          );
          item.onClick(async () => {
            if (present) {
              tpl.fields = tpl.fields.filter((f) => f.name !== key);
              tpl.excludedFields = tpl.excludedFields.filter(
                (n) => n !== key
              );
              tpl.lintFields = tpl.lintFields.filter((n) => n !== key);
              tpl.noGroupFields = tpl.noGroupFields.filter(
                (n) => n !== key
              );
              await this.saveSettings();
              new Notice(`[FFG] Removed "${key}" from "${label}"`);
            } else {
              tpl.fields.push({ name: key, value: undefined });
              await this.saveSettings();
              new Notice(`[FFG] Added "${key}" to "${label}"`);
            }
          });
        });
      }
    }

    menu.showAtMouseEvent(e);
  }

  private clearGroupTagging(p: HTMLElement) {
    if (p.dataset.ffgGroup) delete p.dataset.ffgGroup;
    if (p.dataset.ffgFolded) delete p.dataset.ffgFolded;
  }

  private ensureGroupHeaders(
    container: HTMLElement,
    groups: RuntimeGroup[],
    members: Map<string, HTMLElement[]>,
    state: Map<string, boolean>,
    knownGroupIds: Set<string>
  ) {
    const propParent = this.findPropParent(container);
    if (!propParent) return;

    const existing = new Map<string, HTMLElement>();
    propParent
      .querySelectorAll<HTMLElement>(":scope > .ffg-group-header")
      .forEach((h) => {
        const id = h.dataset.groupId;
        if (id) existing.set(id, h);
      });

    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      const memberList = members.get(g.id) ?? [];

      if (memberList.length === 0) {
        const stale = existing.get(g.id);
        if (stale) stale.remove();
        continue;
      }

      let header = existing.get(g.id);
      if (!header) {
        header = this.createGroupHeader(g, container);
        propParent.appendChild(header);
      }

      const order =
        FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_BASE +
        k * FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_SIZE;
      const orderStr = String(order);
      if (header.style.order !== orderStr) header.style.order = orderStr;

      const folded = state.get(g.id) ?? g.defaultFolded;
      const foldVal = folded ? "true" : "false";
      if (header.dataset.folded !== foldVal) header.dataset.folded = foldVal;

      const chevron = header.querySelector<HTMLElement>(".ffg-chevron");
      if (chevron) {
        const expected = folded ? "chevron-right" : "chevron-down";
        if (chevron.dataset.iconState !== expected) {
          setIcon(chevron, expected);
          chevron.dataset.iconState = expected;
        }
      }

      const nameEl = header.querySelector<HTMLElement>(".ffg-name");
      if (nameEl && nameEl.textContent !== g.name) nameEl.textContent = g.name;

      const countEl = header.querySelector<HTMLElement>(".ffg-count");
      if (countEl) {
        const text = `(${memberList.length})`;
        if (countEl.textContent !== text) countEl.textContent = text;
      }
    }

    // Remove orphaned headers (group deleted from settings).
    for (const [id, header] of existing) {
      if (!knownGroupIds.has(id)) header.remove();
    }
  }

  private findPropParent(container: HTMLElement): HTMLElement | null {
    const firstProp = container.querySelector<HTMLElement>(".metadata-property");
    return firstProp?.parentElement ?? null;
  }

  private createGroupHeader(g: RuntimeGroup, container: HTMLElement): HTMLElement {
    const header = document.createElement("div");
    header.className = "ffg-group-header";
    header.dataset.groupId = g.id;

    const chevron = document.createElement("span");
    chevron.className = "ffg-chevron";
    setIcon(chevron, "chevron-right");
    chevron.dataset.iconState = "chevron-right";

    const name = document.createElement("span");
    name.className = "ffg-name";
    name.textContent = g.name;

    const count = document.createElement("span");
    count.className = "ffg-count";
    count.textContent = "(0)";

    // Small settings affordance: jumps straight to this group's settings card.
    const settingsBtn = document.createElement("span");
    settingsBtn.className = "ffg-group-settings";
    settingsBtn.setAttribute("role", "button");
    settingsBtn.setAttribute("aria-label", `${g.name} settings`);
    setIcon(settingsBtn, "settings-2");

    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);
    header.appendChild(settingsBtn);

    const blockBubbling = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    header.addEventListener("mousedown", blockBubbling, true);
    header.addEventListener("mouseup", blockBubbling, true);

    // Settings icon: open this group's settings instead of toggling fold.
    const blockBubblingHard = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    settingsBtn.addEventListener("mousedown", blockBubblingHard, true);
    settingsBtn.addEventListener("mouseup", blockBubblingHard, true);
    settingsBtn.addEventListener(
      "click",
      (event) => {
        blockBubblingHard(event);
        this.openGroupSettings(g.id, container);
      },
      true
    );

    header.addEventListener(
      "click",
      (event) => {
        // Clicks on the settings icon are handled by its own listener.
        if ((event.target as HTMLElement).closest(".ffg-group-settings")) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.toggleGroupFold(container, g.id);
      },
      true
    );

    return header;
  }

  private toggleGroupFold(container: HTMLElement, groupId: string) {
    const state = this.foldState.get(container);
    if (!state) return;
    const newFolded = !state.get(groupId);
    state.set(groupId, newFolded);

    this.isProcessing = true;
    try {
      const foldVal = newFolded ? "true" : "false";
      const escaped =
        typeof CSS !== "undefined" && CSS.escape ? CSS.escape(groupId) : groupId;

      container
        .querySelectorAll<HTMLElement>(
          `.metadata-property[data-ffg-group="${escaped}"]`
        )
        .forEach((p) => {
          if (p.dataset.ffgFolded !== foldVal) p.dataset.ffgFolded = foldVal;
        });

      const header = container.querySelector<HTMLElement>(
        `.ffg-group-header[data-group-id="${escaped}"]`
      );
      if (header) {
        if (header.dataset.folded !== foldVal) header.dataset.folded = foldVal;
        const chevron = header.querySelector<HTMLElement>(".ffg-chevron");
        if (chevron) {
          const expected = newFolded ? "chevron-right" : "chevron-down";
          setIcon(chevron, expected);
          chevron.dataset.iconState = expected;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private applyIconOverrides(props: HTMLElement[]) {
    if (props.length === 0) return;

    const iconByKey = new Map<string, string>();
    for (const o of this.settings.iconOverrides) {
      if (o.name && o.icon) iconByKey.set(o.name, o.icon);
    }

    for (const p of props) {
      const key = p.dataset.propertyKey ?? "";
      const iconEl = p.querySelector<HTMLElement>(".metadata-property-icon");
      if (!iconEl) continue;

      const desired = iconByKey.get(key);
      if (desired) {
        if (iconEl.dataset.ffgIcon !== desired) {
          setIcon(iconEl, desired);
          iconEl.dataset.ffgIcon = desired;
        }
      } else if (iconEl.dataset.ffgIcon) {
        // Override removed. Mark cleared; native icon restores on Obsidian's next render.
        delete iconEl.dataset.ffgIcon;
      }
    }
  }

  private ensureAddButtonOrder(container: HTMLElement) {
    const addBtn = container.querySelector<HTMLElement>(".metadata-add-button");
    if (!addBtn) return;
    const orderStr = String(FoldableFrontmatterGroupsPlugin.ADD_BUTTON_ORDER);
    if (addBtn.style.order !== orderStr) addBtn.style.order = orderStr;
  }

  // Find the "Properties" heading associated with this container (may be a
  // descendant OR a previous sibling depending on Obsidian's view layout) and
  // toggle a class on it so CSS can hide it for excluded files.
  private applyExcludedHeadingTag(container: HTMLElement, excluded: boolean) {
    const headings = new Set<HTMLElement>();
    container
      .querySelectorAll<HTMLElement>(".metadata-properties-heading")
      .forEach((h) => headings.add(h));
    let cursor: Element | null = container;
    for (let depth = 0; depth < 3 && cursor; depth++) {
      let sib: Element | null = cursor.previousElementSibling;
      while (sib) {
        if (sib instanceof HTMLElement) {
          if (sib.classList.contains("metadata-properties-heading")) {
            headings.add(sib);
            break;
          }
          const nested = sib.querySelector<HTMLElement>(
            ".metadata-properties-heading"
          );
          if (nested) {
            headings.add(nested);
            break;
          }
        }
        sib = sib.previousElementSibling;
      }
      cursor = cursor.parentElement;
    }
    for (const h of headings) {
      if (excluded) h.classList.add("ffg-excluded-heading");
      else h.classList.remove("ffg-excluded-heading");
    }
  }

  private deactivate(container: HTMLElement) {
    container.classList.remove("ffg-active");
    container.classList.remove("ffg-excluded");
    this.applyExcludedHeadingTag(container, false);
    container
      .querySelectorAll<HTMLElement>(".ffg-group-header")
      .forEach((h) => h.remove());
    container.querySelectorAll<HTMLElement>(".metadata-property").forEach((p) => {
      this.clearGroupTagging(p);
      p.classList.remove("ffg-property-orphan");
      if (p.style.order) p.style.removeProperty("order");
    });
    const addBtn = container.querySelector<HTMLElement>(".metadata-add-button");
    if (addBtn?.style.order) addBtn.style.removeProperty("order");
  }

  private ensureSettingsGear(container: HTMLElement) {
    const addBtn = container.querySelector<HTMLElement>(".metadata-add-button");
    if (!addBtn) return;
    if (addBtn.querySelector(".ffg-panel-actions")) return;

    const stopAll = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const actions = document.createElement("div");
    actions.className = "ffg-panel-actions";

    // Reconcile this file now: backfill template defaults and lint, exactly as
    // the file-open / file-leave triggers do. Useful right after moving a file
    // into a folder that has a template. Then re-render grouping.
    const refresh = document.createElement("div");
    refresh.className = "ffg-settings-gear ffg-settings-refresh";
    refresh.setAttribute("aria-label", "Reconcile and reload this file from disk");
    refresh.setAttribute("role", "button");
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("mousedown", stopAll, true);
    refresh.addEventListener("mouseup", stopAll, true);
    refresh.addEventListener(
      "click",
      (e) => {
        stopAll(e);
        void this.refreshFileFromPanel(container);
      },
      true
    );

    const gear = document.createElement("div");
    gear.className = "ffg-settings-gear";
    gear.setAttribute("aria-label", "Foldable Frontmatter Groups settings");
    gear.setAttribute("role", "button");
    setIcon(gear, "settings");
    gear.addEventListener("mousedown", stopAll, true);
    gear.addEventListener("mouseup", stopAll, true);
    gear.addEventListener(
      "click",
      (e) => {
        stopAll(e);
        const setting = (this.app as unknown as {
          setting?: { open: () => void; openTabById: (id: string) => void };
        }).setting;
        if (setting?.open && setting?.openTabById) {
          setting.open();
          setting.openTabById("foldable-frontmatter-groups");
        }
      },
      true
    );

    actions.appendChild(refresh);
    actions.appendChild(gear);
    addBtn.appendChild(actions);
  }

  // Resolve the file for a Properties-panel container and run reconcile on it
  // (template defaults + lint + canonical order), then re-render grouping.
  // Same effect as the file-open / file-leave auto-reconcile, on demand.
  private async refreshFileFromPanel(container: HTMLElement) {
    const file = this.fileForContainer(container);
    if (!file || file.extension !== "md") {
      new Notice("[FFG] No file for this panel");
      return;
    }
    const result = await this.reconcileFrontmatter(file);
    this.invalidateWildcardCache();
    this.processAllContainers();
    const bodyReloaded = await this.reloadOpenViewsFromDisk(file);
    this.markRefreshButtonStale(file, false);
    if (bodyReloaded) new Notice("[FFG] Reloaded from disk");
    else if (result === "rewrote") new Notice("[FFG] Frontmatter updated");
    else if (result === "noop") new Notice("[FFG] Already up to date");
    else if (result === "no-frontmatter") new Notice("[FFG] No frontmatter");
    else if (result === "error") new Notice("[FFG] Error, see console");
  }

  // Pull the latest content from disk into any open view showing this file,
  // when the view's content has diverged from disk (the "stale open file"
  // case where Obsidian missed an external modify). Uses setViewData (the
  // load path), preserving cursor/scroll. Discards any unsaved buffer for
  // this file by design — this is a deliberate "reload from disk" action.
  private async reloadOpenViewsFromDisk(file: TFile): Promise<boolean> {
    let reloaded = false;
    let disk: string;
    try {
      disk = await this.app.vault.read(file);
    } catch (e) {
      console.error("[FFG] reloadOpenViewsFromDisk read error", file.path, e);
      return false;
    }
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as unknown as {
        file?: TFile;
        getViewData?: () => string;
        setViewData?: (data: string, clear: boolean) => void;
        getEphemeralState?: () => unknown;
        setEphemeralState?: (state: unknown) => void;
      };
      if (
        !view ||
        view.file !== file ||
        typeof view.getViewData !== "function" ||
        typeof view.setViewData !== "function"
      ) {
        return;
      }
      if (view.getViewData() === disk) return;
      const eState =
        typeof view.getEphemeralState === "function"
          ? view.getEphemeralState()
          : null;
      view.setViewData(disk, false);
      if (eState && typeof view.setEphemeralState === "function") {
        view.setEphemeralState(eState);
      }
      reloaded = true;
    });
    return reloaded;
  }

  // True if the file is currently shown in any open leaf.
  private isFileOpenInAnyLeaf(file: TFile): boolean {
    let open = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as unknown as { file?: TFile };
      if (view && view.file === file) open = true;
    });
    return open;
  }

  // After an external modify of an open file, check whether the view's
  // content diverges from disk. If stale, reload from disk (Obsidian
  // sometimes misses the notify for external writes). Discards any unsaved
  // buffer by design — disk wins.
  private async checkAndFixStaleView(file: TFile, tModify: number, viewSnapshot: Map<object, string>) {
    let disk: string;
    try {
      disk = await this.app.vault.read(file);
    } catch {
      return;
    }
    let staleDetected = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as unknown as {
        file?: TFile;
        getViewData?: () => string;
      };
      if (!view || view.file !== file || typeof view.getViewData !== "function") {
        return;
      }
      const shown = view.getViewData();
      if (shown === disk) return;
      // If the view content changed since the modify event, the user is actively
      // editing (typed more, backspaced, etc) — skip.
      const snapshot = viewSnapshot.get(leaf);
      if (snapshot !== undefined && shown !== snapshot) return;
      console.warn("[FFG] stale view detected after external modify", {
        path: file.path,
        diskLen: disk.length,
        shownLen: shown.length,
        msSinceModify: Math.round(performance.now() - tModify),
        activeFile: this.app.workspace.getActiveFile()?.path ?? null,
      });
      staleDetected = true;
    });
    if (staleDetected) {
      this.markRefreshButtonStale(file, true);
    }
  }

  // Highlight (or clear) the refresh button for all open panels showing this
  // file, signalling that the view may be out of date with disk.
  private markRefreshButtonStale(file: TFile, stale: boolean) {
    document.querySelectorAll<HTMLElement>(".ffg-settings-refresh").forEach((btn) => {
      const container = btn.closest(".metadata-container") as HTMLElement | null;
      if (!container) return;
      if (this.fileForContainer(container) === file) {
        btn.classList.toggle("ffg-stale", stale);
      }
    });
  }

  // Open the plugin's settings, switch to the Grouping tab, expand the given
  // group, then unfold + scroll to the template that matches the current
  // file's folder (falling back to the group card if none matches). Used by
  // the per-group settings icon on Properties-panel group headers.
  openGroupSettings(groupId: string, container?: HTMLElement) {
    const setting = (this.app as unknown as {
      setting?: { open: () => void; openTabById: (id: string) => void };
    }).setting;
    if (!setting?.open || !setting?.openTabById) return;

    // Pick the best-matching template in this group for the panel's file:
    // highest path-prefix score wins (most specific folder).
    let templateId: string | null = null;
    const file = container ? this.fileForContainer(container) : null;
    if (file) {
      let bestScore = -1;
      for (const tpl of this.settings.folderTemplates) {
        if (tpl.group !== groupId) continue;
        const score = this.templateMatchScore(tpl, file.path);
        if (score >= 0 && score > bestScore) {
          bestScore = score;
          templateId = tpl.id;
        }
      }
    }

    setting.open();
    setting.openTabById("foldable-frontmatter-groups");
    // display() runs synchronously on openTabById; reveal on the next tick so
    // the freshly-rendered card exists and layout has settled.
    window.setTimeout(
      () => this.settingTab?.revealGroup(groupId, templateId),
      0
    );
  }

  // ── Canonical order + reconcile ─────────────────────────────────────────────

  computeCanonicalOrder(keys: string[], filePath: string | null = null): string[] {
    // Merge the file's matching-template fieldOrder into each group, exactly
    // as processContainer does for the panel, so the key order written to
    // disk matches the order the Properties panel displays.
    const perFileOrders = this.perFileGroupOrders(filePath);
    const groups = this.runtimeGroups.map((g) => {
      const override = perFileOrders.get(g.id);
      if (!override) return g;
      const seen = new Set(override);
      return {
        ...g,
        fieldOrder: [...override, ...g.fieldOrder.filter((n) => !seen.has(n))],
      };
    });
    const topSet = new Set(this.settings.topZone.fieldOrder);

    type Bucket = "top" | "unmatched" | { groupId: string };
    const bucket = new Map<string, Bucket>();
    for (const k of keys) {
      if (topSet.has(k)) {
        bucket.set(k, "top");
        continue;
      }
      let assigned = false;
      for (const g of groups) {
        if (this.matchGroupForFile(g, k, filePath)) {
          bucket.set(k, { groupId: g.id });
          assigned = true;
          break;
        }
      }
      if (!assigned) bucket.set(k, "unmatched");
    }

    const result: string[] = [];

    // 1. Top zone in configured order (only keys that exist in this file)
    for (const k of this.settings.topZone.fieldOrder) {
      if (bucket.get(k) === "top") result.push(k);
    }

    // 2. Unmatched keys, original file order
    for (const k of keys) {
      if (bucket.get(k) === "unmatched") result.push(k);
    }

    // 3. Each group: explicit fieldOrder first, then unlisted matches in file order
    for (const g of groups) {
      const groupKeys = keys.filter((k) => {
        const b = bucket.get(k);
        return typeof b === "object" && b.groupId === g.id;
      });
      if (groupKeys.length === 0) continue;

      const groupKeySet = new Set(groupKeys);
      const explicit = g.fieldOrder.filter((k) => groupKeySet.has(k));
      const explicitSet = new Set(explicit);

      for (const k of explicit) result.push(k);
      for (const k of groupKeys) {
        if (!explicitSet.has(k)) result.push(k);
      }
    }

    return result;
  }

  private isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0
    ) return true;
    return false;
  }

  // Stricter check used by lint pass and bulk-scrub: only literal null/undefined.
  // Empty strings / arrays / objects are user-meaningful and preserved.
  private isNullValue(value: unknown): boolean {
    return value === null || value === undefined;
  }

  // Resolve a template's match against a file path. Returns the longest
  // include-prefix length if the file matches, or -1 if no include matches
  // OR if any exclude prefix matches. Empty/"*" prefixes count as global.
  templateMatchScore(tpl: FolderTemplate, filePath: string): number {
    // Exclude check first; an exclude prefix beats any include.
    for (const prefix of tpl.excludedPathPrefixes ?? []) {
      if (!prefix) continue;
      if (prefix === "*") return -1;
      if (filePath.startsWith(prefix)) return -1;
    }
    let bestLen = -1;
    for (const prefix of tpl.pathPrefixes) {
      const isGlobal = !prefix || prefix === "*";
      if (isGlobal) {
        if (0 > bestLen) bestLen = 0;
      } else if (filePath.startsWith(prefix)) {
        if (prefix.length > bestLen) bestLen = prefix.length;
      }
    }
    return bestLen;
  }

  // Returns map of fieldName → seed value for templates that apply to this file.
  // Empty/undefined pathPrefix counts as global. Longest prefix wins per field;
  // for the same prefix, settings order wins.
  computeDefaultsForFile(filePath: string): Map<string, unknown> {
    type Hit = { len: number; order: number; value: unknown };
    const hits = new Map<string, Hit>();
    this.settings.folderTemplates.forEach((tpl, order) => {
      const bestLen = this.templateMatchScore(tpl, filePath);
      if (bestLen < 0) return;

      // Build effective field set: linked-group fields first (value=undefined),
      // then explicit template fields override.
      const effective = new Map<string, unknown>();
      if (tpl.group) {
        const group = this.settings.groups.find((g) => g.id === tpl.group);
        if (group) {
          // Only flow in wildcard / regex matches and any legacy group-owned
          // literals — never sibling templates' explicit fields.
          const source = this.getGroupEffectiveFieldsCached(group, []);
          for (const name of source) {
            if (name && !effective.has(name)) effective.set(name, undefined);
          }
        }
      }
      for (const field of tpl.fields) {
        if (!field.name) continue;
        effective.set(field.name, field.value);
      }
      const excludedSet = new Set(tpl.excludedFields);
      for (const name of Array.from(effective.keys())) {
        if (excludedSet.has(name)) effective.delete(name);
      }

      for (const [name, value] of effective) {
        const prior = hits.get(name);
        if (
          !prior ||
          bestLen > prior.len ||
          (bestLen === prior.len && order > prior.order)
        ) {
          hits.set(name, { len: bestLen, order, value });
        }
      }
    });
    const result = new Map<string, unknown>();
    for (const [name, hit] of hits) result.set(name, hit.value);
    return result;
  }

  // Returns the union of lintFields[] across (a) every globalLintFields name
  // and (b) any template's lintFields whose path matches the file.
  computeLintFieldsForFile(filePath: string): Set<string> {
    const result = new Set<string>();
    for (const name of this.settings.globalLintFields) {
      if (name) result.add(name);
    }
    for (const tpl of this.settings.folderTemplates) {
      if (tpl.lintFields.length === 0) continue;
      if (this.templateMatchScore(tpl, filePath) < 0) continue;
      for (const name of tpl.lintFields) {
        if (name) result.add(name);
      }
    }
    return result;
  }

  private resolveSeedValue(value: unknown): unknown {
    if (value === "<today>") {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    if (value === "<now>") {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${day}T${hh}:${mm}`;
    }
    return value;
  }

  private applyDefaultsToFm(
    fm: Record<string, unknown>,
    defaults: Map<string, unknown>
  ): boolean {
    let mutated = false;
    for (const [key, value] of defaults) {
      const hasKey = Object.prototype.hasOwnProperty.call(fm, key);
      if (hasKey && !this.isEmptyValue(fm[key])) continue;
      const resolved = this.resolveSeedValue(value);
      const next = resolved === undefined ? null : resolved;
      // A present-but-empty key with an empty seed is already in its target
      // state. Re-assigning null would flag a mutation and force a rewrite
      // (mtime bump) on every reconcile of every note with an empty slot.
      if (hasKey && next === null) continue;
      fm[key] = next;
      mutated = true;
    }
    return mutated;
  }

  async applyDefaultsOnCreate(file: TFile) {
    if (file.extension !== "md") return;
    const defaults = this.computeDefaultsForFile(file.path);
    if (defaults.size > 0) {
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          this.applyDefaultsToFm(fm, defaults);
        });
      } catch (e) {
        console.error("[FFG] applyDefaultsOnCreate error", file.path, e);
      }
    }
    await this.maybeInsertBodyTemplate(file);

    // A freshly created note's Properties panel renders only after these
    // writes land. The MutationObserver can miss that render when it coincides
    // with an in-flight process pass (mutations arriving while isProcessing is
    // true are dropped), which leaves the gear/refresh buttons un-injected
    // until a manual close/reopen. Nudge a reprocess so they appear on their
    // own. Idempotent (ensureSettingsGear no-ops if already present); two
    // attempts cover mobile render lag. Only fires for genuine post-layout
    // creates, so it doesn't reintroduce any startup cost.
    this.scheduleTimeout(() => this.processAllContainers(), 100);
    this.scheduleTimeout(() => this.processAllContainers(), 600);
  }

  // Longest matching prefix among any folderTemplate; ties broken by settings order
  // (later entries override earlier when prefix length is equal).
  computeBodyTemplateForFile(filePath: string): string | null {
    let bestLen = -1;
    let bestPath: string | null = null;
    this.settings.folderTemplates.forEach((tpl) => {
      if (!tpl.bodyTemplatePath) return;
      const len = this.templateMatchScore(tpl, filePath);
      if (len < 0) return;
      if (len >= bestLen) {
        bestLen = len;
        bestPath = tpl.bodyTemplatePath ?? null;
      }
    });
    return bestPath;
  }

  // Splits a file's text into [frontmatterBlock, body]. The frontmatter block,
  // if present, includes the leading and trailing `---` lines plus the trailing newline.
  private splitFrontmatter(text: string): { fm: string; body: string } {
    if (!text.startsWith("---")) return { fm: "", body: text };
    // Find the closing --- on its own line, after the opening one.
    const lines = text.split("\n");
    if (lines[0] !== "---") return { fm: "", body: text };
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        end = i;
        break;
      }
    }
    if (end < 0) return { fm: "", body: text };
    const fm = lines.slice(0, end + 1).join("\n") + "\n";
    const body = lines.slice(end + 1).join("\n");
    return { fm, body };
  }

  async maybeInsertBodyTemplate(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    const templatePath = this.computeBodyTemplateForFile(file.path);
    if (!templatePath) return;
    try {
      const current = await this.app.vault.read(file);
      const { fm, body } = this.splitFrontmatter(current);
      if (body.trim().length > 0) return; // body not blank

      const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
      if (!(templateFile instanceof TFile)) {
        new Notice(`[FFG] Body template not found: ${templatePath}`);
        return;
      }
      // Strip frontmatter from the template file too; only its body is inserted.
      const templateText = await this.app.vault.read(templateFile);
      const { body: templateBody } = this.splitFrontmatter(templateText);
      // A template that is only frontmatter (or empty) has nothing to insert.
      // The old fallback pasted the raw file, frontmatter block included.
      if (templateBody.trim().length === 0) return;
      const insertion = templateBody;

      const separator = fm.length > 0 ? "\n" : "";
      const next = fm + separator + insertion;
      await this.app.vault.modify(file, next);

      await this.maybeParseTemplaterInFile(file);
    } catch (e) {
      console.error("[FFG] maybeInsertBodyTemplate error", file.path, e);
    }
  }

  // If Templater plugin is installed, ask it to parse its syntax in `file` in place.
  // Falls back silently when Templater is absent or the API path is unavailable.
  private async maybeParseTemplaterInFile(file: TFile): Promise<void> {
    type TemplaterPluginShape = {
      templater?: {
        overwrite_file_commands?: (file: TFile, active_file?: boolean) => Promise<void>;
      };
    };
    const plugins = (
      this.app as unknown as {
        plugins?: { plugins?: Record<string, unknown> };
      }
    ).plugins;
    const templaterPlugin = plugins?.plugins?.["templater-obsidian"] as
      | TemplaterPluginShape
      | undefined;
    const fn = templaterPlugin?.templater?.overwrite_file_commands;
    if (typeof fn !== "function") return;
    try {
      await fn.call(templaterPlugin!.templater, file, false);
    } catch (e) {
      console.warn("[FFG] Templater parse failed; left raw", file.path, e);
    }
  }

  // ── Scrub log ────────────────────────────────────────────────────────────

  private get scrubLogPath(): string {
    const dir =
      this.manifest.dir ??
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return `${dir}/scrub-log.json`;
  }

  async readScrubLog(): Promise<ScrubLogEntry[]> {
    try {
      const exists = await this.app.vault.adapter.exists(this.scrubLogPath);
      if (!exists) return [];
      const raw = await this.app.vault.adapter.read(this.scrubLogPath);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ScrubLogEntry[]) : [];
    } catch (e) {
      console.error("[FFG] readScrubLog error", e);
      return [];
    }
  }

  private async appendScrubLog(entry: ScrubLogEntry): Promise<void> {
    try {
      const log = await this.readScrubLog();
      log.push(entry);
      if (log.length > 500) log.splice(0, log.length - 500);
      await this.app.vault.adapter.write(
        this.scrubLogPath,
        JSON.stringify(log, null, 2)
      );
    } catch (e) {
      console.error("[FFG] appendScrubLog error", e);
    }
  }

  // For a given field, returns the templates that "touch" it (i.e. would
  // surface it as a default, contain it via linked-group wildcard expansion,
  // or already have it flagged for cleanup), and the subset that have cleanup
  // turned on. Used by the Cleanup tab to render partial-coverage fractions.
  templatesActiveForField(
    field: string,
    groupEffectiveCache?: Map<string, Set<string>>
  ): { total: FolderTemplate[]; withCleanup: FolderTemplate[] } {
    const total: FolderTemplate[] = [];
    const withCleanup: FolderTemplate[] = [];
    for (const tpl of this.settings.folderTemplates) {
      let active = false;
      const hasLint = tpl.lintFields.includes(field);
      if (hasLint) {
        active = true;
      } else if ((tpl.excludedFields ?? []).includes(field)) {
        active = false;
      } else if (tpl.fields.some((f) => f.name === field)) {
        active = true;
      } else if (tpl.group) {
        let effective: Set<string> | undefined;
        if (groupEffectiveCache && groupEffectiveCache.has(tpl.group)) {
          effective = groupEffectiveCache.get(tpl.group);
        } else {
          const g = this.settings.groups.find((gg) => gg.id === tpl.group);
          effective = new Set(
            g ? this.getGroupEffectiveFieldsCached(g, []) : []
          );
          if (groupEffectiveCache) {
            groupEffectiveCache.set(tpl.group, effective);
          }
        }
        if (effective && effective.has(field)) active = true;
      }
      if (active) {
        total.push(tpl);
        if (hasLint) withCleanup.push(tpl);
      }
    }
    return { total, withCleanup };
  }

  // Returns the canonical list of lint-flagged field names from templates,
  // along with which templates flag each. Used as the auto-seed for Cleanup.
  lintFlaggedFieldsFromTemplates(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const tpl of this.settings.folderTemplates) {
      for (const name of tpl.lintFields) {
        if (!name) continue;
        let set = result.get(name);
        if (!set) {
          set = new Set();
          result.set(name, set);
        }
        set.add(tpl.name || "(unnamed template)");
      }
    }
    return result;
  }

  // True if `filePath` is under `scope`. Empty scope = whole vault.
  private fileInScope(filePath: string, scope: string): boolean {
    if (!scope) return true;
    if (scope === "*") return true;
    if (filePath === scope) return true;
    const s = scope.endsWith("/") ? scope : scope + "/";
    return filePath.startsWith(s);
  }

  // Count null and total occurrences of every requested field within `scope`
  // in ONE vault walk. `coveredNullCount` = nulls in files matched by a
  // template that owns the field; the delta (nullCount - coveredNullCount) is
  // orphan nulls in notes no template covers. Replaces the per-field variant
  // that re-walked the whole vault once per field (O(fields × files)).
  countFieldsInScope(
    fieldNames: Set<string>,
    scope: string
  ): Map<
    string,
    { nullCount: number; totalCount: number; coveredNullCount: number }
  > {
    const counts = new Map<
      string,
      { nullCount: number; totalCount: number; coveredNullCount: number }
    >();
    const activeByField = new Map<string, FolderTemplate[]>();
    const groupEffectiveCache = new Map<string, Set<string>>();
    for (const name of fieldNames) {
      counts.set(name, { nullCount: 0, totalCount: 0, coveredNullCount: 0 });
      activeByField.set(
        name,
        this.templatesActiveForField(name, groupEffectiveCache).total
      );
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      for (const k of Object.keys(fm)) {
        if (k === "position") continue;
        const c = counts.get(k);
        if (!c) continue;
        c.totalCount++;
        if (this.isNullValue(fm[k])) {
          c.nullCount++;
          const activeTpls = activeByField.get(k) ?? [];
          if (
            activeTpls.some(
              (tpl) => this.templateMatchScore(tpl, file.path) >= 0
            )
          ) {
            c.coveredNullCount++;
          }
        }
      }
    }
    return counts;
  }

  // For inspection: every file in scope that has `fieldName` set, with the
  // raw value. `covered` = the note sits in a folder matched by a template
  // that owns this field. Uncovered notes are orphans relative to the
  // grouping/cleanup system.
  collectFieldOccurrencesInScope(
    fieldName: string,
    scope: string
  ): Array<{ file: TFile; value: unknown; covered: boolean; isNull: boolean }> {
    const activeTpls = this.templatesActiveForField(fieldName).total;
    const out: Array<{
      file: TFile;
      value: unknown;
      covered: boolean;
      isNull: boolean;
    }> = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      if (!Object.prototype.hasOwnProperty.call(fm, fieldName)) continue;
      const covered = activeTpls.some(
        (tpl) => this.templateMatchScore(tpl, file.path) >= 0
      );
      out.push({
        file,
        value: fm[fieldName],
        covered,
        isNull: this.isNullValue(fm[fieldName]),
      });
    }
    out.sort((a, b) => a.file.path.localeCompare(b.file.path));
    return out;
  }

  // Every distinct frontmatter key across files in `scope`. Filters out
  // Obsidian's internal `position` artifact and keys with empty string names.
  collectFrontmatterKeysInScope(scope: string): Set<string> {
    const keys = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      for (const k of Object.keys(fm)) {
        if (!k || k === "position") continue;
        keys.add(k);
      }
    }
    return keys;
  }

  // Remove only null-valued occurrences of `fieldName` within `scope`.
  // Pre-filters via metadataCache so we never call processFrontMatter on files
  // that don't have the field (otherwise every scanned file's mtime would bump).
  async scrubFieldNullInScope(
    fieldName: string,
    scope: string
  ): Promise<number> {
    const totalRemoved: ScrubLogFileEntry[] = [];
    const maxPasses = 3;
    for (let pass = 0; pass < maxPasses; pass++) {
      const passRemoved: ScrubLogFileEntry[] = [];
      const touchedFiles: TFile[] = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this.fileInScope(file.path, scope)) continue;
        const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!cached) continue;
        if (!Object.prototype.hasOwnProperty.call(cached, fieldName)) continue;
        if (!this.isNullValue(cached[fieldName])) continue;

        let captured: unknown = undefined;
        let didRemove = false;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (
              Object.prototype.hasOwnProperty.call(fm, fieldName) &&
              this.isNullValue(fm[fieldName])
            ) {
              captured = fm[fieldName];
              delete fm[fieldName];
              didRemove = true;
            }
          });
        } catch (e) {
          console.error("[FFG] scrubFieldNullInScope error", file.path, e);
          continue;
        }
        if (didRemove) {
          passRemoved.push({ path: file.path, value: captured });
          touchedFiles.push(file);
        }
      }
      totalRemoved.push(...passRemoved);
      if (passRemoved.length === 0) break;
      await this.waitForFrontmatterCatchUp(touchedFiles, fieldName);
    }
    if (totalRemoved.length > 0) {
      await this.appendScrubLog({
        ts: Date.now(),
        action: "remove-null",
        scope,
        field: fieldName,
        files: totalRemoved,
      });
    }
    return totalRemoved.length;
  }

  // Remove EVERY occurrence of `fieldName` within `scope`, including non-null values.
  // Pre-filters via metadataCache to avoid mtime churn. Iterates in passes
  // because the cache can lag/miss for some files; a second pass picks up
  // stragglers once the cache has caught up.
  async scrubFieldAllInScope(
    fieldName: string,
    scope: string
  ): Promise<number> {
    const totalRemoved: ScrubLogFileEntry[] = [];
    const maxPasses = 3;
    for (let pass = 0; pass < maxPasses; pass++) {
      const passRemoved: ScrubLogFileEntry[] = [];
      const touchedFiles: TFile[] = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this.fileInScope(file.path, scope)) continue;
        const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!cached) continue;
        if (!Object.prototype.hasOwnProperty.call(cached, fieldName)) continue;

        let captured: unknown = undefined;
        let didRemove = false;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (Object.prototype.hasOwnProperty.call(fm, fieldName)) {
              captured = fm[fieldName];
              delete fm[fieldName];
              didRemove = true;
            }
          });
        } catch (e) {
          console.error("[FFG] scrubFieldAllInScope error", file.path, e);
          continue;
        }
        if (didRemove) {
          passRemoved.push({ path: file.path, value: captured });
          touchedFiles.push(file);
        }
      }
      totalRemoved.push(...passRemoved);
      if (passRemoved.length === 0) break;
      await this.waitForFrontmatterCatchUp(touchedFiles, fieldName);
    }
    if (totalRemoved.length > 0) {
      await this.appendScrubLog({
        ts: Date.now(),
        action: "remove-all",
        scope,
        field: fieldName,
        files: totalRemoved,
      });
    }
    return totalRemoved.length;
  }

  // After bulk writes, Obsidian's metadataCache lags the disk by some ms.
  // Poll until every touched file's cache reflects the field's removal so
  // the post-scrub rescan reads accurate counts. Bounded by a hard ceiling.
  // Polling is more reliable than the "changed" event under batch load, which
  // can coalesce or drop firings for large operations.
  private async waitForFrontmatterCatchUp(
    files: TFile[],
    fieldName: string
  ): Promise<void> {
    if (files.length === 0) return;
    const stillHasField = (file: TFile): boolean => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) return false;
      return Object.prototype.hasOwnProperty.call(fm, fieldName);
    };
    const startedAt = Date.now();
    const ceilingMs = 8000;
    const intervalMs = 120;
    while (Date.now() - startedAt < ceilingMs) {
      let allClear = true;
      for (const f of files) {
        if (stillHasField(f)) {
          allClear = false;
          break;
        }
      }
      if (allClear) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // ── Field migration ──────────────────────────────────────────────────────
  // One-off: copy values from `sourceField` to `targetField` across `scope`,
  // then delete the source field. Files where the target already has a
  // non-null/non-empty value are returned as conflicts for the caller to
  // resolve; null target counts as "safe to overwrite."

  scanFieldMigration(
    sourceField: string,
    targetField: string,
    scope: string
  ): {
    cleanFiles: TFile[];
    conflicts: Array<{ file: TFile; sourceValue: unknown; targetValue: unknown }>;
  } {
    const cleanFiles: TFile[] = [];
    const conflicts: Array<{
      file: TFile;
      sourceValue: unknown;
      targetValue: unknown;
    }> = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!cached) continue;
      if (!Object.prototype.hasOwnProperty.call(cached, sourceField)) continue;
      const sourceValue = cached[sourceField];
      if (this.isEmptyValue(sourceValue)) continue;

      const hasTarget = Object.prototype.hasOwnProperty.call(
        cached,
        targetField
      );
      const targetValue = hasTarget ? cached[targetField] : undefined;
      if (!hasTarget || this.isEmptyValue(targetValue)) {
        cleanFiles.push(file);
      } else {
        conflicts.push({ file, sourceValue, targetValue });
      }
    }
    return { cleanFiles, conflicts };
  }

  // Apply one resolved migration to one file. Resolution:
  //   - "use-source": target gets source value; source field deleted.
  //   - "use-target": target unchanged; source field deleted.
  //   - "merge": both source and target must be arrays; target becomes the
  //     union (preserving target order, appending novel source items); source
  //     field deleted.
  // Returns the captured pair {sourceValue, targetValueBefore} if a write
  // happened, or null on no-op / error.
  async applyFieldMigrationToFile(
    file: TFile,
    sourceField: string,
    targetField: string,
    resolution: "use-source" | "use-target" | "merge"
  ): Promise<{ sourceValue: unknown; targetValueBefore: unknown } | null> {
    let capturedSource: unknown = undefined;
    let capturedTarget: unknown = undefined;
    let didWrite = false;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (!Object.prototype.hasOwnProperty.call(fm, sourceField)) return;
        capturedSource = fm[sourceField];
        capturedTarget = Object.prototype.hasOwnProperty.call(fm, targetField)
          ? fm[targetField]
          : undefined;

        if (resolution === "use-source") {
          fm[targetField] = capturedSource;
        } else if (resolution === "merge") {
          if (Array.isArray(capturedSource) && Array.isArray(capturedTarget)) {
            const merged = [...capturedTarget];
            for (const item of capturedSource) {
              if (!merged.includes(item)) merged.push(item);
            }
            fm[targetField] = merged;
          } else {
            // Fall back to source-wins for non-list merges so we don't lose data.
            fm[targetField] = capturedSource;
          }
        }
        // "use-target": leave fm[targetField] alone.

        delete fm[sourceField];
        didWrite = true;
      });
    } catch (e) {
      console.error("[FFG] applyFieldMigrationToFile error", file.path, e);
      return null;
    }
    if (!didWrite) return null;
    return { sourceValue: capturedSource, targetValueBefore: capturedTarget };
  }

  async logFieldMigration(
    sourceField: string,
    targetField: string,
    scope: string,
    perFile: Array<{
      path: string;
      sourceValue: unknown;
      targetValueBefore: unknown;
    }>
  ): Promise<void> {
    if (perFile.length === 0) return;
    await this.appendScrubLog({
      ts: Date.now(),
      action: "migrate",
      scope,
      field: sourceField,
      targetField,
      files: perFile.map((p) => ({ path: p.path, value: p.sourceValue })),
      targetValuesBefore: perFile.map((p) => p.targetValueBefore),
    });
  }

  // Plan a settings-side rename so the source field name disappears from
  // plugin configuration alongside the note-side migration. Categorizes each
  // touched location as either a clean update (no value ambiguity, safe to
  // auto-apply) or a decision the user must make (template seed values that
  // diverge). Nothing is applied until the caller invokes apply().
  planSettingsUpdates(
    sourceField: string,
    targetField: string
  ): SettingsUpdatePlan {
    const cleanUpdates: SettingsUpdatePlan["cleanUpdates"] = [];
    const decisions: SettingsUpdatePlan["decisions"] = [];
    const source = sourceField.trim();
    const target = targetField.trim();
    if (!source || !target || source === target) {
      return { cleanUpdates, decisions };
    }

    // Top Level Properties
    const tz = this.settings.topZone.fieldOrder;
    if (tz.includes(source)) {
      const targetPresent = tz.includes(target);
      cleanUpdates.push({
        label: targetPresent
          ? "Top Level Properties — remove source (target already present)"
          : "Top Level Properties — rename source → target",
        apply: () => {
          const list = this.settings.topZone.fieldOrder;
          const i = list.indexOf(source);
          if (i < 0) return;
          if (list.includes(target)) list.splice(i, 1);
          else list[i] = target;
        },
      });
    }

    // Groups (literal matcher values + fieldOrder; wildcards skipped)
    for (const g of this.settings.groups) {
      const mvHas = (g.matcherValues ?? []).includes(source);
      const foHas = (g.fieldOrder ?? []).includes(source);
      if (!mvHas && !foHas) continue;
      cleanUpdates.push({
        label: `Group "${g.name || g.id}" — rename literal entries (wildcards skipped)`,
        apply: () => {
          const renameList = (list: string[]) => {
            const out: string[] = [];
            for (const v of list) {
              if (v !== source) {
                out.push(v);
                continue;
              }
              if (!out.includes(target)) out.push(target);
            }
            return out;
          };
          g.matcherValues = renameList(g.matcherValues ?? []);
          g.fieldOrder = renameList(g.fieldOrder ?? []);
        },
      });
    }

    // Templates
    for (const t of this.settings.folderTemplates) {
      const tlabel = `Template "${t.name || t.id}"`;
      const srcFieldIdx = t.fields.findIndex((f) => f.name === source);
      const tgtFieldIdx = t.fields.findIndex((f) => f.name === target);
      const inExc = t.excludedFields.includes(source);
      const inLint = t.lintFields.includes(source);

      // Fields[] handling (may produce a decision)
      if (srcFieldIdx >= 0) {
        const srcVal = t.fields[srcFieldIdx].value;
        const tgtVal = tgtFieldIdx >= 0 ? t.fields[tgtFieldIdx].value : undefined;
        const srcHasSeed = !this.isEmptyValue(srcVal);
        const tgtHasEntry = tgtFieldIdx >= 0;
        const tgtHasSeed = tgtHasEntry && !this.isEmptyValue(tgtVal);
        const sameSeed =
          srcHasSeed &&
          tgtHasSeed &&
          this.seedValuesEqual(srcVal, tgtVal);

        const dropSource = () => {
          const i = t.fields.findIndex((f) => f.name === source);
          if (i >= 0) t.fields.splice(i, 1);
        };
        const setTargetValue = (value: unknown) => {
          const i = t.fields.findIndex((f) => f.name === target);
          if (i >= 0) {
            if (value === undefined) {
              t.fields[i] = { name: target };
            } else {
              t.fields[i] = { name: target, value };
            }
          } else {
            t.fields.push(
              value === undefined ? { name: target } : { name: target, value }
            );
          }
        };

        if (!srcHasSeed || sameSeed) {
          // Clean: target keeps whatever it had (or source's name is reused).
          cleanUpdates.push({
            label: tgtHasEntry
              ? `${tlabel} default value — remove source (target already present)`
              : `${tlabel} default value — rename source → target`,
            apply: () => {
              if (tgtHasEntry) {
                dropSource();
              } else {
                const i = t.fields.findIndex((f) => f.name === source);
                if (i >= 0) {
                  const value = t.fields[i].value;
                  t.fields[i] =
                    value === undefined
                      ? { name: target }
                      : { name: target, value };
                }
              }
            },
          });
        } else {
          // Decision required.
          decisions.push({
            id: `tpl-${t.id}-fields`,
            label: `${tlabel} default value for "${target}"`,
            sourceValue: srcVal,
            targetValue: tgtHasEntry ? tgtVal : undefined,
            targetHadEntry: tgtHasEntry,
            choice: "target",
            apply: (chosen) => {
              if (chosen === "source") {
                setTargetValue(srcVal);
                dropSource();
              } else {
                if (tgtHasEntry) {
                  dropSource();
                } else {
                  // Target had no entry; user chose "no seed" for target.
                  setTargetValue(undefined);
                  dropSource();
                }
              }
            },
          });
        }
      }

      if (inExc) {
        const targetPresent = t.excludedFields.includes(target);
        cleanUpdates.push({
          label: targetPresent
            ? `${tlabel} excluded fields — remove source (target already present)`
            : `${tlabel} excluded fields — rename source → target`,
          apply: () => {
            t.excludedFields = t.excludedFields.filter((n) => n !== source);
            if (!t.excludedFields.includes(target))
              t.excludedFields.push(target);
          },
        });
      }
      if (inLint) {
        const targetPresent = t.lintFields.includes(target);
        cleanUpdates.push({
          label: targetPresent
            ? `${tlabel} cleanup-when-empty — remove source (target already present)`
            : `${tlabel} cleanup-when-empty — rename source → target`,
          apply: () => {
            t.lintFields = t.lintFields.filter((n) => n !== source);
            if (!t.lintFields.includes(target)) t.lintFields.push(target);
          },
        });
      }
    }

    // Icon overrides
    const iconIdx = this.settings.iconOverrides.findIndex(
      (o) => o.name === source
    );
    if (iconIdx >= 0) {
      const targetPresent =
        this.settings.iconOverrides.findIndex((o) => o.name === target) >= 0;
      cleanUpdates.push({
        label: targetPresent
          ? "Icon overrides — remove source (target already present)"
          : "Icon overrides — rename source → target",
        apply: () => {
          const i = this.settings.iconOverrides.findIndex(
            (o) => o.name === source
          );
          if (i < 0) return;
          const j = this.settings.iconOverrides.findIndex(
            (o) => o.name === target
          );
          if (j >= 0) {
            this.settings.iconOverrides.splice(i, 1);
          } else {
            this.settings.iconOverrides[i].name = target;
          }
        },
      });
    }

    // Cleanup ad-hoc fields
    if (this.settings.cleanupAdHocFields.includes(source)) {
      cleanUpdates.push({
        label: this.settings.cleanupAdHocFields.includes(target)
          ? "Cleanup ad-hoc fields — remove source (target already present)"
          : "Cleanup ad-hoc fields — rename source → target",
        apply: () => {
          this.settings.cleanupAdHocFields = this.settings.cleanupAdHocFields.filter(
            (n) => n !== source
          );
          if (!this.settings.cleanupAdHocFields.includes(target)) {
            this.settings.cleanupAdHocFields.push(target);
          }
        },
      });
    }

    // Vault-wide cleanup
    if (this.settings.globalLintFields.includes(source)) {
      cleanUpdates.push({
        label: this.settings.globalLintFields.includes(target)
          ? "Vault-wide cleanup — remove source (target already present)"
          : "Vault-wide cleanup — rename source → target",
        apply: () => {
          this.settings.globalLintFields = this.settings.globalLintFields.filter(
            (n) => n !== source
          );
          if (!this.settings.globalLintFields.includes(target)) {
            this.settings.globalLintFields.push(target);
          }
        },
      });
    }

    return { cleanUpdates, decisions };
  }

  private seedValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  async applySettingsUpdates(
    plan: SettingsUpdatePlan,
    decisionChoices: Map<string, "source" | "target">
  ): Promise<{ applied: number }> {
    let applied = 0;
    for (const u of plan.cleanUpdates) {
      try {
        u.apply();
        applied += 1;
      } catch (e) {
        console.error("[FFG] settings clean update failed", u.label, e);
      }
    }
    for (const d of plan.decisions) {
      const choice = decisionChoices.get(d.id) ?? d.choice;
      try {
        d.apply(choice);
        applied += 1;
      } catch (e) {
        console.error("[FFG] settings decision apply failed", d.label, e);
      }
    }
    await this.saveSettings();
    return { applied };
  }

  // List every place `fieldName` shows up in plugin settings, so we can warn
  // the user that migration only touches notes, not configuration.
  collectFieldSettingsReferences(fieldName: string): string[] {
    const hits: string[] = [];
    const cleaned = fieldName.trim();
    if (!cleaned) return hits;
    if (this.settings.topZone.fieldOrder.includes(cleaned)) {
      hits.push("Top Level Properties");
    }
    for (const g of this.settings.groups) {
      const inMatchers = (g.matcherValues ?? []).some(
        (v) => v === cleaned || v === cleaned + "*"
      );
      const inFieldOrder = (g.fieldOrder ?? []).includes(cleaned);
      if (inMatchers || inFieldOrder) {
        hits.push(`Group "${g.name || g.id}"`);
      }
    }
    for (const tpl of this.settings.folderTemplates) {
      const inFields = tpl.fields.some((f) => f.name === cleaned);
      const inExcluded = tpl.excludedFields.includes(cleaned);
      const inLint = tpl.lintFields.includes(cleaned);
      if (inFields || inExcluded || inLint) {
        hits.push(`Template "${tpl.name || tpl.id}"`);
      }
    }
    if (this.settings.iconOverrides.some((o) => o.name === cleaned)) {
      hits.push("Icon overrides");
    }
    if (this.settings.cleanupAdHocFields.includes(cleaned)) {
      hits.push("Cleanup ad-hoc fields");
    }
    if (this.settings.globalLintFields.includes(cleaned)) {
      hits.push("Vault-wide cleanup");
    }
    return hits;
  }

  // Write a checklist note to the Inbox folder listing every conflict file
  // as a wikilink. Returns the path written.
  async writeMigrationConflictNote(
    sourceField: string,
    targetField: string,
    scope: string,
    conflicts: Array<{ file: TFile; sourceValue: unknown; targetValue: unknown }>
  ): Promise<string> {
    const inboxFolder = "Inbox";
    const date = new Date().toISOString().slice(0, 10);
    const safeSource = sourceField.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeTarget = targetField.replace(/[^a-zA-Z0-9_-]/g, "_");
    const baseName = `${date} Field Migration Conflicts ${safeSource} to ${safeTarget}`;

    let candidate = `${inboxFolder}/${baseName}.md`;
    let suffix = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${inboxFolder}/${baseName} (${suffix}).md`;
      suffix += 1;
    }

    const renderValue = (v: unknown): string => {
      if (v === null || v === undefined) return "*(null)*";
      if (typeof v === "string") return v;
      try {
        return "`" + JSON.stringify(v) + "`";
      } catch {
        return String(v);
      }
    };

    const lines: string[] = [];
    lines.push(`# Field Migration Conflicts`);
    lines.push("");
    lines.push(`- Source field: \`${sourceField}\``);
    lines.push(`- Target field: \`${targetField}\``);
    lines.push(`- Scope: ${scope ? `\`${scope}\`` : "whole vault"}`);
    lines.push(`- Count: ${conflicts.length}`);
    lines.push("");
    lines.push(
      `Each file below has both \`${sourceField}\` and \`${targetField}\` set. Open the file, decide which value to keep, then check it off here.`
    );
    lines.push("");
    for (const c of conflicts) {
      const link = c.file.basename;
      lines.push(`- [ ] [[${link}]]`);
      lines.push(`    - \`${sourceField}\`: ${renderValue(c.sourceValue)}`);
      lines.push(`    - \`${targetField}\`: ${renderValue(c.targetValue)}`);
    }
    lines.push("");

    if (!this.app.vault.getAbstractFileByPath(inboxFolder)) {
      await this.app.vault.createFolder(inboxFolder);
    }
    await this.app.vault.create(candidate, lines.join("\n"));
    return candidate;
  }

  async reconcileFrontmatter(
    file: TFile
  ): Promise<"rewrote" | "noop" | "no-frontmatter" | "error" | "skipped"> {
    if (!file || file.extension !== "md") return "skipped";

    try {
      let outcome: "rewrote" | "noop" | "no-frontmatter" = "no-frontmatter";

      const defaults = this.computeDefaultsForFile(file.path);
      const lintFieldsSet = this.computeLintFieldsForFile(file.path);

      // Fast path: peek the cached frontmatter. If no defaults could apply,
      // no lint flags hit any present null key, and the keys are already in
      // canonical order, skip processFrontMatter entirely (it parses the file
      // and bumps mtime even when the callback is a no-op).
      const cachedFm =
        this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
      if (cachedFm) {
        const cachedKeys = Object.keys(cachedFm).filter((k) => k !== "position");
        // Mirrors applyDefaultsToFm exactly: a write is needed only when a key
        // is missing, or present-but-empty with a NON-empty seed. Keep the two
        // in sync — this pre-check is the only thing standing between a clean
        // open/leave and a processFrontMatter call (which rewrites the file
        // even when the callback is a no-op).
        const needsDefault =
          defaults.size > 0 &&
          Array.from(defaults.entries()).some(([k, v]) => {
            if (!cachedKeys.includes(k)) return true;
            if (!this.isEmptyValue(cachedFm[k])) return false;
            const resolved = this.resolveSeedValue(v);
            return resolved !== undefined && resolved !== null;
          });
        // Mirrors the lint pass below: keys the defaults map wants present are
        // never lint-scrubbed (defaults win over cleanup).
        const needsLint =
          lintFieldsSet.size > 0 &&
          cachedKeys.some((k) => {
            if (!lintFieldsSet.has(k)) return false;
            if (defaults.has(k)) return false;
            return this.isNullValue(cachedFm[k]);
          });
        let needsOrphanScrub = false;
        if (this.settings.scrubOrphanNulls) {
          const knownKeys = this.knownFieldsForFile(file.path);
          needsOrphanScrub = cachedKeys.some((k) => {
            if (knownKeys.has(k)) return false;
            return this.isNullValue(cachedFm[k]);
          });
        }
        if (!needsDefault && !needsLint && !needsOrphanScrub) {
          const desiredKeys = this.computeCanonicalOrder(cachedKeys, file.path);
          let same = cachedKeys.length === desiredKeys.length;
          if (same) {
            for (let i = 0; i < cachedKeys.length; i++) {
              if (cachedKeys[i] !== desiredKeys[i]) {
                same = false;
                break;
              }
            }
          }
          if (same) return "noop";
        }
      } else if (defaults.size === 0 && lintFieldsSet.size === 0) {
        return "no-frontmatter";
      }

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        let mutated = false;

        // Defaults pass: insert missing keys (never overwrite).
        if (defaults.size > 0) {
          if (this.applyDefaultsToFm(fm, defaults)) mutated = true;
        }

        // Lint pass: scrub keys flagged by any matching template if value is null.
        // Any key in the defaults map is skipped entirely (defaults win over
        // cleanup): if a matching template says the field should exist, deleting
        // it here would just make the defaults pass re-insert it on the next
        // reconcile — an insert/delete loop that rewrote the file on every
        // open/leave and stripped intentionally-empty scaffold fields.
        if (lintFieldsSet.size > 0) {
          for (const k of Object.keys(fm)) {
            if (k === "position") continue;
            if (!lintFieldsSet.has(k)) continue;
            if (defaults.has(k)) continue;
            if (this.isNullValue(fm[k])) {
              delete fm[k];
              mutated = true;
            }
          }
        }

        // Orphan-null pass: scrub null keys that no matching template claims.
        if (this.settings.scrubOrphanNulls) {
          const knownKeys = this.knownFieldsForFile(file.path);
          for (const k of Object.keys(fm)) {
            if (k === "position") continue;
            if (knownKeys.has(k)) continue;
            if (this.isNullValue(fm[k])) {
              delete fm[k];
              mutated = true;
            }
          }
        }

        const currentKeys = Object.keys(fm).filter((k) => k !== "position");
        if (currentKeys.length === 0) {
          outcome = mutated ? "rewrote" : "no-frontmatter";
          return;
        }

        const desiredKeys = this.computeCanonicalOrder(currentKeys, file.path);

        let same = currentKeys.length === desiredKeys.length;
        if (same) {
          for (let i = 0; i < currentKeys.length; i++) {
            if (currentKeys[i] !== desiredKeys[i]) {
              same = false;
              break;
            }
          }
        }

        if (!same) {
          const snapshot: Record<string, unknown> = {};
          for (const k of currentKeys) snapshot[k] = fm[k];
          for (const k of currentKeys) delete fm[k];
          for (const k of desiredKeys) fm[k] = snapshot[k];
          mutated = true;
        }

        outcome = mutated ? "rewrote" : "noop";
      });

      return outcome;
    } catch (e) {
      console.error("[FFG] reconcileFrontmatter error", file.path, e);
      return "error";
    }
  }
}

// ── Frontmatter key suggester ────────────────────────────────────────────────

interface KeySuggestOptions {
  commaAware?: boolean;
  filter?: () => (key: string) => boolean;
}

class FrontmatterKeySuggest extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;
  private allKeys: string[];
  private onAccept: (value: string) => void;
  private commaAware: boolean;
  private filterFn?: () => (key: string) => boolean;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onAccept: (value: string) => void,
    options: KeySuggestOptions = {}
  ) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    this.commaAware = options.commaAware ?? false;
    this.filterFn = options.filter;
    this.allKeys = this.collectKeys(app);
  }

  private collectKeys(app: App): string[] {
    const set = new Set<string>();
    const mtm = (app as unknown as { metadataTypeManager?: { properties?: Record<string, unknown> } })
      .metadataTypeManager;
    if (mtm?.properties) {
      for (const key of Object.keys(mtm.properties)) set.add(key);
    }
    if (set.size === 0) {
      for (const file of app.vault.getMarkdownFiles()) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm) continue;
        for (const key of Object.keys(fm)) {
          if (key !== "position") set.add(key);
        }
      }
    }
    return Array.from(set).sort();
  }

  private currentToken(): string {
    if (!this.commaAware) return this.inputEl.value.trim().toLowerCase();
    const value = this.inputEl.value;
    const lastComma = value.lastIndexOf(",");
    return value.slice(lastComma + 1).trim().toLowerCase();
  }

  getSuggestions(_query: string): string[] {
    const token = this.currentToken();
    const filter = this.filterFn?.();
    let keys = this.allKeys;
    if (filter) keys = keys.filter(filter);
    if (token) keys = keys.filter((k) => k.toLowerCase().includes(token));
    return keys.slice(0, 50);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    if (this.commaAware) {
      const current = this.inputEl.value;
      const lastComma = current.lastIndexOf(",");
      const prefix = lastComma === -1 ? "" : current.slice(0, lastComma + 1) + " ";
      const newValue = prefix + value;
      this.inputEl.value = newValue;
      this.onAccept(newValue);
    } else {
      this.inputEl.value = value;
      this.onAccept(value);
    }
    this.close();
    this.inputEl.focus();
  }
}

// ── Seed value parsing ───────────────────────────────────────────────────────

function parseSeedValue(raw: string): unknown {
  if (raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!isNaN(n)) return n;
  }
  return raw;
}

function seedValueToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

// ── Lucide icon suggester ────────────────────────────────────────────────────

class LucideIconSuggest extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;
  private onAccept: (value: string) => void;
  private allIcons: string[];

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onAccept: (value: string) => void
  ) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    this.allIcons = getIconIds().sort();
  }

  getSuggestions(_query: string): string[] {
    const token = this.inputEl.value.trim().toLowerCase();
    if (!token) return this.allIcons.slice(0, 50);
    return this.allIcons
      .filter((id) => id.toLowerCase().includes(token))
      .slice(0, 50);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.addClass("ffg-icon-suggestion");
    const iconEl = el.createSpan({ cls: "ffg-icon-suggestion-icon" });
    setIcon(iconEl, value);
    el.createSpan({ cls: "ffg-icon-suggestion-text", text: value });
  }

  selectSuggestion(value: string): void {
    this.inputEl.value = value;
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
}

// ── Property value suggester ─────────────────────────────────────────────────

interface PropertyValueSuggestOptions {
  excludeValues?: () => Set<string>;
}

class PropertyValueSuggest extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;
  private values: string[];
  private onAccept: (value: string) => void;
  private options: PropertyValueSuggestOptions;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    values: string[],
    onAccept: (value: string) => void,
    options: PropertyValueSuggestOptions = {}
  ) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.values = values;
    this.onAccept = onAccept;
    this.options = options;
  }

  getSuggestions(_query: string): string[] {
    const token = this.inputEl.value.trim().toLowerCase();
    const exclude = this.options.excludeValues?.() ?? new Set<string>();
    let values = this.values.filter((v) => !exclude.has(v));
    if (token) values = values.filter((v) => v.toLowerCase().includes(token));
    return values.slice(0, 50);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
}

// ── Confirmation modal ───────────────────────────────────────────────────────

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private onConfirm: () => void | Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });
    const row = this.contentEl.createDiv("ffg-modal-buttons");
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const confirm = row.createEl("button", {
      text: "Confirm",
      cls: "mod-warning",
    });
    confirm.addEventListener("click", async () => {
      this.close();
      await this.onConfirm();
    });
  }
}

interface MigrationConfirmResult {
  applySettings: boolean;
  decisionChoices: Map<string, "source" | "target">;
}

class MigrationConfirmModal extends Modal {
  private decisionChoices = new Map<string, "source" | "target">();
  private applySettings = false;

  constructor(
    app: App,
    private scan: {
      sourceField: string;
      targetField: string;
      scope: string;
      cleanFiles: TFile[];
      conflicts: Array<{
        file: TFile;
        sourceValue: unknown;
        targetValue: unknown;
      }>;
      settingsRefs: string[];
      settingsPlan: SettingsUpdatePlan;
    },
    private onConfirm: (result: MigrationConfirmResult) => void | Promise<void>
  ) {
    super(app);
    for (const d of scan.settingsPlan.decisions) {
      this.decisionChoices.set(d.id, d.choice);
    }
    // If there's nothing to migrate but settings have references, the user's
    // intent is clearly a settings-only sweep — pre-check the box.
    const filesTotal = scan.cleanFiles.length + scan.conflicts.length;
    const settingsTotal =
      scan.settingsPlan.cleanUpdates.length + scan.settingsPlan.decisions.length;
    if (filesTotal === 0 && settingsTotal > 0) {
      this.applySettings = true;
    }
  }

  onOpen(): void {
    this.contentEl.empty();
    const filesTotal =
      this.scan.cleanFiles.length + this.scan.conflicts.length;
    const settingsOnly = filesTotal === 0;
    this.contentEl.createEl("h2", {
      text: settingsOnly ? "Clean up settings references" : "Migrate field",
    });
    this.contentEl.createEl("p", {
      text: settingsOnly
        ? `No notes in ${this.scan.scope ? `\`${this.scan.scope}\`` : "the whole vault"} carry \`${this.scan.sourceField}\`, but plugin settings still reference it. Rename to \`${this.scan.targetField}\` in settings only.`
        : `Move values from \`${this.scan.sourceField}\` to \`${this.scan.targetField}\` in ${this.scan.scope ? `\`${this.scan.scope}\`` : "the whole vault"}, then delete the source field.`,
    });
    if (!settingsOnly) {
      const list = this.contentEl.createEl("ul");
      list.createEl("li", {
        text: `${this.scan.cleanFiles.length} file(s) will migrate automatically (target was empty or absent).`,
      });
      if (this.scan.conflicts.length >= 6) {
        list.createEl("li", {
          text: `${this.scan.conflicts.length} conflict(s) will be written to a checklist note in Inbox/ for manual resolution.`,
        });
      } else if (this.scan.conflicts.length > 0) {
        list.createEl("li", {
          text: `${this.scan.conflicts.length} conflict(s) will be resolved one at a time in a follow-up dialog.`,
        });
      }
    }

    const settingsTotal =
      this.scan.settingsPlan.cleanUpdates.length +
      this.scan.settingsPlan.decisions.length;

    if (settingsTotal > 0) {
      const sweepWrap = this.contentEl.createDiv("ffg-migrate-sweep");
      const checkRow = sweepWrap.createDiv("ffg-migrate-sweep-check");
      const checkbox = checkRow.createEl("input", {
        type: "checkbox",
      });
      checkbox.id = "ffg-migrate-sweep-toggle";
      const labelEl = checkRow.createEl("label");
      labelEl.htmlFor = "ffg-migrate-sweep-toggle";
      labelEl.setText(
        `Also update plugin settings (${settingsTotal} reference${settingsTotal === 1 ? "" : "s"})`
      );

      const detailWrap = sweepWrap.createDiv("ffg-migrate-sweep-detail");
      detailWrap.style.display = "none";

      const renderDetail = () => {
        detailWrap.empty();
        if (this.scan.settingsPlan.cleanUpdates.length > 0) {
          detailWrap.createEl("div", {
            text: "Automatic updates",
            cls: "ffg-migrate-sweep-section",
          });
          const ul = detailWrap.createEl("ul");
          for (const u of this.scan.settingsPlan.cleanUpdates) {
            ul.createEl("li", { text: u.label });
          }
        }
        if (this.scan.settingsPlan.decisions.length > 0) {
          detailWrap.createEl("div", {
            text: "Decisions required",
            cls: "ffg-migrate-sweep-section ffg-migrate-sweep-decisions",
          });
          for (const d of this.scan.settingsPlan.decisions) {
            const row = detailWrap.createDiv("ffg-migrate-decision");
            row.createEl("div", {
              text: d.label,
              cls: "ffg-migrate-decision-label",
            });
            const values = row.createDiv("ffg-migrate-decision-values");
            values.createEl("div", {
              text: `source: ${this.renderValue(d.sourceValue)}`,
            });
            values.createEl("div", {
              text: d.targetHadEntry
                ? `target: ${this.renderValue(d.targetValue)}`
                : "target: (no entry — would gain source's seed)",
            });
            const choices = row.createDiv("ffg-migrate-decision-choices");
            const name = `ffg-decision-${d.id}`;
            const mkRadio = (
              value: "source" | "target",
              labelText: string
            ) => {
              const wrap = choices.createEl("label", {
                cls: "ffg-migrate-radio",
              });
              const input = wrap.createEl("input", { type: "radio" });
              input.name = name;
              input.value = value;
              input.checked = (this.decisionChoices.get(d.id) ?? d.choice) === value;
              input.addEventListener("change", () => {
                if (input.checked) {
                  this.decisionChoices.set(d.id, value);
                }
              });
              wrap.createSpan({ text: ` ${labelText}` });
            };
            mkRadio("source", "Use source value");
            mkRadio(
              "target",
              d.targetHadEntry ? "Keep target value" : "Leave target without a seed"
            );
          }
        }
      };

      checkbox.addEventListener("change", () => {
        this.applySettings = checkbox.checked;
        detailWrap.style.display = checkbox.checked ? "" : "none";
        if (checkbox.checked) renderDetail();
      });

      // Pre-check + expand if we entered settings-only mode in the constructor.
      if (this.applySettings) {
        checkbox.checked = true;
        detailWrap.style.display = "";
        renderDetail();
      }
    }

    const row = this.contentEl.createDiv("ffg-modal-buttons");
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const confirm = row.createEl("button", {
      text: "Proceed",
      cls: "mod-cta",
    });
    confirm.addEventListener("click", async () => {
      this.close();
      await this.onConfirm({
        applySettings: this.applySettings,
        decisionChoices: this.decisionChoices,
      });
    });
  }

  private renderValue(v: unknown): string {
    if (v === undefined) return "(no seed)";
    if (v === null) return "(null)";
    if (typeof v === "string") return v.length === 0 ? "(empty string)" : v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}

type ConflictResolution = "use-source" | "use-target" | "merge" | "skip";

interface ConflictDecision {
  file: TFile;
  resolution: ConflictResolution;
}

type OccurrenceFilter = "all" | "covered" | "uncovered";

// Manages the auto-reconcile exclude list. Files added here have all
// frontmatter hidden in the Properties panel and are skipped by the
// file-open / file-leave / create / rename triggers. Manual commands
// still operate on them.
class ReconcileExcludeModal extends Modal {
  constructor(
    app: App,
    private plugin: FoldableFrontmatterGroupsPlugin
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.titleEl.setText("Auto-reconcile exclude list");
    this.contentEl.createEl("p", {
      text: "Files listed here have all frontmatter hidden in the Properties panel and are skipped by auto-reconcile (file-open, file-leave, create, and rename triggers). Manual reconcile commands still operate on them.",
      cls: "setting-item-description",
    });

    new Setting(this.contentEl)
      .setName("Auto-exclude folder notes")
      .setDesc(
        "Treat any file whose name matches its parent folder (e.g. 'Projects/Projects.md') as if it were on this list. No need to add them individually."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.excludeFolderNotes)
          .onChange(async (value) => {
            this.plugin.settings.excludeFolderNotes = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Whitelist: notes ───────────────────────────────────────────────────
    this.contentEl.createEl("h4", {
      text: "Whitelist notes",
      cls: "ffg-exclude-section-heading",
    });
    this.contentEl.createEl("p", {
      text: "Folder notes added here show frontmatter and participate in auto-reconcile normally, even when the auto-exclude toggle is on.",
      cls: "setting-item-description",
    });
    this.renderPathList(
      this.contentEl,
      () => this.plugin.settings.folderNoteWhitelist,
      async (list) => {
        this.plugin.settings.folderNoteWhitelist = list;
        await this.plugin.saveSettings();
      },
      {
        placeholder: "Type to find a folder note...",
        emptyText: "No folder notes whitelisted.",
        removeLabel: (p) => `Remove ${p} from whitelist`,
        suggester: "file",
        folderNotesOnly: true,
      }
    );

    // ── Whitelist: folders ─────────────────────────────────────────────────
    this.contentEl.createEl("h4", {
      text: "Whitelist folders",
      cls: "ffg-exclude-section-heading",
    });
    this.contentEl.createEl("p", {
      text: "Any folder note inside one of these folders (at any depth) is whitelisted. Paths are vault-relative, e.g. 'Claude/Skills/'.",
      cls: "setting-item-description",
    });
    this.renderPathList(
      this.contentEl,
      () => this.plugin.settings.folderNoteWhitelistFolders,
      async (list) => {
        this.plugin.settings.folderNoteWhitelistFolders = list;
        await this.plugin.saveSettings();
      },
      {
        placeholder: "Type to find a folder...",
        emptyText: "No folders whitelisted.",
        removeLabel: (p) => `Remove ${p} from whitelist`,
        suggester: "folder",
      }
    );

    // ── Manually excluded files ────────────────────────────────────────────
    this.contentEl.createEl("h4", {
      text: "Manually excluded files",
      cls: "ffg-exclude-section-heading",
    });
    this.contentEl.createEl("p", {
      text: "Add any specific files (folder notes or not) you want excluded.",
      cls: "setting-item-description",
    });
    this.renderPathList(
      this.contentEl,
      () => this.plugin.settings.reconcileExcludedFiles,
      async (list) => {
        this.plugin.settings.reconcileExcludedFiles = list;
        await this.plugin.saveSettings();
      },
      {
        placeholder: "Type to search notes...",
        emptyText: "No files excluded.",
        removeLabel: (p) => `Remove ${p} from exclude list`,
        suggester: "file",
      }
    );

    // Footer Close button.
    const footer = this.contentEl.createDiv("ffg-modal-buttons");
    const closeBtn = footer.createEl("button", { text: "Done" });
    closeBtn.addEventListener("click", () => this.close());
  }

  // Shared add-input + remove-list widget used by the whitelist (files +
  // folders) and the manual exclude list sections.
  private renderPathList(
    parent: HTMLElement,
    getList: () => string[],
    setList: (list: string[]) => Promise<void>,
    options: {
      placeholder: string;
      emptyText: string;
      removeLabel: (path: string) => string;
      // "file" attaches MarkdownFilePathSuggest; "folder" attaches
      // FolderPathSuggest and normalizes paths to end with "/".
      suggester: "file" | "folder";
      folderNotesOnly?: boolean;
    }
  ): void {
    const addRow = parent.createDiv("ffg-exclude-add-row");
    const input = addRow.createEl("input", {
      type: "text",
      cls: "ffg-exclude-input",
      attr: { placeholder: options.placeholder },
    });

    const isFolder = options.suggester === "folder";
    const normalize = (raw: string): string => {
      const v = raw.trim();
      if (!v) return "";
      if (!isFolder) return v;
      return v.endsWith("/") ? v : v + "/";
    };

    const list = parent.createDiv("ffg-exclude-list");
    const render = () => {
      list.empty();
      const entries = getList()
        .slice()
        .sort((a, b) => a.localeCompare(b));
      if (entries.length === 0) {
        list.createEl("div", {
          text: options.emptyText,
          cls: "ffg-exclude-empty",
        });
        return;
      }
      for (const path of entries) {
        const row = list.createDiv("ffg-exclude-row");
        const pathLink = row.createEl(isFolder ? "span" : "a", {
          cls: "ffg-exclude-path",
          text: path,
        });
        if (!isFolder) {
          pathLink.addEventListener("click", (e) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
              this.app.workspace.getLeaf("tab").openFile(file);
            }
          });
        }
        const removeBtn = row.createEl("button", {
          cls: "ffg-exclude-remove",
          text: "×",
          attr: { "aria-label": options.removeLabel(path) },
        });
        removeBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await setList(getList().filter((p) => p !== path));
          render();
        });
      }
    };

    const onAccept = async (value: string) => {
      const path = normalize(value);
      if (!path) return;
      const current = getList();
      if (current.includes(path)) {
        input.value = "";
        return;
      }
      await setList([...current, path]);
      input.value = "";
      render();
    };

    if (isFolder) {
      new FolderPathSuggest(this.app, input, onAccept);
    } else {
      new MarkdownFilePathSuggest(this.app, input, onAccept, {
        folderNotesOnly: options.folderNotesOnly,
      });
    }

    render();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class FieldOccurrencesModal extends Modal {
  private filter: OccurrenceFilter = "all";

  constructor(
    app: App,
    private fieldName: string,
    private scopePath: string,
    private occurrences: Array<{
      file: TFile;
      value: unknown;
      covered: boolean;
      isNull: boolean;
    }>
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", {
      text: `Field: ${this.fieldName}`,
    });
    const scopeLabel = this.scopePath || "whole vault";

    const total = this.occurrences.length;
    const coveredCount = this.occurrences.filter((o) => o.covered).length;
    const uncoveredCount = total - coveredCount;
    const nullCount = this.occurrences.filter((o) => o.isNull).length;
    const uncoveredNullCount = this.occurrences.filter(
      (o) => !o.covered && o.isNull
    ).length;

    const summary = `${total} note${total === 1 ? "" : "s"} in ${scopeLabel} have this field. ${nullCount} null · ${uncoveredCount} uncovered · ${uncoveredNullCount} uncovered null.`;
    this.contentEl.createEl("p", {
      text: summary,
      cls: "setting-item-description",
    });

    if (total === 0) {
      this.contentEl.createEl("div", {
        text: "No notes in scope carry this field.",
        cls: "ffg-cleanup-empty",
      });
      return;
    }

    // Segmented filter: All / Covered / Uncovered.
    const filterBar = this.contentEl.createDiv("ffg-occurrence-filter");
    const filters: Array<{
      key: OccurrenceFilter;
      label: string;
      count: number;
    }> = [
      { key: "all", label: "All", count: total },
      { key: "covered", label: "Covered", count: coveredCount },
      { key: "uncovered", label: "Uncovered", count: uncoveredCount },
    ];
    const list = this.contentEl.createDiv("ffg-occurrence-list");
    const filterButtons = new Map<OccurrenceFilter, HTMLButtonElement>();
    for (const f of filters) {
      const btn = filterBar.createEl("button", {
        cls: "ffg-occurrence-filter-btn",
        text: `${f.label} (${f.count})`,
      });
      if (f.count === 0 && f.key !== "all") btn.disabled = true;
      filterButtons.set(f.key, btn);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.filter = f.key;
        this.refreshFilterButtons(filterButtons);
        this.renderList(list);
      });
    }
    this.refreshFilterButtons(filterButtons);
    this.renderList(list);
  }

  private refreshFilterButtons(
    buttons: Map<OccurrenceFilter, HTMLButtonElement>
  ): void {
    for (const [key, btn] of buttons) {
      btn.toggleClass("is-active", key === this.filter);
    }
  }

  private renderList(list: HTMLElement): void {
    list.empty();
    const filtered = this.occurrences.filter((o) => {
      if (this.filter === "covered") return o.covered;
      if (this.filter === "uncovered") return !o.covered;
      return true;
    });
    if (filtered.length === 0) {
      list.createEl("div", {
        text: `No ${this.filter} entries.`,
        cls: "ffg-cleanup-empty",
      });
      return;
    }
    for (const occ of filtered) {
      const row = list.createDiv("ffg-occurrence-row");
      const head = row.createDiv("ffg-occurrence-head");
      const pathLink = head.createEl("a", {
        cls: "ffg-occurrence-path",
        text: occ.file.path,
      });
      pathLink.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.workspace.getLeaf("tab").openFile(occ.file);
      });
      const chips = head.createDiv("ffg-occurrence-chips");
      if (!occ.covered) {
        chips.createEl("span", {
          cls: "ffg-occurrence-chip ffg-occurrence-chip-uncovered",
          text: "uncovered",
        });
      }
      if (occ.isNull) {
        chips.createEl("span", {
          cls: "ffg-occurrence-chip ffg-occurrence-chip-null",
          text: "null",
        });
      }

      const valueEl = row.createEl("div", { cls: "ffg-occurrence-value" });
      valueEl.setText(this.renderValue(occ.value));
    }
  }

  private renderValue(v: unknown): string {
    if (v === null) return "null";
    if (v === undefined) return "(unset)";
    if (typeof v === "string") return v.length === 0 ? '""' : v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}

class ConflictResolutionModal extends Modal {
  private decisions: ConflictDecision[] = [];
  private index = 0;
  private finalized = false;

  constructor(
    app: App,
    private conflicts: Array<{
      file: TFile;
      sourceValue: unknown;
      targetValue: unknown;
    }>,
    private sourceField: string,
    private targetField: string,
    private onDone: (decisions: ConflictDecision[]) => void | Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderCurrent();
  }

  private renderCurrent(): void {
    this.contentEl.empty();
    if (this.index >= this.conflicts.length) {
      this.finalized = true;
      this.close();
      void this.onDone(this.decisions);
      return;
    }
    const current = this.conflicts[this.index];
    this.contentEl.createEl("h2", {
      text: `Conflict ${this.index + 1} of ${this.conflicts.length}`,
    });
    this.contentEl.createEl("p", { text: current.file.path });

    const sourceBox = this.contentEl.createDiv("ffg-conflict-value");
    sourceBox.createEl("div", {
      text: `${this.sourceField} (source)`,
      cls: "ffg-conflict-label",
    });
    sourceBox.createEl("pre", {
      text: this.renderValue(current.sourceValue),
    });

    const targetBox = this.contentEl.createDiv("ffg-conflict-value");
    targetBox.createEl("div", {
      text: `${this.targetField} (target)`,
      cls: "ffg-conflict-label",
    });
    targetBox.createEl("pre", {
      text: this.renderValue(current.targetValue),
    });

    const bothLists =
      Array.isArray(current.sourceValue) && Array.isArray(current.targetValue);

    const row = this.contentEl.createDiv("ffg-modal-buttons");

    const openBtn = row.createEl("button", { text: "Open file" });
    openBtn.addEventListener("click", () => {
      this.app.workspace.getLeaf("tab").openFile(current.file);
    });

    const skip = row.createEl("button", { text: "Skip" });
    skip.addEventListener("click", () => this.decide(current.file, "skip"));

    const useTarget = row.createEl("button", {
      text: `Keep target & delete source`,
    });
    useTarget.addEventListener("click", () =>
      this.decide(current.file, "use-target")
    );

    if (bothLists) {
      const merge = row.createEl("button", {
        text: "Merge (union)",
      });
      merge.addEventListener("click", () =>
        this.decide(current.file, "merge")
      );
    }

    const useSource = row.createEl("button", {
      text: `Use source, overwrite target`,
      cls: "mod-warning",
    });
    useSource.addEventListener("click", () =>
      this.decide(current.file, "use-source")
    );
  }

  private decide(file: TFile, resolution: ConflictResolution): void {
    this.decisions.push({ file, resolution });
    this.index += 1;
    this.renderCurrent();
  }

  private renderValue(v: unknown): string {
    if (v === null || v === undefined) return "(null)";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  onClose(): void {
    if (this.finalized) return;
    while (this.index < this.conflicts.length) {
      this.decisions.push({
        file: this.conflicts[this.index].file,
        resolution: "skip",
      });
      this.index += 1;
    }
    this.finalized = true;
    void this.onDone(this.decisions);
  }
}

// ── Lint scope popover ───────────────────────────────────────────────────────

function openLintScopePopover(
  plugin: FoldableFrontmatterGroupsPlugin,
  fieldName: string,
  anchor: HTMLElement,
  onChange: () => void
): void {
  // Use the anchor's window so the popover renders in the same window the
  // user clicked from — Obsidian's settings can now open in a popout, and a
  // popover appended to the main document would either land in the wrong
  // window or get stacked underneath the settings overlay.
  const doc = anchor.ownerDocument ?? document;
  const win = doc.defaultView ?? window;

  doc.querySelectorAll(".ffg-lint-popover").forEach((el) => el.remove());

  const popover = doc.body.createDiv({ cls: "ffg-lint-popover" });
  const rect = anchor.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.left = `${Math.max(8, rect.left)}px`;
  // Stack above Obsidian's settings overlay and any modal in the same window.
  popover.style.zIndex = "2147483000";

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("mousedown", outsideHandler, true);
    doc.removeEventListener("keydown", escapeHandler);
    popover.remove();
    onChange();
  };
  const outsideHandler = (e: MouseEvent) => {
    const target = e.target as Node;
    if (popover.contains(target)) return;
    if (anchor.isConnected && anchor.contains(target)) return;
    close();
  };
  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  popover.createEl("div", {
    cls: "ffg-lint-popover-title",
    text: `Cleanup "${fieldName}" when null`,
  });

  const vaultRow = popover.createDiv({ cls: "ffg-lint-popover-row" });
  const vaultCheck = vaultRow.createEl("input", {
    type: "checkbox",
    cls: "ffg-lint-popover-check",
  });
  vaultCheck.checked = plugin.settings.globalLintFields.includes(fieldName);
  vaultRow.createEl("span", {
    text: "Vault-wide",
    cls: "ffg-lint-popover-row-label ffg-lint-popover-vault",
  });

  // Per-template rows — built next so vault's change handler can disable them.
  const templateRows: Array<{ row: HTMLElement; checkbox: HTMLInputElement }> =
    [];

  const applyVaultOverride = () => {
    const overridden = vaultCheck.checked;
    for (const { row, checkbox } of templateRows) {
      checkbox.disabled = overridden;
      row.toggleClass("ffg-lint-popover-row-disabled", overridden);
    }
  };

  vaultCheck.addEventListener("change", async () => {
    const list = plugin.settings.globalLintFields;
    if (vaultCheck.checked) {
      if (!list.includes(fieldName)) list.push(fieldName);
    } else {
      plugin.settings.globalLintFields = list.filter((n) => n !== fieldName);
    }
    await plugin.saveSettings();
    applyVaultOverride();
  });

  if (plugin.settings.folderTemplates.length > 0) {
    popover.createEl("div", {
      cls: "ffg-lint-popover-section",
      text: "Templates",
    });
    const orderedTemplates = sortTemplatesByGroupingOrder(
      plugin.settings.folderTemplates,
      plugin.settings.groups
    );
    for (const tpl of orderedTemplates) {
      const tplRow = popover.createDiv({ cls: "ffg-lint-popover-row" });
      const cb = tplRow.createEl("input", {
        type: "checkbox",
        cls: "ffg-lint-popover-check",
      });
      cb.checked = tpl.lintFields.includes(fieldName);
      tplRow.createEl("span", {
        text: tpl.name || "(unnamed template)",
        cls: "ffg-lint-popover-row-label",
      });
      cb.addEventListener("change", async () => {
        if (cb.checked) {
          if (!tpl.lintFields.includes(fieldName)) {
            tpl.lintFields.push(fieldName);
          }
          plugin.ensureTemplateOwnsField(tpl, fieldName);
        } else {
          tpl.lintFields = tpl.lintFields.filter((n) => n !== fieldName);
        }
        await plugin.saveSettings();
      });
      templateRows.push({ row: tplRow, checkbox: cb });
    }
    applyVaultOverride();
  } else {
    popover.createEl("div", {
      cls: "ffg-lint-popover-empty",
      text: "No templates defined yet.",
    });
  }

  win.setTimeout(() => {
    if (closed) return;
    doc.addEventListener("mousedown", outsideHandler, true);
  }, 0);
  doc.addEventListener("keydown", escapeHandler);
}

// ── Scrub log modal ──────────────────────────────────────────────────────────

class ScrubLogModal extends Modal {
  constructor(app: App, private entries: ScrubLogEntry[]) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.titleEl.setText("Scrub log");

    if (this.entries.length === 0) {
      this.contentEl.createEl("p", {
        text: "No scrubs recorded yet.",
        cls: "ffg-log-empty",
      });
      return;
    }

    this.contentEl.createEl("p", {
      text: "Most recent first. Click an entry to show the file paths and the values that were removed.",
      cls: "ffg-log-desc",
    });

    const sorted = this.entries.slice().sort((a, b) => b.ts - a.ts);

    // Export controls
    const exportRow = this.contentEl.createDiv("ffg-log-export-row");
    exportRow.createSpan({
      text: "Export range:",
      cls: "ffg-log-export-label",
    });
    const fromInput = exportRow.createEl("input", {
      type: "date",
      cls: "ffg-log-export-date",
    });
    fromInput.setAttr("aria-label", "From date");
    exportRow.createSpan({ text: "to", cls: "ffg-log-export-sep" });
    const toInput = exportRow.createEl("input", {
      type: "date",
      cls: "ffg-log-export-date",
    });
    toInput.setAttr("aria-label", "To date");

    const dateToIso = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const oldest = new Date(sorted[sorted.length - 1].ts);
    const newest = new Date(sorted[0].ts);
    fromInput.value = dateToIso(oldest);
    toInput.value = dateToIso(newest);

    const downloadBtn = exportRow.createEl("button", {
      text: "Download JSON",
      cls: "ffg-log-export-btn",
    });
    downloadBtn.addEventListener("click", () => {
      const fromTs = fromInput.value
        ? new Date(`${fromInput.value}T00:00:00`).getTime()
        : 0;
      const toTs = toInput.value
        ? new Date(`${toInput.value}T23:59:59.999`).getTime()
        : Date.now();
      const filtered = this.entries.filter(
        (e) => e.ts >= fromTs && e.ts <= toTs
      );
      if (filtered.length === 0) {
        new Notice("[FFG] No scrub entries in that range");
        return;
      }
      const blob = new Blob([JSON.stringify(filtered, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fromStr = fromInput.value || "all";
      const toStr = toInput.value || "now";
      a.download = `ffg-scrub-log-${fromStr}_to_${toStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      new Notice(
        `[FFG] Exported ${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`
      );
    });

    const list = this.contentEl.createDiv("ffg-log-list");
    for (const entry of sorted) {
      this.renderEntry(list, entry);
    }
  }

  private renderEntry(parent: HTMLElement, entry: ScrubLogEntry) {
    const item = parent.createDiv("ffg-log-item");
    const head = item.createDiv("ffg-log-item-head");
    const tsStr = new Date(entry.ts).toLocaleString();
    const actionLabel =
      entry.action === "remove-null"
        ? "Removed null"
        : entry.action === "remove-all"
        ? "Removed ALL"
        : "Migrated";
    const scopeLabel = entry.scope || "whole vault";
    head.createSpan({
      cls: "ffg-log-item-time",
      text: tsStr,
    });
    head.createSpan({
      cls:
        "ffg-log-item-action" +
        (entry.action === "remove-all" ? " ffg-log-item-action-nuke" : ""),
      text: actionLabel,
    });
    head.createSpan({
      cls: "ffg-log-item-field",
      text:
        entry.action === "migrate" && entry.targetField
          ? `${entry.field} → ${entry.targetField}`
          : entry.field,
    });
    head.createSpan({
      cls: "ffg-log-item-meta",
      text: `${entry.files.length} file${entry.files.length === 1 ? "" : "s"} · ${scopeLabel}`,
    });

    const details = item.createDiv("ffg-log-item-details");
    details.style.display = "none";

    head.addEventListener("click", () => {
      if (details.style.display === "none") {
        if (!details.dataset.rendered) {
          for (const f of entry.files) {
            const row = details.createDiv("ffg-log-file");
            row.createSpan({ cls: "ffg-log-file-path", text: f.path });
            row.createSpan({
              cls: "ffg-log-file-value",
              text: ` = ${JSON.stringify(f.value)}`,
            });
          }
          details.dataset.rendered = "1";
        }
        details.style.display = "";
      } else {
        details.style.display = "none";
      }
    });
  }
}

// ── Folder path suggester ────────────────────────────────────────────────────

class FolderPathSuggest extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;
  private onAccept: (value: string) => void;
  private allFolders: string[];

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onAccept: (value: string) => void
  ) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    const folders: string[] = [];
    for (const f of app.vault.getAllLoadedFiles()) {
      if (f instanceof TFolder && f.path && f.path !== "/") {
        folders.push(f.path.endsWith("/") ? f.path : f.path + "/");
      }
    }
    this.allFolders = folders.sort();
  }

  getSuggestions(_query: string): string[] {
    const token = this.inputEl.value.trim().toLowerCase();
    if (!token) return this.allFolders.slice(0, 50);
    return this.allFolders
      .filter((p) => p.toLowerCase().includes(token))
      .slice(0, 50);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.inputEl.value = value;
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
}

// True for "folder note" / MOC files where the basename equals the parent
// folder's name (e.g. "People (Notable)/People (Notable).md"). Knox uses this
// pattern heavily, so we surface those entries at the top of suggestions.
function isFolderNotePath(path: string): boolean {
  const parts = path.split("/");
  if (parts.length < 2) return false;
  const basename = parts[parts.length - 1].replace(/\.md$/i, "");
  const parent = parts[parts.length - 2];
  return basename === parent && basename.length > 0;
}

class MarkdownFilePathSuggest extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;
  private onAccept: (value: string) => void;
  private allFiles: string[];
  private folderNoteSet: Set<string>;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onAccept: (value: string) => void,
    options: { folderNotesOnly?: boolean } = {}
  ) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    const files: string[] = [];
    const folderNotes = new Set<string>();
    for (const f of app.vault.getMarkdownFiles()) {
      const isFN = isFolderNotePath(f.path);
      if (options.folderNotesOnly && !isFN) continue;
      files.push(f.path);
      if (isFN) folderNotes.add(f.path);
    }
    // Stable sort: folder notes first (alphabetical), then everything else
    // (alphabetical). Keeps the top of the suggestion list useful both for an
    // empty query (browsing) and a non-empty one (after substring filter).
    this.allFiles = files.sort((a, b) => {
      const af = folderNotes.has(a);
      const bf = folderNotes.has(b);
      if (af !== bf) return af ? -1 : 1;
      return a.localeCompare(b);
    });
    this.folderNoteSet = folderNotes;
  }

  getSuggestions(_query: string): string[] {
    const token = this.inputEl.value.trim().toLowerCase();
    if (!token) return this.allFiles.slice(0, 50);
    return this.allFiles
      .filter((p) => p.toLowerCase().includes(token))
      .slice(0, 50);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.addClass("ffg-md-file-suggestion");
    if (this.folderNoteSet.has(value)) {
      el.addClass("ffg-md-file-suggestion-folder-note");
      el.createEl("span", {
        cls: "ffg-md-file-suggestion-badge",
        text: "MOC",
      });
    }
    el.createEl("span", {
      cls: "ffg-md-file-suggestion-path",
      text: value,
    });
  }

  selectSuggestion(value: string): void {
    this.inputEl.value = value;
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

class FfgSettingTab extends PluginSettingTab {
  plugin: FoldableFrontmatterGroupsPlugin;

  constructor(app: App, plugin: FoldableFrontmatterGroupsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private activeTab: "groups" | "fields" | "cleanup" = "groups";
  private rerenderActiveTab: () => void = () => {};
  private propertyValuesCache: Map<string, string[]> | null = null;
  private propertiesOrderExpanded = false;
  private groupExpansionState = new Map<string, boolean>();
  private templateExpansionState = new Map<string, boolean>();
  // When set, display() opens on the Grouping tab with this group expanded,
  // then scrolls it into view and flashes it. Cleared after reveal.
  private pendingRevealGroupId: string | null = null;
  // Optional template within the revealed group to also unfold and focus.
  private pendingRevealTemplateId: string | null = null;
  private cleanupScope = "";
  private cleanupSortMode: "abc" | "grouping" = "abc";
  private migrateScope = "";

  private getPropertyValues(key: string): string[] {
    if (!key) return [];
    if (!this.propertyValuesCache) {
      const cache = new Map<string, Set<string>>();
      for (const file of this.app.vault.getMarkdownFiles()) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm) continue;
        for (const [k, v] of Object.entries(fm)) {
          if (k === "position") continue;
          let set = cache.get(k);
          if (!set) {
            set = new Set();
            cache.set(k, set);
          }
          if (Array.isArray(v)) {
            for (const item of v) {
              if (typeof item === "string" && item) set.add(item);
              else if (typeof item === "number" || typeof item === "boolean") {
                set.add(String(item));
              }
            }
          } else if (typeof v === "string" && v) {
            set.add(v);
          } else if (typeof v === "number" || typeof v === "boolean") {
            set.add(String(v));
          }
        }
      }
      this.propertyValuesCache = new Map();
      for (const [k, set] of cache) {
        this.propertyValuesCache.set(k, Array.from(set).sort());
      }
    }
    return this.propertyValuesCache.get(key) ?? [];
  }

  // Called from the Properties-panel per-group settings icon. Re-renders the
  // whole settings pane (so the tab strip highlight stays correct) with the
  // target group pre-expanded, then scrolls and flashes it.
  revealGroup(groupId: string, templateId?: string | null): void {
    this.pendingRevealGroupId = groupId;
    this.pendingRevealTemplateId = templateId ?? null;
    this.display();
  }

  display(): void {
    this.propertyValuesCache = null;
    this.propertiesOrderExpanded = false;
    this.groupExpansionState.clear();
    this.templateExpansionState.clear();
    if (this.pendingRevealGroupId) {
      this.activeTab = "groups";
      this.groupExpansionState.set(this.pendingRevealGroupId, false);
      if (this.pendingRevealTemplateId) {
        // false = expanded
        this.templateExpansionState.set(this.pendingRevealTemplateId, false);
      }
    }
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable group folding")
      .setDesc("Show grouped, collapsible sections in the Properties panel.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.groupFoldingEnabled)
          .onChange(async (value) => {
            this.plugin.settings.groupFoldingEnabled = value;
            await this.plugin.saveSettings();
            applyPausedState(value);
          })
      );

    const banner = containerEl.createDiv("ffg-paused-banner");
    banner.textContent =
      "Group folding is off. The plugin is paused; settings below are preserved but not applied.";

    const pausedZone = containerEl.createDiv("ffg-paused-zone");

    new Setting(pausedZone)
      .setName("Auto-reconcile frontmatter")
      .setDesc(
        "On file open and file leave: backfill template defaults into empty fields, scrub cleanup-flagged nulls, and reorder keys to match the Properties panel. Off by default."
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("file-x")
          .setTooltip("Edit exclude list")
          .onClick(() => {
            new ReconcileExcludeModal(this.app, this.plugin).open();
          })
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.reconcileOnLeave)
          .onChange(async (value) => {
            this.plugin.settings.reconcileOnLeave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(pausedZone)
      .setName("Scrub orphan nulls")
      .setDesc(
        "During auto-reconcile, also delete any null property no matching template claims."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.scrubOrphanNulls)
          .onChange(async (value) => {
            this.plugin.settings.scrubOrphanNulls = value;
            await this.plugin.saveSettings();
          })
      );

    const tabStrip = pausedZone.createDiv("ffg-tab-strip");
    const tabContent = pausedZone.createDiv("ffg-tab-content");

    const tabs: Array<{ id: typeof this.activeTab; label: string }> = [
      { id: "groups", label: "Grouping" },
      { id: "fields", label: "Customize Icons" },
      { id: "cleanup", label: "Cleanup" },
    ];

    const renderTabStrip = () => {
      tabStrip.empty();
      for (const tab of tabs) {
        const btn = tabStrip.createEl("button", {
          text: tab.label,
          cls:
            "ffg-tab-button" +
            (tab.id === this.activeTab ? " ffg-tab-active" : ""),
        });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          this.activeTab = tab.id;
          renderTabStrip();
          renderActiveTab();
        });
      }
    };

    const renderActiveTab = () => {
      tabContent.empty();
      if (this.activeTab === "groups") this.renderGroupsAndOrderTab(tabContent);
      else if (this.activeTab === "fields") this.renderFieldsTab(tabContent);
      else if (this.activeTab === "cleanup") this.renderCleanupTab(tabContent);
    };
    this.rerenderActiveTab = renderActiveTab;

    const applyPausedState = (enabled: boolean) => {
      banner.style.display = enabled ? "none" : "";
      pausedZone.toggleClass("ffg-settings-disabled", !enabled);
    };

    renderTabStrip();
    renderActiveTab();
    applyPausedState(this.plugin.settings.groupFoldingEnabled);

    if (this.pendingRevealGroupId) {
      const groupId = this.pendingRevealGroupId;
      const templateId = this.pendingRevealTemplateId;
      this.pendingRevealGroupId = null;
      this.pendingRevealTemplateId = null;
      const esc = (s: string) =>
        typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s;
      window.setTimeout(() => {
        const groupCard = this.containerEl.querySelector<HTMLElement>(
          `.ffg-group-card[data-ffg-group-card="${esc(groupId)}"]`
        );
        // Prefer the matched template card; fall back to the group card.
        const templateCard = templateId
          ? this.containerEl.querySelector<HTMLElement>(
              `.ffg-template-card[data-ffg-template-card="${esc(templateId)}"]`
            )
          : null;
        const target = templateCard ?? groupCard;
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("ffg-reveal-flash");
        window.setTimeout(() => target.classList.remove("ffg-reveal-flash"), 1600);
      }, 0);
    }
  }

  private renderGroupsAndOrderTab(parent: HTMLElement) {
    // Top Level Properties collapsible section
    const orderCard = parent.createDiv("ffg-group-card");
    const orderHead = orderCard.createDiv("ffg-group-card-head");
    const orderChevron = orderHead.createSpan({
      cls: "ffg-group-card-chevron",
    });
    setIcon(
      orderChevron,
      this.propertiesOrderExpanded ? "chevron-down" : "chevron-right"
    );
    orderHead.createSpan({
      cls: "ffg-group-card-title",
      text: "Top Level Properties",
    });
    const orderSummary = orderHead.createSpan({
      cls: "ffg-group-card-summary",
      text: `${this.plugin.settings.topZone.fieldOrder.length} pinned`,
    });
    const orderBody = orderCard.createDiv("ffg-group-card-body");
    orderBody.style.display = this.propertiesOrderExpanded ? "" : "none";
    orderHead.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("input") || target.closest("button")) return;
      this.propertiesOrderExpanded = !this.propertiesOrderExpanded;
      setIcon(
        orderChevron,
        this.propertiesOrderExpanded ? "chevron-down" : "chevron-right"
      );
      orderBody.style.display = this.propertiesOrderExpanded ? "" : "none";
    });

    orderBody.createEl("p", {
      text: "Properties listed here appear at the top of the Properties panel, in this order. Overrides group matching.",
      cls: "setting-item-description",
    });

    const topListContainer = orderBody.createDiv("ffg-field-order-list");
    this.renderFieldOrderList(
      topListContainer,
      () => this.plugin.settings.topZone.fieldOrder,
      async (list) => {
        this.plugin.settings.topZone.fieldOrder = list;
        await this.plugin.saveSettings();
        orderSummary.setText(`${list.length} pinned`);
      },
      () => {
        const matchers = this.plugin.settings.groups.map(
          (g) =>
            toRuntimeGroup(g, this.plugin.settings.folderTemplates).matcher
        );
        return (key: string) => !matchers.some((m) => m(key));
      }
    );

    parent.createEl("h3", { text: "Global Templates" });
    parent.createEl("p", {
      text: "Folder-scoped templates that are not linked to a specific group. Group-linked templates live under their group below.",
      cls: "setting-item-description",
    });

    const globalTemplatesContainer = parent.createDiv("ffg-global-templates");
    const renderGlobalTemplates = () => {
      globalTemplatesContainer.empty();
      const globals = this.plugin.settings.folderTemplates.filter(
        (t) => !t.group
      );
      if (globals.length === 0) {
        globalTemplatesContainer.createEl("div", {
          text: "No global templates yet.",
          cls: "ffg-inline-templates-empty",
        });
      } else {
        const isGlobal = (t: FolderTemplate) => !t.group;
        globals.forEach((tpl, idx) => {
          this.renderTemplateCard(globalTemplatesContainer, tpl, {
            collapsible: true,
            collapsed: true,
            refresh: () => renderGlobalTemplates(),
            reorder: {
              canMoveUp: idx > 0,
              canMoveDown: idx < globals.length - 1,
              onMoveUp: async () => {
                await this.swapTemplateInSection(tpl, -1, isGlobal);
                renderGlobalTemplates();
              },
              onMoveDown: async () => {
                await this.swapTemplateInSection(tpl, 1, isGlobal);
                renderGlobalTemplates();
              },
            },
          });
        });
      }
    };
    renderGlobalTemplates();

    new Setting(parent).addButton((btn) =>
      btn.setButtonText("+ Add global template").onClick(async () => {
        this.plugin.settings.folderTemplates.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          name: "",
          pathPrefixes: [""],
          excludedPathPrefixes: [],
          fields: [],
          fieldOrder: [],
          excludedFields: [],
          lintFields: [],
          noGroupFields: [],
        });
        await this.plugin.saveSettings();
        renderGlobalTemplates();
      })
    );

    parent.createEl("h3", { text: "Groups" });

    const groupsContainer = parent.createDiv("ffg-settings-groups");
    this.renderGroups(groupsContainer);

    new Setting(parent).addButton((btn) =>
      btn
        .setButtonText("+ Add Group")
        .onClick(async () => {
          const newId =
            Date.now().toString(36) + Math.random().toString(36).slice(2);
          this.plugin.settings.groups.push({
            id: newId,
            name: "New Group",
            matcherType: "unified",
            matcherValues: [],
            defaultFolded: true,
            fieldOrder: [],
          });
          this.groupExpansionState.set(newId, false);
          await this.plugin.saveSettings();
          this.renderGroups(groupsContainer);
        })
    );
  }

  private renderFieldsTab(parent: HTMLElement) {
    parent.createEl("h3", { text: "Icon overrides" });
    parent.createEl("p", {
      text: "Replace the Properties panel icon for a given frontmatter key. Pick any Lucide icon. (Vault-wide cleanup rules live on the Cleanup tab; folder-scoped cleanup lives inside templates.)",
      cls: "setting-item-description",
    });

    const iconListContainer = parent.createDiv("ffg-field-config-list");
    this.renderIconOverrideList(iconListContainer);

    new Setting(parent).addButton((btn) =>
      btn.setButtonText("+ Add icon override").onClick(async () => {
        this.plugin.settings.iconOverrides.push({ name: "", icon: "" });
        await this.plugin.saveSettings();
        this.renderIconOverrideList(iconListContainer);
      })
    );
  }

  private renderIconOverrideList(container: HTMLElement) {
    container.empty();
    const sorted = this.plugin.settings.iconOverrides
      .slice()
      .sort((a, b) =>
        (a.name || "￿").toLowerCase().localeCompare((b.name || "￿").toLowerCase())
      );
    for (const override of sorted) {
      this.renderIconOverrideRow(container, override);
    }
  }

  private renderIconOverrideRow(container: HTMLElement, override: IconOverride) {
    const setting = new Setting(container);
    setting.settingEl.addClass("ffg-field-row");
    setting.infoEl.remove();

    setting.addText((text) => {
      text
        .setPlaceholder("frontmatter key")
        .setValue(override.name)
        .onChange((value) => {
          override.name = value.trim();
          this.plugin.saveSettingsDebounced();
        });
      text.inputEl.addClass("ffg-field-name-input");
      new FrontmatterKeySuggest(this.app, text.inputEl, async (value) => {
        override.name = value;
        text.setValue(value);
        await this.plugin.saveSettings();
      });
    });

    const iconWrap = setting.controlEl.createDiv({ cls: "ffg-icon-input-wrap" });
    const iconPreview = iconWrap.createSpan({ cls: "ffg-icon-preview" });
    if (override.icon) setIcon(iconPreview, override.icon);

    const iconInput = iconWrap.createEl("input", {
      type: "text",
      cls: "ffg-icon-input",
    });
    iconInput.placeholder = "icon";
    iconInput.value = override.icon;

    const updateIcon = async (raw: string) => {
      override.icon = raw.trim();
      iconPreview.empty();
      if (override.icon) setIcon(iconPreview, override.icon);
      this.plugin.saveSettingsDebounced();
    };

    iconInput.addEventListener("input", () => void updateIcon(iconInput.value));
    new LucideIconSuggest(this.app, iconInput, async (value) => {
      iconInput.value = value;
      await updateIcon(value);
    });

    setting.addExtraButton((btn) =>
      btn
        .setIcon("trash")
        .setTooltip("Delete override")
        .onClick(async () => {
          this.plugin.settings.iconOverrides =
            this.plugin.settings.iconOverrides.filter((o) => o !== override);
          await this.plugin.saveSettings();
          this.renderIconOverrideList(container);
        })
    );
  }

  private renderCleanupTab(parent: HTMLElement) {
    parent.createEl("p", {
      text: "Inspect and clean up frontmatter fields. Choose a scope, then per field: 'Remove null values' deletes only null entries; 'Remove ALL' deletes every occurrence (requires double-confirm).",
      cls: "setting-item-description",
    });

    // Scope selector
    const scopeRow = parent.createDiv("ffg-cleanup-scope-row");
    scopeRow.createSpan({
      text: "Scope:",
      cls: "ffg-cleanup-label",
    });
    const scopeSelect = scopeRow.createEl("select", {
      cls: "ffg-cleanup-scope-select",
    });
    scopeSelect.createEl("option", { value: "vault", text: "Whole vault" });
    scopeSelect.createEl("option", { value: "folder", text: "Specific folder" });
    scopeSelect.value = this.cleanupScope === "" ? "vault" : "folder";

    const folderInput = scopeRow.createEl("input", {
      type: "text",
      cls: "ffg-cleanup-folder-input",
    });
    folderInput.placeholder = "folder path (e.g. Notes/People/)";
    folderInput.value = this.cleanupScope;
    folderInput.style.display = this.cleanupScope === "" ? "none" : "";
    new FolderPathSuggest(this.app, folderInput, async (value) => {
      folderInput.value = value;
      this.cleanupScope = value;
      await refresh();
    });
    folderInput.addEventListener("blur", () => {
      if (this.cleanupScope !== folderInput.value.trim()) {
        this.cleanupScope = folderInput.value.trim();
        void refresh();
      }
    });

    scopeSelect.addEventListener("change", () => {
      if (scopeSelect.value === "vault") {
        this.cleanupScope = "";
        folderInput.style.display = "none";
      } else {
        folderInput.style.display = "";
        this.cleanupScope = folderInput.value.trim();
      }
      void refresh();
    });

    // Sort selector
    const sortRow = parent.createDiv("ffg-cleanup-scope-row");
    sortRow.createSpan({
      text: "Sort:",
      cls: "ffg-cleanup-label",
    });
    const sortSelect = sortRow.createEl("select", {
      cls: "ffg-cleanup-scope-select",
    });
    sortSelect.createEl("option", {
      value: "abc",
      text: "Alphabetical (cleanup-enabled first)",
    });
    sortSelect.createEl("option", {
      value: "grouping",
      text: "By grouping order (Top Level → groups → unmatched)",
    });
    sortSelect.value = this.cleanupSortMode;
    sortSelect.addEventListener("change", () => {
      this.cleanupSortMode =
        sortSelect.value === "grouping" ? "grouping" : "abc";
      void refresh();
    });

    // Results
    const resultsContainer = parent.createDiv("ffg-cleanup-results");

    // Add ad-hoc field (rendered at the bottom of the tab)
    const addRow = parent.createDiv("ffg-cleanup-add-row");
    addRow.createSpan({
      text: "Add field:",
      cls: "ffg-cleanup-label",
    });
    const addInput = addRow.createEl("input", {
      type: "text",
      cls: "ffg-cleanup-add-input",
    });
    addInput.placeholder = "frontmatter key";
    const commitAdd = async (raw: string) => {
      const v = raw.trim();
      if (!v) return;
      const list = this.plugin.settings.cleanupAdHocFields;
      if (!list.includes(v)) {
        list.push(v);
        await this.plugin.saveSettings();
      }
      addInput.value = "";
      await refresh();
    };
    new FrontmatterKeySuggest(this.app, addInput, async (value) => {
      await commitAdd(value);
    });
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitAdd(addInput.value);
      }
    });
    const addBtn = addRow.createEl("button", { text: "Add" });
    addBtn.addEventListener("click", () => {
      void commitAdd(addInput.value);
    });

    // Migrate field section
    this.renderMigrateFieldSection(parent);

    // Footer: view scrub log
    const footerRow = parent.createDiv("ffg-cleanup-footer");
    const logBtn = footerRow.createEl("button", {
      text: "View scrub log",
      cls: "ffg-cleanup-log-btn",
    });
    logBtn.addEventListener("click", async () => {
      const entries = await this.plugin.readScrubLog();
      new ScrubLogModal(this.app, entries).open();
    });

    const refresh = async () => {
      resultsContainer.empty();
      resultsContainer.createEl("div", {
        text: "Scanning...",
        cls: "ffg-cleanup-empty",
      });
      try {
        const templateFields = this.plugin.lintFlaggedFieldsFromTemplates();
        const allFields = new Set<string>();
        // Cleanup-flagged fields always present, even if scope holds 0 hits.
        for (const name of templateFields.keys()) allFields.add(name);
        for (const name of this.plugin.settings.cleanupAdHocFields) {
          allFields.add(name);
        }
        for (const name of this.plugin.settings.globalLintFields) {
          allFields.add(name);
        }
        // Plus every frontmatter key present in scope.
        for (const name of this.plugin.collectFrontmatterKeysInScope(
          this.cleanupScope
        )) {
          allFields.add(name);
        }

        const counts = this.plugin.countFieldsInScope(
          allFields,
          this.cleanupScope
        );

        this.renderCleanupResults(
          resultsContainer,
          allFields,
          templateFields,
          counts,
          refresh
        );
      } catch (e) {
        console.error("[FFG] scan error", e);
        resultsContainer.empty();
        resultsContainer.createEl("div", {
          text: "Scan failed; see console.",
          cls: "ffg-cleanup-empty",
        });
      }
    };
    void refresh();
  }

  private renderMigrateFieldSection(parent: HTMLElement) {
    const section = parent.createDiv("ffg-migrate-section");
    section.createEl("h3", { text: "Migrate field" });
    section.createEl("p", {
      text: "Copy values from one frontmatter field to another across the chosen scope, then delete the source. One-off use: consolidating two near-duplicate fields. Conflicts (files where the target already has a non-null/non-empty value) are resolved interactively if fewer than 6, or written to a checklist note in Inbox/ if 6 or more. Every migration is logged to the scrub log.",
      cls: "setting-item-description",
    });

    // Scope selector (independent of the cleanup-table scope above).
    const scopeRow = section.createDiv("ffg-cleanup-scope-row");
    scopeRow.createSpan({
      text: "Scope:",
      cls: "ffg-cleanup-label",
    });
    const scopeSelect = scopeRow.createEl("select", {
      cls: "ffg-cleanup-scope-select",
    });
    scopeSelect.createEl("option", { value: "vault", text: "Whole vault" });
    scopeSelect.createEl("option", { value: "folder", text: "Specific folder" });
    scopeSelect.value = this.migrateScope === "" ? "vault" : "folder";

    const folderInput = scopeRow.createEl("input", {
      type: "text",
      cls: "ffg-cleanup-folder-input",
    });
    folderInput.placeholder = "folder path (e.g. Notes/People/)";
    folderInput.value = this.migrateScope;
    folderInput.style.display = this.migrateScope === "" ? "none" : "";
    new FolderPathSuggest(this.app, folderInput, (value) => {
      folderInput.value = value;
      this.migrateScope = value;
      lastScan = null;
      renderPreview();
    });
    folderInput.addEventListener("blur", () => {
      const v = folderInput.value.trim();
      if (this.migrateScope !== v) {
        this.migrateScope = v;
        lastScan = null;
        renderPreview();
      }
    });
    scopeSelect.addEventListener("change", () => {
      if (scopeSelect.value === "vault") {
        this.migrateScope = "";
        folderInput.style.display = "none";
      } else {
        folderInput.style.display = "";
        this.migrateScope = folderInput.value.trim();
      }
      lastScan = null;
      renderPreview();
    });

    const inputRow = section.createDiv("ffg-migrate-input-row");
    const sourceWrap = inputRow.createDiv("ffg-migrate-input-wrap");
    sourceWrap.createSpan({
      text: "Source:",
      cls: "ffg-cleanup-label",
    });
    const sourceInput = sourceWrap.createEl("input", {
      type: "text",
      cls: "ffg-migrate-input",
    });
    sourceInput.placeholder = "field to consolidate";

    const targetWrap = inputRow.createDiv("ffg-migrate-input-wrap");
    targetWrap.createSpan({
      text: "Target:",
      cls: "ffg-cleanup-label",
    });
    const targetInput = targetWrap.createEl("input", {
      type: "text",
      cls: "ffg-migrate-input",
    });
    targetInput.placeholder = "field to keep";

    new FrontmatterKeySuggest(this.app, sourceInput, (value) => {
      sourceInput.value = value;
    });
    new FrontmatterKeySuggest(this.app, targetInput, (value) => {
      targetInput.value = value;
    });

    const previewBox = section.createDiv("ffg-migrate-preview");
    previewBox.style.display = "none";

    const buttonsRow = section.createDiv("ffg-migrate-buttons");
    const scanBtn = buttonsRow.createEl("button", {
      text: "Scan",
      cls: "ffg-migrate-scan",
    });
    const migrateBtn = buttonsRow.createEl("button", {
      text: "Migrate",
      cls: "ffg-migrate-go",
    });
    migrateBtn.disabled = true;

    let lastScan: {
      sourceField: string;
      targetField: string;
      scope: string;
      cleanFiles: TFile[];
      conflicts: Array<{
        file: TFile;
        sourceValue: unknown;
        targetValue: unknown;
      }>;
      settingsRefs: string[];
      settingsPlan: SettingsUpdatePlan;
    } | null = null;

    const renderPreview = () => {
      previewBox.empty();
      if (!lastScan) {
        previewBox.style.display = "none";
        migrateBtn.disabled = true;
        return;
      }
      previewBox.style.display = "";
      const totalTouched =
        lastScan.cleanFiles.length + lastScan.conflicts.length;
      const settingsTotal =
        lastScan.settingsPlan.cleanUpdates.length +
        lastScan.settingsPlan.decisions.length;
      if (totalTouched === 0 && settingsTotal === 0) {
        previewBox.createEl("div", {
          text: `No files in scope have a non-empty \`${lastScan.sourceField}\` and no plugin settings reference it. Nothing to do.`,
        });
        migrateBtn.disabled = true;
        return;
      }
      const summary = previewBox.createEl("div", {
        cls: "ffg-migrate-summary",
      });
      if (totalTouched === 0) {
        summary.createEl("div", {
          text: `No files in scope have a non-empty \`${lastScan.sourceField}\`.`,
          cls: "ffg-migrate-note",
        });
        summary.createEl("div", {
          text: `${settingsTotal} settings reference(s) can still be cleaned up below.`,
        });
      } else {
        summary.createEl("div", {
          text: `${lastScan.cleanFiles.length} file(s) will migrate cleanly.`,
        });
        summary.createEl("div", {
          text: `${lastScan.conflicts.length} conflict(s) (both source and target set).`,
        });
      }
      if (lastScan.conflicts.length >= 6) {
        summary.createEl("div", {
          text: `Conflicts will be written to a checklist note in Inbox/ for manual resolution.`,
          cls: "ffg-migrate-note",
        });
      } else if (lastScan.conflicts.length > 0) {
        summary.createEl("div", {
          text: `Conflicts will be resolved interactively, one file at a time.`,
          cls: "ffg-migrate-note",
        });
      }
      if (lastScan.settingsRefs.length > 0) {
        const warn = previewBox.createEl("div", {
          cls: "ffg-migrate-warn",
        });
        warn.createEl("div", {
          text: `Heads up: \`${lastScan.sourceField}\` is also referenced in plugin settings (you'll get an option to update these in the confirmation step):`,
        });
        const list = warn.createEl("ul");
        for (const ref of lastScan.settingsRefs) {
          list.createEl("li", { text: ref });
        }
      }
      migrateBtn.disabled = false;
    };

    scanBtn.addEventListener("click", () => {
      const src = sourceInput.value.trim();
      const tgt = targetInput.value.trim();
      if (!src || !tgt) {
        new Notice("[FFG] Set both source and target fields");
        return;
      }
      if (src === tgt) {
        new Notice("[FFG] Source and target must differ");
        return;
      }
      const scope = this.migrateScope;
      const result = this.plugin.scanFieldMigration(src, tgt, scope);
      const settingsRefs =
        this.plugin.collectFieldSettingsReferences(src);
      const settingsPlan = this.plugin.planSettingsUpdates(src, tgt);
      lastScan = {
        sourceField: src,
        targetField: tgt,
        scope,
        cleanFiles: result.cleanFiles,
        conflicts: result.conflicts,
        settingsRefs,
        settingsPlan,
      };
      renderPreview();
    });

    [sourceInput, targetInput].forEach((el) =>
      el.addEventListener("input", () => {
        lastScan = null;
        renderPreview();
      })
    );

    migrateBtn.addEventListener("click", () => {
      if (!lastScan) return;
      const scan = lastScan;
      new MigrationConfirmModal(this.app, scan, async (confirmResult) => {
        if (confirmResult.applySettings) {
          try {
            const { applied } = await this.plugin.applySettingsUpdates(
              scan.settingsPlan,
              confirmResult.decisionChoices
            );
            if (applied > 0) {
              new Notice(`[FFG] Updated ${applied} settings reference(s).`);
            }
          } catch (e) {
            console.error("[FFG] applySettingsUpdates error", e);
            new Notice(
              "[FFG] Settings update failed; see console. Continuing with note migration."
            );
          }
        }
        const perFile: Array<{
          path: string;
          sourceValue: unknown;
          targetValueBefore: unknown;
        }> = [];

        // Phase 1: clean files (target empty/null/missing) — auto use-source.
        for (const file of scan.cleanFiles) {
          const result = await this.plugin.applyFieldMigrationToFile(
            file,
            scan.sourceField,
            scan.targetField,
            "use-source"
          );
          if (result) {
            perFile.push({
              path: file.path,
              sourceValue: result.sourceValue,
              targetValueBefore: result.targetValueBefore,
            });
          }
        }

        // Phase 2: conflicts.
        if (scan.conflicts.length >= 6) {
          // Bulk path: write inbox note; leave conflicts untouched.
          let inboxPath = "";
          try {
            inboxPath = await this.plugin.writeMigrationConflictNote(
              scan.sourceField,
              scan.targetField,
              scan.scope,
              scan.conflicts
            );
          } catch (e) {
            console.error("[FFG] writeMigrationConflictNote error", e);
            new Notice(
              "[FFG] Migrated clean files; failed to write conflict note (see console)."
            );
          }
          await this.plugin.logFieldMigration(
            scan.sourceField,
            scan.targetField,
            scan.scope,
            perFile
          );
          new Notice(
            `[FFG] Migrated ${perFile.length} file(s). ${scan.conflicts.length} conflicts queued in ${inboxPath}.`
          );
          lastScan = null;
          renderPreview();
          return;
        }

        // Interactive path: < 6 conflicts.
        new ConflictResolutionModal(
          this.app,
          scan.conflicts,
          scan.sourceField,
          scan.targetField,
          async (decisions) => {
            for (const decision of decisions) {
              if (decision.resolution === "skip") continue;
              const result = await this.plugin.applyFieldMigrationToFile(
                decision.file,
                scan.sourceField,
                scan.targetField,
                decision.resolution
              );
              if (result) {
                perFile.push({
                  path: decision.file.path,
                  sourceValue: result.sourceValue,
                  targetValueBefore: result.targetValueBefore,
                });
              }
            }
            await this.plugin.logFieldMigration(
              scan.sourceField,
              scan.targetField,
              scan.scope,
              perFile
            );
            new Notice(
              `[FFG] Migration complete: ${perFile.length} file(s) updated.`
            );
            lastScan = null;
            renderPreview();
          }
        ).open();
      }).open();
    });
  }

  private renderCleanupResults(
    container: HTMLElement,
    allFields: Set<string>,
    templateFields: Map<string, Set<string>>,
    counts: Map<
      string,
      { nullCount: number; totalCount: number; coveredNullCount: number }
    >,
    rescan: () => Promise<void>
  ) {
    container.empty();

    if (allFields.size === 0) {
      container.createEl("div", {
        text: "No fields to inspect. Toggle the eraser icon on a template field, or add an ad-hoc field above.",
        cls: "ffg-cleanup-empty",
      });
      return;
    }

    const scopeLabel = this.cleanupScope || "vault";

    const table = container.createEl("table", { cls: "ffg-cleanup-table" });
    const thead = table.createEl("thead").createEl("tr");
    thead.createEl("th", { text: "Field" });
    thead.createEl("th", { text: "Cleanup Null", cls: "ffg-cleanup-lint-th" });
    thead.createEl("th", { text: "Null" });
    thead.createEl("th", { text: "Total" });
    thead.createEl("th", { text: "" });

    const tbody = table.createEl("tbody");
    const isCleanupEnabled = (key: string): boolean => {
      if (templateFields.has(key)) return true;
      if (this.plugin.settings.globalLintFields.includes(key)) return true;
      return false;
    };

    // Build the sort plan based on the active mode. `groupBoundaries` records
    // index positions where a visual divider should be inserted (with label).
    type Divider = { afterIndex: number; label: string };
    let sortedKeys: string[];
    const dividers: Divider[] = [];
    if (this.cleanupSortMode === "grouping") {
      // Position by grouping: Top Level → each group in settings order → unmatched.
      const ordered: string[] = [];
      const seen = new Set<string>();
      const addIfPresent = (name: string) => {
        if (!name || seen.has(name)) return;
        if (!allFields.has(name)) return;
        ordered.push(name);
        seen.add(name);
      };
      // Top Level Properties
      const topStart = ordered.length;
      for (const name of this.plugin.settings.topZone.fieldOrder) {
        addIfPresent(name);
      }
      if (ordered.length > topStart) {
        dividers.push({
          afterIndex: topStart - 1,
          label: "Top Level Properties",
        });
      }
      // Groups in settings order
      for (const g of this.plugin.settings.groups) {
        const before = ordered.length;
        const effective = this.plugin.getGroupEffectiveFieldsCached(
          g,
          this.plugin.settings.folderTemplates
        );
        for (const name of effective) addIfPresent(name);
        if (ordered.length > before) {
          dividers.push({
            afterIndex: before - 1,
            label: g.name || "Group",
          });
        }
      }
      // Unmatched (everything else), alphabetical
      const unmatched = Array.from(allFields)
        .filter((k) => !seen.has(k))
        .sort((a, b) => a.localeCompare(b));
      if (unmatched.length > 0) {
        const before = ordered.length;
        for (const name of unmatched) {
          ordered.push(name);
          seen.add(name);
        }
        dividers.push({ afterIndex: before - 1, label: "Unmatched" });
      }
      sortedKeys = ordered;
    } else {
      sortedKeys = Array.from(allFields).sort((a, b) => {
        const ea = isCleanupEnabled(a);
        const eb = isCleanupEnabled(b);
        if (ea !== eb) return ea ? -1 : 1;
        return a.localeCompare(b);
      });
    }

    const insertDivider = (label: string) => {
      const divRow = tbody.createEl("tr", { cls: "ffg-cleanup-divider" });
      const divCell = divRow.createEl("td", { attr: { colspan: "5" } });
      divCell.setText(label);
    };

    // Shared cache across the render loop; per-group wildcard expansion scans
    // the whole vault, so memoize once per group id.
    const groupEffectiveCache = new Map<string, Set<string>>();

    let dividerInserted = false;
    for (let idx = 0; idx < sortedKeys.length; idx++) {
      const key = sortedKeys[idx];
      if (this.cleanupSortMode === "grouping") {
        const divs = dividers.filter((d) => d.afterIndex === idx - 1);
        for (const d of divs) insertDivider(d.label);
      } else if (!isCleanupEnabled(key) && !dividerInserted) {
        const enabledCount = sortedKeys.findIndex((k) => !isCleanupEnabled(k));
        if (enabledCount > 0) insertDivider("Cleanup not enabled");
        dividerInserted = true;
      }
      const c =
        counts.get(key) ??
        { nullCount: 0, totalCount: 0, coveredNullCount: 0 };
      const templates = templateFields.get(key);
      const isAdHoc = this.plugin.settings.cleanupAdHocFields.includes(key);

      const row = tbody.createEl("tr");
      const keyCell = row.createEl("td", { cls: "ffg-cleanup-key" });
      const keyBtn = keyCell.createEl("button", {
        cls: "ffg-cleanup-key-btn",
        text: key,
        attr: {
          "aria-label": `Inspect notes that use "${key}"`,
        },
      });
      keyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const occurrences = this.plugin.collectFieldOccurrencesInScope(
          key,
          this.cleanupScope
        );
        new FieldOccurrencesModal(
          this.app,
          key,
          this.cleanupScope,
          occurrences
        ).open();
      });
      if (isAdHoc) {
        const removeAdHoc = keyCell.createEl("button", {
          cls: "ffg-cleanup-adhoc-remove",
          text: "×",
          attr: { "aria-label": "Remove ad-hoc field" },
        });
        removeAdHoc.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.plugin.settings.cleanupAdHocFields =
            this.plugin.settings.cleanupAdHocFields.filter((n) => n !== key);
          await this.plugin.saveSettings();
          await rescan();
        });
      }

      const lintCell = row.createEl("td", { cls: "ffg-cleanup-lint-cell" });
      const inVault = this.plugin.settings.globalLintFields.includes(key);
      const coverage = this.plugin.templatesActiveForField(
        key,
        groupEffectiveCache
      );
      const inTemplate = coverage.withCleanup.length > 0;
      // Partial coverage = some-but-not-all templates that touch this field
      // have cleanup on. Skip the fraction when there's only one template
      // (no ambiguity possible) or when vault-wide is on (universal).
      const showFraction =
        inTemplate &&
        !inVault &&
        coverage.total.length > 1 &&
        coverage.withCleanup.length < coverage.total.length;

      let scopeDescription = "currently off";
      if (inVault) scopeDescription = "currently vault-wide";
      else if (showFraction) {
        scopeDescription = `currently in ${coverage.withCleanup.length} of ${coverage.total.length} templates`;
      } else if (inTemplate) {
        scopeDescription = "currently template-scoped";
      }

      const lintBtn = lintCell.createEl("button", {
        cls: "ffg-cleanup-lint-btn",
        attr: {
          "aria-label": "Configure cleanup scope: " + scopeDescription,
        },
      });
      setIcon(lintBtn, "sparkles");
      if (showFraction) {
        lintBtn.addClass("ffg-cleanup-lint-fractional");
        lintBtn.createEl("span", {
          cls: "ffg-cleanup-lint-fraction",
          text: `${coverage.withCleanup.length}/${coverage.total.length}`,
        });
      }
      if (inVault) lintBtn.addClass("active-vault");
      else if (inTemplate) lintBtn.addClass("active-template");
      lintBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLintScopePopover(this.plugin, key, lintBtn, () => {
          void rescan();
        });
      });

      // Null column: shows "N (M uncovered)" when some nulls sit in files no
      // template touches. Bare count when everything is covered (or when there
      // are no active templates to compare against).
      const nullCell = row.createEl("td", { cls: "ffg-cleanup-count" });
      const uncoveredNulls = c.nullCount - c.coveredNullCount;
      if (c.nullCount > 0 && uncoveredNulls > 0 && coverage.total.length > 0) {
        nullCell.setText(`${c.nullCount} (${uncoveredNulls} uncovered)`);
        nullCell.setAttr(
          "aria-label",
          `${c.nullCount} null occurrence${c.nullCount === 1 ? "" : "s"} total. ${uncoveredNulls} sit in files no template covers; ${c.coveredNullCount} are covered.`
        );
      } else {
        nullCell.setText(String(c.nullCount));
      }
      row.createEl("td", { text: String(c.totalCount), cls: "ffg-cleanup-count" });

      const actionCell = row.createEl("td", { cls: "ffg-cleanup-actions-cell" });

      const scrubBtn = actionCell.createEl("button", {
        text: "Remove null",
        cls: c.nullCount > 0 ? "mod-warning" : "",
      });
      if (c.nullCount === 0) scrubBtn.disabled = true;
      scrubBtn.addEventListener("click", () => {
        if (c.nullCount === 0) return;
        new ConfirmModal(
          this.app,
          `Remove "${key}" (null) from ${c.nullCount} file${c.nullCount === 1 ? "" : "s"} in ${scopeLabel}? Non-null values are untouched.`,
          async () => {
            scrubBtn.disabled = true;
            scrubBtn.setText("Removing...");
            try {
              const n = await this.plugin.scrubFieldNullInScope(
                key,
                this.cleanupScope
              );
              new Notice(
                `[FFG] Removed null "${key}" from ${n} file${n === 1 ? "" : "s"}`
              );
              await rescan();
            } catch (e) {
              console.error("[FFG] scrub-null error", e);
              new Notice("[FFG] Scrub failed, see console");
            }
          }
        ).open();
      });

      const nukeBtn = actionCell.createEl("button", {
        text: "Remove ALL",
        cls: c.totalCount > 0 ? "ffg-cleanup-nuke" : "",
      });
      if (c.totalCount === 0) nukeBtn.disabled = true;
      nukeBtn.addEventListener("click", () => {
        if (c.totalCount === 0) return;
        new ConfirmModal(
          this.app,
          `DANGER: Remove EVERY occurrence of "${key}" from ${c.totalCount} file${c.totalCount === 1 ? "" : "s"} in ${scopeLabel}? This includes non-null values and is not reversible.`,
          () => {
            new ConfirmModal(
              this.app,
              `Last chance. Really delete "${key}" from ${c.totalCount} file${c.totalCount === 1 ? "" : "s"}?`,
              async () => {
                nukeBtn.disabled = true;
                nukeBtn.setText("Removing...");
                try {
                  const n = await this.plugin.scrubFieldAllInScope(
                    key,
                    this.cleanupScope
                  );
                  new Notice(
                    `[FFG] Removed "${key}" from ${n} file${n === 1 ? "" : "s"}`
                  );
                  await rescan();
                } catch (e) {
                  console.error("[FFG] scrub-all error", e);
                  new Notice("[FFG] Scrub failed, see console");
                }
              }
            ).open();
          }
        ).open();
      });
    }
  }

  private renderTemplateList(container: HTMLElement) {
    container.empty();
    for (const tpl of this.plugin.settings.folderTemplates) {
      this.renderTemplateCard(container, tpl);
    }
  }

  private renderTemplateCard(
    container: HTMLElement,
    tpl: FolderTemplate,
    options: {
      collapsible?: boolean;
      collapsed?: boolean;
      refresh?: () => void;
      onFieldsChanged?: () => void;
      reorder?: {
        canMoveUp: boolean;
        canMoveDown: boolean;
        onMoveUp: () => void | Promise<void>;
        onMoveDown: () => void | Promise<void>;
      };
    } = {}
  ) {
    const card = container.createDiv("ffg-template-card");
    card.dataset.ffgTemplateCard = tpl.id;
    const refresh = options.refresh ?? (() => this.renderTemplateList(container));
    const onFieldsChanged = options.onFieldsChanged;

    let body: HTMLElement;
    let nameInRow: ((value: string) => void) | null = null;
    let pathsInRow: (() => void) | null = null;

    if (options.collapsible) {
      // Preserve expansion state across re-renders (e.g. reorder, edit).
      // Default to options.collapsed only when no prior state exists.
      let collapsed = this.templateExpansionState.has(tpl.id)
        ? this.templateExpansionState.get(tpl.id)!
        : options.collapsed ?? false;
      card.addClass("ffg-template-card-collapsible");

      const head = card.createDiv("ffg-template-card-head");
      const chevron = head.createSpan({ cls: "ffg-template-card-chevron" });
      setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

      const nameInput = head.createEl("input", {
        type: "text",
        cls: "ffg-template-card-name",
      });
      nameInput.placeholder = "Template name (optional)";
      nameInput.value = tpl.name;
      nameInput.addEventListener("click", (e) => e.stopPropagation());
      nameInput.addEventListener("input", () => {
        tpl.name = nameInput.value;
        this.plugin.saveSettingsDebounced();
      });
      nameInRow = (value) => {
        if (nameInput.value !== value) nameInput.value = value;
      };

      const summaryEl = head.createSpan({ cls: "ffg-template-card-summary" });
      const renderSummary = () => {
        const labels = tpl.pathPrefixes
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        summaryEl.setText(labels.length ? labels.join(", ") : "global");
      };
      renderSummary();
      pathsInRow = renderSummary;

      const actions = head.createDiv("ffg-template-card-actions");
      if (options.reorder) {
        const upBtn = actions.createEl("button", {
          cls: "ffg-template-card-action",
          attr: { "aria-label": "Move template up" },
        });
        setIcon(upBtn, "arrow-up");
        upBtn.disabled = !options.reorder.canMoveUp;
        upBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await options.reorder!.onMoveUp();
        });

        const downBtn = actions.createEl("button", {
          cls: "ffg-template-card-action",
          attr: { "aria-label": "Move template down" },
        });
        setIcon(downBtn, "arrow-down");
        downBtn.disabled = !options.reorder.canMoveDown;
        downBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await options.reorder!.onMoveDown();
        });
      }
      const trashBtn = actions.createEl("button", {
        cls: "ffg-template-card-action",
        attr: { "aria-label": "Delete template" },
      });
      setIcon(trashBtn, "trash");
      trashBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        this.plugin.settings.folderTemplates =
          this.plugin.settings.folderTemplates.filter(
            (t) => t.id !== tpl.id
          );
        this.templateExpansionState.delete(tpl.id);
        await this.plugin.saveSettings();
        refresh();
      });

      body = card.createDiv("ffg-template-card-body");
      body.style.display = collapsed ? "none" : "";

      head.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (target.closest("input") || target.closest("button")) return;
        collapsed = !collapsed;
        this.templateExpansionState.set(tpl.id, collapsed);
        setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
        body.style.display = collapsed ? "none" : "";
      });
    } else {
      body = card;
    }

    // Multi-link indicator removed: templates now belong to at most one group.
    const renderLinkedIndicator = () => {
      /* no-op */
    };

    // Name + delete now live in the card head. For non-collapsible (legacy)
    // mode, fall back to an inline Name setting in the body.
    if (!options.collapsible) {
      new Setting(body)
        .setName("Name")
        .addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip("Delete template")
            .onClick(async () => {
              this.plugin.settings.folderTemplates =
                this.plugin.settings.folderTemplates.filter(
                  (t) => t.id !== tpl.id
                );
              await this.plugin.saveSettings();
              refresh();
            })
        )
        .addText((text) =>
          text
            .setPlaceholder("Template name (optional)")
            .setValue(tpl.name)
            .onChange(async (value) => {
              tpl.name = value;
              nameInRow?.(value);
              await this.plugin.saveSettings();
            })
        );
    }

    // === Default Field Values (rendered FIRST in the new layout) ===
    const fieldsHeader = body.createDiv("ffg-field-order-header");
    fieldsHeader.createEl("div", {
      text: "Default Field Values",
      cls: "setting-item-name",
    });
    fieldsHeader.createEl("div", {
      text: "Linked-group fields appear here automatically. Set a default value on any row, or add a field below. Use the chevrons on each row to reorder for this template.",
      cls: "setting-item-description",
    });

    const fieldsContainer = body.createDiv("ffg-template-fields");
    const renderFields = () =>
      this.renderTemplateFieldsList(fieldsContainer, tpl, onFieldsChanged);

    // === Targeting & setup (collapsible) ===
    const targetingHasContent =
      tpl.pathPrefixes.some((p) => p.trim().length > 0) ||
      (tpl.excludedPathPrefixes ?? []).some((p) => p.trim().length > 0) ||
      !!tpl.bodyTemplatePath ||
      !!tpl.group ||
      tpl.fields.length > 0;
    let targetingCollapsed = targetingHasContent;

    const targetingCard = body.createDiv("ffg-template-targeting");
    const targetingHead = targetingCard.createDiv("ffg-template-targeting-head");
    const targetingChevron = targetingHead.createSpan({
      cls: "ffg-template-targeting-chevron",
    });
    setIcon(
      targetingChevron,
      targetingCollapsed ? "chevron-right" : "chevron-down"
    );
    targetingHead.createSpan({
      cls: "ffg-template-targeting-title",
      text: "Targeting & setup",
    });
    const targetingSummary = targetingHead.createSpan({
      cls: "ffg-template-targeting-summary",
    });
    const targetingBody = targetingCard.createDiv("ffg-template-targeting-body");
    targetingBody.style.display = targetingCollapsed ? "none" : "";

    const renderTargetingSummary = () => {
      const includeCount = tpl.pathPrefixes.filter(
        (p) => p.trim().length > 0
      ).length;
      const excludeCount = (tpl.excludedPathPrefixes ?? []).filter(
        (p) => p.trim().length > 0
      ).length;
      const bodyOn = !!tpl.bodyTemplatePath;
      const groupName = tpl.group
        ? this.plugin.settings.groups.find((g) => g.id === tpl.group)?.name ??
          "?"
        : "—";
      const includesGlobal = tpl.pathPrefixes.some((p) => !p || p === "*");
      const includeLabel = includesGlobal
        ? "global"
        : `${includeCount} include${includeCount === 1 ? "" : "s"}`;
      targetingSummary.setText(
        `${includeLabel} · ${excludeCount} exclude${excludeCount === 1 ? "" : "s"} · body ${bodyOn ? "on" : "off"} · group ${groupName}`
      );
    };
    renderTargetingSummary();

    targetingHead.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("input") || t.closest("button")) return;
      targetingCollapsed = !targetingCollapsed;
      setIcon(
        targetingChevron,
        targetingCollapsed ? "chevron-right" : "chevron-down"
      );
      targetingBody.style.display = targetingCollapsed ? "none" : "";
    });

    // Include / Exclude path naming — labels shift to "Include paths" when
    // there's at least one exclude prefix, to make the relationship clearer.
    const includePathsLabel = (): string =>
      (tpl.excludedPathPrefixes ?? []).some((p) => p.trim().length > 0)
        ? "Include paths"
        : "Folder paths";

    const pathsHeader = targetingBody.createDiv("ffg-field-order-header");
    const pathsHeaderName = pathsHeader.createEl("div", {
      text: includePathsLabel(),
      cls: "setting-item-name",
    });
    pathsHeader.createEl("div", {
      text: "One or more path prefixes (e.g. Notes/People/). Empty string matches every note.",
      cls: "setting-item-description",
    });

    const pathsContainer = targetingBody.createDiv("ffg-template-paths");
    const renderPaths = () => {
      pathsContainer.empty();
      tpl.pathPrefixes.forEach((path, index) => {
        const row = pathsContainer.createDiv("ffg-template-path-row");
        const input = row.createEl("input", {
          type: "text",
          cls: "ffg-template-path-input",
        });
        input.placeholder = "path prefix (empty = global)";
        input.value = path;
        input.addEventListener("input", () => {
          tpl.pathPrefixes[index] = input.value;
          pathsInRow?.();
          renderTargetingSummary();
          this.plugin.saveSettingsDebounced();
        });
        new FolderPathSuggest(this.app, input, async (value) => {
          tpl.pathPrefixes[index] = value;
          pathsInRow?.();
          renderTargetingSummary();
          await this.plugin.saveSettings();
        });

        const deleteBtn = row.createEl("button", {
          cls: "ffg-template-field-delete",
          attr: { "aria-label": "Delete path" },
        });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          tpl.pathPrefixes = tpl.pathPrefixes.filter((_, i) => i !== index);
          pathsInRow?.();
          renderTargetingSummary();
          await this.plugin.saveSettings();
          renderPaths();
        });
      });

      const addBtn = pathsContainer.createEl("button", {
        text: "+ Add path",
        cls: "ffg-add-field-btn",
      });
      addBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        tpl.pathPrefixes.push("");
        pathsInRow?.();
        renderTargetingSummary();
        await this.plugin.saveSettings();
        renderPaths();
      });
    };
    renderPaths();

    // Exclude paths
    const excludeHeader = targetingBody.createDiv("ffg-field-order-header");
    excludeHeader.createEl("div", {
      text: "Exclude paths",
      cls: "setting-item-name",
    });
    excludeHeader.createEl("div", {
      text: "Files matching any exclude prefix are skipped, even if they match an include path above.",
      cls: "setting-item-description",
    });

    const excludeContainer = targetingBody.createDiv("ffg-template-paths");
    const renderExcludes = () => {
      excludeContainer.empty();
      if (!tpl.excludedPathPrefixes) tpl.excludedPathPrefixes = [];
      tpl.excludedPathPrefixes.forEach((path, index) => {
        const row = excludeContainer.createDiv("ffg-template-path-row");
        const input = row.createEl("input", {
          type: "text",
          cls: "ffg-template-path-input",
        });
        input.placeholder = "path prefix to exclude";
        input.value = path;
        input.addEventListener("input", () => {
          tpl.excludedPathPrefixes[index] = input.value;
          renderTargetingSummary();
          pathsHeaderName.setText(includePathsLabel());
          this.plugin.saveSettingsDebounced();
        });
        new FolderPathSuggest(this.app, input, async (value) => {
          tpl.excludedPathPrefixes[index] = value;
          renderTargetingSummary();
          pathsHeaderName.setText(includePathsLabel());
          await this.plugin.saveSettings();
        });

        const deleteBtn = row.createEl("button", {
          cls: "ffg-template-field-delete",
          attr: { "aria-label": "Delete exclude path" },
        });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          tpl.excludedPathPrefixes = tpl.excludedPathPrefixes.filter(
            (_, i) => i !== index
          );
          renderTargetingSummary();
          pathsHeaderName.setText(includePathsLabel());
          await this.plugin.saveSettings();
          renderExcludes();
        });
      });

      const addBtn = excludeContainer.createEl("button", {
        text: "+ Add exclude",
        cls: "ffg-add-field-btn",
      });
      addBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!tpl.excludedPathPrefixes) tpl.excludedPathPrefixes = [];
        tpl.excludedPathPrefixes.push("");
        renderTargetingSummary();
        pathsHeaderName.setText(includePathsLabel());
        await this.plugin.saveSettings();
        renderExcludes();
      });
    };
    renderExcludes();

    const bodyHeader = targetingBody.createDiv("ffg-field-order-header");
    bodyHeader.createEl("div", {
      text: "Body template",
      cls: "setting-item-name",
    });
    bodyHeader.createEl("div", {
      text: "Optional markdown note whose body is inserted into matching notes when their body is blank. Fires on note creation and on move into a matching folder. Templater syntax is parsed if the Templater plugin is installed.",
      cls: "setting-item-description",
    });
    const bodyRow = targetingBody.createDiv("ffg-template-body-row");
    const bodyInput = bodyRow.createEl("input", {
      type: "text",
      cls: "ffg-template-body-input",
    });
    bodyInput.placeholder = "path/to/template-note.md";
    bodyInput.value = tpl.bodyTemplatePath ?? "";
    bodyInput.addEventListener("input", () => {
      const value = bodyInput.value.trim();
      if (value) tpl.bodyTemplatePath = value;
      else delete tpl.bodyTemplatePath;
      renderTargetingSummary();
      this.plugin.saveSettingsDebounced();
    });
    new MarkdownFilePathSuggest(this.app, bodyInput, async (value) => {
      bodyInput.value = value;
      if (value) tpl.bodyTemplatePath = value;
      else delete tpl.bodyTemplatePath;
      renderTargetingSummary();
      await this.plugin.saveSettings();
    });
    const openBtn = bodyRow.createEl("button", {
      text: "Open",
      cls: "ffg-template-body-open",
    });
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const path = bodyInput.value.trim();
      if (!path) {
        new Notice("[FFG] Set a body template path first");
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        new Notice(`[FFG] Body template not found: ${path}`);
        return;
      }
      this.app.workspace.getLeaf("tab").openFile(file);
    });

    const groupsHeader = targetingBody.createDiv("ffg-field-order-header");
    groupsHeader.createEl("div", {
      text: "Group",
      cls: "setting-item-name",
    });
    groupsHeader.createEl("div", {
      text: "Pick the group that this template's fields belong to. Fields with Sort-into-group on will fold under this group's heading in the Properties panel. Pick (none) to leave this as a standalone (global) template.",
      cls: "setting-item-description",
    });

    const groupsContainer = targetingBody.createDiv("ffg-template-linked-groups");
    const groupSelect = groupsContainer.createEl("select", {
      cls: "ffg-template-group-select",
    });
    groupSelect.createEl("option", { value: "", text: "(none — global)" });
    for (const g of this.plugin.settings.groups) {
      groupSelect.createEl("option", { value: g.id, text: g.name || g.id });
    }
    groupSelect.value = tpl.group ?? "";
    groupSelect.addEventListener("change", async () => {
      const newVal = groupSelect.value;
      if (newVal) tpl.group = newVal;
      else delete tpl.group;
      await this.plugin.saveSettings();
      // Card may need to move between Global Templates and a group's section.
      if (this.activeTab === "groups") {
        this.rerenderActiveTab();
        return;
      }
      renderFields();
      renderTargetingSummary();
    });

    const renderLinkedGroups = () => {
      groupSelect.value = tpl.group ?? "";
    };

    renderFields();
  }

  // Build a template's render order: existing tpl.fieldOrder entries that are
  // still backed by either a linked-group field or an explicit named field,
  // then any backing names not yet in fieldOrder (linked first, then explicit).
  // Returns the ordered named-field plan plus any anonymous (in-progress) rows
  // and the linkedOrigin map.
  private getTemplateRenderPlan(tpl: FolderTemplate): {
    orderedNames: string[];
    linkedOrigin: Map<string, string>;
    anonymous: TemplateField[];
  } {
    // Each template owns its own fields. No sibling-template inheritance —
    // adding a new template no longer auto-imports rows from other templates
    // linked to the same group. Wildcard-matched vault keys and any legacy
    // group-owned literals still flow in (they aren't owned by any template).
    const ownNames = new Set(
      tpl.fields.filter((f) => f.name).map((f) => f.name)
    );
    const linkedOrigin = new Map<string, string>();
    if (tpl.group) {
      const group = this.plugin.settings.groups.find((g) => g.id === tpl.group);
      if (group) {
      for (const lit of getGroupLiteralFields(group)) {
        if (lit && !ownNames.has(lit) && !linkedOrigin.has(lit)) {
          linkedOrigin.set(lit, group.name);
        }
      }
      const wildcardExpanded = this.plugin.getGroupEffectiveFieldsCached(
        group,
        []
      );
      const legacyLits = new Set(getGroupLiteralFields(group));
      for (const name of wildcardExpanded) {
        if (
          name &&
          !legacyLits.has(name) &&
          !ownNames.has(name) &&
          !linkedOrigin.has(name)
        ) {
          linkedOrigin.set(name, group.name);
        }
      }
      }
    }

    const allNames: string[] = [];
    const seenAll = new Set<string>();
    for (const name of linkedOrigin.keys()) {
      if (!seenAll.has(name)) {
        allNames.push(name);
        seenAll.add(name);
      }
    }
    for (const f of tpl.fields) {
      if (f.name && !seenAll.has(f.name)) {
        allNames.push(f.name);
        seenAll.add(f.name);
      }
    }

    const allNamesSet = new Set(allNames);
    const orderedNames: string[] = [];
    const placed = new Set<string>();
    for (const name of tpl.fieldOrder) {
      if (allNamesSet.has(name) && !placed.has(name)) {
        orderedNames.push(name);
        placed.add(name);
      }
    }
    for (const name of allNames) {
      if (!placed.has(name)) {
        orderedNames.push(name);
        placed.add(name);
      }
    }

    const anonymous = tpl.fields.filter((f) => !f.name);
    return { orderedNames, linkedOrigin, anonymous };
  }

  // Swap `tpl` with the previous/next template in `folderTemplates` that also
  // satisfies the section filter, so that up/down reordering in either
  // Global Templates or a group's "Templates using this group" subsection
  // moves the card within its visible section.
  private async swapTemplateInSection(
    tpl: FolderTemplate,
    direction: -1 | 1,
    filter: (t: FolderTemplate) => boolean
  ): Promise<void> {
    const all = this.plugin.settings.folderTemplates;
    const myIdx = all.findIndex((t) => t.id === tpl.id);
    if (myIdx < 0) return;
    let targetIdx = -1;
    if (direction === -1) {
      for (let i = myIdx - 1; i >= 0; i--) {
        if (filter(all[i])) {
          targetIdx = i;
          break;
        }
      }
    } else {
      for (let i = myIdx + 1; i < all.length; i++) {
        if (filter(all[i])) {
          targetIdx = i;
          break;
        }
      }
    }
    if (targetIdx < 0) return;
    [all[myIdx], all[targetIdx]] = [all[targetIdx], all[myIdx]];
    await this.plugin.saveSettings();
  }

  private async reorderTemplateField(
    tpl: FolderTemplate,
    fromIndex: number,
    toIndex: number
  ): Promise<void> {
    const { orderedNames } = this.getTemplateRenderPlan(tpl);
    if (
      fromIndex < 0 ||
      fromIndex >= orderedNames.length ||
      toIndex < 0 ||
      toIndex >= orderedNames.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = orderedNames.splice(fromIndex, 1);
    // Always land BELOW the drop target. Splicing already shifts indices when
    // fromIndex < toIndex, so toIndex points to the target's new position;
    // when fromIndex > toIndex, the target hasn't shifted, so we need toIndex+1
    // to land below it.
    const insertAt =
      fromIndex < toIndex ? toIndex : Math.min(toIndex + 1, orderedNames.length);
    orderedNames.splice(insertAt, 0, moved);
    tpl.fieldOrder = orderedNames;
    await this.plugin.saveSettings();
  }

  private renderTemplateFieldsList(
    container: HTMLElement,
    tpl: FolderTemplate,
    onFieldsChanged?: () => void
  ) {
    container.empty();
    const refresh = () =>
      this.renderTemplateFieldsList(container, tpl, onFieldsChanged);

    const { orderedNames, linkedOrigin, anonymous } =
      this.getTemplateRenderPlan(tpl);

    orderedNames.forEach((name, idx) => {
      const origin = linkedOrigin.get(name) ?? null;
      const explicit = tpl.fields.find((f) => f.name === name);
      this.renderTemplateFieldRow(
        container,
        tpl,
        name,
        origin,
        explicit,
        refresh,
        {
          index: idx,
          onReorder: async (fromIndex, toIndex) => {
            await this.reorderTemplateField(tpl, fromIndex, toIndex);
            refresh();
          },
        },
        onFieldsChanged
      );
    });

    for (const f of anonymous) {
      this.renderTemplateFieldRow(
        container,
        tpl,
        f.name,
        null,
        f,
        refresh,
        undefined,
        onFieldsChanged
      );
    }

    const addBtn = container.createEl("button", {
      text: "+ Add field",
      cls: "ffg-add-field-btn",
    });
    addBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      tpl.fields.push({ name: "", value: undefined });
      await this.plugin.saveSettings();
      refresh();
    });
  }

  private getPropertyType(key: string): string {
    if (!key) return "text";
    const mtm = (this.app as unknown as {
      metadataTypeManager?: {
        properties?: Record<
          string,
          { type?: string; widget?: string } | undefined
        >;
      };
    }).metadataTypeManager;
    if (!mtm) return "text";
    const props = mtm.properties ?? {};
    const lookup = props[key] ?? props[key.toLowerCase()];
    return lookup?.widget ?? lookup?.type ?? "text";
  }

  private renderTemplateFieldRow(
    container: HTMLElement,
    tpl: FolderTemplate,
    fieldName: string,
    origin: string | null,
    explicit: TemplateField | undefined,
    refresh: () => void,
    reorder?: {
      index: number;
      onReorder: (fromIndex: number, toIndex: number) => Promise<void>;
    },
    onFieldsChanged?: () => void
  ) {
    const row = container.createDiv("ffg-template-field-row");

    // Always render the drag-handle slot so anonymous (just-added) rows align
    // with named rows. Drag interactions only attach when reorder is provided.
    const handle = row.createEl("span", {
      cls:
        "ffg-template-field-drag" +
        (reorder ? "" : " ffg-template-field-drag-placeholder"),
      attr: reorder
        ? { "aria-label": "Drag to reorder", draggable: "true" }
        : { "aria-hidden": "true" },
    });
    setIcon(handle, "grip-vertical");

    if (reorder) {
      row.dataset.ffgIndex = String(reorder.index);

      handle.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData(
          "application/x-ffg-field",
          String(reorder.index)
        );
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        row.addClass("ffg-template-field-dragging");
      });
      handle.addEventListener("dragend", () => {
        row.removeClass("ffg-template-field-dragging");
        container
          .querySelectorAll(".ffg-template-field-drop-target")
          .forEach((el) => el.removeClass("ffg-template-field-drop-target"));
      });
      row.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types.includes("application/x-ffg-field")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        container
          .querySelectorAll(".ffg-template-field-drop-target")
          .forEach((el) => el.removeClass("ffg-template-field-drop-target"));
        row.addClass("ffg-template-field-drop-target");
      });
      row.addEventListener("drop", async (e) => {
        const raw = e.dataTransfer?.getData("application/x-ffg-field");
        if (!raw) return;
        e.preventDefault();
        const fromIndex = parseInt(raw, 10);
        if (Number.isNaN(fromIndex) || fromIndex === reorder.index) return;
        await reorder.onReorder(fromIndex, reorder.index);
      });
    }

    if (origin) {
      row.createEl("span", {
        cls: "ffg-template-field-name-linked",
        text: fieldName,
      });
    } else {
      const nameInput = row.createEl("input", {
        type: "text",
        cls: "ffg-template-field-name",
      });
      nameInput.placeholder = "frontmatter key";
      nameInput.value = fieldName;
      nameInput.addEventListener("input", () => {
        if (!explicit) return;
        explicit.name = nameInput.value.trim();
        this.plugin.saveSettingsDebounced();
      });
      nameInput.addEventListener("blur", () => {
        onFieldsChanged?.();
      });
      new FrontmatterKeySuggest(this.app, nameInput, async (value) => {
        if (!explicit) return;
        explicit.name = value;
        nameInput.value = value;
        await this.plugin.saveSettings();
        onFieldsChanged?.();
        refresh();
      });
    }

    const commitValue = async (newValue: unknown) => {
      if (origin) {
        const isEmpty =
          newValue === undefined ||
          newValue === "" ||
          (Array.isArray(newValue) && newValue.length === 0);
        if (isEmpty) {
          if (explicit) {
            tpl.fields = tpl.fields.filter((f) => f !== explicit);
            explicit = undefined;
            this.plugin.saveSettingsDebounced();
          }
        } else {
          if (!explicit) {
            explicit = { name: fieldName, value: newValue };
            tpl.fields.push(explicit);
          } else {
            explicit.value = newValue;
          }
          this.plugin.saveSettingsDebounced();
        }
      } else if (explicit) {
        explicit.value = newValue;
        this.plugin.saveSettingsDebounced();
      }
    };

    const currentValue = explicit ? explicit.value : undefined;
    const type = fieldName ? this.getPropertyType(fieldName) : "text";
    this.renderValueWidget(row, fieldName, type, currentValue, commitValue);

    const nameRef = () => (origin ? fieldName : explicit?.name ?? fieldName);

    const isExcluded = tpl.excludedFields.includes(nameRef());
    if (isExcluded) row.addClass("ffg-template-field-row-excluded");

    const eyeBtn = row.createEl("button", {
      cls: "ffg-template-field-eye",
      attr: {
        "aria-label": isExcluded
          ? "Hidden by default. Click to show by default."
          : "Showing by default. Click to hide by default.",
      },
    });
    setIcon(eyeBtn, isExcluded ? "eye-off" : "eye");
    eyeBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = nameRef();
      if (!key) return;
      const nowExcluded = !tpl.excludedFields.includes(key);
      if (nowExcluded) {
        tpl.excludedFields.push(key);
      } else {
        tpl.excludedFields = tpl.excludedFields.filter((n) => n !== key);
      }
      row.toggleClass("ffg-template-field-row-excluded", nowExcluded);
      setIcon(eyeBtn, nowExcluded ? "eye-off" : "eye");
      eyeBtn.setAttr(
        "aria-label",
        nowExcluded
          ? "Hidden by default. Click to show by default."
          : "Showing by default. Click to hide by default."
      );
      await this.plugin.saveSettings();
    });

    const isLinted = tpl.lintFields.includes(nameRef());
    const eraserBtn = row.createEl("button", {
      cls: "ffg-template-field-eraser",
      attr: {
        "aria-label": isLinted
          ? "Stop cleanup for this field"
          : "Cleanup this field when null",
      },
    });
    setIcon(eraserBtn, "sparkles");
    if (isLinted) eraserBtn.addClass("active");
    eraserBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = nameRef();
      if (!key) return;
      const nowLinted = !tpl.lintFields.includes(key);
      if (nowLinted) {
        tpl.lintFields.push(key);
      } else {
        tpl.lintFields = tpl.lintFields.filter((n) => n !== key);
      }
      eraserBtn.toggleClass("active", nowLinted);
      eraserBtn.setAttr(
        "aria-label",
        nowLinted
          ? "Stop cleanup for this field"
          : "Cleanup this field when null"
      );
      await this.plugin.saveSettings();
    });

    // "Sort into group" toggle: when on, this field joins the group display in
    // the Properties panel. When off, the field renders outside any group.
    if (tpl.group) {
      const isInGroup = !(tpl.noGroupFields ?? []).includes(nameRef());
      const groupToggle = row.createEl("button", {
        cls: "ffg-template-field-group-toggle",
        attr: {
          "aria-label": isInGroup
            ? "In group. Click to remove from group."
            : "Not in group. Click to sort into group.",
        },
      });
      setIcon(groupToggle, isInGroup ? "folder" : "folder-x");
      if (isInGroup) groupToggle.addClass("active");
      groupToggle.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = nameRef();
        if (!key) return;
        if (!tpl.noGroupFields) tpl.noGroupFields = [];
        const nowIn = tpl.noGroupFields.includes(key);
        if (nowIn) {
          tpl.noGroupFields = tpl.noGroupFields.filter((n) => n !== key);
          groupToggle.addClass("active");
          setIcon(groupToggle, "folder");
        } else {
          tpl.noGroupFields.push(key);
          groupToggle.removeClass("active");
          setIcon(groupToggle, "folder-x");
        }
        groupToggle.setAttr(
          "aria-label",
          nowIn
            ? "In group. Click to remove from group."
            : "Not in group. Click to sort into group."
        );
        await this.plugin.saveSettings();
        onFieldsChanged?.();
      });
    }

    if (!origin && explicit) {
      const deleteBtn = row.createEl("button", {
        cls: "ffg-template-field-delete",
        attr: { "aria-label": "Delete field" },
      });
      setIcon(deleteBtn, "trash");
      deleteBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = explicit;
        if (!target) return;
        const name = target.name;
        tpl.fields = tpl.fields.filter((f) => f !== target);
        if (name) {
          tpl.excludedFields = tpl.excludedFields.filter((n) => n !== name);
          tpl.lintFields = tpl.lintFields.filter((n) => n !== name);
          tpl.noGroupFields = tpl.noGroupFields.filter((n) => n !== name);
        }
        await this.plugin.saveSettings();
        onFieldsChanged?.();
        refresh();
      });
    }
  }

  private renderValueWidget(
    parent: HTMLElement,
    fieldName: string,
    type: string,
    currentValue: unknown,
    onCommit: (newValue: unknown) => void | Promise<void>
  ) {
    switch (type) {
      case "number": {
        const input = parent.createEl("input", {
          type: "number",
          cls: "ffg-template-field-value",
        });
        input.placeholder = "default value";
        input.value =
          typeof currentValue === "number" ? String(currentValue) : "";
        input.addEventListener("input", () => {
          const raw = input.value;
          if (raw === "") {
            void onCommit(undefined);
            return;
          }
          const n = Number(raw);
          if (!isNaN(n)) void onCommit(n);
        });
        return;
      }
      case "checkbox": {
        const wrap = parent.createDiv({ cls: "ffg-template-field-value-toggle" });
        const cb = wrap.createEl("input", { type: "checkbox" });
        cb.checked = currentValue === true;
        cb.addEventListener("change", () => {
          void onCommit(cb.checked);
        });
        return;
      }
      case "date": {
        const wrap = parent.createDiv({ cls: "ffg-template-field-value-date" });
        let isAuto = currentValue === "<today>";
        const input = wrap.createEl("input", {
          type: "date",
          cls: "ffg-template-field-value",
        });
        input.value = isAuto
          ? ""
          : typeof currentValue === "string"
          ? currentValue
          : "";
        input.disabled = isAuto;
        input.addEventListener("input", () => {
          const raw = input.value;
          void onCommit(raw === "" ? undefined : raw);
        });
        const autoBtn = wrap.createEl("button", {
          text: "Today",
          cls: "ffg-template-field-auto-btn",
        });
        if (isAuto) autoBtn.addClass("active");
        autoBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          isAuto = !isAuto;
          if (isAuto) {
            input.value = "";
            input.disabled = true;
            autoBtn.addClass("active");
            void onCommit("<today>");
          } else {
            input.disabled = false;
            autoBtn.removeClass("active");
            void onCommit(undefined);
          }
        });
        return;
      }
      case "datetime": {
        const wrap = parent.createDiv({ cls: "ffg-template-field-value-date" });
        let isAuto = currentValue === "<now>";
        const input = wrap.createEl("input", {
          type: "datetime-local",
          cls: "ffg-template-field-value",
        });
        input.value = isAuto
          ? ""
          : typeof currentValue === "string"
          ? currentValue
          : "";
        input.disabled = isAuto;
        input.addEventListener("input", () => {
          const raw = input.value;
          void onCommit(raw === "" ? undefined : raw);
        });
        const autoBtn = wrap.createEl("button", {
          text: "Now",
          cls: "ffg-template-field-auto-btn",
        });
        if (isAuto) autoBtn.addClass("active");
        autoBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          isAuto = !isAuto;
          if (isAuto) {
            input.value = "";
            input.disabled = true;
            autoBtn.addClass("active");
            void onCommit("<now>");
          } else {
            input.disabled = false;
            autoBtn.removeClass("active");
            void onCommit(undefined);
          }
        });
        return;
      }
      case "multitext":
      case "tags":
      case "aliases": {
        const wrap = parent.createDiv({ cls: "ffg-template-field-value-multi" });
        const values: string[] = Array.isArray(currentValue)
          ? currentValue.map((v) => String(v))
          : [];

        const pillList = wrap.createDiv({ cls: "ffg-pill-list" });
        const renderPills = () => {
          pillList.empty();
          values.forEach((v, i) => {
            const pill = pillList.createDiv({ cls: "ffg-pill" });
            pill.createSpan({ cls: "ffg-pill-text", text: v });
            const remove = pill.createSpan({
              cls: "ffg-pill-remove",
              text: "×",
            });
            remove.setAttribute("role", "button");
            remove.setAttribute("aria-label", `Remove ${v}`);
            remove.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              values.splice(i, 1);
              renderPills();
              void onCommit(values.length === 0 ? undefined : values.slice());
            });
          });
        };
        renderPills();

        const input = wrap.createEl("input", {
          type: "text",
          cls: "ffg-template-field-value",
        });
        input.placeholder = "add default value, press enter";
        const addValue = (raw: string) => {
          const v = raw.trim();
          if (!v || values.includes(v)) {
            input.value = "";
            return;
          }
          values.push(v);
          renderPills();
          void onCommit(values.slice());
          input.value = "";
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addValue(input.value);
          }
        });
        const vaultValues = this.getPropertyValues(fieldName);
        if (vaultValues.length > 0) {
          new PropertyValueSuggest(
            this.app,
            input,
            vaultValues,
            (value) => addValue(value),
            { excludeValues: () => new Set(values) }
          );
        }
        return;
      }
      default: {
        const input = parent.createEl("input", {
          type: "text",
          cls: "ffg-template-field-value",
        });
        input.placeholder = "default value (optional)";
        input.value = seedValueToString(currentValue);
        input.addEventListener("input", () => {
          const raw = input.value;
          void onCommit(raw === "" ? undefined : parseSeedValue(raw));
        });
        const vaultValues = this.getPropertyValues(fieldName);
        if (vaultValues.length > 0) {
          new PropertyValueSuggest(this.app, input, vaultValues, (value) => {
            input.value = value;
            void onCommit(parseSeedValue(value));
          });
        }
        return;
      }
    }
  }

  private renderFieldOrderList(
    container: HTMLElement,
    getList: () => string[],
    setList: (list: string[]) => Promise<void>,
    suggesterFilter?: () => (key: string) => boolean
  ) {
    const render = () => {
      container.empty();
      const list = getList();

      list.forEach((field, index) => {
        const originalValue = field;
        const setting = new Setting(container);
        setting.addExtraButton((btn) =>
          btn
            .setIcon("arrow-up")
            .setTooltip("Move up")
            .setDisabled(index === 0)
            .onClick(async () => {
              const current = getList();
              if (index <= 0) return;
              [current[index - 1], current[index]] = [current[index], current[index - 1]];
              await setList(current);
              render();
            })
        );
        setting.addExtraButton((btn) =>
          btn
            .setIcon("arrow-down")
            .setTooltip("Move down")
            .setDisabled(index === list.length - 1)
            .onClick(async () => {
              const current = getList();
              if (index >= current.length - 1) return;
              [current[index], current[index + 1]] = [current[index + 1], current[index]];
              await setList(current);
              render();
            })
        );
        setting.addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip("Remove")
            .onClick(async () => {
              const current = getList();
              current.splice(index, 1);
              await setList(current);
              render();
            })
        );
        setting.addText((text) => {
          // Per-keystroke path: mutate the live list and persist debounced.
          // Full setList (summary refresh, section re-render) still runs on
          // suggester accept and on the reorder/remove buttons.
          text.setValue(field).onChange((value) => {
            const current = getList();
            current[index] = value;
            this.plugin.saveSettingsDebounced();
          });
          new FrontmatterKeySuggest(
            this.app,
            text.inputEl,
            async (value) => {
              const current = getList();
              current[index] = value;
              await setList(current);
            },
            {
              filter: () => {
                const matcherFilter = suggesterFilter?.();
                const current = getList();
                const usedByOthers = new Set(
                  current.filter((_, i) => i !== index).filter(Boolean)
                );
                return (key: string) => {
                  if (key === originalValue) return true;
                  if (usedByOthers.has(key)) return false;
                  if (matcherFilter && !matcherFilter(key)) return false;
                  return true;
                };
              },
            }
          );
        });
      });

      const addBtn = container.createEl("button", {
        text: "+ Add Field",
        cls: "ffg-add-field-btn",
      });
      addBtn.addEventListener("click", async () => {
        const current = getList();
        current.push("");
        await setList(current);
        render();
      });
    };
    render();
  }

  private renderGroups(container: HTMLElement) {
    container.empty();
    const groups = this.plugin.settings.groups;
    groups.forEach((group, index) => {
      this.renderGroupCard(container, group, index, groups.length);
    });
  }

  private groupSummaryText(group: StoredGroupConfig): string {
    const fieldCount = getGroupLiteralFields(group).length;
    const tplCount = this.plugin.settings.folderTemplates.filter(
      (t) => t.group === group.id
    ).length;
    return `${fieldCount} field${fieldCount === 1 ? "" : "s"} · ${tplCount} template${tplCount === 1 ? "" : "s"}`;
  }

  private renderGroupCard(
    container: HTMLElement,
    group: StoredGroupConfig,
    index: number,
    total: number
  ) {
    const card = container.createDiv("ffg-group-card");
    card.dataset.ffgGroupCard = group.id;
    let collapsed = this.groupExpansionState.get(group.id) ?? true;

    const head = card.createDiv("ffg-group-card-head");

    const chevron = head.createSpan({ cls: "ffg-group-card-chevron" });
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

    const nameInput = head.createEl("input", {
      type: "text",
      cls: "ffg-group-card-name",
    });
    nameInput.placeholder = "Group name";
    nameInput.value = group.name;
    nameInput.addEventListener("input", () => {
      group.name = nameInput.value;
      this.plugin.saveSettingsDebounced();
    });
    nameInput.addEventListener("click", (e) => e.stopPropagation());

    const summaryEl = head.createSpan({
      cls: "ffg-group-card-summary",
      text: this.groupSummaryText(group),
    });
    const updateSummary = () => {
      summaryEl.setText(this.groupSummaryText(group));
    };

    const actions = head.createDiv("ffg-group-card-actions");
    const upBtn = actions.createEl("button", {
      cls: "ffg-group-card-action",
      attr: { "aria-label": "Move up" },
    });
    setIcon(upBtn, "arrow-up");
    if (index === 0) upBtn.disabled = true;
    upBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const groups = this.plugin.settings.groups;
      const i = groups.findIndex((g) => g.id === group.id);
      if (i <= 0) return;
      [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]];
      await this.plugin.saveSettings();
      this.renderGroups(container);
    });

    const downBtn = actions.createEl("button", {
      cls: "ffg-group-card-action",
      attr: { "aria-label": "Move down" },
    });
    setIcon(downBtn, "arrow-down");
    if (index === total - 1) downBtn.disabled = true;
    downBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const groups = this.plugin.settings.groups;
      const i = groups.findIndex((g) => g.id === group.id);
      if (i < 0 || i >= groups.length - 1) return;
      [groups[i], groups[i + 1]] = [groups[i + 1], groups[i]];
      await this.plugin.saveSettings();
      this.renderGroups(container);
    });

    const trashBtn = actions.createEl("button", {
      cls: "ffg-group-card-action",
      attr: { "aria-label": "Delete group" },
    });
    setIcon(trashBtn, "trash");
    trashBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      this.plugin.settings.groups = this.plugin.settings.groups.filter(
        (g) => g.id !== group.id
      );
      this.groupExpansionState.delete(group.id);
      await this.plugin.saveSettings();
      this.renderGroups(container);
    });

    const body = card.createDiv("ffg-group-card-body");
    body.style.display = collapsed ? "none" : "";

    head.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("input") || target.closest("button")) return;
      collapsed = !collapsed;
      this.groupExpansionState.set(group.id, collapsed);
      setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
      body.style.display = collapsed ? "none" : "";
    });

    const matchRow = body.createDiv("ffg-group-match-row");
    const matchLeft = matchRow.createDiv("ffg-group-match-left");
    matchLeft.createEl("div", {
      text: "Match by",
      cls: "setting-item-name",
    });
    const matcherSelect = matchLeft.createEl("select", { cls: "dropdown" });
    matcherSelect.createEl("option", { value: "unified", text: "Field list" });
    matcherSelect.createEl("option", { value: "regex", text: "Regex" });
    matcherSelect.value = group.matcherType;
    matcherSelect.addEventListener("change", async () => {
      group.matcherType = matcherSelect.value as StoredGroupConfig["matcherType"];
      await this.plugin.saveSettings();
      this.renderGroups(container);
    });
    const foldSelect = matchRow.createEl("select", { cls: "dropdown" });
    foldSelect.createEl("option", {
      value: "true",
      text: "Folded by default",
    });
    foldSelect.createEl("option", {
      value: "false",
      text: "Expanded by default",
    });
    foldSelect.value = group.defaultFolded ? "true" : "false";
    foldSelect.addEventListener("change", async () => {
      group.defaultFolded = foldSelect.value === "true";
      await this.plugin.saveSettings();
    });

    // When matcher entries change, linked templates need to re-render too
    // (so renamed/added literals flow into their inherited-fields list).
    const onMatcherChange = () => {
      updateSummary();
      if (this.activeTab === "groups") this.rerenderActiveTab();
    };

    if (group.matcherType === "regex") {
      this.renderRegexMatcherSection(body, group);
    } else {
      this.renderUnifiedMatcherSection(body, group, onMatcherChange);
    }

    const linkedFieldsContainer = body.createDiv("ffg-linked-fields-table");
    this.renderLinkedFieldsTable(linkedFieldsContainer, group);
    const refreshLinkedFields = () =>
      this.renderLinkedFieldsTable(linkedFieldsContainer, group);

    this.renderInlineTemplatesSection(body, group, () => {
      updateSummary();
      refreshLinkedFields();
    });
  }

  private renderInlineTemplatesSection(
    card: HTMLElement,
    group: StoredGroupConfig,
    onChange?: () => void
  ) {
    const header = card.createDiv("ffg-field-order-header");
    header.createEl("div", {
      text: "Templates using this group",
      cls: "setting-item-name",
    });
    header.createEl("div", {
      text: "Folder-scoped templates that automatically include this group's fields.",
      cls: "setting-item-description",
    });

    const listContainer = card.createDiv("ffg-inline-templates");
    const render = () => {
      listContainer.empty();
      const linked = this.plugin.settings.folderTemplates.filter(
        (t) => t.group === group.id
      );
      if (linked.length === 0) {
        listContainer.createEl("div", {
          text: "No templates yet.",
          cls: "ffg-inline-templates-empty",
        });
      } else {
        const inGroup = (t: FolderTemplate) => t.group === group.id;
        linked.forEach((tpl, idx) => {
          this.renderTemplateCard(listContainer, tpl, {
            collapsible: true,
            collapsed: true,
            refresh: () => {
              render();
              onChange?.();
            },
            onFieldsChanged: () => onChange?.(),
            reorder: {
              canMoveUp: idx > 0,
              canMoveDown: idx < linked.length - 1,
              onMoveUp: async () => {
                await this.swapTemplateInSection(tpl, -1, inGroup);
                render();
                onChange?.();
              },
              onMoveDown: async () => {
                await this.swapTemplateInSection(tpl, 1, inGroup);
                render();
                onChange?.();
              },
            },
          });
        });
      }

      const addBtn = listContainer.createEl("button", {
        text: "+ Add template",
        cls: "ffg-add-field-btn",
      });
      addBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.plugin.settings.folderTemplates.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          name: "",
          pathPrefixes: [""],
          excludedPathPrefixes: [],
          group: group.id,
          fields: [],
          fieldOrder: [],
          excludedFields: [],
          lintFields: [],
          noGroupFields: [],
        });
        await this.plugin.saveSettings();
        render();
        onChange?.();
      });
    };
    render();
  }

  private renderUnifiedMatcherSection(
    card: HTMLElement,
    group: StoredGroupConfig,
    onChange?: () => void
  ) {
    // Group matcher entries: typically wildcards like `claude_*`, but literal
    // names are also accepted (rare; literals usually come from linked
    // templates' show-in-group rows). Raw entries are preserved as the user
    // types so empty rows can be created and edited.
    const wildcardHeader = card.createDiv("ffg-field-order-header");
    wildcardHeader.createEl("div", {
      text: "Wildcards",
      cls: "setting-item-name",
    });
    wildcardHeader.createEl("div", {
      text: "Pattern entries ending in * (e.g. claude_* sweeps every claude_ field). Plain field names are also accepted as group literals, but you'll usually contribute literals via a linked template's Sort-into-group toggle.",
      cls: "setting-item-description",
    });

    const wildcardContainer = card.createDiv("ffg-field-order-list");
    this.renderFieldOrderList(
      wildcardContainer,
      () => group.matcherValues ?? [],
      async (list) => {
        group.matcherValues = list;
        await this.plugin.saveSettings();
        onChange?.();
      }
    );
  }

  // Read-only table of every field contributed to `group` by its linked
  // templates. Lives in its own container so the parent group card can re-run
  // it whenever a linked template's fields change.
  private renderLinkedFieldsTable(
    container: HTMLElement,
    group: StoredGroupConfig
  ) {
    container.empty();
    const linkedTemplates = this.plugin.settings.folderTemplates.filter(
      (t) => t.group === group.id
    );
    const contributed = getGroupTemplateContributedLiterals(
      group,
      this.plugin.settings.folderTemplates
    );
    if (contributed.length === 0) return;

    const linkedHeader = container.createDiv("ffg-field-order-header");
    linkedHeader.createEl("div", {
      text: "Fields from linked templates",
      cls: "setting-item-name",
    });
    linkedHeader.createEl("div", {
      text: "Alphabetical summary of every field this group covers. Columns are the linked templates; checkmarks indicate the field is contributed by that template. Order in the Properties panel comes from the active file's matching template.",
      cls: "setting-item-description",
    });

    const table = container.createEl("table", {
      cls: "ffg-group-contributed-table",
    });
    const thead = table.createEl("thead").createEl("tr");
    thead.createEl("th", {
      text: "Field",
      cls: "ffg-group-contributed-th-field",
    });
    for (const t of linkedTemplates) {
      thead.createEl("th", {
        text: t.name || "(unnamed)",
        cls: "ffg-group-contributed-th-tpl",
      });
    }
    const tbody = table.createEl("tbody");
    for (const entry of contributed) {
      const row = tbody.createEl("tr");
      row.createEl("td", {
        text: entry.name,
        cls: "ffg-group-contributed-name",
      });
      for (const t of linkedTemplates) {
        const label = t.name || t.id;
        const present = entry.originTemplates.includes(label);
        const cell = row.createEl("td", {
          cls: "ffg-group-contributed-check",
        });
        cell.setText(present ? "✓" : "");
      }
    }
  }

  private renderRegexMatcherSection(
    card: HTMLElement,
    group: StoredGroupConfig
  ) {
    let inputEl: HTMLInputElement | null = null;
    let pillList: HTMLElement | null = null;

    const renderPill = (value: string) => {
      if (!pillList) return;
      const pill = pillList.createDiv("ffg-pill");
      pill.createSpan({ cls: "ffg-pill-text", text: value });
      const remove = pill.createSpan({ cls: "ffg-pill-remove", text: "×" });
      remove.setAttribute("aria-label", `Remove ${value}`);
      remove.setAttribute("role", "button");
      remove.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = group.matcherValues.indexOf(value);
        if (idx >= 0) group.matcherValues.splice(idx, 1);
        pill.remove();
        await this.plugin.saveSettings();
      });
    };

    const commit = async () => {
      if (!inputEl) return;
      const v = inputEl.value.trim();
      inputEl.value = "";
      if (!v) return;
      if (group.matcherValues.includes(v)) return;
      group.matcherValues.push(v);
      renderPill(v);
      await this.plugin.saveSettings();
    };

    new Setting(card)
      .setName("Regex patterns")
      .addText((text) => {
        text.setPlaceholder("Add regex pattern and press Enter");
        inputEl = text.inputEl;
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        });
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("plus")
          .setTooltip("Add pattern")
          .onClick(() => void commit())
      );

    pillList = card.createDiv("ffg-pill-list");
    for (const v of group.matcherValues) renderPill(v);

    const fieldOrderHeader = card.createDiv("ffg-field-order-header");
    fieldOrderHeader.createEl("div", {
      text: "Field order",
      cls: "setting-item-name",
    });
    fieldOrderHeader.createEl("div", {
      text: "Manually order matching fields. Unlisted fields go after.",
      cls: "setting-item-description",
    });

    const fieldOrderContainer = card.createDiv("ffg-field-order-list");
    this.renderFieldOrderList(
      fieldOrderContainer,
      () => group.fieldOrder,
      async (list) => {
        group.fieldOrder = list;
        await this.plugin.saveSettings();
      },
      () => toRuntimeGroup(group, this.plugin.settings.folderTemplates).matcher
    );
  }
}
