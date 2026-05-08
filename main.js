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
  topZone: { fieldOrder: [] },
  groups: [
    {
      id: "ai",
      name: "AI Properties",
      matcherType: "prefix",
      matcherValues: ["ai_", "claude_"],
      defaultFolded: true,
      fieldOrder: []
    },
    {
      id: "hidden",
      name: "Hidden Properties",
      matcherType: "prefix",
      matcherValues: ["_"],
      defaultFolded: true,
      fieldOrder: []
    }
  ]
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
function toRuntimeGroup(g) {
  var _a, _b;
  const values = ((_a = g.matcherValues) != null ? _a : []).filter((v) => v && v.length > 0);
  let matcher;
  if (g.matcherType === "regex") {
    const regexes = [];
    for (const v of values) {
      try {
        regexes.push(new RegExp(v));
      } catch (e) {
      }
    }
    matcher = (key) => regexes.some((re) => re.test(key));
  } else if (g.matcherType === "list") {
    const keys = new Set(values);
    matcher = (key) => keys.has(key);
  } else {
    matcher = (key) => values.some((p) => key.startsWith(p));
  }
  return {
    id: g.id,
    name: g.name,
    defaultFolded: g.defaultFolded,
    fieldOrder: (_b = g.fieldOrder) != null ? _b : [],
    matcher
  };
}
var FoldableFrontmatterGroupsPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.observer = null;
    this.foldState = /* @__PURE__ */ new WeakMap();
    this.isProcessing = false;
    this.lastActiveFile = null;
  }
  async onload() {
    console.log("[FFG] loading v0.6");
    await this.loadSettings();
    this.addSettingTab(new FfgSettingTab(this.app, this));
    this.installObserver();
    this.app.workspace.onLayoutReady(() => {
      this.processAllContainers();
      this.lastActiveFile = this.app.workspace.getActiveFile();
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
        if (result === "rewrote") new import_obsidian.Notice("[FFG] Frontmatter reordered");
        else if (result === "noop") new import_obsidian.Notice("[FFG] Already in canonical order");
        else if (result === "no-frontmatter") new import_obsidian.Notice("[FFG] No frontmatter");
        else if (result === "error") new import_obsidian.Notice("[FFG] Error \u2014 see console");
      }
    });
  }
  onunload() {
    var _a;
    console.log("[FFG] unloading");
    (_a = this.observer) == null ? void 0 : _a.disconnect();
    this.observer = null;
    this.unwrapAll();
    document.querySelectorAll(".ffg-settings-gear").forEach((el) => el.remove());
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
        const legacy = g.matcherValue;
        if (typeof legacy === "string" && legacy.length > 0) {
          g.matcherValues = g.matcherType === "regex" ? [legacy] : legacy.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          g.matcherValues = [];
        }
        delete g.matcherValue;
      }
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.onSettingsChanged();
  }
  onSettingsChanged() {
    if (!this.settings.groupFoldingEnabled) {
      this.unwrapAll();
      return;
    }
    this.isProcessing = true;
    try {
      this.unwrapAll();
      document.querySelectorAll(".metadata-container").forEach((c) => {
        if (c.isConnected) this.processContainer(c);
      });
    } finally {
      this.isProcessing = false;
    }
  }
  get runtimeGroups() {
    return this.settings.groups.map(toRuntimeGroup);
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
      if (!this.settings.groupFoldingEnabled) return;
      const groups = this.runtimeGroups;
      if (!this.needsRegrouping(container, groups)) return;
      const allProps = Array.from(
        container.querySelectorAll(".metadata-property")
      );
      if (allProps.length === 0) return;
      const topLevelProp = allProps.find((p) => !p.closest(".ffg-group-body"));
      const existingWrapper = container.querySelector(".ffg-group");
      const mainParent = (_b = (_a = topLevelProp == null ? void 0 : topLevelProp.parentElement) != null ? _a : existingWrapper == null ? void 0 : existingWrapper.parentElement) != null ? _b : null;
      if (!mainParent) return;
      let state = this.foldState.get(container);
      if (!state) {
        state = /* @__PURE__ */ new Map();
        for (const g of groups) state.set(g.id, g.defaultFolded);
        this.foldState.set(container, state);
      }
      const topSet = new Set(this.settings.topZone.fieldOrder);
      const expectedGroup = (p) => {
        var _a2;
        const key = (_a2 = p.dataset.propertyKey) != null ? _a2 : "";
        if (topSet.has(key)) return null;
        for (const g of groups) {
          if (g.matcher(key)) return g.id;
        }
        return null;
      };
      const propsByGroup = /* @__PURE__ */ new Map();
      for (const p of allProps) {
        const gid = expectedGroup(p);
        if (gid !== null) {
          const arr = (_c = propsByGroup.get(gid)) != null ? _c : [];
          arr.push(p);
          propsByGroup.set(gid, arr);
        }
      }
      for (const g of groups) {
        const props = (_d = propsByGroup.get(g.id)) != null ? _d : [];
        let wrapper = container.querySelector(
          `.ffg-group[data-group-id="${g.id}"]`
        );
        if (props.length === 0) {
          if (wrapper) this.unwrapOne(wrapper);
          continue;
        }
        if (!wrapper) {
          const folded = (_e = state.get(g.id)) != null ? _e : g.defaultFolded;
          wrapper = this.createWrapper(g, folded, container);
          mainParent.appendChild(wrapper);
        }
        const body = wrapper.querySelector(".ffg-group-body");
        if (!body) continue;
        const ordered = orderByFieldOrder(props, g.fieldOrder);
        for (const p of ordered) body.appendChild(p);
        const count = wrapper.querySelector(".ffg-count");
        if (count) count.textContent = `(${props.length})`;
      }
      for (const p of allProps) {
        if (expectedGroup(p) === null && p.closest(".ffg-group-body")) {
          mainParent.appendChild(p);
        }
      }
      if (topSet.size > 0) {
        const topProps = allProps.filter(
          (p) => {
            var _a2;
            return topSet.has((_a2 = p.dataset.propertyKey) != null ? _a2 : "");
          }
        );
        if (topProps.length > 0) {
          const orderedTop = orderByFieldOrder(topProps, this.settings.topZone.fieldOrder);
          for (let i = orderedTop.length - 1; i >= 0; i--) {
            mainParent.insertBefore(orderedTop[i], mainParent.firstChild);
          }
        }
      }
    } catch (e) {
      console.error("[FFG] processContainer error", e);
    }
  }
  createWrapper(g, folded, container) {
    const wrapper = document.createElement("div");
    wrapper.className = "ffg-group";
    if (folded) wrapper.classList.add("ffg-folded");
    wrapper.dataset.groupId = g.id;
    const header = document.createElement("div");
    header.className = "ffg-group-header";
    const chevron = document.createElement("span");
    chevron.className = "ffg-chevron";
    (0, import_obsidian.setIcon)(chevron, folded ? "chevron-right" : "chevron-down");
    const name = document.createElement("span");
    name.className = "ffg-name";
    name.textContent = g.name;
    const count = document.createElement("span");
    count.className = "ffg-count";
    count.textContent = "(0)";
    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);
    const body = document.createElement("div");
    body.className = "ffg-group-body";
    if (folded) body.style.display = "none";
    const blockBubbling = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    header.addEventListener("mousedown", blockBubbling, true);
    header.addEventListener("mouseup", blockBubbling, true);
    header.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const groupState = this.foldState.get(container);
        if (!groupState) return;
        const newFolded = !groupState.get(g.id);
        groupState.set(g.id, newFolded);
        body.style.display = newFolded ? "none" : "";
        (0, import_obsidian.setIcon)(chevron, newFolded ? "chevron-right" : "chevron-down");
        wrapper.classList.toggle("ffg-folded", newFolded);
      },
      true
    );
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }
  needsRegrouping(container, groups) {
    var _a;
    const allProps = Array.from(
      container.querySelectorAll(".metadata-property")
    );
    const topSet = new Set(this.settings.topZone.fieldOrder);
    for (const p of allProps) {
      const key = (_a = p.dataset.propertyKey) != null ? _a : "";
      let shouldBeIn = null;
      if (!topSet.has(key)) {
        for (const g of groups) {
          if (g.matcher(key)) {
            shouldBeIn = g.id;
            break;
          }
        }
      }
      const inBody = p.closest(".ffg-group-body");
      if (shouldBeIn === null) {
        if (inBody) return true;
      } else {
        if (!inBody) return true;
        const wrapper = inBody.closest(".ffg-group");
        if ((wrapper == null ? void 0 : wrapper.dataset.groupId) !== shouldBeIn) return true;
      }
    }
    if (topSet.size > 0) {
      const topProps = allProps.filter((p) => {
        var _a2;
        return topSet.has((_a2 = p.dataset.propertyKey) != null ? _a2 : "");
      });
      if (topProps.length > 0) {
        const ordered = orderByFieldOrder(topProps, this.settings.topZone.fieldOrder);
        const parent = ordered[0].parentElement;
        if (!parent) return true;
        const topLevelProps = [];
        for (const child of Array.from(parent.children)) {
          if (child instanceof HTMLElement && child.classList.contains("metadata-property")) {
            topLevelProps.push(child);
            if (topLevelProps.length >= ordered.length) break;
          }
        }
        for (let i = 0; i < ordered.length; i++) {
          if (topLevelProps[i] !== ordered[i]) return true;
        }
      }
    }
    for (const g of groups) {
      if (g.fieldOrder.length === 0) continue;
      const wrapper = container.querySelector(
        `.ffg-group[data-group-id="${g.id}"]`
      );
      if (!wrapper) continue;
      const body = wrapper.querySelector(".ffg-group-body");
      if (!body) continue;
      const groupProps = Array.from(body.querySelectorAll(".metadata-property"));
      const ordered = orderByFieldOrder(groupProps, g.fieldOrder);
      for (let i = 0; i < groupProps.length; i++) {
        if (groupProps[i] !== ordered[i]) return true;
      }
    }
    return false;
  }
  unwrapAll() {
    document.querySelectorAll(".ffg-group").forEach((wrapper) => this.unwrapOne(wrapper));
  }
  ensureSettingsGear(container) {
    const addBtn = container.querySelector(".metadata-add-button");
    if (!addBtn) return;
    if (addBtn.querySelector(".ffg-settings-gear")) return;
    const gear = document.createElement("div");
    gear.className = "ffg-settings-gear";
    gear.setAttribute("aria-label", "Foldable Frontmatter Groups settings");
    gear.setAttribute("role", "button");
    (0, import_obsidian.setIcon)(gear, "settings");
    const stopAll = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
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
    addBtn.appendChild(gear);
  }
  unwrapOne(wrapper) {
    const body = wrapper.querySelector(".ffg-group-body");
    const parent = wrapper.parentElement;
    if (parent && body) {
      Array.from(body.children).forEach((child) => {
        parent.insertBefore(child, wrapper);
      });
    }
    wrapper.remove();
  }
  // ── Canonical order + reconcile ─────────────────────────────────────────────
  computeCanonicalOrder(keys) {
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
        if (g.matcher(k)) {
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
  async reconcileFrontmatter(file) {
    if (!file || file.extension !== "md") return "skipped";
    try {
      let outcome = "no-frontmatter";
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const currentKeys = Object.keys(fm).filter((k) => k !== "position");
        if (currentKeys.length === 0) {
          outcome = "no-frontmatter";
          return;
        }
        const desiredKeys = this.computeCanonicalOrder(currentKeys);
        let same = currentKeys.length === desiredKeys.length;
        if (same) {
          for (let i = 0; i < currentKeys.length; i++) {
            if (currentKeys[i] !== desiredKeys[i]) {
              same = false;
              break;
            }
          }
        }
        if (same) {
          outcome = "noop";
          return;
        }
        const snapshot = {};
        for (const k of currentKeys) snapshot[k] = fm[k];
        for (const k of currentKeys) delete fm[k];
        for (const k of desiredKeys) fm[k] = snapshot[k];
        outcome = "rewrote";
      });
      return outcome;
    } catch (e) {
      console.error("[FFG] reconcileFrontmatter error", file.path, e);
      return "error";
    }
  }
};
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
var FfgSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
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
    const bodyEl = containerEl.createDiv("ffg-settings-body");
    const applyPausedState = (enabled) => {
      banner.style.display = enabled ? "none" : "";
      bodyEl.toggleClass("ffg-settings-disabled", !enabled);
    };
    applyPausedState(this.plugin.settings.groupFoldingEnabled);
    new import_obsidian.Setting(bodyEl).setName("Reconcile frontmatter on file leave").setDesc(
      "When you switch away from a file, rewrite its YAML key order to match the Properties panel display. Off by default."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.reconcileOnLeave).onChange(async (value) => {
        this.plugin.settings.reconcileOnLeave = value;
        await this.plugin.saveSettings();
      })
    );
    bodyEl.createEl("h3", { text: "Properties Order" });
    bodyEl.createEl("p", {
      text: "Properties listed here appear at the top of the Properties panel, in this order. Overrides group matching.",
      cls: "setting-item-description"
    });
    const topListContainer = bodyEl.createDiv("ffg-field-order-list");
    this.renderFieldOrderList(
      topListContainer,
      () => this.plugin.settings.topZone.fieldOrder,
      async (list) => {
        this.plugin.settings.topZone.fieldOrder = list;
        await this.plugin.saveSettings();
      },
      () => {
        const matchers = this.plugin.settings.groups.map(
          (g) => toRuntimeGroup(g).matcher
        );
        return (key) => !matchers.some((m) => m(key));
      }
    );
    bodyEl.createEl("h3", { text: "Groups" });
    const groupsContainer = bodyEl.createDiv("ffg-settings-groups");
    this.renderGroups(groupsContainer);
    new import_obsidian.Setting(bodyEl).addButton(
      (btn) => btn.setButtonText("+ Add Group").onClick(async () => {
        this.plugin.settings.groups.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          name: "New Group",
          matcherType: "prefix",
          matcherValue: "",
          defaultFolded: true,
          fieldOrder: []
        });
        await this.plugin.saveSettings();
        this.renderGroups(groupsContainer);
      })
    );
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
  renderGroupCard(container, group, index, total) {
    const card = container.createDiv("ffg-settings-card");
    new import_obsidian.Setting(card).setName("Name").addExtraButton(
      (btn) => btn.setIcon("arrow-up").setTooltip("Move up").setDisabled(index === 0).onClick(async () => {
        const groups = this.plugin.settings.groups;
        const i = groups.findIndex((g) => g.id === group.id);
        if (i <= 0) return;
        [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]];
        await this.plugin.saveSettings();
        this.renderGroups(container);
      })
    ).addExtraButton(
      (btn) => btn.setIcon("arrow-down").setTooltip("Move down").setDisabled(index === total - 1).onClick(async () => {
        const groups = this.plugin.settings.groups;
        const i = groups.findIndex((g) => g.id === group.id);
        if (i < 0 || i >= groups.length - 1) return;
        [groups[i], groups[i + 1]] = [groups[i + 1], groups[i]];
        await this.plugin.saveSettings();
        this.renderGroups(container);
      })
    ).addExtraButton(
      (btn) => btn.setIcon("trash").setTooltip("Delete group").onClick(async () => {
        this.plugin.settings.groups = this.plugin.settings.groups.filter(
          (g) => g.id !== group.id
        );
        await this.plugin.saveSettings();
        this.renderGroups(container);
      })
    ).addText(
      (text) => text.setValue(group.name).onChange(async (value) => {
        group.name = value;
        await this.plugin.saveSettings();
      })
    ).addDropdown(
      (dd) => dd.addOption("true", "Collapsed").addOption("false", "Expanded").setValue(group.defaultFolded ? "true" : "false").onChange(async (value) => {
        group.defaultFolded = value === "true";
        await this.plugin.saveSettings();
      })
    );
    const placeholderByType = {
      prefix: "Add prefix (e.g. ai_) and press Enter",
      regex: "Add regex pattern and press Enter",
      list: "Add exact field name and press Enter"
    };
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
    new import_obsidian.Setting(card).setName("Match by").addDropdown(
      (dd) => dd.addOption("prefix", "Prefix").addOption("regex", "Regex").addOption("list", "Exact list").setValue(group.matcherType).onChange(async (value) => {
        group.matcherType = value;
        await this.plugin.saveSettings();
        this.renderGroups(container);
      })
    ).addText((text) => {
      text.setPlaceholder(placeholderByType[group.matcherType]);
      inputEl = text.inputEl;
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
      });
    }).addExtraButton(
      (btn) => btn.setIcon("plus").setTooltip("Add criterion").onClick(() => void commit())
    );
    pillList = card.createDiv("ffg-pill-list");
    for (const v of group.matcherValues) renderPill(v);
    if (group.matcherType === "list" && inputEl) {
      new FrontmatterKeySuggest(
        this.app,
        inputEl,
        async (value) => {
          if (!inputEl) return;
          inputEl.value = "";
          if (group.matcherValues.includes(value)) return;
          group.matcherValues.push(value);
          renderPill(value);
          await this.plugin.saveSettings();
        },
        {
          filter: () => (key) => !group.matcherValues.includes(key)
        }
      );
    }
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
      () => toRuntimeGroup(group).matcher
    );
  }
};
