/* Foldable Frontmatter Groups - generated bundle. */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FoldableFrontmatterGroupsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
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
      fieldOrder: []
    },
    {
      id: "hidden",
      name: "Hidden Properties",
      matcherType: "unified",
      matcherValues: ["_*"],
      defaultFolded: true,
      fieldOrder: []
    }
  ],
  iconOverrides: [],
  folderTemplates: [],
  cleanupAdHocFields: [],
  globalLintFields: []
};
function orderByFieldOrder(props, fieldOrder) {
  var _a;
  const byKey = /* @__PURE__ */ new Map();
  for (const p of props) byKey.set((_a = p.dataset.propertyKey) != null ? _a : "", p);
  const result = [];
  const seen = /* @__PURE__ */ new Set();
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
function getGroupLiteralFields(g) {
  var _a, _b;
  if (g.matcherType === "regex") return (_a = g.fieldOrder) != null ? _a : [];
  return ((_b = g.matcherValues) != null ? _b : []).filter((v) => v && !v.endsWith("*"));
}
function getGroupTemplateContributedLiterals(g, templates) {
  var _a, _b;
  const map = /* @__PURE__ */ new Map();
  for (const lit of getGroupLiteralFields(g)) {
    if (lit && !map.has(lit)) map.set(lit, []);
  }
  for (const t of templates) {
    if (t.group !== g.id) continue;
    const skip = new Set((_a = t.noGroupFields) != null ? _a : []);
    const label = t.name || t.id;
    for (const f of t.fields) {
      if (!f.name || skip.has(f.name)) continue;
      const arr = (_b = map.get(f.name)) != null ? _b : [];
      if (!arr.includes(label)) arr.push(label);
      map.set(f.name, arr);
    }
  }
  return Array.from(map.entries()).map(([name, originTemplates]) => ({ name, originTemplates })).sort((a, b) => a.name.localeCompare(b.name));
}
function compileGroupMatcher(g) {
  var _a, _b;
  if (g.matcherType === "regex") {
    const regexes = [];
    for (const v of (_a = g.matcherValues) != null ? _a : []) {
      try {
        regexes.push(new RegExp(v));
      } catch (e) {
      }
    }
    if (regexes.length === 0) return null;
    return (key) => regexes.some((re) => re.test(key));
  }
  const prefixes = [];
  for (const v of (_b = g.matcherValues) != null ? _b : []) {
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
function sortTemplatesByGroupingOrder(templates, groups) {
  const groupIndex = new Map(groups.map((g, i) => [g.id, i]));
  const naturalIndex = new Map(templates.map((t, i) => [t.id, i]));
  return [...templates].sort((a, b) => {
    var _a, _b, _c, _d;
    const aSection = a.group ? (_a = groupIndex.get(a.group)) != null ? _a : Number.MAX_SAFE_INTEGER : -1;
    const bSection = b.group ? (_b = groupIndex.get(b.group)) != null ? _b : Number.MAX_SAFE_INTEGER : -1;
    if (aSection !== bSection) return aSection - bSection;
    return ((_c = naturalIndex.get(a.id)) != null ? _c : 0) - ((_d = naturalIndex.get(b.id)) != null ? _d : 0);
  });
}
function toRuntimeGroup(g, templates = []) {
  var _a, _b, _c, _d;
  const values = ((_a = g.matcherValues) != null ? _a : []).filter((v) => v && v.length > 0);
  let nonTemplateMatcher;
  let fieldOrder;
  const templateLiteralOwners = /* @__PURE__ */ new Map();
  for (const t of templates) {
    if (t.group !== g.id) continue;
    const skip = new Set((_b = t.noGroupFields) != null ? _b : []);
    for (const f of t.fields) {
      if (!f.name || skip.has(f.name)) continue;
      const list = (_c = templateLiteralOwners.get(f.name)) != null ? _c : [];
      if (!list.includes(t)) list.push(t);
      templateLiteralOwners.set(f.name, list);
    }
  }
  if (g.matcherType === "regex") {
    const regexes = [];
    for (const v of values) {
      try {
        regexes.push(new RegExp(v));
      } catch (e) {
      }
    }
    nonTemplateMatcher = (key) => regexes.some((re) => re.test(key));
    fieldOrder = [
      ...templateLiteralOwners.keys(),
      ...(_d = g.fieldOrder) != null ? _d : []
    ];
  } else {
    const groupOwnLiterals = /* @__PURE__ */ new Set();
    const prefixes = [];
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
      )
    ];
  }
  const matcher = (key) => nonTemplateMatcher(key) || templateLiteralOwners.has(key);
  return {
    id: g.id,
    name: g.name,
    defaultFolded: g.defaultFolded,
    fieldOrder,
    matcher,
    nonTemplateMatcher,
    templateLiteralOwners
  };
}
var _FoldableFrontmatterGroupsPlugin = class _FoldableFrontmatterGroupsPlugin extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.observer = null;
    this.foldState = /* @__PURE__ */ new WeakMap();
    this.isProcessing = false;
    this.lastActiveFile = null;
    // Cache of vault-wide wildcard expansion per group. Key encodes matcher
    // state so any settings edit that changes matching naturally produces a
    // miss without explicit cleanup. Cleared wholesale on saveSettings and on
    // metadataCache changes (debounced).
    this.wildcardExpansionCache = /* @__PURE__ */ new Map();
    // Single cached scan of every frontmatter key in the vault. All per-group
    // wildcard expansion filters this set instead of re-scanning all files per
    // group (the old hot path cost N full vault scans). Rebuilt on invalidation.
    this.allVaultKeysCache = null;
    // Gates metadataCache "changed" invalidation until the initial vault index
    // has settled. During cold start the cache fires for thousands of files; left
    // ungated it nukes the wildcard cache repeatedly and forces the panel to
    // re-scan the whole vault mid-load (the mobile 3s stall). Flipped true once
    // after layout-ready + first "resolved" (or a safety timer on warm starts).
    this.indexReady = false;
    this.metadataCacheInvalidationTimer = null;
    this.contextMenuBoundContainers = /* @__PURE__ */ new WeakSet();
    // Reference to the settings tab so Properties-panel affordances (e.g. the
    // per-group settings icon) can drive navigation into the settings UI.
    this.settingTab = null;
  }
  async onload() {
    console.log("[FFG] loading v1.4.1");
    await this.loadSettings();
    this.settingTab = new FfgSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.app.workspace.onLayoutReady(() => {
      this.processAllContainers();
      this.lastActiveFile = this.app.workspace.getActiveFile();
      this.installObserver();
      const markReady = () => {
        if (this.indexReady) return;
        this.indexReady = true;
        this.invalidateWildcardCache();
        this.processAllContainers();
      };
      this.registerEvent(this.app.metadataCache.on("resolved", markReady));
      window.setTimeout(markReady, 1e4);
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
          new import_obsidian.Notice("[FFG] No active markdown file");
          return;
        }
        const result = await this.reconcileFrontmatter(file);
        if (result === "rewrote") new import_obsidian.Notice("[FFG] Frontmatter updated");
        else if (result === "noop") new import_obsidian.Notice("[FFG] Already in canonical order");
        else if (result === "no-frontmatter") new import_obsidian.Notice("[FFG] No frontmatter");
        else if (result === "error") new import_obsidian.Notice("[FFG] Error, see console");
      }
    });
    this.addCommand({
      id: "apply-default-frontmatter",
      name: "Apply default frontmatter (active file)",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new import_obsidian.Notice("[FFG] No active markdown file");
          return;
        }
        const result = await this.reconcileFrontmatter(file);
        if (result === "rewrote") new import_obsidian.Notice("[FFG] Frontmatter updated");
        else if (result === "noop") new import_obsidian.Notice("[FFG] No changes needed");
        else if (result === "no-frontmatter") new import_obsidian.Notice("[FFG] No frontmatter");
        else if (result === "error") new import_obsidian.Notice("[FFG] Error, see console");
      }
    });
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "md") {
          if (this.isFileExcludedFromReconcile(file.path)) return;
          void this.applyDefaultsOnCreate(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") return;
        if (this.isFileExcludedFromReconcile(file.path)) return;
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
        window.setTimeout(() => {
          void this.reconcileFrontmatter(file);
        }, 0);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") return;
        if (!this.isFileOpenInAnyLeaf(file)) return;
        const tModify = performance.now();
        const viewSnapshot = /* @__PURE__ */ new Map();
        this.app.workspace.iterateAllLeaves((leaf) => {
          const view = leaf.view;
          if ((view == null ? void 0 : view.file) === file && typeof view.getViewData === "function") {
            viewSnapshot.set(leaf, view.getViewData());
          }
        });
        window.setTimeout(() => {
          void this.checkAndFixStaleView(file, tModify, viewSnapshot);
        }, 500);
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
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
  }
  onunload() {
    var _a;
    console.log("[FFG] unloading");
    (_a = this.observer) == null ? void 0 : _a.disconnect();
    this.observer = null;
    document.querySelectorAll(".metadata-container").forEach((c) => this.deactivate(c));
    document.querySelectorAll(".ffg-settings-gear").forEach((el) => el.remove());
  }
  async loadSettings() {
    var _a, _b, _c, _d, _e, _f;
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
        const legacy = g.matcherValue;
        if (typeof legacy === "string" && legacy.length > 0) {
          g.matcherValues = g.matcherType === "regex" ? [legacy] : legacy.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          g.matcherValues = [];
        }
        delete g.matcherValue;
      }
      const mt = g.matcherType;
      if (mt === "prefix") {
        const literals = (_a = g.fieldOrder) != null ? _a : [];
        const wildcards = ((_b = g.matcherValues) != null ? _b : []).map(
          (v) => v.endsWith("*") ? v : v + "*"
        );
        g.matcherValues = [...literals, ...wildcards];
        g.fieldOrder = [];
        g.matcherType = "unified";
      } else if (mt === "list") {
        const fieldOrder = (_c = g.fieldOrder) != null ? _c : [];
        const matcherValues = (_d = g.matcherValues) != null ? _d : [];
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
    this.settings.reconcileExcludedFiles = this.settings.reconcileExcludedFiles.filter(
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
    this.settings.folderNoteWhitelistFolders = this.settings.folderNoteWhitelistFolders.filter((s) => typeof s === "string" && s.length > 0).map((s) => s.endsWith("/") ? s : s + "/");
    const legacyLintNames = /* @__PURE__ */ new Set();
    const legacyLintRules = this.settings.lintRules;
    if (Array.isArray(legacyLintRules)) {
      for (const r of legacyLintRules) {
        if (typeof (r == null ? void 0 : r.name) === "string" && r.name) legacyLintNames.add(r.name);
      }
    }
    delete this.settings.lintRules;
    const legacyFields = this.settings.fields;
    if (Array.isArray(legacyFields)) {
      for (const f of legacyFields) {
        if (typeof (f == null ? void 0 : f.name) !== "string" || !f.name) continue;
        if (typeof f.icon === "string" && f.icon) {
          if (!this.settings.iconOverrides.some((o) => o.name === f.name)) {
            this.settings.iconOverrides.push({ name: f.name, icon: f.icon });
          }
        }
        if (f.lintRemoveWhenEmpty === true) {
          legacyLintNames.add(f.name);
        }
      }
      delete this.settings.fields;
    }
    for (const o of this.settings.iconOverrides) {
      if (typeof o.name !== "string") o.name = "";
      if (typeof o.icon !== "string") o.icon = "";
    }
    if (!Array.isArray(this.settings.folderTemplates)) {
      this.settings.folderTemplates = [];
    }
    const legacyFD = this.settings.fieldDefaults;
    if (Array.isArray(legacyFD)) {
      for (const fd of legacyFD) {
        const fieldName = typeof (fd == null ? void 0 : fd.fieldName) === "string" ? fd.fieldName : "";
        if (!fieldName || !Array.isArray(fd.folders)) continue;
        for (const folder of fd.folders) {
          const prefix = typeof (folder == null ? void 0 : folder.pathPrefix) === "string" ? folder.pathPrefix : "";
          let tpl = this.settings.folderTemplates.find(
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
              noGroupFields: []
            };
            this.settings.folderTemplates.push(tpl);
          }
          if (!tpl.fields.some((f) => f.name === fieldName)) {
            tpl.fields.push({ name: fieldName, value: folder.value });
          }
        }
      }
      delete this.settings.fieldDefaults;
    }
    for (const t of this.settings.folderTemplates) {
      if (typeof t.id !== "string" || !t.id) {
        t.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      }
      if (typeof t.name !== "string") t.name = "";
      const legacyPrefix = t.pathPrefix;
      if (!Array.isArray(t.pathPrefixes)) {
        t.pathPrefixes = typeof legacyPrefix === "string" ? [legacyPrefix] : [];
      }
      delete t.pathPrefix;
      t.pathPrefixes = t.pathPrefixes.filter((p) => typeof p === "string");
      const legacyLinked = t.linkedGroups;
      if (Array.isArray(legacyLinked)) {
        const first = legacyLinked.find((id) => typeof id === "string" && !!id);
        if (first && !t.group) t.group = first;
        delete t.linkedGroups;
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
    if (legacyLintNames.size > 0) {
      let globalTpl = this.settings.folderTemplates.find(
        (t) => t.pathPrefixes.length === 1 && t.pathPrefixes[0] === "" && !t.group
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
          noGroupFields: []
        };
        this.settings.folderTemplates.push(globalTpl);
      }
      for (const name of legacyLintNames) {
        if (!globalTpl.lintFields.includes(name)) globalTpl.lintFields.push(name);
        if (!globalTpl.excludedFields.includes(name)) {
          globalTpl.excludedFields.push(name);
        }
        if (!globalTpl.fields.some((f) => f.name === name)) {
          globalTpl.fields.push({ name, value: void 0 });
        }
      }
    }
    for (const t of this.settings.folderTemplates) {
      const isGlobal = t.pathPrefixes.length === 1 && t.pathPrefixes[0] === "" && !t.group;
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
          (f) => !(f.name === name && f.value === void 0)
        );
        t.excludedFields = t.excludedFields.filter((n) => n !== name);
      }
    }
    this.settings.folderTemplates = this.settings.folderTemplates.filter((t) => {
      const isGlobal = t.pathPrefixes.length === 1 && t.pathPrefixes[0] === "" && !t.group;
      if (!isGlobal) return true;
      return t.fields.length > 0 || t.excludedFields.length > 0 || t.lintFields.length > 0;
    });
    delete this.settings.defaultRules;
    for (const g of this.settings.groups) {
      if (g.matcherType === "regex") continue;
      const linkedTpls = this.settings.folderTemplates.filter(
        (t) => t.group === g.id
      );
      if (linkedTpls.length === 0) continue;
      const target = linkedTpls[0];
      const literals = ((_e = g.matcherValues) != null ? _e : []).filter(
        (v) => v && !v.endsWith("*")
      );
      if (literals.length === 0) continue;
      for (const name of literals) {
        const present = linkedTpls.some(
          (t) => t.fields.some((f) => f.name === name)
        );
        if (!present) {
          target.fields.push({ name });
        }
      }
      g.matcherValues = ((_f = g.matcherValues) != null ? _f : []).filter(
        (v) => v && v.endsWith("*")
      );
    }
    for (const tpl of this.settings.folderTemplates) {
      for (const name of tpl.lintFields) {
        if (!name) continue;
        if (tpl.fields.some((f) => f.name === name)) continue;
        tpl.fields.push({ name, value: void 0 });
        if (!tpl.excludedFields.includes(name)) {
          tpl.excludedFields.push(name);
        }
      }
    }
  }
  // Shared healer: ensure a template owns a row for any field flagged for
  // cleanup, so the Grouping tab and Cleanup tab stay in sync.
  ensureTemplateOwnsField(tpl, fieldName) {
    if (!fieldName) return;
    if (tpl.fields.some((f) => f.name === fieldName)) return;
    tpl.fields.push({ name: fieldName, value: void 0 });
    if (!tpl.excludedFields.includes(fieldName)) {
      tpl.excludedFields.push(fieldName);
    }
  }
  async saveSettings() {
    this.invalidateWildcardCache();
    await this.saveData(this.settings);
    this.onSettingsChanged();
  }
  onSettingsChanged() {
    this.isProcessing = true;
    try {
      document.querySelectorAll(".metadata-container").forEach((c) => {
        if (c.isConnected) this.processContainer(c);
      });
    } finally {
      this.isProcessing = false;
    }
  }
  get runtimeGroups() {
    const templates = this.settings.folderTemplates;
    return this.settings.groups.map((g) => toRuntimeGroup(g, templates));
  }
  // Cached wildcard expansion for a single group. Walks the vault once per
  // (groupId + matcher signature) and reuses the sorted result until the
  // cache is invalidated.
  cachedWildcardKeys(g) {
    var _a;
    const key = g.id + "|" + g.matcherType + "|" + ((_a = g.matcherValues) != null ? _a : []).join(",");
    let cached = this.wildcardExpansionCache.get(key);
    if (cached) return cached;
    const matches = compileGroupMatcher(g);
    if (!matches) {
      cached = [];
    } else {
      const matched = [];
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
  getAllVaultFrontmatterKeys() {
    var _a;
    if (this.allVaultKeysCache) return this.allVaultKeysCache;
    const keys = /* @__PURE__ */ new Set();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
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
  getGroupEffectiveFieldsCached(g, templates) {
    const contributedLiterals = templates ? getGroupTemplateContributedLiterals(g, templates).map((e) => e.name) : getGroupLiteralFields(g);
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
  invalidateWildcardCache() {
    this.wildcardExpansionCache.clear();
    this.allVaultKeysCache = null;
  }
  // True if this file is on the user's auto-reconcile exclude list, or if the
  // "Auto-exclude folder notes" toggle is on and the file is a folder note
  // (basename equals immediate parent folder's name). Used to hide all
  // frontmatter in the Properties panel and skip defaults insertion, lint
  // scrubbing, canonical-order reorder, and body-template insertion. Manual
  // command invocations still run.
  isFileExcludedFromReconcile(filePath) {
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
  knownFieldsForFile(filePath) {
    const out = /* @__PURE__ */ new Set();
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
  matchGroupForFile(g, key, filePath) {
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
  fileForContainer(container) {
    const leafEl = container.closest(".workspace-leaf");
    if (!leafEl) return this.app.workspace.getActiveFile();
    let found = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const containerEl = leaf.containerEl;
      if (containerEl === leafEl) {
        const view = leaf.view;
        if (view instanceof import_obsidian.MarkdownView && view.file instanceof import_obsidian.TFile) {
          found = view.file;
        }
      }
    });
    return found != null ? found : this.app.workspace.getActiveFile();
  }
  // Ordered name list for a template. Sibling-template inheritance is gone:
  // each template owns its own fields. Wildcard-matched vault keys and any
  // legacy group-only literals still flow in (they aren't owned by any
  // template). Honors tpl.fieldOrder; appends new names at the end.
  templateOrderedFieldNames(tpl) {
    var _a;
    const inheritedNames = /* @__PURE__ */ new Set();
    if (tpl.group) {
      const groupId = tpl.group;
      const group = this.settings.groups.find((g) => g.id === groupId);
      if (group) {
        for (const lit of getGroupLiteralFields(group)) {
          if (lit) inheritedNames.add(lit);
        }
        const wildcardExpanded = this.getGroupEffectiveFieldsCached(group, []);
        const legacyLits = new Set(getGroupLiteralFields(group));
        for (const n of wildcardExpanded) {
          if (n && !legacyLits.has(n)) inheritedNames.add(n);
        }
      }
    }
    const allNames = [];
    const seen = /* @__PURE__ */ new Set();
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
    const ordered = [];
    const placed = /* @__PURE__ */ new Set();
    for (const n of (_a = tpl.fieldOrder) != null ? _a : []) {
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
  perFileGroupOrders(file) {
    var _a;
    const result = /* @__PURE__ */ new Map();
    if (!file) return result;
    const filePath = file.path;
    for (const g of this.settings.groups) {
      let bestTpl = null;
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
      const skip = new Set((_a = bestTpl.noGroupFields) != null ? _a : []);
      const ordered = this.templateOrderedFieldNames(bestTpl).filter(
        (n) => !skip.has(n)
      );
      if (ordered.length > 0) result.set(g.id, ordered);
    }
    return result;
  }
  installObserver() {
    this.observer = new MutationObserver((mutations) => {
      if (this.isProcessing) return;
      const containers = /* @__PURE__ */ new Set();
      for (const m of mutations) {
        const target = m.target;
        if (target.nodeType === Node.ELEMENT_NODE) {
          const el = target;
          const container = el.closest(".metadata-container");
          if (container) containers.add(container);
        }
        m.addedNodes.forEach((node) => {
          var _a, _b;
          if (!(node instanceof HTMLElement)) return;
          if ((_a = node.matches) == null ? void 0 : _a.call(node, ".metadata-container")) containers.add(node);
          (_b = node.querySelectorAll) == null ? void 0 : _b.call(node, ".metadata-container").forEach((c) => containers.add(c));
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
  processAllContainers() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      document.querySelectorAll(".metadata-container").forEach((c) => this.processContainer(c));
    } finally {
      this.isProcessing = false;
    }
  }
  processContainer(container) {
    var _a, _b, _c, _d, _e;
    try {
      this.ensureSettingsGear(container);
      this.ensureAddButtonOrder(container);
      this.ensureContextMenuBinding(container);
      const allProps = Array.from(
        container.querySelectorAll(".metadata-property")
      );
      this.applyIconOverrides(allProps);
      if (!this.settings.groupFoldingEnabled) {
        this.deactivate(container);
        container.classList.remove("ffg-excluded");
        return;
      }
      container.classList.add("ffg-active");
      const fileForPanel = this.fileForContainer(container);
      const excluded = !!fileForPanel && this.isFileExcludedFromReconcile(fileForPanel.path);
      this.applyExcludedHeadingTag(container, excluded);
      if (excluded) {
        container.querySelectorAll(".ffg-group-header").forEach((h) => h.remove());
        for (const p of allProps) {
          this.clearGroupTagging(p);
          p.classList.remove("ffg-property-orphan");
          if (p.style.order) p.style.removeProperty("order");
        }
        container.classList.add("ffg-excluded");
        return;
      }
      container.classList.remove("ffg-excluded");
      const perFileOrders = this.perFileGroupOrders(fileForPanel);
      const groups = this.runtimeGroups.map((g) => {
        const override = perFileOrders.get(g.id);
        if (!override) return g;
        const seen = new Set(override);
        const merged = [
          ...override,
          ...g.fieldOrder.filter((n) => !seen.has(n))
        ];
        return { ...g, fieldOrder: merged };
      });
      let state = this.foldState.get(container);
      if (!state) {
        state = /* @__PURE__ */ new Map();
        this.foldState.set(container, state);
      }
      for (const g of groups) {
        if (!state.has(g.id)) state.set(g.id, g.defaultFolded);
      }
      const topSet = new Set(this.settings.topZone.fieldOrder);
      const bucketByEl = /* @__PURE__ */ new Map();
      const groupMembers = /* @__PURE__ */ new Map();
      for (let i = 0; i < allProps.length; i++) {
        const p = allProps[i];
        const key = (_a = p.dataset.propertyKey) != null ? _a : "";
        if (topSet.has(key)) {
          bucketByEl.set(p, {
            kind: "top",
            index: this.settings.topZone.fieldOrder.indexOf(key)
          });
          continue;
        }
        let matchedGroupId = null;
        for (const g of groups) {
          if (this.matchGroupForFile(g, key, (_b = fileForPanel == null ? void 0 : fileForPanel.path) != null ? _b : null)) {
            matchedGroupId = g.id;
            break;
          }
        }
        if (matchedGroupId) {
          const arr = (_c = groupMembers.get(matchedGroupId)) != null ? _c : [];
          arr.push(p);
          groupMembers.set(matchedGroupId, arr);
        } else {
          bucketByEl.set(p, { kind: "unmatched", fileIndex: i });
        }
      }
      for (const g of groups) {
        const members = (_d = groupMembers.get(g.id)) != null ? _d : [];
        if (members.length === 0) continue;
        const ordered = orderByFieldOrder(members, g.fieldOrder);
        for (let i = 0; i < ordered.length; i++) {
          bucketByEl.set(ordered[i], { kind: "group", groupId: g.id, index: i });
        }
      }
      const knownGroupIds = new Set(groups.map((g) => g.id));
      for (const p of allProps) {
        const b = bucketByEl.get(p);
        if (!b) continue;
        let order;
        if (b.kind === "unmatched") {
          if (!p.classList.contains("ffg-property-orphan")) {
            p.classList.add("ffg-property-orphan");
          }
        } else if (p.classList.contains("ffg-property-orphan")) {
          p.classList.remove("ffg-property-orphan");
        }
        if (b.kind === "top") {
          order = _FoldableFrontmatterGroupsPlugin.TOP_BASE + b.index;
          this.clearGroupTagging(p);
        } else if (b.kind === "unmatched") {
          order = _FoldableFrontmatterGroupsPlugin.UNMATCHED_BASE + b.fileIndex;
          this.clearGroupTagging(p);
        } else {
          const groupIdx = groups.findIndex((g) => g.id === b.groupId);
          order = _FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_BASE + groupIdx * _FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_SIZE + 1 + b.index;
          const folded = (_e = state.get(b.groupId)) != null ? _e : false;
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
  ensureContextMenuBinding(container) {
    if (this.contextMenuBoundContainers.has(container)) return;
    this.contextMenuBoundContainers.add(container);
    container.addEventListener(
      "contextmenu",
      (e) => this.handlePropertyContextMenu(e),
      true
    );
  }
  handlePropertyContextMenu(e) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    if (!this.settings.groupFoldingEnabled) return;
    const target = e.target;
    if (!target) return;
    const propRow = target.closest(
      ".metadata-property"
    );
    if (!propRow) return;
    const key = (_a = propRow.dataset.propertyKey) != null ? _a : "";
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    const menu = new import_obsidian.Menu();
    menu.addItem((item) => {
      item.setTitle(`"${key}"`);
      item.setDisabled(true);
    });
    menu.addSeparator();
    const mtm = this.app.metadataTypeManager;
    if (mtm && typeof mtm.setType === "function") {
      const currentType = (_i = (_h = (_e = (_b = mtm.getAssignedType) == null ? void 0 : _b.call(mtm, key)) != null ? _e : (_d = (_c = mtm.properties) == null ? void 0 : _c[key]) == null ? void 0 : _d.widget) != null ? _h : (_g = (_f = mtm.properties) == null ? void 0 : _f[key]) == null ? void 0 : _g.type) != null ? _i : "text";
      const types = [
        { id: "text", label: "Text", icon: "text" },
        { id: "multitext", label: "List", icon: "list" },
        { id: "number", label: "Number", icon: "binary" },
        { id: "checkbox", label: "Checkbox", icon: "check-square" },
        { id: "date", label: "Date", icon: "calendar" },
        { id: "datetime", label: "Date & time", icon: "clock" }
      ];
      menu.addItem((item) => {
        item.setTitle("Property type");
        item.setIcon("type");
        const sub = item.setSubmenu();
        for (const t of types) {
          sub.addItem((sub2) => {
            sub2.setTitle(t.label);
            sub2.setIcon(t.icon);
            if (currentType === t.id) {
              sub2.setChecked(true);
            }
            sub2.onClick(() => {
              try {
                mtm.setType(key, t.id);
              } catch (err) {
                console.error("[FFG] setType error", err);
              }
            });
          });
        }
      });
      menu.addSeparator();
    }
    menu.addItem((item) => {
      item.setIcon("trash");
      item.setTitle("Remove property");
      item.onClick(async () => {
        const file = this.fileForContainer(propRow.closest(
          ".metadata-container"
        ));
        if (!file) return;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            delete fm[key];
          });
        } catch (err) {
          console.error("[FFG] remove property error", err);
          new import_obsidian.Notice("[FFG] Remove failed, see console");
        }
      });
    });
    menu.addSeparator();
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
              new import_obsidian.Notice(`[FFG] Removed "${key}" from "${label}"`);
            } else {
              tpl.fields.push({ name: key, value: void 0 });
              await this.saveSettings();
              new import_obsidian.Notice(`[FFG] Added "${key}" to "${label}"`);
            }
          });
        });
      }
    }
    menu.showAtMouseEvent(e);
  }
  clearGroupTagging(p) {
    if (p.dataset.ffgGroup) delete p.dataset.ffgGroup;
    if (p.dataset.ffgFolded) delete p.dataset.ffgFolded;
  }
  ensureGroupHeaders(container, groups, members, state, knownGroupIds) {
    var _a, _b;
    const propParent = this.findPropParent(container);
    if (!propParent) return;
    const existing = /* @__PURE__ */ new Map();
    propParent.querySelectorAll(":scope > .ffg-group-header").forEach((h) => {
      const id = h.dataset.groupId;
      if (id) existing.set(id, h);
    });
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      const memberList = (_a = members.get(g.id)) != null ? _a : [];
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
      const order = _FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_BASE + k * _FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_SIZE;
      const orderStr = String(order);
      if (header.style.order !== orderStr) header.style.order = orderStr;
      const folded = (_b = state.get(g.id)) != null ? _b : g.defaultFolded;
      const foldVal = folded ? "true" : "false";
      if (header.dataset.folded !== foldVal) header.dataset.folded = foldVal;
      const chevron = header.querySelector(".ffg-chevron");
      if (chevron) {
        const expected = folded ? "chevron-right" : "chevron-down";
        if (chevron.dataset.iconState !== expected) {
          (0, import_obsidian.setIcon)(chevron, expected);
          chevron.dataset.iconState = expected;
        }
      }
      const nameEl = header.querySelector(".ffg-name");
      if (nameEl && nameEl.textContent !== g.name) nameEl.textContent = g.name;
      const countEl = header.querySelector(".ffg-count");
      if (countEl) {
        const text = `(${memberList.length})`;
        if (countEl.textContent !== text) countEl.textContent = text;
      }
    }
    for (const [id, header] of existing) {
      if (!knownGroupIds.has(id)) header.remove();
    }
  }
  findPropParent(container) {
    var _a;
    const firstProp = container.querySelector(".metadata-property");
    return (_a = firstProp == null ? void 0 : firstProp.parentElement) != null ? _a : null;
  }
  createGroupHeader(g, container) {
    const header = document.createElement("div");
    header.className = "ffg-group-header";
    header.dataset.groupId = g.id;
    const chevron = document.createElement("span");
    chevron.className = "ffg-chevron";
    (0, import_obsidian.setIcon)(chevron, "chevron-right");
    chevron.dataset.iconState = "chevron-right";
    const name = document.createElement("span");
    name.className = "ffg-name";
    name.textContent = g.name;
    const count = document.createElement("span");
    count.className = "ffg-count";
    count.textContent = "(0)";
    const settingsBtn = document.createElement("span");
    settingsBtn.className = "ffg-group-settings";
    settingsBtn.setAttribute("role", "button");
    settingsBtn.setAttribute("aria-label", `${g.name} settings`);
    (0, import_obsidian.setIcon)(settingsBtn, "settings-2");
    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);
    header.appendChild(settingsBtn);
    const blockBubbling = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    header.addEventListener("mousedown", blockBubbling, true);
    header.addEventListener("mouseup", blockBubbling, true);
    const blockBubblingHard = (e) => {
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
        if (event.target.closest(".ffg-group-settings")) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.toggleGroupFold(container, g.id);
      },
      true
    );
    return header;
  }
  toggleGroupFold(container, groupId) {
    const state = this.foldState.get(container);
    if (!state) return;
    const newFolded = !state.get(groupId);
    state.set(groupId, newFolded);
    this.isProcessing = true;
    try {
      const foldVal = newFolded ? "true" : "false";
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(groupId) : groupId;
      container.querySelectorAll(
        `.metadata-property[data-ffg-group="${escaped}"]`
      ).forEach((p) => {
        if (p.dataset.ffgFolded !== foldVal) p.dataset.ffgFolded = foldVal;
      });
      const header = container.querySelector(
        `.ffg-group-header[data-group-id="${escaped}"]`
      );
      if (header) {
        if (header.dataset.folded !== foldVal) header.dataset.folded = foldVal;
        const chevron = header.querySelector(".ffg-chevron");
        if (chevron) {
          const expected = newFolded ? "chevron-right" : "chevron-down";
          (0, import_obsidian.setIcon)(chevron, expected);
          chevron.dataset.iconState = expected;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
  applyIconOverrides(props) {
    var _a;
    if (props.length === 0) return;
    const iconByKey = /* @__PURE__ */ new Map();
    for (const o of this.settings.iconOverrides) {
      if (o.name && o.icon) iconByKey.set(o.name, o.icon);
    }
    for (const p of props) {
      const key = (_a = p.dataset.propertyKey) != null ? _a : "";
      const iconEl = p.querySelector(".metadata-property-icon");
      if (!iconEl) continue;
      const desired = iconByKey.get(key);
      if (desired) {
        if (iconEl.dataset.ffgIcon !== desired) {
          (0, import_obsidian.setIcon)(iconEl, desired);
          iconEl.dataset.ffgIcon = desired;
        }
      } else if (iconEl.dataset.ffgIcon) {
        delete iconEl.dataset.ffgIcon;
      }
    }
  }
  ensureAddButtonOrder(container) {
    const addBtn = container.querySelector(".metadata-add-button");
    if (!addBtn) return;
    const orderStr = String(_FoldableFrontmatterGroupsPlugin.ADD_BUTTON_ORDER);
    if (addBtn.style.order !== orderStr) addBtn.style.order = orderStr;
  }
  // Find the "Properties" heading associated with this container (may be a
  // descendant OR a previous sibling depending on Obsidian's view layout) and
  // toggle a class on it so CSS can hide it for excluded files.
  applyExcludedHeadingTag(container, excluded) {
    const headings = /* @__PURE__ */ new Set();
    container.querySelectorAll(".metadata-properties-heading").forEach((h) => headings.add(h));
    let cursor = container;
    for (let depth = 0; depth < 3 && cursor; depth++) {
      let sib = cursor.previousElementSibling;
      while (sib) {
        if (sib instanceof HTMLElement) {
          if (sib.classList.contains("metadata-properties-heading")) {
            headings.add(sib);
            break;
          }
          const nested = sib.querySelector(
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
  deactivate(container) {
    container.classList.remove("ffg-active");
    container.classList.remove("ffg-excluded");
    this.applyExcludedHeadingTag(container, false);
    container.querySelectorAll(".ffg-group-header").forEach((h) => h.remove());
    container.querySelectorAll(".metadata-property").forEach((p) => {
      this.clearGroupTagging(p);
      p.classList.remove("ffg-property-orphan");
      if (p.style.order) p.style.removeProperty("order");
    });
    const addBtn = container.querySelector(".metadata-add-button");
    if (addBtn == null ? void 0 : addBtn.style.order) addBtn.style.removeProperty("order");
  }
  ensureSettingsGear(container) {
    const addBtn = container.querySelector(".metadata-add-button");
    if (!addBtn) return;
    if (addBtn.querySelector(".ffg-panel-actions")) return;
    const stopAll = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const actions = document.createElement("div");
    actions.className = "ffg-panel-actions";
    const refresh = document.createElement("div");
    refresh.className = "ffg-settings-gear ffg-settings-refresh";
    refresh.setAttribute("aria-label", "Reconcile and reload this file from disk");
    refresh.setAttribute("role", "button");
    (0, import_obsidian.setIcon)(refresh, "refresh-cw");
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
    (0, import_obsidian.setIcon)(gear, "settings");
    gear.addEventListener("mousedown", stopAll, true);
    gear.addEventListener("mouseup", stopAll, true);
    gear.addEventListener(
      "click",
      (e) => {
        stopAll(e);
        const setting = this.app.setting;
        if ((setting == null ? void 0 : setting.open) && (setting == null ? void 0 : setting.openTabById)) {
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
  async refreshFileFromPanel(container) {
    const file = this.fileForContainer(container);
    if (!file || file.extension !== "md") {
      new import_obsidian.Notice("[FFG] No file for this panel");
      return;
    }
    const result = await this.reconcileFrontmatter(file);
    this.invalidateWildcardCache();
    this.processAllContainers();
    const bodyReloaded = await this.reloadOpenViewsFromDisk(file);
    this.markRefreshButtonStale(file, false);
    if (bodyReloaded) new import_obsidian.Notice("[FFG] Reloaded from disk");
    else if (result === "rewrote") new import_obsidian.Notice("[FFG] Frontmatter updated");
    else if (result === "noop") new import_obsidian.Notice("[FFG] Already up to date");
    else if (result === "no-frontmatter") new import_obsidian.Notice("[FFG] No frontmatter");
    else if (result === "error") new import_obsidian.Notice("[FFG] Error, see console");
  }
  // Pull the latest content from disk into any open view showing this file,
  // when the view's content has diverged from disk (the "stale open file"
  // case where Obsidian missed an external modify). Uses setViewData (the
  // load path), preserving cursor/scroll. Discards any unsaved buffer for
  // this file by design — this is a deliberate "reload from disk" action.
  async reloadOpenViewsFromDisk(file) {
    let reloaded = false;
    let disk;
    try {
      disk = await this.app.vault.read(file);
    } catch (e) {
      console.error("[FFG] reloadOpenViewsFromDisk read error", file.path, e);
      return false;
    }
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!view || view.file !== file || typeof view.getViewData !== "function" || typeof view.setViewData !== "function") {
        return;
      }
      if (view.getViewData() === disk) return;
      const eState = typeof view.getEphemeralState === "function" ? view.getEphemeralState() : null;
      view.setViewData(disk, false);
      if (eState && typeof view.setEphemeralState === "function") {
        view.setEphemeralState(eState);
      }
      reloaded = true;
    });
    return reloaded;
  }
  // True if the file is currently shown in any open leaf.
  isFileOpenInAnyLeaf(file) {
    let open = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view && view.file === file) open = true;
    });
    return open;
  }
  // After an external modify of an open file, check whether the view's
  // content diverges from disk. If stale, reload from disk (Obsidian
  // sometimes misses the notify for external writes). Discards any unsaved
  // buffer by design — disk wins.
  async checkAndFixStaleView(file, tModify, viewSnapshot) {
    let disk;
    try {
      disk = await this.app.vault.read(file);
    } catch (e) {
      return;
    }
    let staleDetected = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      var _a, _b;
      const view = leaf.view;
      if (!view || view.file !== file || typeof view.getViewData !== "function") {
        return;
      }
      const shown = view.getViewData();
      if (shown === disk) return;
      const snapshot = viewSnapshot.get(leaf);
      if (snapshot !== void 0 && shown !== snapshot) return;
      console.warn("[FFG] stale view detected after external modify", {
        path: file.path,
        diskLen: disk.length,
        shownLen: shown.length,
        msSinceModify: Math.round(performance.now() - tModify),
        activeFile: (_b = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : null
      });
      staleDetected = true;
    });
    if (staleDetected) {
      this.markRefreshButtonStale(file, true);
    }
  }
  // Highlight (or clear) the refresh button for all open panels showing this
  // file, signalling that the view may be out of date with disk.
  markRefreshButtonStale(file, stale) {
    document.querySelectorAll(".ffg-settings-refresh").forEach((btn) => {
      const container = btn.closest(".metadata-container");
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
  openGroupSettings(groupId, container) {
    const setting = this.app.setting;
    if (!(setting == null ? void 0 : setting.open) || !(setting == null ? void 0 : setting.openTabById)) return;
    let templateId = null;
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
    window.setTimeout(
      () => {
        var _a;
        return (_a = this.settingTab) == null ? void 0 : _a.revealGroup(groupId, templateId);
      },
      0
    );
  }
  // ── Canonical order + reconcile ─────────────────────────────────────────────
  computeCanonicalOrder(keys, filePath = null) {
    const groups = this.runtimeGroups;
    const topSet = new Set(this.settings.topZone.fieldOrder);
    const bucket = /* @__PURE__ */ new Map();
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
    const result = [];
    for (const k of this.settings.topZone.fieldOrder) {
      if (bucket.get(k) === "top") result.push(k);
    }
    for (const k of keys) {
      if (bucket.get(k) === "unmatched") result.push(k);
    }
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
  isEmptyValue(value) {
    if (value === null || value === void 0) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return true;
    return false;
  }
  // Stricter check used by lint pass and bulk-scrub: only literal null/undefined.
  // Empty strings / arrays / objects are user-meaningful and preserved.
  isNullValue(value) {
    return value === null || value === void 0;
  }
  // Resolve a template's match against a file path. Returns the longest
  // include-prefix length if the file matches, or -1 if no include matches
  // OR if any exclude prefix matches. Empty/"*" prefixes count as global.
  templateMatchScore(tpl, filePath) {
    var _a;
    for (const prefix of (_a = tpl.excludedPathPrefixes) != null ? _a : []) {
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
  computeDefaultsForFile(filePath) {
    const hits = /* @__PURE__ */ new Map();
    this.settings.folderTemplates.forEach((tpl, order) => {
      const bestLen = this.templateMatchScore(tpl, filePath);
      if (bestLen < 0) return;
      const effective = /* @__PURE__ */ new Map();
      if (tpl.group) {
        const group = this.settings.groups.find((g) => g.id === tpl.group);
        if (group) {
          const source = this.getGroupEffectiveFieldsCached(group, []);
          for (const name of source) {
            if (name && !effective.has(name)) effective.set(name, void 0);
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
        if (!prior || bestLen > prior.len || bestLen === prior.len && order > prior.order) {
          hits.set(name, { len: bestLen, order, value });
        }
      }
    });
    const result = /* @__PURE__ */ new Map();
    for (const [name, hit] of hits) result.set(name, hit.value);
    return result;
  }
  // Returns the union of lintFields[] across (a) every globalLintFields name
  // and (b) any template's lintFields whose path matches the file.
  computeLintFieldsForFile(filePath) {
    const result = /* @__PURE__ */ new Set();
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
  resolveSeedValue(value) {
    if (value === "<today>") {
      const d = /* @__PURE__ */ new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    if (value === "<now>") {
      const d = /* @__PURE__ */ new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${day}T${hh}:${mm}`;
    }
    return value;
  }
  applyDefaultsToFm(fm, defaults) {
    let mutated = false;
    for (const [key, value] of defaults) {
      const hasKey = Object.prototype.hasOwnProperty.call(fm, key);
      if (hasKey && !this.isEmptyValue(fm[key])) continue;
      const resolved = this.resolveSeedValue(value);
      fm[key] = resolved === void 0 ? null : resolved;
      mutated = true;
    }
    return mutated;
  }
  async applyDefaultsOnCreate(file) {
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
  }
  // Longest matching prefix among any folderTemplate; ties broken by settings order
  // (later entries override earlier when prefix length is equal).
  computeBodyTemplateForFile(filePath) {
    let bestLen = -1;
    let bestPath = null;
    this.settings.folderTemplates.forEach((tpl) => {
      var _a;
      if (!tpl.bodyTemplatePath) return;
      const len = this.templateMatchScore(tpl, filePath);
      if (len < 0) return;
      if (len >= bestLen) {
        bestLen = len;
        bestPath = (_a = tpl.bodyTemplatePath) != null ? _a : null;
      }
    });
    return bestPath;
  }
  // Splits a file's text into [frontmatterBlock, body]. The frontmatter block,
  // if present, includes the leading and trailing `---` lines plus the trailing newline.
  splitFrontmatter(text) {
    if (!text.startsWith("---")) return { fm: "", body: text };
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
  async maybeInsertBodyTemplate(file) {
    if (file.extension !== "md") return;
    const templatePath = this.computeBodyTemplateForFile(file.path);
    if (!templatePath) return;
    try {
      const current = await this.app.vault.read(file);
      const { fm, body } = this.splitFrontmatter(current);
      if (body.trim().length > 0) return;
      const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
      if (!(templateFile instanceof import_obsidian.TFile)) {
        new import_obsidian.Notice(`[FFG] Body template not found: ${templatePath}`);
        return;
      }
      const templateText = await this.app.vault.read(templateFile);
      const { body: templateBody } = this.splitFrontmatter(templateText);
      const insertion = templateBody.length === 0 ? templateText : templateBody;
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
  async maybeParseTemplaterInFile(file) {
    var _a, _b;
    const plugins = this.app.plugins;
    const templaterPlugin = (_a = plugins == null ? void 0 : plugins.plugins) == null ? void 0 : _a["templater-obsidian"];
    const fn = (_b = templaterPlugin == null ? void 0 : templaterPlugin.templater) == null ? void 0 : _b.overwrite_file_commands;
    if (typeof fn !== "function") return;
    try {
      await fn.call(templaterPlugin.templater, file, false);
    } catch (e) {
      console.warn("[FFG] Templater parse failed; left raw", file.path, e);
    }
  }
  // ── Scrub log ────────────────────────────────────────────────────────────
  get scrubLogPath() {
    var _a;
    const dir = (_a = this.manifest.dir) != null ? _a : `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return `${dir}/scrub-log.json`;
  }
  async readScrubLog() {
    try {
      const exists = await this.app.vault.adapter.exists(this.scrubLogPath);
      if (!exists) return [];
      const raw = await this.app.vault.adapter.read(this.scrubLogPath);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("[FFG] readScrubLog error", e);
      return [];
    }
  }
  async appendScrubLog(entry) {
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
  templatesActiveForField(field, groupEffectiveCache) {
    var _a;
    const total = [];
    const withCleanup = [];
    for (const tpl of this.settings.folderTemplates) {
      let active = false;
      const hasLint = tpl.lintFields.includes(field);
      if (hasLint) {
        active = true;
      } else if (((_a = tpl.excludedFields) != null ? _a : []).includes(field)) {
        active = false;
      } else if (tpl.fields.some((f) => f.name === field)) {
        active = true;
      } else if (tpl.group) {
        let effective;
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
  lintFlaggedFieldsFromTemplates() {
    const result = /* @__PURE__ */ new Map();
    for (const tpl of this.settings.folderTemplates) {
      for (const name of tpl.lintFields) {
        if (!name) continue;
        let set = result.get(name);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          result.set(name, set);
        }
        set.add(tpl.name || "(unnamed template)");
      }
    }
    return result;
  }
  // True if `filePath` is under `scope`. Empty scope = whole vault.
  fileInScope(filePath, scope) {
    if (!scope) return true;
    if (scope === "*") return true;
    if (filePath === scope) return true;
    const s = scope.endsWith("/") ? scope : scope + "/";
    return filePath.startsWith(s);
  }
  // Count null and total occurrences of `fieldName` within `scope`.
  // `coveredNullCount` = nulls in files matched by a template that owns the
  // field. The delta (nullCount - coveredNullCount) is orphan nulls sitting in
  // notes where no template in this group covers the field.
  async countFieldInScope(fieldName, scope) {
    var _a;
    const activeTpls = this.templatesActiveForField(fieldName).total;
    let nullCount = 0;
    let totalCount = 0;
    let coveredNullCount = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
      if (!fm) continue;
      if (!Object.prototype.hasOwnProperty.call(fm, fieldName)) continue;
      totalCount++;
      if (this.isNullValue(fm[fieldName])) {
        nullCount++;
        if (activeTpls.some((tpl) => this.templateMatchScore(tpl, file.path) >= 0)) {
          coveredNullCount++;
        }
      }
    }
    return { nullCount, totalCount, coveredNullCount };
  }
  // For inspection: every file in scope that has `fieldName` set, with the
  // raw value. `covered` = the note sits in a folder matched by a template
  // that owns this field. Uncovered notes are orphans relative to the
  // grouping/cleanup system.
  collectFieldOccurrencesInScope(fieldName, scope) {
    var _a;
    const activeTpls = this.templatesActiveForField(fieldName).total;
    const out = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
      if (!fm) continue;
      if (!Object.prototype.hasOwnProperty.call(fm, fieldName)) continue;
      const covered = activeTpls.some(
        (tpl) => this.templateMatchScore(tpl, file.path) >= 0
      );
      out.push({
        file,
        value: fm[fieldName],
        covered,
        isNull: this.isNullValue(fm[fieldName])
      });
    }
    out.sort((a, b) => a.file.path.localeCompare(b.file.path));
    return out;
  }
  // Every distinct frontmatter key across files in `scope`. Filters out
  // Obsidian's internal `position` artifact and keys with empty string names.
  collectFrontmatterKeysInScope(scope) {
    var _a;
    const keys = /* @__PURE__ */ new Set();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
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
  async scrubFieldNullInScope(fieldName, scope) {
    var _a;
    const totalRemoved = [];
    const maxPasses = 3;
    for (let pass = 0; pass < maxPasses; pass++) {
      const passRemoved = [];
      const touchedFiles = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this.fileInScope(file.path, scope)) continue;
        const cached = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
        if (!cached) continue;
        if (!Object.prototype.hasOwnProperty.call(cached, fieldName)) continue;
        if (!this.isNullValue(cached[fieldName])) continue;
        let captured = void 0;
        let didRemove = false;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (Object.prototype.hasOwnProperty.call(fm, fieldName) && this.isNullValue(fm[fieldName])) {
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
        files: totalRemoved
      });
    }
    return totalRemoved.length;
  }
  // Remove EVERY occurrence of `fieldName` within `scope`, including non-null values.
  // Pre-filters via metadataCache to avoid mtime churn. Iterates in passes
  // because the cache can lag/miss for some files; a second pass picks up
  // stragglers once the cache has caught up.
  async scrubFieldAllInScope(fieldName, scope) {
    var _a;
    const totalRemoved = [];
    const maxPasses = 3;
    for (let pass = 0; pass < maxPasses; pass++) {
      const passRemoved = [];
      const touchedFiles = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this.fileInScope(file.path, scope)) continue;
        const cached = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
        if (!cached) continue;
        if (!Object.prototype.hasOwnProperty.call(cached, fieldName)) continue;
        let captured = void 0;
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
        files: totalRemoved
      });
    }
    return totalRemoved.length;
  }
  // After bulk writes, Obsidian's metadataCache lags the disk by some ms.
  // Poll until every touched file's cache reflects the field's removal so
  // the post-scrub rescan reads accurate counts. Bounded by a hard ceiling.
  // Polling is more reliable than the "changed" event under batch load, which
  // can coalesce or drop firings for large operations.
  async waitForFrontmatterCatchUp(files, fieldName) {
    if (files.length === 0) return;
    const stillHasField = (file) => {
      var _a;
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
      if (!fm) return false;
      return Object.prototype.hasOwnProperty.call(fm, fieldName);
    };
    const startedAt = Date.now();
    const ceilingMs = 8e3;
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
  scanFieldMigration(sourceField, targetField, scope) {
    var _a;
    const cleanFiles = [];
    const conflicts = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.fileInScope(file.path, scope)) continue;
      const cached = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
      if (!cached) continue;
      if (!Object.prototype.hasOwnProperty.call(cached, sourceField)) continue;
      const sourceValue = cached[sourceField];
      if (this.isEmptyValue(sourceValue)) continue;
      const hasTarget = Object.prototype.hasOwnProperty.call(
        cached,
        targetField
      );
      const targetValue = hasTarget ? cached[targetField] : void 0;
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
  async applyFieldMigrationToFile(file, sourceField, targetField, resolution) {
    let capturedSource = void 0;
    let capturedTarget = void 0;
    let didWrite = false;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (!Object.prototype.hasOwnProperty.call(fm, sourceField)) return;
        capturedSource = fm[sourceField];
        capturedTarget = Object.prototype.hasOwnProperty.call(fm, targetField) ? fm[targetField] : void 0;
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
            fm[targetField] = capturedSource;
          }
        }
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
  async logFieldMigration(sourceField, targetField, scope, perFile) {
    if (perFile.length === 0) return;
    await this.appendScrubLog({
      ts: Date.now(),
      action: "migrate",
      scope,
      field: sourceField,
      targetField,
      files: perFile.map((p) => ({ path: p.path, value: p.sourceValue })),
      targetValuesBefore: perFile.map((p) => p.targetValueBefore)
    });
  }
  // Plan a settings-side rename so the source field name disappears from
  // plugin configuration alongside the note-side migration. Categorizes each
  // touched location as either a clean update (no value ambiguity, safe to
  // auto-apply) or a decision the user must make (template seed values that
  // diverge). Nothing is applied until the caller invokes apply().
  planSettingsUpdates(sourceField, targetField) {
    var _a, _b;
    const cleanUpdates = [];
    const decisions = [];
    const source = sourceField.trim();
    const target = targetField.trim();
    if (!source || !target || source === target) {
      return { cleanUpdates, decisions };
    }
    const tz = this.settings.topZone.fieldOrder;
    if (tz.includes(source)) {
      const targetPresent = tz.includes(target);
      cleanUpdates.push({
        label: targetPresent ? "Top Level Properties \u2014 remove source (target already present)" : "Top Level Properties \u2014 rename source \u2192 target",
        apply: () => {
          const list = this.settings.topZone.fieldOrder;
          const i = list.indexOf(source);
          if (i < 0) return;
          if (list.includes(target)) list.splice(i, 1);
          else list[i] = target;
        }
      });
    }
    for (const g of this.settings.groups) {
      const mvHas = ((_a = g.matcherValues) != null ? _a : []).includes(source);
      const foHas = ((_b = g.fieldOrder) != null ? _b : []).includes(source);
      if (!mvHas && !foHas) continue;
      cleanUpdates.push({
        label: `Group "${g.name || g.id}" \u2014 rename literal entries (wildcards skipped)`,
        apply: () => {
          var _a2, _b2;
          const renameList = (list) => {
            const out = [];
            for (const v of list) {
              if (v !== source) {
                out.push(v);
                continue;
              }
              if (!out.includes(target)) out.push(target);
            }
            return out;
          };
          g.matcherValues = renameList((_a2 = g.matcherValues) != null ? _a2 : []);
          g.fieldOrder = renameList((_b2 = g.fieldOrder) != null ? _b2 : []);
        }
      });
    }
    for (const t of this.settings.folderTemplates) {
      const tlabel = `Template "${t.name || t.id}"`;
      const srcFieldIdx = t.fields.findIndex((f) => f.name === source);
      const tgtFieldIdx = t.fields.findIndex((f) => f.name === target);
      const inExc = t.excludedFields.includes(source);
      const inLint = t.lintFields.includes(source);
      if (srcFieldIdx >= 0) {
        const srcVal = t.fields[srcFieldIdx].value;
        const tgtVal = tgtFieldIdx >= 0 ? t.fields[tgtFieldIdx].value : void 0;
        const srcHasSeed = !this.isEmptyValue(srcVal);
        const tgtHasEntry = tgtFieldIdx >= 0;
        const tgtHasSeed = tgtHasEntry && !this.isEmptyValue(tgtVal);
        const sameSeed = srcHasSeed && tgtHasSeed && this.seedValuesEqual(srcVal, tgtVal);
        const dropSource = () => {
          const i = t.fields.findIndex((f) => f.name === source);
          if (i >= 0) t.fields.splice(i, 1);
        };
        const setTargetValue = (value) => {
          const i = t.fields.findIndex((f) => f.name === target);
          if (i >= 0) {
            if (value === void 0) {
              t.fields[i] = { name: target };
            } else {
              t.fields[i] = { name: target, value };
            }
          } else {
            t.fields.push(
              value === void 0 ? { name: target } : { name: target, value }
            );
          }
        };
        if (!srcHasSeed || sameSeed) {
          cleanUpdates.push({
            label: tgtHasEntry ? `${tlabel} default value \u2014 remove source (target already present)` : `${tlabel} default value \u2014 rename source \u2192 target`,
            apply: () => {
              if (tgtHasEntry) {
                dropSource();
              } else {
                const i = t.fields.findIndex((f) => f.name === source);
                if (i >= 0) {
                  const value = t.fields[i].value;
                  t.fields[i] = value === void 0 ? { name: target } : { name: target, value };
                }
              }
            }
          });
        } else {
          decisions.push({
            id: `tpl-${t.id}-fields`,
            label: `${tlabel} default value for "${target}"`,
            sourceValue: srcVal,
            targetValue: tgtHasEntry ? tgtVal : void 0,
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
                  setTargetValue(void 0);
                  dropSource();
                }
              }
            }
          });
        }
      }
      if (inExc) {
        const targetPresent = t.excludedFields.includes(target);
        cleanUpdates.push({
          label: targetPresent ? `${tlabel} excluded fields \u2014 remove source (target already present)` : `${tlabel} excluded fields \u2014 rename source \u2192 target`,
          apply: () => {
            t.excludedFields = t.excludedFields.filter((n) => n !== source);
            if (!t.excludedFields.includes(target))
              t.excludedFields.push(target);
          }
        });
      }
      if (inLint) {
        const targetPresent = t.lintFields.includes(target);
        cleanUpdates.push({
          label: targetPresent ? `${tlabel} cleanup-when-empty \u2014 remove source (target already present)` : `${tlabel} cleanup-when-empty \u2014 rename source \u2192 target`,
          apply: () => {
            t.lintFields = t.lintFields.filter((n) => n !== source);
            if (!t.lintFields.includes(target)) t.lintFields.push(target);
          }
        });
      }
    }
    const iconIdx = this.settings.iconOverrides.findIndex(
      (o) => o.name === source
    );
    if (iconIdx >= 0) {
      const targetPresent = this.settings.iconOverrides.findIndex((o) => o.name === target) >= 0;
      cleanUpdates.push({
        label: targetPresent ? "Icon overrides \u2014 remove source (target already present)" : "Icon overrides \u2014 rename source \u2192 target",
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
        }
      });
    }
    if (this.settings.cleanupAdHocFields.includes(source)) {
      cleanUpdates.push({
        label: this.settings.cleanupAdHocFields.includes(target) ? "Cleanup ad-hoc fields \u2014 remove source (target already present)" : "Cleanup ad-hoc fields \u2014 rename source \u2192 target",
        apply: () => {
          this.settings.cleanupAdHocFields = this.settings.cleanupAdHocFields.filter(
            (n) => n !== source
          );
          if (!this.settings.cleanupAdHocFields.includes(target)) {
            this.settings.cleanupAdHocFields.push(target);
          }
        }
      });
    }
    if (this.settings.globalLintFields.includes(source)) {
      cleanUpdates.push({
        label: this.settings.globalLintFields.includes(target) ? "Vault-wide cleanup \u2014 remove source (target already present)" : "Vault-wide cleanup \u2014 rename source \u2192 target",
        apply: () => {
          this.settings.globalLintFields = this.settings.globalLintFields.filter(
            (n) => n !== source
          );
          if (!this.settings.globalLintFields.includes(target)) {
            this.settings.globalLintFields.push(target);
          }
        }
      });
    }
    return { cleanUpdates, decisions };
  }
  seedValuesEqual(a, b) {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
      return false;
    }
  }
  async applySettingsUpdates(plan, decisionChoices) {
    var _a;
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
      const choice = (_a = decisionChoices.get(d.id)) != null ? _a : d.choice;
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
  collectFieldSettingsReferences(fieldName) {
    var _a, _b;
    const hits = [];
    const cleaned = fieldName.trim();
    if (!cleaned) return hits;
    if (this.settings.topZone.fieldOrder.includes(cleaned)) {
      hits.push("Top Level Properties");
    }
    for (const g of this.settings.groups) {
      const inMatchers = ((_a = g.matcherValues) != null ? _a : []).some(
        (v) => v === cleaned || v === cleaned + "*"
      );
      const inFieldOrder = ((_b = g.fieldOrder) != null ? _b : []).includes(cleaned);
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
  async writeMigrationConflictNote(sourceField, targetField, scope, conflicts) {
    const inboxFolder = "_ Inbox _";
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const safeSource = sourceField.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeTarget = targetField.replace(/[^a-zA-Z0-9_-]/g, "_");
    const baseName = `${date} Field Migration Conflicts ${safeSource} to ${safeTarget}`;
    let candidate = `${inboxFolder}/${baseName}.md`;
    let suffix = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${inboxFolder}/${baseName} (${suffix}).md`;
      suffix += 1;
    }
    const renderValue = (v) => {
      if (v === null || v === void 0) return "*(null)*";
      if (typeof v === "string") return v;
      try {
        return "`" + JSON.stringify(v) + "`";
      } catch (e) {
        return String(v);
      }
    };
    const lines = [];
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
    await this.app.vault.create(candidate, lines.join("\n"));
    return candidate;
  }
  async reconcileFrontmatter(file) {
    var _a, _b;
    if (!file || file.extension !== "md") return "skipped";
    try {
      let outcome = "no-frontmatter";
      const defaults = this.computeDefaultsForFile(file.path);
      const lintFieldsSet = this.computeLintFieldsForFile(file.path);
      const cachedFm = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) != null ? _b : null;
      if (cachedFm) {
        const cachedKeys = Object.keys(cachedFm).filter((k) => k !== "position");
        const needsDefault = defaults.size > 0 && Array.from(defaults.keys()).some(
          (k) => !cachedKeys.includes(k) || this.isEmptyValue(cachedFm[k])
        );
        const needsLint = lintFieldsSet.size > 0 && cachedKeys.some((k) => {
          if (!lintFieldsSet.has(k)) return false;
          if (defaults.has(k)) {
            const seed = defaults.get(k);
            if (seed !== void 0 && seed !== null) return false;
          }
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
        if (defaults.size > 0) {
          if (this.applyDefaultsToFm(fm, defaults)) mutated = true;
        }
        if (lintFieldsSet.size > 0) {
          for (const k of Object.keys(fm)) {
            if (k === "position") continue;
            if (!lintFieldsSet.has(k)) continue;
            if (defaults.has(k)) {
              const seed = defaults.get(k);
              if (seed !== void 0 && seed !== null) continue;
            }
            if (this.isNullValue(fm[k])) {
              delete fm[k];
              mutated = true;
            }
          }
        }
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
          const snapshot = {};
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
};
// ── Virtual grouping (CSS-order based; no DOM moves) ───────────────────────
_FoldableFrontmatterGroupsPlugin.TOP_BASE = 0;
_FoldableFrontmatterGroupsPlugin.UNMATCHED_BASE = 1e4;
_FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_BASE = 1e5;
_FoldableFrontmatterGroupsPlugin.GROUP_BLOCK_SIZE = 1e4;
_FoldableFrontmatterGroupsPlugin.ADD_BUTTON_ORDER = 999999;
var FoldableFrontmatterGroupsPlugin = _FoldableFrontmatterGroupsPlugin;
var FrontmatterKeySuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, onAccept, options = {}) {
    var _a;
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    this.commaAware = (_a = options.commaAware) != null ? _a : false;
    this.filterFn = options.filter;
    this.allKeys = this.collectKeys(app);
  }
  collectKeys(app) {
    var _a;
    const set = /* @__PURE__ */ new Set();
    const mtm = app.metadataTypeManager;
    if (mtm == null ? void 0 : mtm.properties) {
      for (const key of Object.keys(mtm.properties)) set.add(key);
    }
    if (set.size === 0) {
      for (const file of app.vault.getMarkdownFiles()) {
        const fm = (_a = app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
        if (!fm) continue;
        for (const key of Object.keys(fm)) {
          if (key !== "position") set.add(key);
        }
      }
    }
    return Array.from(set).sort();
  }
  currentToken() {
    if (!this.commaAware) return this.inputEl.value.trim().toLowerCase();
    const value = this.inputEl.value;
    const lastComma = value.lastIndexOf(",");
    return value.slice(lastComma + 1).trim().toLowerCase();
  }
  getSuggestions(_query) {
    var _a;
    const token = this.currentToken();
    const filter = (_a = this.filterFn) == null ? void 0 : _a.call(this);
    let keys = this.allKeys;
    if (filter) keys = keys.filter(filter);
    if (token) keys = keys.filter((k) => k.toLowerCase().includes(token));
    return keys.slice(0, 50);
  }
  renderSuggestion(value, el) {
    el.setText(value);
  }
  selectSuggestion(value) {
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
};
function parseSeedValue(raw) {
  if (raw === "") return void 0;
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
function seedValueToString(value) {
  if (value === void 0 || value === null) return "";
  if (typeof value === "string") return value;
  return String(value);
}
var LucideIconSuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, onAccept) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    this.allIcons = (0, import_obsidian.getIconIds)().sort();
  }
  getSuggestions(_query) {
    const token = this.inputEl.value.trim().toLowerCase();
    if (!token) return this.allIcons.slice(0, 50);
    return this.allIcons.filter((id) => id.toLowerCase().includes(token)).slice(0, 50);
  }
  renderSuggestion(value, el) {
    el.addClass("ffg-icon-suggestion");
    const iconEl = el.createSpan({ cls: "ffg-icon-suggestion-icon" });
    (0, import_obsidian.setIcon)(iconEl, value);
    el.createSpan({ cls: "ffg-icon-suggestion-text", text: value });
  }
  selectSuggestion(value) {
    this.inputEl.value = value;
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
};
var PropertyValueSuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, values, onAccept, options = {}) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.values = values;
    this.onAccept = onAccept;
    this.options = options;
  }
  getSuggestions(_query) {
    var _a, _b, _c;
    const token = this.inputEl.value.trim().toLowerCase();
    const exclude = (_c = (_b = (_a = this.options).excludeValues) == null ? void 0 : _b.call(_a)) != null ? _c : /* @__PURE__ */ new Set();
    let values = this.values.filter((v) => !exclude.has(v));
    if (token) values = values.filter((v) => v.toLowerCase().includes(token));
    return values.slice(0, 50);
  }
  renderSuggestion(value, el) {
    el.setText(value);
  }
  selectSuggestion(value) {
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
};
var ConfirmModal = class extends import_obsidian.Modal {
  constructor(app, message, onConfirm) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });
    const row = this.contentEl.createDiv("ffg-modal-buttons");
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const confirm = row.createEl("button", {
      text: "Confirm",
      cls: "mod-warning"
    });
    confirm.addEventListener("click", async () => {
      this.close();
      await this.onConfirm();
    });
  }
};
var MigrationConfirmModal = class extends import_obsidian.Modal {
  constructor(app, scan, onConfirm) {
    super(app);
    this.scan = scan;
    this.onConfirm = onConfirm;
    this.decisionChoices = /* @__PURE__ */ new Map();
    this.applySettings = false;
    for (const d of scan.settingsPlan.decisions) {
      this.decisionChoices.set(d.id, d.choice);
    }
    const filesTotal = scan.cleanFiles.length + scan.conflicts.length;
    const settingsTotal = scan.settingsPlan.cleanUpdates.length + scan.settingsPlan.decisions.length;
    if (filesTotal === 0 && settingsTotal > 0) {
      this.applySettings = true;
    }
  }
  onOpen() {
    this.contentEl.empty();
    const filesTotal = this.scan.cleanFiles.length + this.scan.conflicts.length;
    const settingsOnly = filesTotal === 0;
    this.contentEl.createEl("h2", {
      text: settingsOnly ? "Clean up settings references" : "Migrate field"
    });
    this.contentEl.createEl("p", {
      text: settingsOnly ? `No notes in ${this.scan.scope ? `\`${this.scan.scope}\`` : "the whole vault"} carry \`${this.scan.sourceField}\`, but plugin settings still reference it. Rename to \`${this.scan.targetField}\` in settings only.` : `Move values from \`${this.scan.sourceField}\` to \`${this.scan.targetField}\` in ${this.scan.scope ? `\`${this.scan.scope}\`` : "the whole vault"}, then delete the source field.`
    });
    if (!settingsOnly) {
      const list = this.contentEl.createEl("ul");
      list.createEl("li", {
        text: `${this.scan.cleanFiles.length} file(s) will migrate automatically (target was empty or absent).`
      });
      if (this.scan.conflicts.length >= 6) {
        list.createEl("li", {
          text: `${this.scan.conflicts.length} conflict(s) will be written to a checklist note in _ Inbox _/ for manual resolution.`
        });
      } else if (this.scan.conflicts.length > 0) {
        list.createEl("li", {
          text: `${this.scan.conflicts.length} conflict(s) will be resolved one at a time in a follow-up dialog.`
        });
      }
    }
    const settingsTotal = this.scan.settingsPlan.cleanUpdates.length + this.scan.settingsPlan.decisions.length;
    if (settingsTotal > 0) {
      const sweepWrap = this.contentEl.createDiv("ffg-migrate-sweep");
      const checkRow = sweepWrap.createDiv("ffg-migrate-sweep-check");
      const checkbox = checkRow.createEl("input", {
        type: "checkbox"
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
            cls: "ffg-migrate-sweep-section"
          });
          const ul = detailWrap.createEl("ul");
          for (const u of this.scan.settingsPlan.cleanUpdates) {
            ul.createEl("li", { text: u.label });
          }
        }
        if (this.scan.settingsPlan.decisions.length > 0) {
          detailWrap.createEl("div", {
            text: "Decisions required",
            cls: "ffg-migrate-sweep-section ffg-migrate-sweep-decisions"
          });
          for (const d of this.scan.settingsPlan.decisions) {
            const row2 = detailWrap.createDiv("ffg-migrate-decision");
            row2.createEl("div", {
              text: d.label,
              cls: "ffg-migrate-decision-label"
            });
            const values = row2.createDiv("ffg-migrate-decision-values");
            values.createEl("div", {
              text: `source: ${this.renderValue(d.sourceValue)}`
            });
            values.createEl("div", {
              text: d.targetHadEntry ? `target: ${this.renderValue(d.targetValue)}` : "target: (no entry \u2014 would gain source's seed)"
            });
            const choices = row2.createDiv("ffg-migrate-decision-choices");
            const name = `ffg-decision-${d.id}`;
            const mkRadio = (value, labelText) => {
              var _a;
              const wrap = choices.createEl("label", {
                cls: "ffg-migrate-radio"
              });
              const input = wrap.createEl("input", { type: "radio" });
              input.name = name;
              input.value = value;
              input.checked = ((_a = this.decisionChoices.get(d.id)) != null ? _a : d.choice) === value;
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
      cls: "mod-cta"
    });
    confirm.addEventListener("click", async () => {
      this.close();
      await this.onConfirm({
        applySettings: this.applySettings,
        decisionChoices: this.decisionChoices
      });
    });
  }
  renderValue(v) {
    if (v === void 0) return "(no seed)";
    if (v === null) return "(null)";
    if (typeof v === "string") return v.length === 0 ? "(empty string)" : v;
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
};
var ReconcileExcludeModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    this.contentEl.empty();
    this.titleEl.setText("Auto-reconcile exclude list");
    this.contentEl.createEl("p", {
      text: "Files listed here have all frontmatter hidden in the Properties panel and are skipped by auto-reconcile (file-open, file-leave, create, and rename triggers). Manual reconcile commands still operate on them.",
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(this.contentEl).setName("Auto-exclude folder notes").setDesc(
      "Treat any file whose name matches its parent folder (e.g. 'Projects/Projects.md') as if it were on this list. No need to add them individually."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.excludeFolderNotes).onChange(async (value) => {
        this.plugin.settings.excludeFolderNotes = value;
        await this.plugin.saveSettings();
      })
    );
    this.contentEl.createEl("h4", {
      text: "Whitelist notes",
      cls: "ffg-exclude-section-heading"
    });
    this.contentEl.createEl("p", {
      text: "Folder notes added here show frontmatter and participate in auto-reconcile normally, even when the auto-exclude toggle is on.",
      cls: "setting-item-description"
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
        folderNotesOnly: true
      }
    );
    this.contentEl.createEl("h4", {
      text: "Whitelist folders",
      cls: "ffg-exclude-section-heading"
    });
    this.contentEl.createEl("p", {
      text: "Any folder note inside one of these folders (at any depth) is whitelisted. Paths are vault-relative, e.g. 'Claude/Skills/'.",
      cls: "setting-item-description"
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
        suggester: "folder"
      }
    );
    this.contentEl.createEl("h4", {
      text: "Manually excluded files",
      cls: "ffg-exclude-section-heading"
    });
    this.contentEl.createEl("p", {
      text: "Add any specific files (folder notes or not) you want excluded.",
      cls: "setting-item-description"
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
        suggester: "file"
      }
    );
    const footer = this.contentEl.createDiv("ffg-modal-buttons");
    const closeBtn = footer.createEl("button", { text: "Done" });
    closeBtn.addEventListener("click", () => this.close());
  }
  // Shared add-input + remove-list widget used by the whitelist (files +
  // folders) and the manual exclude list sections.
  renderPathList(parent, getList, setList, options) {
    const addRow = parent.createDiv("ffg-exclude-add-row");
    const input = addRow.createEl("input", {
      type: "text",
      cls: "ffg-exclude-input",
      attr: { placeholder: options.placeholder }
    });
    const isFolder = options.suggester === "folder";
    const normalize = (raw) => {
      const v = raw.trim();
      if (!v) return "";
      if (!isFolder) return v;
      return v.endsWith("/") ? v : v + "/";
    };
    const list = parent.createDiv("ffg-exclude-list");
    const render = () => {
      list.empty();
      const entries = getList().slice().sort((a, b) => a.localeCompare(b));
      if (entries.length === 0) {
        list.createEl("div", {
          text: options.emptyText,
          cls: "ffg-exclude-empty"
        });
        return;
      }
      for (const path of entries) {
        const row = list.createDiv("ffg-exclude-row");
        const pathLink = row.createEl(isFolder ? "span" : "a", {
          cls: "ffg-exclude-path",
          text: path
        });
        if (!isFolder) {
          pathLink.addEventListener("click", (e) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof import_obsidian.TFile) {
              this.app.workspace.getLeaf("tab").openFile(file);
            }
          });
        }
        const removeBtn = row.createEl("button", {
          cls: "ffg-exclude-remove",
          text: "\xD7",
          attr: { "aria-label": options.removeLabel(path) }
        });
        removeBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await setList(getList().filter((p) => p !== path));
          render();
        });
      }
    };
    const onAccept = async (value) => {
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
        folderNotesOnly: options.folderNotesOnly
      });
    }
    render();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var FieldOccurrencesModal = class extends import_obsidian.Modal {
  constructor(app, fieldName, scopePath, occurrences) {
    super(app);
    this.fieldName = fieldName;
    this.scopePath = scopePath;
    this.occurrences = occurrences;
    this.filter = "all";
  }
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", {
      text: `Field: ${this.fieldName}`
    });
    const scopeLabel = this.scopePath || "whole vault";
    const total = this.occurrences.length;
    const coveredCount = this.occurrences.filter((o) => o.covered).length;
    const uncoveredCount = total - coveredCount;
    const nullCount = this.occurrences.filter((o) => o.isNull).length;
    const uncoveredNullCount = this.occurrences.filter(
      (o) => !o.covered && o.isNull
    ).length;
    const summary = `${total} note${total === 1 ? "" : "s"} in ${scopeLabel} have this field. ${nullCount} null \xB7 ${uncoveredCount} uncovered \xB7 ${uncoveredNullCount} uncovered null.`;
    this.contentEl.createEl("p", {
      text: summary,
      cls: "setting-item-description"
    });
    if (total === 0) {
      this.contentEl.createEl("div", {
        text: "No notes in scope carry this field.",
        cls: "ffg-cleanup-empty"
      });
      return;
    }
    const filterBar = this.contentEl.createDiv("ffg-occurrence-filter");
    const filters = [
      { key: "all", label: "All", count: total },
      { key: "covered", label: "Covered", count: coveredCount },
      { key: "uncovered", label: "Uncovered", count: uncoveredCount }
    ];
    const list = this.contentEl.createDiv("ffg-occurrence-list");
    const filterButtons = /* @__PURE__ */ new Map();
    for (const f of filters) {
      const btn = filterBar.createEl("button", {
        cls: "ffg-occurrence-filter-btn",
        text: `${f.label} (${f.count})`
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
  refreshFilterButtons(buttons) {
    for (const [key, btn] of buttons) {
      btn.toggleClass("is-active", key === this.filter);
    }
  }
  renderList(list) {
    list.empty();
    const filtered = this.occurrences.filter((o) => {
      if (this.filter === "covered") return o.covered;
      if (this.filter === "uncovered") return !o.covered;
      return true;
    });
    if (filtered.length === 0) {
      list.createEl("div", {
        text: `No ${this.filter} entries.`,
        cls: "ffg-cleanup-empty"
      });
      return;
    }
    for (const occ of filtered) {
      const row = list.createDiv("ffg-occurrence-row");
      const head = row.createDiv("ffg-occurrence-head");
      const pathLink = head.createEl("a", {
        cls: "ffg-occurrence-path",
        text: occ.file.path
      });
      pathLink.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.workspace.getLeaf("tab").openFile(occ.file);
      });
      const chips = head.createDiv("ffg-occurrence-chips");
      if (!occ.covered) {
        chips.createEl("span", {
          cls: "ffg-occurrence-chip ffg-occurrence-chip-uncovered",
          text: "uncovered"
        });
      }
      if (occ.isNull) {
        chips.createEl("span", {
          cls: "ffg-occurrence-chip ffg-occurrence-chip-null",
          text: "null"
        });
      }
      const valueEl = row.createEl("div", { cls: "ffg-occurrence-value" });
      valueEl.setText(this.renderValue(occ.value));
    }
  }
  renderValue(v) {
    if (v === null) return "null";
    if (v === void 0) return "(unset)";
    if (typeof v === "string") return v.length === 0 ? '""' : v;
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
};
var ConflictResolutionModal = class extends import_obsidian.Modal {
  constructor(app, conflicts, sourceField, targetField, onDone) {
    super(app);
    this.conflicts = conflicts;
    this.sourceField = sourceField;
    this.targetField = targetField;
    this.onDone = onDone;
    this.decisions = [];
    this.index = 0;
    this.finalized = false;
  }
  onOpen() {
    this.renderCurrent();
  }
  renderCurrent() {
    this.contentEl.empty();
    if (this.index >= this.conflicts.length) {
      this.finalized = true;
      this.close();
      void this.onDone(this.decisions);
      return;
    }
    const current = this.conflicts[this.index];
    this.contentEl.createEl("h2", {
      text: `Conflict ${this.index + 1} of ${this.conflicts.length}`
    });
    this.contentEl.createEl("p", { text: current.file.path });
    const sourceBox = this.contentEl.createDiv("ffg-conflict-value");
    sourceBox.createEl("div", {
      text: `${this.sourceField} (source)`,
      cls: "ffg-conflict-label"
    });
    sourceBox.createEl("pre", {
      text: this.renderValue(current.sourceValue)
    });
    const targetBox = this.contentEl.createDiv("ffg-conflict-value");
    targetBox.createEl("div", {
      text: `${this.targetField} (target)`,
      cls: "ffg-conflict-label"
    });
    targetBox.createEl("pre", {
      text: this.renderValue(current.targetValue)
    });
    const bothLists = Array.isArray(current.sourceValue) && Array.isArray(current.targetValue);
    const row = this.contentEl.createDiv("ffg-modal-buttons");
    const openBtn = row.createEl("button", { text: "Open file" });
    openBtn.addEventListener("click", () => {
      this.app.workspace.getLeaf("tab").openFile(current.file);
    });
    const skip = row.createEl("button", { text: "Skip" });
    skip.addEventListener("click", () => this.decide(current.file, "skip"));
    const useTarget = row.createEl("button", {
      text: `Keep target & delete source`
    });
    useTarget.addEventListener(
      "click",
      () => this.decide(current.file, "use-target")
    );
    if (bothLists) {
      const merge = row.createEl("button", {
        text: "Merge (union)"
      });
      merge.addEventListener(
        "click",
        () => this.decide(current.file, "merge")
      );
    }
    const useSource = row.createEl("button", {
      text: `Use source, overwrite target`,
      cls: "mod-warning"
    });
    useSource.addEventListener(
      "click",
      () => this.decide(current.file, "use-source")
    );
  }
  decide(file, resolution) {
    this.decisions.push({ file, resolution });
    this.index += 1;
    this.renderCurrent();
  }
  renderValue(v) {
    if (v === null || v === void 0) return "(null)";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch (e) {
      return String(v);
    }
  }
  onClose() {
    if (this.finalized) return;
    while (this.index < this.conflicts.length) {
      this.decisions.push({
        file: this.conflicts[this.index].file,
        resolution: "skip"
      });
      this.index += 1;
    }
    this.finalized = true;
    void this.onDone(this.decisions);
  }
};
function openLintScopePopover(plugin, fieldName, anchor, onChange) {
  var _a, _b;
  const doc = (_a = anchor.ownerDocument) != null ? _a : document;
  const win = (_b = doc.defaultView) != null ? _b : window;
  doc.querySelectorAll(".ffg-lint-popover").forEach((el) => el.remove());
  const popover = doc.body.createDiv({ cls: "ffg-lint-popover" });
  const rect = anchor.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.left = `${Math.max(8, rect.left)}px`;
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
  const outsideHandler = (e) => {
    const target = e.target;
    if (popover.contains(target)) return;
    if (anchor.isConnected && anchor.contains(target)) return;
    close();
  };
  const escapeHandler = (e) => {
    if (e.key === "Escape") close();
  };
  popover.createEl("div", {
    cls: "ffg-lint-popover-title",
    text: `Cleanup "${fieldName}" when null`
  });
  const vaultRow = popover.createDiv({ cls: "ffg-lint-popover-row" });
  const vaultCheck = vaultRow.createEl("input", {
    type: "checkbox",
    cls: "ffg-lint-popover-check"
  });
  vaultCheck.checked = plugin.settings.globalLintFields.includes(fieldName);
  vaultRow.createEl("span", {
    text: "Vault-wide",
    cls: "ffg-lint-popover-row-label ffg-lint-popover-vault"
  });
  const templateRows = [];
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
      text: "Templates"
    });
    const orderedTemplates = sortTemplatesByGroupingOrder(
      plugin.settings.folderTemplates,
      plugin.settings.groups
    );
    for (const tpl of orderedTemplates) {
      const tplRow = popover.createDiv({ cls: "ffg-lint-popover-row" });
      const cb = tplRow.createEl("input", {
        type: "checkbox",
        cls: "ffg-lint-popover-check"
      });
      cb.checked = tpl.lintFields.includes(fieldName);
      tplRow.createEl("span", {
        text: tpl.name || "(unnamed template)",
        cls: "ffg-lint-popover-row-label"
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
      text: "No templates defined yet."
    });
  }
  win.setTimeout(() => {
    if (closed) return;
    doc.addEventListener("mousedown", outsideHandler, true);
  }, 0);
  doc.addEventListener("keydown", escapeHandler);
}
var ScrubLogModal = class extends import_obsidian.Modal {
  constructor(app, entries) {
    super(app);
    this.entries = entries;
  }
  onOpen() {
    this.contentEl.empty();
    this.titleEl.setText("Scrub log");
    if (this.entries.length === 0) {
      this.contentEl.createEl("p", {
        text: "No scrubs recorded yet.",
        cls: "ffg-log-empty"
      });
      return;
    }
    this.contentEl.createEl("p", {
      text: "Most recent first. Click an entry to show the file paths and the values that were removed.",
      cls: "ffg-log-desc"
    });
    const sorted = this.entries.slice().sort((a, b) => b.ts - a.ts);
    const exportRow = this.contentEl.createDiv("ffg-log-export-row");
    exportRow.createSpan({
      text: "Export range:",
      cls: "ffg-log-export-label"
    });
    const fromInput = exportRow.createEl("input", {
      type: "date",
      cls: "ffg-log-export-date"
    });
    fromInput.setAttr("aria-label", "From date");
    exportRow.createSpan({ text: "to", cls: "ffg-log-export-sep" });
    const toInput = exportRow.createEl("input", {
      type: "date",
      cls: "ffg-log-export-date"
    });
    toInput.setAttr("aria-label", "To date");
    const dateToIso = (d) => {
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
      cls: "ffg-log-export-btn"
    });
    downloadBtn.addEventListener("click", () => {
      const fromTs = fromInput.value ? (/* @__PURE__ */ new Date(`${fromInput.value}T00:00:00`)).getTime() : 0;
      const toTs = toInput.value ? (/* @__PURE__ */ new Date(`${toInput.value}T23:59:59.999`)).getTime() : Date.now();
      const filtered = this.entries.filter(
        (e) => e.ts >= fromTs && e.ts <= toTs
      );
      if (filtered.length === 0) {
        new import_obsidian.Notice("[FFG] No scrub entries in that range");
        return;
      }
      const blob = new Blob([JSON.stringify(filtered, null, 2)], {
        type: "application/json"
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
      window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
      new import_obsidian.Notice(
        `[FFG] Exported ${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`
      );
    });
    const list = this.contentEl.createDiv("ffg-log-list");
    for (const entry of sorted) {
      this.renderEntry(list, entry);
    }
  }
  renderEntry(parent, entry) {
    const item = parent.createDiv("ffg-log-item");
    const head = item.createDiv("ffg-log-item-head");
    const tsStr = new Date(entry.ts).toLocaleString();
    const actionLabel = entry.action === "remove-null" ? "Removed null" : entry.action === "remove-all" ? "Removed ALL" : "Migrated";
    const scopeLabel = entry.scope || "whole vault";
    head.createSpan({
      cls: "ffg-log-item-time",
      text: tsStr
    });
    head.createSpan({
      cls: "ffg-log-item-action" + (entry.action === "remove-all" ? " ffg-log-item-action-nuke" : ""),
      text: actionLabel
    });
    head.createSpan({
      cls: "ffg-log-item-field",
      text: entry.action === "migrate" && entry.targetField ? `${entry.field} \u2192 ${entry.targetField}` : entry.field
    });
    head.createSpan({
      cls: "ffg-log-item-meta",
      text: `${entry.files.length} file${entry.files.length === 1 ? "" : "s"} \xB7 ${scopeLabel}`
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
              text: ` = ${JSON.stringify(f.value)}`
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
};
var FolderPathSuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, onAccept) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    const folders = [];
    for (const f of app.vault.getAllLoadedFiles()) {
      if (f instanceof import_obsidian.TFolder && f.path && f.path !== "/") {
        folders.push(f.path.endsWith("/") ? f.path : f.path + "/");
      }
    }
    this.allFolders = folders.sort();
  }
  getSuggestions(_query) {
    const token = this.inputEl.value.trim().toLowerCase();
    if (!token) return this.allFolders.slice(0, 50);
    return this.allFolders.filter((p) => p.toLowerCase().includes(token)).slice(0, 50);
  }
  renderSuggestion(value, el) {
    el.setText(value);
  }
  selectSuggestion(value) {
    this.inputEl.value = value;
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
};
function isFolderNotePath(path) {
  const parts = path.split("/");
  if (parts.length < 2) return false;
  const basename = parts[parts.length - 1].replace(/\.md$/i, "");
  const parent = parts[parts.length - 2];
  return basename === parent && basename.length > 0;
}
var MarkdownFilePathSuggest = class extends import_obsidian.AbstractInputSuggest {
  constructor(app, inputEl, onAccept, options = {}) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onAccept = onAccept;
    const files = [];
    const folderNotes = /* @__PURE__ */ new Set();
    for (const f of app.vault.getMarkdownFiles()) {
      const isFN = isFolderNotePath(f.path);
      if (options.folderNotesOnly && !isFN) continue;
      files.push(f.path);
      if (isFN) folderNotes.add(f.path);
    }
    this.allFiles = files.sort((a, b) => {
      const af = folderNotes.has(a);
      const bf = folderNotes.has(b);
      if (af !== bf) return af ? -1 : 1;
      return a.localeCompare(b);
    });
    this.folderNoteSet = folderNotes;
  }
  getSuggestions(_query) {
    const token = this.inputEl.value.trim().toLowerCase();
    if (!token) return this.allFiles.slice(0, 50);
    return this.allFiles.filter((p) => p.toLowerCase().includes(token)).slice(0, 50);
  }
  renderSuggestion(value, el) {
    el.addClass("ffg-md-file-suggestion");
    if (this.folderNoteSet.has(value)) {
      el.addClass("ffg-md-file-suggestion-folder-note");
      el.createEl("span", {
        cls: "ffg-md-file-suggestion-badge",
        text: "MOC"
      });
    }
    el.createEl("span", {
      cls: "ffg-md-file-suggestion-path",
      text: value
    });
  }
  selectSuggestion(value) {
    this.inputEl.value = value;
    this.onAccept(value);
    this.close();
    this.inputEl.focus();
  }
};
var FfgSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.activeTab = "groups";
    this.rerenderActiveTab = () => {
    };
    this.propertyValuesCache = null;
    this.propertiesOrderExpanded = false;
    this.groupExpansionState = /* @__PURE__ */ new Map();
    this.templateExpansionState = /* @__PURE__ */ new Map();
    // When set, display() opens on the Grouping tab with this group expanded,
    // then scrolls it into view and flashes it. Cleared after reveal.
    this.pendingRevealGroupId = null;
    // Optional template within the revealed group to also unfold and focus.
    this.pendingRevealTemplateId = null;
    this.cleanupScope = "";
    this.cleanupSortMode = "abc";
    this.migrateScope = "";
    this.plugin = plugin;
  }
  getPropertyValues(key) {
    var _a, _b;
    if (!key) return [];
    if (!this.propertyValuesCache) {
      const cache = /* @__PURE__ */ new Map();
      for (const file of this.app.vault.getMarkdownFiles()) {
        const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
        if (!fm) continue;
        for (const [k, v] of Object.entries(fm)) {
          if (k === "position") continue;
          let set = cache.get(k);
          if (!set) {
            set = /* @__PURE__ */ new Set();
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
      this.propertyValuesCache = /* @__PURE__ */ new Map();
      for (const [k, set] of cache) {
        this.propertyValuesCache.set(k, Array.from(set).sort());
      }
    }
    return (_b = this.propertyValuesCache.get(key)) != null ? _b : [];
  }
  // Called from the Properties-panel per-group settings icon. Re-renders the
  // whole settings pane (so the tab strip highlight stays correct) with the
  // target group pre-expanded, then scrolls and flashes it.
  revealGroup(groupId, templateId) {
    this.pendingRevealGroupId = groupId;
    this.pendingRevealTemplateId = templateId != null ? templateId : null;
    this.display();
  }
  display() {
    this.propertyValuesCache = null;
    this.propertiesOrderExpanded = false;
    this.groupExpansionState.clear();
    this.templateExpansionState.clear();
    if (this.pendingRevealGroupId) {
      this.activeTab = "groups";
      this.groupExpansionState.set(this.pendingRevealGroupId, false);
      if (this.pendingRevealTemplateId) {
        this.templateExpansionState.set(this.pendingRevealTemplateId, false);
      }
    }
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Enable group folding").setDesc("Show grouped, collapsible sections in the Properties panel.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.groupFoldingEnabled).onChange(async (value) => {
        this.plugin.settings.groupFoldingEnabled = value;
        await this.plugin.saveSettings();
        applyPausedState(value);
      })
    );
    const banner = containerEl.createDiv("ffg-paused-banner");
    banner.textContent = "Group folding is off. The plugin is paused; settings below are preserved but not applied.";
    const pausedZone = containerEl.createDiv("ffg-paused-zone");
    new import_obsidian.Setting(pausedZone).setName("Auto-reconcile frontmatter").setDesc(
      "On file open and file leave: backfill template defaults into empty fields, scrub cleanup-flagged nulls, and reorder keys to match the Properties panel. Off by default."
    ).addExtraButton(
      (btn) => btn.setIcon("file-x").setTooltip("Edit exclude list").onClick(() => {
        new ReconcileExcludeModal(this.app, this.plugin).open();
      })
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.reconcileOnLeave).onChange(async (value) => {
        this.plugin.settings.reconcileOnLeave = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(pausedZone).setName("Scrub orphan nulls").setDesc(
      "During auto-reconcile, also delete any null property no matching template claims."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.scrubOrphanNulls).onChange(async (value) => {
        this.plugin.settings.scrubOrphanNulls = value;
        await this.plugin.saveSettings();
      })
    );
    const tabStrip = pausedZone.createDiv("ffg-tab-strip");
    const tabContent = pausedZone.createDiv("ffg-tab-content");
    const tabs = [
      { id: "groups", label: "Grouping" },
      { id: "fields", label: "Customize Icons" },
      { id: "cleanup", label: "Cleanup" }
    ];
    const renderTabStrip = () => {
      tabStrip.empty();
      for (const tab of tabs) {
        const btn = tabStrip.createEl("button", {
          text: tab.label,
          cls: "ffg-tab-button" + (tab.id === this.activeTab ? " ffg-tab-active" : "")
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
    const applyPausedState = (enabled) => {
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
      const esc = (s) => typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s;
      window.setTimeout(() => {
        const groupCard = this.containerEl.querySelector(
          `.ffg-group-card[data-ffg-group-card="${esc(groupId)}"]`
        );
        const templateCard = templateId ? this.containerEl.querySelector(
          `.ffg-template-card[data-ffg-template-card="${esc(templateId)}"]`
        ) : null;
        const target = templateCard != null ? templateCard : groupCard;
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("ffg-reveal-flash");
        window.setTimeout(() => target.classList.remove("ffg-reveal-flash"), 1600);
      }, 0);
    }
  }
  renderGroupsAndOrderTab(parent) {
    const orderCard = parent.createDiv("ffg-group-card");
    const orderHead = orderCard.createDiv("ffg-group-card-head");
    const orderChevron = orderHead.createSpan({
      cls: "ffg-group-card-chevron"
    });
    (0, import_obsidian.setIcon)(
      orderChevron,
      this.propertiesOrderExpanded ? "chevron-down" : "chevron-right"
    );
    orderHead.createSpan({
      cls: "ffg-group-card-title",
      text: "Top Level Properties"
    });
    const orderSummary = orderHead.createSpan({
      cls: "ffg-group-card-summary",
      text: `${this.plugin.settings.topZone.fieldOrder.length} pinned`
    });
    const orderBody = orderCard.createDiv("ffg-group-card-body");
    orderBody.style.display = this.propertiesOrderExpanded ? "" : "none";
    orderHead.addEventListener("click", (e) => {
      const target = e.target;
      if (target.closest("input") || target.closest("button")) return;
      this.propertiesOrderExpanded = !this.propertiesOrderExpanded;
      (0, import_obsidian.setIcon)(
        orderChevron,
        this.propertiesOrderExpanded ? "chevron-down" : "chevron-right"
      );
      orderBody.style.display = this.propertiesOrderExpanded ? "" : "none";
    });
    orderBody.createEl("p", {
      text: "Properties listed here appear at the top of the Properties panel, in this order. Overrides group matching.",
      cls: "setting-item-description"
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
          (g) => toRuntimeGroup(g, this.plugin.settings.folderTemplates).matcher
        );
        return (key) => !matchers.some((m) => m(key));
      }
    );
    parent.createEl("h3", { text: "Global Templates" });
    parent.createEl("p", {
      text: "Folder-scoped templates that are not linked to a specific group. Group-linked templates live under their group below.",
      cls: "setting-item-description"
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
          cls: "ffg-inline-templates-empty"
        });
      } else {
        const isGlobal = (t) => !t.group;
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
              }
            }
          });
        });
      }
    };
    renderGlobalTemplates();
    new import_obsidian.Setting(parent).addButton(
      (btn) => btn.setButtonText("+ Add global template").onClick(async () => {
        this.plugin.settings.folderTemplates.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          name: "",
          pathPrefixes: [""],
          excludedPathPrefixes: [],
          fields: [],
          fieldOrder: [],
          excludedFields: [],
          lintFields: [],
          noGroupFields: []
        });
        await this.plugin.saveSettings();
        renderGlobalTemplates();
      })
    );
    parent.createEl("h3", { text: "Groups" });
    const groupsContainer = parent.createDiv("ffg-settings-groups");
    this.renderGroups(groupsContainer);
    new import_obsidian.Setting(parent).addButton(
      (btn) => btn.setButtonText("+ Add Group").onClick(async () => {
        const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        this.plugin.settings.groups.push({
          id: newId,
          name: "New Group",
          matcherType: "unified",
          matcherValues: [],
          defaultFolded: true,
          fieldOrder: []
        });
        this.groupExpansionState.set(newId, false);
        await this.plugin.saveSettings();
        this.renderGroups(groupsContainer);
      })
    );
  }
  renderFieldsTab(parent) {
    parent.createEl("h3", { text: "Icon overrides" });
    parent.createEl("p", {
      text: "Replace the Properties panel icon for a given frontmatter key. Pick any Lucide icon. (Vault-wide cleanup rules live on the Cleanup tab; folder-scoped cleanup lives inside templates.)",
      cls: "setting-item-description"
    });
    const iconListContainer = parent.createDiv("ffg-field-config-list");
    this.renderIconOverrideList(iconListContainer);
    new import_obsidian.Setting(parent).addButton(
      (btn) => btn.setButtonText("+ Add icon override").onClick(async () => {
        this.plugin.settings.iconOverrides.push({ name: "", icon: "" });
        await this.plugin.saveSettings();
        this.renderIconOverrideList(iconListContainer);
      })
    );
  }
  renderIconOverrideList(container) {
    container.empty();
    const sorted = this.plugin.settings.iconOverrides.slice().sort(
      (a, b) => (a.name || "\uFFFF").toLowerCase().localeCompare((b.name || "\uFFFF").toLowerCase())
    );
    for (const override of sorted) {
      this.renderIconOverrideRow(container, override);
    }
  }
  renderIconOverrideRow(container, override) {
    const setting = new import_obsidian.Setting(container);
    setting.settingEl.addClass("ffg-field-row");
    setting.infoEl.remove();
    setting.addText((text) => {
      text.setPlaceholder("frontmatter key").setValue(override.name).onChange(async (value) => {
        override.name = value.trim();
        await this.plugin.saveSettings();
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
    if (override.icon) (0, import_obsidian.setIcon)(iconPreview, override.icon);
    const iconInput = iconWrap.createEl("input", {
      type: "text",
      cls: "ffg-icon-input"
    });
    iconInput.placeholder = "icon";
    iconInput.value = override.icon;
    const updateIcon = async (raw) => {
      override.icon = raw.trim();
      iconPreview.empty();
      if (override.icon) (0, import_obsidian.setIcon)(iconPreview, override.icon);
      await this.plugin.saveSettings();
    };
    iconInput.addEventListener("input", () => void updateIcon(iconInput.value));
    new LucideIconSuggest(this.app, iconInput, async (value) => {
      iconInput.value = value;
      await updateIcon(value);
    });
    setting.addExtraButton(
      (btn) => btn.setIcon("trash").setTooltip("Delete override").onClick(async () => {
        this.plugin.settings.iconOverrides = this.plugin.settings.iconOverrides.filter((o) => o !== override);
        await this.plugin.saveSettings();
        this.renderIconOverrideList(container);
      })
    );
  }
  renderCleanupTab(parent) {
    parent.createEl("p", {
      text: "Inspect and clean up frontmatter fields. Choose a scope, then per field: 'Remove null values' deletes only null entries; 'Remove ALL' deletes every occurrence (requires double-confirm).",
      cls: "setting-item-description"
    });
    const scopeRow = parent.createDiv("ffg-cleanup-scope-row");
    scopeRow.createSpan({
      text: "Scope:",
      cls: "ffg-cleanup-label"
    });
    const scopeSelect = scopeRow.createEl("select", {
      cls: "ffg-cleanup-scope-select"
    });
    scopeSelect.createEl("option", { value: "vault", text: "Whole vault" });
    scopeSelect.createEl("option", { value: "folder", text: "Specific folder" });
    scopeSelect.value = this.cleanupScope === "" ? "vault" : "folder";
    const folderInput = scopeRow.createEl("input", {
      type: "text",
      cls: "ffg-cleanup-folder-input"
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
    const sortRow = parent.createDiv("ffg-cleanup-scope-row");
    sortRow.createSpan({
      text: "Sort:",
      cls: "ffg-cleanup-label"
    });
    const sortSelect = sortRow.createEl("select", {
      cls: "ffg-cleanup-scope-select"
    });
    sortSelect.createEl("option", {
      value: "abc",
      text: "Alphabetical (cleanup-enabled first)"
    });
    sortSelect.createEl("option", {
      value: "grouping",
      text: "By grouping order (Top Level \u2192 groups \u2192 unmatched)"
    });
    sortSelect.value = this.cleanupSortMode;
    sortSelect.addEventListener("change", () => {
      this.cleanupSortMode = sortSelect.value === "grouping" ? "grouping" : "abc";
      void refresh();
    });
    const resultsContainer = parent.createDiv("ffg-cleanup-results");
    const addRow = parent.createDiv("ffg-cleanup-add-row");
    addRow.createSpan({
      text: "Add field:",
      cls: "ffg-cleanup-label"
    });
    const addInput = addRow.createEl("input", {
      type: "text",
      cls: "ffg-cleanup-add-input"
    });
    addInput.placeholder = "frontmatter key";
    const commitAdd = async (raw) => {
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
    this.renderMigrateFieldSection(parent);
    const footerRow = parent.createDiv("ffg-cleanup-footer");
    const logBtn = footerRow.createEl("button", {
      text: "View scrub log",
      cls: "ffg-cleanup-log-btn"
    });
    logBtn.addEventListener("click", async () => {
      const entries = await this.plugin.readScrubLog();
      new ScrubLogModal(this.app, entries).open();
    });
    const refresh = async () => {
      resultsContainer.empty();
      resultsContainer.createEl("div", {
        text: "Scanning...",
        cls: "ffg-cleanup-empty"
      });
      try {
        const templateFields = this.plugin.lintFlaggedFieldsFromTemplates();
        const allFields = /* @__PURE__ */ new Set();
        for (const name of templateFields.keys()) allFields.add(name);
        for (const name of this.plugin.settings.cleanupAdHocFields) {
          allFields.add(name);
        }
        for (const name of this.plugin.settings.globalLintFields) {
          allFields.add(name);
        }
        for (const name of this.plugin.collectFrontmatterKeysInScope(
          this.cleanupScope
        )) {
          allFields.add(name);
        }
        const counts = /* @__PURE__ */ new Map();
        for (const name of allFields) {
          counts.set(
            name,
            await this.plugin.countFieldInScope(name, this.cleanupScope)
          );
        }
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
          cls: "ffg-cleanup-empty"
        });
      }
    };
    void refresh();
  }
  renderMigrateFieldSection(parent) {
    const section = parent.createDiv("ffg-migrate-section");
    section.createEl("h3", { text: "Migrate field" });
    section.createEl("p", {
      text: "Copy values from one frontmatter field to another across the chosen scope, then delete the source. One-off use: consolidating two near-duplicate fields. Conflicts (files where the target already has a non-null/non-empty value) are resolved interactively if fewer than 6, or written to a checklist note in _ Inbox _/ if 6 or more. Every migration is logged to the scrub log.",
      cls: "setting-item-description"
    });
    const scopeRow = section.createDiv("ffg-cleanup-scope-row");
    scopeRow.createSpan({
      text: "Scope:",
      cls: "ffg-cleanup-label"
    });
    const scopeSelect = scopeRow.createEl("select", {
      cls: "ffg-cleanup-scope-select"
    });
    scopeSelect.createEl("option", { value: "vault", text: "Whole vault" });
    scopeSelect.createEl("option", { value: "folder", text: "Specific folder" });
    scopeSelect.value = this.migrateScope === "" ? "vault" : "folder";
    const folderInput = scopeRow.createEl("input", {
      type: "text",
      cls: "ffg-cleanup-folder-input"
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
      cls: "ffg-cleanup-label"
    });
    const sourceInput = sourceWrap.createEl("input", {
      type: "text",
      cls: "ffg-migrate-input"
    });
    sourceInput.placeholder = "field to consolidate";
    const targetWrap = inputRow.createDiv("ffg-migrate-input-wrap");
    targetWrap.createSpan({
      text: "Target:",
      cls: "ffg-cleanup-label"
    });
    const targetInput = targetWrap.createEl("input", {
      type: "text",
      cls: "ffg-migrate-input"
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
      cls: "ffg-migrate-scan"
    });
    const migrateBtn = buttonsRow.createEl("button", {
      text: "Migrate",
      cls: "ffg-migrate-go"
    });
    migrateBtn.disabled = true;
    let lastScan = null;
    const renderPreview = () => {
      previewBox.empty();
      if (!lastScan) {
        previewBox.style.display = "none";
        migrateBtn.disabled = true;
        return;
      }
      previewBox.style.display = "";
      const totalTouched = lastScan.cleanFiles.length + lastScan.conflicts.length;
      const settingsTotal = lastScan.settingsPlan.cleanUpdates.length + lastScan.settingsPlan.decisions.length;
      if (totalTouched === 0 && settingsTotal === 0) {
        previewBox.createEl("div", {
          text: `No files in scope have a non-empty \`${lastScan.sourceField}\` and no plugin settings reference it. Nothing to do.`
        });
        migrateBtn.disabled = true;
        return;
      }
      const summary = previewBox.createEl("div", {
        cls: "ffg-migrate-summary"
      });
      if (totalTouched === 0) {
        summary.createEl("div", {
          text: `No files in scope have a non-empty \`${lastScan.sourceField}\`.`,
          cls: "ffg-migrate-note"
        });
        summary.createEl("div", {
          text: `${settingsTotal} settings reference(s) can still be cleaned up below.`
        });
      } else {
        summary.createEl("div", {
          text: `${lastScan.cleanFiles.length} file(s) will migrate cleanly.`
        });
        summary.createEl("div", {
          text: `${lastScan.conflicts.length} conflict(s) (both source and target set).`
        });
      }
      if (lastScan.conflicts.length >= 6) {
        summary.createEl("div", {
          text: `Conflicts will be written to a checklist note in _ Inbox _/ for manual resolution.`,
          cls: "ffg-migrate-note"
        });
      } else if (lastScan.conflicts.length > 0) {
        summary.createEl("div", {
          text: `Conflicts will be resolved interactively, one file at a time.`,
          cls: "ffg-migrate-note"
        });
      }
      if (lastScan.settingsRefs.length > 0) {
        const warn = previewBox.createEl("div", {
          cls: "ffg-migrate-warn"
        });
        warn.createEl("div", {
          text: `Heads up: \`${lastScan.sourceField}\` is also referenced in plugin settings (you'll get an option to update these in the confirmation step):`
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
        new import_obsidian.Notice("[FFG] Set both source and target fields");
        return;
      }
      if (src === tgt) {
        new import_obsidian.Notice("[FFG] Source and target must differ");
        return;
      }
      const scope = this.migrateScope;
      const result = this.plugin.scanFieldMigration(src, tgt, scope);
      const settingsRefs = this.plugin.collectFieldSettingsReferences(src);
      const settingsPlan = this.plugin.planSettingsUpdates(src, tgt);
      lastScan = {
        sourceField: src,
        targetField: tgt,
        scope,
        cleanFiles: result.cleanFiles,
        conflicts: result.conflicts,
        settingsRefs,
        settingsPlan
      };
      renderPreview();
    });
    [sourceInput, targetInput].forEach(
      (el) => el.addEventListener("input", () => {
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
              new import_obsidian.Notice(`[FFG] Updated ${applied} settings reference(s).`);
            }
          } catch (e) {
            console.error("[FFG] applySettingsUpdates error", e);
            new import_obsidian.Notice(
              "[FFG] Settings update failed; see console. Continuing with note migration."
            );
          }
        }
        const perFile = [];
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
              targetValueBefore: result.targetValueBefore
            });
          }
        }
        if (scan.conflicts.length >= 6) {
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
            new import_obsidian.Notice(
              "[FFG] Migrated clean files; failed to write conflict note (see console)."
            );
          }
          await this.plugin.logFieldMigration(
            scan.sourceField,
            scan.targetField,
            scan.scope,
            perFile
          );
          new import_obsidian.Notice(
            `[FFG] Migrated ${perFile.length} file(s). ${scan.conflicts.length} conflicts queued in ${inboxPath}.`
          );
          lastScan = null;
          renderPreview();
          return;
        }
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
                  targetValueBefore: result.targetValueBefore
                });
              }
            }
            await this.plugin.logFieldMigration(
              scan.sourceField,
              scan.targetField,
              scan.scope,
              perFile
            );
            new import_obsidian.Notice(
              `[FFG] Migration complete: ${perFile.length} file(s) updated.`
            );
            lastScan = null;
            renderPreview();
          }
        ).open();
      }).open();
    });
  }
  renderCleanupResults(container, allFields, templateFields, counts, rescan) {
    var _a;
    container.empty();
    if (allFields.size === 0) {
      container.createEl("div", {
        text: "No fields to inspect. Toggle the eraser icon on a template field, or add an ad-hoc field above.",
        cls: "ffg-cleanup-empty"
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
    const isCleanupEnabled = (key) => {
      if (templateFields.has(key)) return true;
      if (this.plugin.settings.globalLintFields.includes(key)) return true;
      return false;
    };
    let sortedKeys;
    const dividers = [];
    if (this.cleanupSortMode === "grouping") {
      const ordered = [];
      const seen = /* @__PURE__ */ new Set();
      const addIfPresent = (name) => {
        if (!name || seen.has(name)) return;
        if (!allFields.has(name)) return;
        ordered.push(name);
        seen.add(name);
      };
      const topStart = ordered.length;
      for (const name of this.plugin.settings.topZone.fieldOrder) {
        addIfPresent(name);
      }
      if (ordered.length > topStart) {
        dividers.push({
          afterIndex: topStart - 1,
          label: "Top Level Properties"
        });
      }
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
            label: g.name || "Group"
          });
        }
      }
      const unmatched = Array.from(allFields).filter((k) => !seen.has(k)).sort((a, b) => a.localeCompare(b));
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
    const insertDivider = (label) => {
      const divRow = tbody.createEl("tr", { cls: "ffg-cleanup-divider" });
      const divCell = divRow.createEl("td", { attr: { colspan: "5" } });
      divCell.setText(label);
    };
    const groupEffectiveCache = /* @__PURE__ */ new Map();
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
      const c = (_a = counts.get(key)) != null ? _a : { nullCount: 0, totalCount: 0, coveredNullCount: 0 };
      const templates = templateFields.get(key);
      const isAdHoc = this.plugin.settings.cleanupAdHocFields.includes(key);
      const row = tbody.createEl("tr");
      const keyCell = row.createEl("td", { cls: "ffg-cleanup-key" });
      const keyBtn = keyCell.createEl("button", {
        cls: "ffg-cleanup-key-btn",
        text: key,
        attr: {
          "aria-label": `Inspect notes that use "${key}"`
        }
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
          text: "\xD7",
          attr: { "aria-label": "Remove ad-hoc field" }
        });
        removeAdHoc.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.plugin.settings.cleanupAdHocFields = this.plugin.settings.cleanupAdHocFields.filter((n) => n !== key);
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
      const showFraction = inTemplate && !inVault && coverage.total.length > 1 && coverage.withCleanup.length < coverage.total.length;
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
          "aria-label": "Configure cleanup scope: " + scopeDescription
        }
      });
      (0, import_obsidian.setIcon)(lintBtn, "sparkles");
      if (showFraction) {
        lintBtn.addClass("ffg-cleanup-lint-fractional");
        lintBtn.createEl("span", {
          cls: "ffg-cleanup-lint-fraction",
          text: `${coverage.withCleanup.length}/${coverage.total.length}`
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
        cls: c.nullCount > 0 ? "mod-warning" : ""
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
              new import_obsidian.Notice(
                `[FFG] Removed null "${key}" from ${n} file${n === 1 ? "" : "s"}`
              );
              await rescan();
            } catch (e) {
              console.error("[FFG] scrub-null error", e);
              new import_obsidian.Notice("[FFG] Scrub failed, see console");
            }
          }
        ).open();
      });
      const nukeBtn = actionCell.createEl("button", {
        text: "Remove ALL",
        cls: c.totalCount > 0 ? "ffg-cleanup-nuke" : ""
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
                  new import_obsidian.Notice(
                    `[FFG] Removed "${key}" from ${n} file${n === 1 ? "" : "s"}`
                  );
                  await rescan();
                } catch (e) {
                  console.error("[FFG] scrub-all error", e);
                  new import_obsidian.Notice("[FFG] Scrub failed, see console");
                }
              }
            ).open();
          }
        ).open();
      });
    }
  }
  renderTemplateList(container) {
    container.empty();
    for (const tpl of this.plugin.settings.folderTemplates) {
      this.renderTemplateCard(container, tpl);
    }
  }
  renderTemplateCard(container, tpl, options = {}) {
    var _a, _b, _c, _d, _e;
    const card = container.createDiv("ffg-template-card");
    card.dataset.ffgTemplateCard = tpl.id;
    const refresh = (_a = options.refresh) != null ? _a : () => this.renderTemplateList(container);
    const onFieldsChanged = options.onFieldsChanged;
    let body;
    let nameInRow = null;
    let pathsInRow = null;
    if (options.collapsible) {
      let collapsed = this.templateExpansionState.has(tpl.id) ? this.templateExpansionState.get(tpl.id) : (_b = options.collapsed) != null ? _b : false;
      card.addClass("ffg-template-card-collapsible");
      const head = card.createDiv("ffg-template-card-head");
      const chevron = head.createSpan({ cls: "ffg-template-card-chevron" });
      (0, import_obsidian.setIcon)(chevron, collapsed ? "chevron-right" : "chevron-down");
      const nameInput = head.createEl("input", {
        type: "text",
        cls: "ffg-template-card-name"
      });
      nameInput.placeholder = "Template name (optional)";
      nameInput.value = tpl.name;
      nameInput.addEventListener("click", (e) => e.stopPropagation());
      nameInput.addEventListener("input", async () => {
        tpl.name = nameInput.value;
        await this.plugin.saveSettings();
      });
      nameInRow = (value) => {
        if (nameInput.value !== value) nameInput.value = value;
      };
      const summaryEl = head.createSpan({ cls: "ffg-template-card-summary" });
      const renderSummary = () => {
        const labels = tpl.pathPrefixes.map((p) => p.trim()).filter((p) => p.length > 0);
        summaryEl.setText(labels.length ? labels.join(", ") : "global");
      };
      renderSummary();
      pathsInRow = renderSummary;
      const actions = head.createDiv("ffg-template-card-actions");
      if (options.reorder) {
        const upBtn = actions.createEl("button", {
          cls: "ffg-template-card-action",
          attr: { "aria-label": "Move template up" }
        });
        (0, import_obsidian.setIcon)(upBtn, "arrow-up");
        upBtn.disabled = !options.reorder.canMoveUp;
        upBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await options.reorder.onMoveUp();
        });
        const downBtn = actions.createEl("button", {
          cls: "ffg-template-card-action",
          attr: { "aria-label": "Move template down" }
        });
        (0, import_obsidian.setIcon)(downBtn, "arrow-down");
        downBtn.disabled = !options.reorder.canMoveDown;
        downBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await options.reorder.onMoveDown();
        });
      }
      const trashBtn = actions.createEl("button", {
        cls: "ffg-template-card-action",
        attr: { "aria-label": "Delete template" }
      });
      (0, import_obsidian.setIcon)(trashBtn, "trash");
      trashBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        this.plugin.settings.folderTemplates = this.plugin.settings.folderTemplates.filter(
          (t) => t.id !== tpl.id
        );
        this.templateExpansionState.delete(tpl.id);
        await this.plugin.saveSettings();
        refresh();
      });
      body = card.createDiv("ffg-template-card-body");
      body.style.display = collapsed ? "none" : "";
      head.addEventListener("click", (e) => {
        const target = e.target;
        if (target.closest("input") || target.closest("button")) return;
        collapsed = !collapsed;
        this.templateExpansionState.set(tpl.id, collapsed);
        (0, import_obsidian.setIcon)(chevron, collapsed ? "chevron-right" : "chevron-down");
        body.style.display = collapsed ? "none" : "";
      });
    } else {
      body = card;
    }
    const renderLinkedIndicator = () => {
    };
    if (!options.collapsible) {
      new import_obsidian.Setting(body).setName("Name").addExtraButton(
        (btn) => btn.setIcon("trash").setTooltip("Delete template").onClick(async () => {
          this.plugin.settings.folderTemplates = this.plugin.settings.folderTemplates.filter(
            (t) => t.id !== tpl.id
          );
          await this.plugin.saveSettings();
          refresh();
        })
      ).addText(
        (text) => text.setPlaceholder("Template name (optional)").setValue(tpl.name).onChange(async (value) => {
          tpl.name = value;
          nameInRow == null ? void 0 : nameInRow(value);
          await this.plugin.saveSettings();
        })
      );
    }
    const fieldsHeader = body.createDiv("ffg-field-order-header");
    fieldsHeader.createEl("div", {
      text: "Default Field Values",
      cls: "setting-item-name"
    });
    fieldsHeader.createEl("div", {
      text: "Linked-group fields appear here automatically. Set a default value on any row, or add a field below. Use the chevrons on each row to reorder for this template.",
      cls: "setting-item-description"
    });
    const fieldsContainer = body.createDiv("ffg-template-fields");
    const renderFields = () => this.renderTemplateFieldsList(fieldsContainer, tpl, onFieldsChanged);
    const targetingHasContent = tpl.pathPrefixes.some((p) => p.trim().length > 0) || ((_c = tpl.excludedPathPrefixes) != null ? _c : []).some((p) => p.trim().length > 0) || !!tpl.bodyTemplatePath || !!tpl.group || tpl.fields.length > 0;
    let targetingCollapsed = targetingHasContent;
    const targetingCard = body.createDiv("ffg-template-targeting");
    const targetingHead = targetingCard.createDiv("ffg-template-targeting-head");
    const targetingChevron = targetingHead.createSpan({
      cls: "ffg-template-targeting-chevron"
    });
    (0, import_obsidian.setIcon)(
      targetingChevron,
      targetingCollapsed ? "chevron-right" : "chevron-down"
    );
    targetingHead.createSpan({
      cls: "ffg-template-targeting-title",
      text: "Targeting & setup"
    });
    const targetingSummary = targetingHead.createSpan({
      cls: "ffg-template-targeting-summary"
    });
    const targetingBody = targetingCard.createDiv("ffg-template-targeting-body");
    targetingBody.style.display = targetingCollapsed ? "none" : "";
    const renderTargetingSummary = () => {
      var _a2, _b2, _c2;
      const includeCount = tpl.pathPrefixes.filter(
        (p) => p.trim().length > 0
      ).length;
      const excludeCount = ((_a2 = tpl.excludedPathPrefixes) != null ? _a2 : []).filter(
        (p) => p.trim().length > 0
      ).length;
      const bodyOn = !!tpl.bodyTemplatePath;
      const groupName = tpl.group ? (_c2 = (_b2 = this.plugin.settings.groups.find((g) => g.id === tpl.group)) == null ? void 0 : _b2.name) != null ? _c2 : "?" : "\u2014";
      const includesGlobal = tpl.pathPrefixes.some((p) => !p || p === "*");
      const includeLabel = includesGlobal ? "global" : `${includeCount} include${includeCount === 1 ? "" : "s"}`;
      targetingSummary.setText(
        `${includeLabel} \xB7 ${excludeCount} exclude${excludeCount === 1 ? "" : "s"} \xB7 body ${bodyOn ? "on" : "off"} \xB7 group ${groupName}`
      );
    };
    renderTargetingSummary();
    targetingHead.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("input") || t.closest("button")) return;
      targetingCollapsed = !targetingCollapsed;
      (0, import_obsidian.setIcon)(
        targetingChevron,
        targetingCollapsed ? "chevron-right" : "chevron-down"
      );
      targetingBody.style.display = targetingCollapsed ? "none" : "";
    });
    const includePathsLabel = () => {
      var _a2;
      return ((_a2 = tpl.excludedPathPrefixes) != null ? _a2 : []).some((p) => p.trim().length > 0) ? "Include paths" : "Folder paths";
    };
    const pathsHeader = targetingBody.createDiv("ffg-field-order-header");
    const pathsHeaderName = pathsHeader.createEl("div", {
      text: includePathsLabel(),
      cls: "setting-item-name"
    });
    pathsHeader.createEl("div", {
      text: "One or more path prefixes (e.g. Notes/People/). Empty string matches every note.",
      cls: "setting-item-description"
    });
    const pathsContainer = targetingBody.createDiv("ffg-template-paths");
    const renderPaths = () => {
      pathsContainer.empty();
      tpl.pathPrefixes.forEach((path, index) => {
        const row = pathsContainer.createDiv("ffg-template-path-row");
        const input = row.createEl("input", {
          type: "text",
          cls: "ffg-template-path-input"
        });
        input.placeholder = "path prefix (empty = global)";
        input.value = path;
        input.addEventListener("input", async () => {
          tpl.pathPrefixes[index] = input.value;
          pathsInRow == null ? void 0 : pathsInRow();
          renderTargetingSummary();
          await this.plugin.saveSettings();
        });
        new FolderPathSuggest(this.app, input, async (value) => {
          tpl.pathPrefixes[index] = value;
          pathsInRow == null ? void 0 : pathsInRow();
          renderTargetingSummary();
          await this.plugin.saveSettings();
        });
        const deleteBtn = row.createEl("button", {
          cls: "ffg-template-field-delete",
          attr: { "aria-label": "Delete path" }
        });
        (0, import_obsidian.setIcon)(deleteBtn, "trash");
        deleteBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          tpl.pathPrefixes = tpl.pathPrefixes.filter((_, i) => i !== index);
          pathsInRow == null ? void 0 : pathsInRow();
          renderTargetingSummary();
          await this.plugin.saveSettings();
          renderPaths();
        });
      });
      const addBtn = pathsContainer.createEl("button", {
        text: "+ Add path",
        cls: "ffg-add-field-btn"
      });
      addBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        tpl.pathPrefixes.push("");
        pathsInRow == null ? void 0 : pathsInRow();
        renderTargetingSummary();
        await this.plugin.saveSettings();
        renderPaths();
      });
    };
    renderPaths();
    const excludeHeader = targetingBody.createDiv("ffg-field-order-header");
    excludeHeader.createEl("div", {
      text: "Exclude paths",
      cls: "setting-item-name"
    });
    excludeHeader.createEl("div", {
      text: "Files matching any exclude prefix are skipped, even if they match an include path above.",
      cls: "setting-item-description"
    });
    const excludeContainer = targetingBody.createDiv("ffg-template-paths");
    const renderExcludes = () => {
      excludeContainer.empty();
      if (!tpl.excludedPathPrefixes) tpl.excludedPathPrefixes = [];
      tpl.excludedPathPrefixes.forEach((path, index) => {
        const row = excludeContainer.createDiv("ffg-template-path-row");
        const input = row.createEl("input", {
          type: "text",
          cls: "ffg-template-path-input"
        });
        input.placeholder = "path prefix to exclude";
        input.value = path;
        input.addEventListener("input", async () => {
          tpl.excludedPathPrefixes[index] = input.value;
          renderTargetingSummary();
          pathsHeaderName.setText(includePathsLabel());
          await this.plugin.saveSettings();
        });
        new FolderPathSuggest(this.app, input, async (value) => {
          tpl.excludedPathPrefixes[index] = value;
          renderTargetingSummary();
          pathsHeaderName.setText(includePathsLabel());
          await this.plugin.saveSettings();
        });
        const deleteBtn = row.createEl("button", {
          cls: "ffg-template-field-delete",
          attr: { "aria-label": "Delete exclude path" }
        });
        (0, import_obsidian.setIcon)(deleteBtn, "trash");
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
        cls: "ffg-add-field-btn"
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
      cls: "setting-item-name"
    });
    bodyHeader.createEl("div", {
      text: "Optional markdown note whose body is inserted into matching notes when their body is blank. Fires on note creation and on move into a matching folder. Templater syntax is parsed if the Templater plugin is installed.",
      cls: "setting-item-description"
    });
    const bodyRow = targetingBody.createDiv("ffg-template-body-row");
    const bodyInput = bodyRow.createEl("input", {
      type: "text",
      cls: "ffg-template-body-input"
    });
    bodyInput.placeholder = "path/to/template-note.md";
    bodyInput.value = (_d = tpl.bodyTemplatePath) != null ? _d : "";
    bodyInput.addEventListener("input", async () => {
      const value = bodyInput.value.trim();
      if (value) tpl.bodyTemplatePath = value;
      else delete tpl.bodyTemplatePath;
      renderTargetingSummary();
      await this.plugin.saveSettings();
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
      cls: "ffg-template-body-open"
    });
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const path = bodyInput.value.trim();
      if (!path) {
        new import_obsidian.Notice("[FFG] Set a body template path first");
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof import_obsidian.TFile)) {
        new import_obsidian.Notice(`[FFG] Body template not found: ${path}`);
        return;
      }
      this.app.workspace.getLeaf("tab").openFile(file);
    });
    const groupsHeader = targetingBody.createDiv("ffg-field-order-header");
    groupsHeader.createEl("div", {
      text: "Group",
      cls: "setting-item-name"
    });
    groupsHeader.createEl("div", {
      text: "Pick the group that this template's fields belong to. Fields with Sort-into-group on will fold under this group's heading in the Properties panel. Pick (none) to leave this as a standalone (global) template.",
      cls: "setting-item-description"
    });
    const groupsContainer = targetingBody.createDiv("ffg-template-linked-groups");
    const groupSelect = groupsContainer.createEl("select", {
      cls: "ffg-template-group-select"
    });
    groupSelect.createEl("option", { value: "", text: "(none \u2014 global)" });
    for (const g of this.plugin.settings.groups) {
      groupSelect.createEl("option", { value: g.id, text: g.name || g.id });
    }
    groupSelect.value = (_e = tpl.group) != null ? _e : "";
    groupSelect.addEventListener("change", async () => {
      const newVal = groupSelect.value;
      if (newVal) tpl.group = newVal;
      else delete tpl.group;
      await this.plugin.saveSettings();
      if (this.activeTab === "groups") {
        this.rerenderActiveTab();
        return;
      }
      renderFields();
      renderTargetingSummary();
    });
    const renderLinkedGroups = () => {
      var _a2;
      groupSelect.value = (_a2 = tpl.group) != null ? _a2 : "";
    };
    renderFields();
  }
  // Build a template's render order: existing tpl.fieldOrder entries that are
  // still backed by either a linked-group field or an explicit named field,
  // then any backing names not yet in fieldOrder (linked first, then explicit).
  // Returns the ordered named-field plan plus any anonymous (in-progress) rows
  // and the linkedOrigin map.
  getTemplateRenderPlan(tpl) {
    const ownNames = new Set(
      tpl.fields.filter((f) => f.name).map((f) => f.name)
    );
    const linkedOrigin = /* @__PURE__ */ new Map();
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
          if (name && !legacyLits.has(name) && !ownNames.has(name) && !linkedOrigin.has(name)) {
            linkedOrigin.set(name, group.name);
          }
        }
      }
    }
    const allNames = [];
    const seenAll = /* @__PURE__ */ new Set();
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
    const orderedNames = [];
    const placed = /* @__PURE__ */ new Set();
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
  async swapTemplateInSection(tpl, direction, filter) {
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
  async reorderTemplateField(tpl, fromIndex, toIndex) {
    const { orderedNames } = this.getTemplateRenderPlan(tpl);
    if (fromIndex < 0 || fromIndex >= orderedNames.length || toIndex < 0 || toIndex >= orderedNames.length || fromIndex === toIndex) {
      return;
    }
    const [moved] = orderedNames.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex : Math.min(toIndex + 1, orderedNames.length);
    orderedNames.splice(insertAt, 0, moved);
    tpl.fieldOrder = orderedNames;
    await this.plugin.saveSettings();
  }
  renderTemplateFieldsList(container, tpl, onFieldsChanged) {
    container.empty();
    const refresh = () => this.renderTemplateFieldsList(container, tpl, onFieldsChanged);
    const { orderedNames, linkedOrigin, anonymous } = this.getTemplateRenderPlan(tpl);
    orderedNames.forEach((name, idx) => {
      var _a;
      const origin = (_a = linkedOrigin.get(name)) != null ? _a : null;
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
          }
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
        void 0,
        onFieldsChanged
      );
    }
    const addBtn = container.createEl("button", {
      text: "+ Add field",
      cls: "ffg-add-field-btn"
    });
    addBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      tpl.fields.push({ name: "", value: void 0 });
      await this.plugin.saveSettings();
      refresh();
    });
  }
  getPropertyType(key) {
    var _a, _b, _c, _d;
    if (!key) return "text";
    const mtm = this.app.metadataTypeManager;
    if (!mtm) return "text";
    const props = (_a = mtm.properties) != null ? _a : {};
    const lookup = (_b = props[key]) != null ? _b : props[key.toLowerCase()];
    return (_d = (_c = lookup == null ? void 0 : lookup.widget) != null ? _c : lookup == null ? void 0 : lookup.type) != null ? _d : "text";
  }
  renderTemplateFieldRow(container, tpl, fieldName, origin, explicit, refresh, reorder, onFieldsChanged) {
    var _a;
    const row = container.createDiv("ffg-template-field-row");
    const handle = row.createEl("span", {
      cls: "ffg-template-field-drag" + (reorder ? "" : " ffg-template-field-drag-placeholder"),
      attr: reorder ? { "aria-label": "Drag to reorder", draggable: "true" } : { "aria-hidden": "true" }
    });
    (0, import_obsidian.setIcon)(handle, "grip-vertical");
    if (reorder) {
      row.dataset.ffgIndex = String(reorder.index);
      handle.addEventListener("dragstart", (e) => {
        var _a2;
        (_a2 = e.dataTransfer) == null ? void 0 : _a2.setData(
          "application/x-ffg-field",
          String(reorder.index)
        );
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        row.addClass("ffg-template-field-dragging");
      });
      handle.addEventListener("dragend", () => {
        row.removeClass("ffg-template-field-dragging");
        container.querySelectorAll(".ffg-template-field-drop-target").forEach((el) => el.removeClass("ffg-template-field-drop-target"));
      });
      row.addEventListener("dragover", (e) => {
        var _a2;
        if (!((_a2 = e.dataTransfer) == null ? void 0 : _a2.types.includes("application/x-ffg-field"))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        container.querySelectorAll(".ffg-template-field-drop-target").forEach((el) => el.removeClass("ffg-template-field-drop-target"));
        row.addClass("ffg-template-field-drop-target");
      });
      row.addEventListener("drop", async (e) => {
        var _a2;
        const raw = (_a2 = e.dataTransfer) == null ? void 0 : _a2.getData("application/x-ffg-field");
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
        text: fieldName
      });
    } else {
      const nameInput = row.createEl("input", {
        type: "text",
        cls: "ffg-template-field-name"
      });
      nameInput.placeholder = "frontmatter key";
      nameInput.value = fieldName;
      nameInput.addEventListener("input", async () => {
        if (!explicit) return;
        explicit.name = nameInput.value.trim();
        await this.plugin.saveSettings();
      });
      nameInput.addEventListener("blur", () => {
        onFieldsChanged == null ? void 0 : onFieldsChanged();
      });
      new FrontmatterKeySuggest(this.app, nameInput, async (value) => {
        if (!explicit) return;
        explicit.name = value;
        nameInput.value = value;
        await this.plugin.saveSettings();
        onFieldsChanged == null ? void 0 : onFieldsChanged();
        refresh();
      });
    }
    const commitValue = async (newValue) => {
      if (origin) {
        const isEmpty = newValue === void 0 || newValue === "" || Array.isArray(newValue) && newValue.length === 0;
        if (isEmpty) {
          if (explicit) {
            tpl.fields = tpl.fields.filter((f) => f !== explicit);
            explicit = void 0;
            await this.plugin.saveSettings();
          }
        } else {
          if (!explicit) {
            explicit = { name: fieldName, value: newValue };
            tpl.fields.push(explicit);
          } else {
            explicit.value = newValue;
          }
          await this.plugin.saveSettings();
        }
      } else if (explicit) {
        explicit.value = newValue;
        await this.plugin.saveSettings();
      }
    };
    const currentValue = explicit ? explicit.value : void 0;
    const type = fieldName ? this.getPropertyType(fieldName) : "text";
    this.renderValueWidget(row, fieldName, type, currentValue, commitValue);
    const nameRef = () => {
      var _a2;
      return origin ? fieldName : (_a2 = explicit == null ? void 0 : explicit.name) != null ? _a2 : fieldName;
    };
    const isExcluded = tpl.excludedFields.includes(nameRef());
    if (isExcluded) row.addClass("ffg-template-field-row-excluded");
    const eyeBtn = row.createEl("button", {
      cls: "ffg-template-field-eye",
      attr: {
        "aria-label": isExcluded ? "Hidden by default. Click to show by default." : "Showing by default. Click to hide by default."
      }
    });
    (0, import_obsidian.setIcon)(eyeBtn, isExcluded ? "eye-off" : "eye");
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
      (0, import_obsidian.setIcon)(eyeBtn, nowExcluded ? "eye-off" : "eye");
      eyeBtn.setAttr(
        "aria-label",
        nowExcluded ? "Hidden by default. Click to show by default." : "Showing by default. Click to hide by default."
      );
      await this.plugin.saveSettings();
    });
    const isLinted = tpl.lintFields.includes(nameRef());
    const eraserBtn = row.createEl("button", {
      cls: "ffg-template-field-eraser",
      attr: {
        "aria-label": isLinted ? "Stop cleanup for this field" : "Cleanup this field when null"
      }
    });
    (0, import_obsidian.setIcon)(eraserBtn, "sparkles");
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
        nowLinted ? "Stop cleanup for this field" : "Cleanup this field when null"
      );
      await this.plugin.saveSettings();
    });
    if (tpl.group) {
      const isInGroup = !((_a = tpl.noGroupFields) != null ? _a : []).includes(nameRef());
      const groupToggle = row.createEl("button", {
        cls: "ffg-template-field-group-toggle",
        attr: {
          "aria-label": isInGroup ? "In group. Click to remove from group." : "Not in group. Click to sort into group."
        }
      });
      (0, import_obsidian.setIcon)(groupToggle, isInGroup ? "folder" : "folder-x");
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
          (0, import_obsidian.setIcon)(groupToggle, "folder");
        } else {
          tpl.noGroupFields.push(key);
          groupToggle.removeClass("active");
          (0, import_obsidian.setIcon)(groupToggle, "folder-x");
        }
        groupToggle.setAttr(
          "aria-label",
          nowIn ? "In group. Click to remove from group." : "Not in group. Click to sort into group."
        );
        await this.plugin.saveSettings();
        onFieldsChanged == null ? void 0 : onFieldsChanged();
      });
    }
    if (!origin && explicit) {
      const deleteBtn = row.createEl("button", {
        cls: "ffg-template-field-delete",
        attr: { "aria-label": "Delete field" }
      });
      (0, import_obsidian.setIcon)(deleteBtn, "trash");
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
        onFieldsChanged == null ? void 0 : onFieldsChanged();
        refresh();
      });
    }
  }
  renderValueWidget(parent, fieldName, type, currentValue, onCommit) {
    switch (type) {
      case "number": {
        const input = parent.createEl("input", {
          type: "number",
          cls: "ffg-template-field-value"
        });
        input.placeholder = "default value";
        input.value = typeof currentValue === "number" ? String(currentValue) : "";
        input.addEventListener("input", () => {
          const raw = input.value;
          if (raw === "") {
            void onCommit(void 0);
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
          cls: "ffg-template-field-value"
        });
        input.value = isAuto ? "" : typeof currentValue === "string" ? currentValue : "";
        input.disabled = isAuto;
        input.addEventListener("input", () => {
          const raw = input.value;
          void onCommit(raw === "" ? void 0 : raw);
        });
        const autoBtn = wrap.createEl("button", {
          text: "Today",
          cls: "ffg-template-field-auto-btn"
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
            void onCommit(void 0);
          }
        });
        return;
      }
      case "datetime": {
        const wrap = parent.createDiv({ cls: "ffg-template-field-value-date" });
        let isAuto = currentValue === "<now>";
        const input = wrap.createEl("input", {
          type: "datetime-local",
          cls: "ffg-template-field-value"
        });
        input.value = isAuto ? "" : typeof currentValue === "string" ? currentValue : "";
        input.disabled = isAuto;
        input.addEventListener("input", () => {
          const raw = input.value;
          void onCommit(raw === "" ? void 0 : raw);
        });
        const autoBtn = wrap.createEl("button", {
          text: "Now",
          cls: "ffg-template-field-auto-btn"
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
            void onCommit(void 0);
          }
        });
        return;
      }
      case "multitext":
      case "tags":
      case "aliases": {
        const wrap = parent.createDiv({ cls: "ffg-template-field-value-multi" });
        const values = Array.isArray(currentValue) ? currentValue.map((v) => String(v)) : [];
        const pillList = wrap.createDiv({ cls: "ffg-pill-list" });
        const renderPills = () => {
          pillList.empty();
          values.forEach((v, i) => {
            const pill = pillList.createDiv({ cls: "ffg-pill" });
            pill.createSpan({ cls: "ffg-pill-text", text: v });
            const remove = pill.createSpan({
              cls: "ffg-pill-remove",
              text: "\xD7"
            });
            remove.setAttribute("role", "button");
            remove.setAttribute("aria-label", `Remove ${v}`);
            remove.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              values.splice(i, 1);
              renderPills();
              void onCommit(values.length === 0 ? void 0 : values.slice());
            });
          });
        };
        renderPills();
        const input = wrap.createEl("input", {
          type: "text",
          cls: "ffg-template-field-value"
        });
        input.placeholder = "add default value, press enter";
        const addValue = (raw) => {
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
          cls: "ffg-template-field-value"
        });
        input.placeholder = "default value (optional)";
        input.value = seedValueToString(currentValue);
        input.addEventListener("input", () => {
          const raw = input.value;
          void onCommit(raw === "" ? void 0 : parseSeedValue(raw));
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
  renderFieldOrderList(container, getList, setList, suggesterFilter) {
    const render = () => {
      container.empty();
      const list = getList();
      list.forEach((field, index) => {
        const originalValue = field;
        const setting = new import_obsidian.Setting(container);
        setting.addExtraButton(
          (btn) => btn.setIcon("arrow-up").setTooltip("Move up").setDisabled(index === 0).onClick(async () => {
            const current = getList();
            if (index <= 0) return;
            [current[index - 1], current[index]] = [current[index], current[index - 1]];
            await setList(current);
            render();
          })
        );
        setting.addExtraButton(
          (btn) => btn.setIcon("arrow-down").setTooltip("Move down").setDisabled(index === list.length - 1).onClick(async () => {
            const current = getList();
            if (index >= current.length - 1) return;
            [current[index], current[index + 1]] = [current[index + 1], current[index]];
            await setList(current);
            render();
          })
        );
        setting.addExtraButton(
          (btn) => btn.setIcon("trash").setTooltip("Remove").onClick(async () => {
            const current = getList();
            current.splice(index, 1);
            await setList(current);
            render();
          })
        );
        setting.addText((text) => {
          text.setValue(field).onChange(async (value) => {
            const current = getList();
            current[index] = value;
            await setList(current);
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
                const matcherFilter = suggesterFilter == null ? void 0 : suggesterFilter();
                const current = getList();
                const usedByOthers = new Set(
                  current.filter((_, i) => i !== index).filter(Boolean)
                );
                return (key) => {
                  if (key === originalValue) return true;
                  if (usedByOthers.has(key)) return false;
                  if (matcherFilter && !matcherFilter(key)) return false;
                  return true;
                };
              }
            }
          );
        });
      });
      const addBtn = container.createEl("button", {
        text: "+ Add Field",
        cls: "ffg-add-field-btn"
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
  renderGroups(container) {
    container.empty();
    const groups = this.plugin.settings.groups;
    groups.forEach((group, index) => {
      this.renderGroupCard(container, group, index, groups.length);
    });
  }
  groupSummaryText(group) {
    const fieldCount = getGroupLiteralFields(group).length;
    const tplCount = this.plugin.settings.folderTemplates.filter(
      (t) => t.group === group.id
    ).length;
    return `${fieldCount} field${fieldCount === 1 ? "" : "s"} \xB7 ${tplCount} template${tplCount === 1 ? "" : "s"}`;
  }
  renderGroupCard(container, group, index, total) {
    var _a;
    const card = container.createDiv("ffg-group-card");
    card.dataset.ffgGroupCard = group.id;
    let collapsed = (_a = this.groupExpansionState.get(group.id)) != null ? _a : true;
    const head = card.createDiv("ffg-group-card-head");
    const chevron = head.createSpan({ cls: "ffg-group-card-chevron" });
    (0, import_obsidian.setIcon)(chevron, collapsed ? "chevron-right" : "chevron-down");
    const nameInput = head.createEl("input", {
      type: "text",
      cls: "ffg-group-card-name"
    });
    nameInput.placeholder = "Group name";
    nameInput.value = group.name;
    nameInput.addEventListener("input", async () => {
      group.name = nameInput.value;
      await this.plugin.saveSettings();
    });
    nameInput.addEventListener("click", (e) => e.stopPropagation());
    const summaryEl = head.createSpan({
      cls: "ffg-group-card-summary",
      text: this.groupSummaryText(group)
    });
    const updateSummary = () => {
      summaryEl.setText(this.groupSummaryText(group));
    };
    const actions = head.createDiv("ffg-group-card-actions");
    const upBtn = actions.createEl("button", {
      cls: "ffg-group-card-action",
      attr: { "aria-label": "Move up" }
    });
    (0, import_obsidian.setIcon)(upBtn, "arrow-up");
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
      attr: { "aria-label": "Move down" }
    });
    (0, import_obsidian.setIcon)(downBtn, "arrow-down");
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
      attr: { "aria-label": "Delete group" }
    });
    (0, import_obsidian.setIcon)(trashBtn, "trash");
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
      const target = e.target;
      if (target.closest("input") || target.closest("button")) return;
      collapsed = !collapsed;
      this.groupExpansionState.set(group.id, collapsed);
      (0, import_obsidian.setIcon)(chevron, collapsed ? "chevron-right" : "chevron-down");
      body.style.display = collapsed ? "none" : "";
    });
    const matchRow = body.createDiv("ffg-group-match-row");
    const matchLeft = matchRow.createDiv("ffg-group-match-left");
    matchLeft.createEl("div", {
      text: "Match by",
      cls: "setting-item-name"
    });
    const matcherSelect = matchLeft.createEl("select", { cls: "dropdown" });
    matcherSelect.createEl("option", { value: "unified", text: "Field list" });
    matcherSelect.createEl("option", { value: "regex", text: "Regex" });
    matcherSelect.value = group.matcherType;
    matcherSelect.addEventListener("change", async () => {
      group.matcherType = matcherSelect.value;
      await this.plugin.saveSettings();
      this.renderGroups(container);
    });
    const foldSelect = matchRow.createEl("select", { cls: "dropdown" });
    foldSelect.createEl("option", {
      value: "true",
      text: "Folded by default"
    });
    foldSelect.createEl("option", {
      value: "false",
      text: "Expanded by default"
    });
    foldSelect.value = group.defaultFolded ? "true" : "false";
    foldSelect.addEventListener("change", async () => {
      group.defaultFolded = foldSelect.value === "true";
      await this.plugin.saveSettings();
    });
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
    const refreshLinkedFields = () => this.renderLinkedFieldsTable(linkedFieldsContainer, group);
    this.renderInlineTemplatesSection(body, group, () => {
      updateSummary();
      refreshLinkedFields();
    });
  }
  renderInlineTemplatesSection(card, group, onChange) {
    const header = card.createDiv("ffg-field-order-header");
    header.createEl("div", {
      text: "Templates using this group",
      cls: "setting-item-name"
    });
    header.createEl("div", {
      text: "Folder-scoped templates that automatically include this group's fields.",
      cls: "setting-item-description"
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
          cls: "ffg-inline-templates-empty"
        });
      } else {
        const inGroup = (t) => t.group === group.id;
        linked.forEach((tpl, idx) => {
          this.renderTemplateCard(listContainer, tpl, {
            collapsible: true,
            collapsed: true,
            refresh: () => {
              render();
              onChange == null ? void 0 : onChange();
            },
            onFieldsChanged: () => onChange == null ? void 0 : onChange(),
            reorder: {
              canMoveUp: idx > 0,
              canMoveDown: idx < linked.length - 1,
              onMoveUp: async () => {
                await this.swapTemplateInSection(tpl, -1, inGroup);
                render();
                onChange == null ? void 0 : onChange();
              },
              onMoveDown: async () => {
                await this.swapTemplateInSection(tpl, 1, inGroup);
                render();
                onChange == null ? void 0 : onChange();
              }
            }
          });
        });
      }
      const addBtn = listContainer.createEl("button", {
        text: "+ Add template",
        cls: "ffg-add-field-btn"
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
          noGroupFields: []
        });
        await this.plugin.saveSettings();
        render();
        onChange == null ? void 0 : onChange();
      });
    };
    render();
  }
  renderUnifiedMatcherSection(card, group, onChange) {
    const wildcardHeader = card.createDiv("ffg-field-order-header");
    wildcardHeader.createEl("div", {
      text: "Wildcards",
      cls: "setting-item-name"
    });
    wildcardHeader.createEl("div", {
      text: "Pattern entries ending in * (e.g. claude_* sweeps every claude_ field). Plain field names are also accepted as group literals, but you'll usually contribute literals via a linked template's Sort-into-group toggle.",
      cls: "setting-item-description"
    });
    const wildcardContainer = card.createDiv("ffg-field-order-list");
    this.renderFieldOrderList(
      wildcardContainer,
      () => {
        var _a;
        return (_a = group.matcherValues) != null ? _a : [];
      },
      async (list) => {
        group.matcherValues = list;
        await this.plugin.saveSettings();
        onChange == null ? void 0 : onChange();
      }
    );
  }
  // Read-only table of every field contributed to `group` by its linked
  // templates. Lives in its own container so the parent group card can re-run
  // it whenever a linked template's fields change.
  renderLinkedFieldsTable(container, group) {
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
      cls: "setting-item-name"
    });
    linkedHeader.createEl("div", {
      text: "Alphabetical summary of every field this group covers. Columns are the linked templates; checkmarks indicate the field is contributed by that template. Order in the Properties panel comes from the active file's matching template.",
      cls: "setting-item-description"
    });
    const table = container.createEl("table", {
      cls: "ffg-group-contributed-table"
    });
    const thead = table.createEl("thead").createEl("tr");
    thead.createEl("th", {
      text: "Field",
      cls: "ffg-group-contributed-th-field"
    });
    for (const t of linkedTemplates) {
      thead.createEl("th", {
        text: t.name || "(unnamed)",
        cls: "ffg-group-contributed-th-tpl"
      });
    }
    const tbody = table.createEl("tbody");
    for (const entry of contributed) {
      const row = tbody.createEl("tr");
      row.createEl("td", {
        text: entry.name,
        cls: "ffg-group-contributed-name"
      });
      for (const t of linkedTemplates) {
        const label = t.name || t.id;
        const present = entry.originTemplates.includes(label);
        const cell = row.createEl("td", {
          cls: "ffg-group-contributed-check"
        });
        cell.setText(present ? "\u2713" : "");
      }
    }
  }
  renderRegexMatcherSection(card, group) {
    let inputEl = null;
    let pillList = null;
    const renderPill = (value) => {
      if (!pillList) return;
      const pill = pillList.createDiv("ffg-pill");
      pill.createSpan({ cls: "ffg-pill-text", text: value });
      const remove = pill.createSpan({ cls: "ffg-pill-remove", text: "\xD7" });
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
    new import_obsidian.Setting(card).setName("Regex patterns").addText((text) => {
      text.setPlaceholder("Add regex pattern and press Enter");
      inputEl = text.inputEl;
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
      });
    }).addExtraButton(
      (btn) => btn.setIcon("plus").setTooltip("Add pattern").onClick(() => void commit())
    );
    pillList = card.createDiv("ffg-pill-list");
    for (const v of group.matcherValues) renderPill(v);
    const fieldOrderHeader = card.createDiv("ffg-field-order-header");
    fieldOrderHeader.createEl("div", {
      text: "Field order",
      cls: "setting-item-name"
    });
    fieldOrderHeader.createEl("div", {
      text: "Manually order matching fields. Unlisted fields go after.",
      cls: "setting-item-description"
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
};
