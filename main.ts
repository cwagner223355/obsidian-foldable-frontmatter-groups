import {
  Plugin,
  PluginSettingTab,
  App,
  Setting,
  AbstractInputSuggest,
  TFile,
  Notice,
  setIcon,
} from "obsidian";

// ── Serializable settings schema ──────────────────────────────────────────────

interface StoredGroupConfig {
  id: string;
  name: string;
  matcherType: "prefix" | "regex" | "list";
  matcherValues: string[];
  defaultFolded: boolean;
  fieldOrder: string[];
}

interface PluginSettings {
  groupFoldingEnabled: boolean;
  reconcileOnLeave: boolean;
  topZone: { fieldOrder: string[] };
  groups: StoredGroupConfig[];
}

const DEFAULT_SETTINGS: PluginSettings = {
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
      fieldOrder: [],
    },
    {
      id: "hidden",
      name: "Hidden Properties",
      matcherType: "prefix",
      matcherValues: ["_"],
      defaultFolded: true,
      fieldOrder: [],
    },
  ],
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
  matcher: (key: string) => boolean;
  defaultFolded: boolean;
  fieldOrder: string[];
}

function toRuntimeGroup(g: StoredGroupConfig): RuntimeGroup {
  const values = (g.matcherValues ?? []).filter((v) => v && v.length > 0);
  let matcher: (key: string) => boolean;

  if (g.matcherType === "regex") {
    const regexes: RegExp[] = [];
    for (const v of values) {
      try {
        regexes.push(new RegExp(v));
      } catch {
        // Invalid regex silently contributes nothing.
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
    fieldOrder: g.fieldOrder ?? [],
    matcher,
  };
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class FoldableFrontmatterGroupsPlugin extends Plugin {
  settings!: PluginSettings;
  private observer: MutationObserver | null = null;
  private foldState = new WeakMap<HTMLElement, Map<string, boolean>>();
  private isProcessing = false;
  private lastActiveFile: TFile | null = null;

  async onload() {
    console.log("[FFG] loading v0.7");
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
          new Notice("[FFG] No active markdown file");
          return;
        }
        const result = await this.reconcileFrontmatter(file);
        if (result === "rewrote") new Notice("[FFG] Frontmatter reordered");
        else if (result === "noop") new Notice("[FFG] Already in canonical order");
        else if (result === "no-frontmatter") new Notice("[FFG] No frontmatter");
        else if (result === "error") new Notice("[FFG] Error — see console");
      },
    });
  }

  onunload() {
    console.log("[FFG] unloading");
    this.observer?.disconnect();
    this.observer = null;
    document
      .querySelectorAll<HTMLElement>(".metadata-container")
      .forEach((c) => this.deactivate(c));
    document
      .querySelectorAll(".ffg-settings-gear")
      .forEach((el) => el.remove());
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
    }
  }

  async saveSettings() {
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
    return this.settings.groups.map(toRuntimeGroup);
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

      if (!this.settings.groupFoldingEnabled) {
        this.deactivate(container);
        return;
      }

      container.classList.add("ffg-active");

      const groups = this.runtimeGroups;
      const allProps = Array.from(
        container.querySelectorAll<HTMLElement>(".metadata-property")
      );

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
          if (g.matcher(key)) {
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

    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);

    const blockBubbling = (e: Event) => {
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

  private ensureAddButtonOrder(container: HTMLElement) {
    const addBtn = container.querySelector<HTMLElement>(".metadata-add-button");
    if (!addBtn) return;
    const orderStr = String(FoldableFrontmatterGroupsPlugin.ADD_BUTTON_ORDER);
    if (addBtn.style.order !== orderStr) addBtn.style.order = orderStr;
  }

  private deactivate(container: HTMLElement) {
    container.classList.remove("ffg-active");
    container
      .querySelectorAll<HTMLElement>(".ffg-group-header")
      .forEach((h) => h.remove());
    container.querySelectorAll<HTMLElement>(".metadata-property").forEach((p) => {
      this.clearGroupTagging(p);
      if (p.style.order) p.style.removeProperty("order");
    });
    const addBtn = container.querySelector<HTMLElement>(".metadata-add-button");
    if (addBtn?.style.order) addBtn.style.removeProperty("order");
  }

  private ensureSettingsGear(container: HTMLElement) {
    const addBtn = container.querySelector<HTMLElement>(".metadata-add-button");
    if (!addBtn) return;
    if (addBtn.querySelector(".ffg-settings-gear")) return;

    const gear = document.createElement("div");
    gear.className = "ffg-settings-gear";
    gear.setAttribute("aria-label", "Foldable Frontmatter Groups settings");
    gear.setAttribute("role", "button");
    setIcon(gear, "settings");

    const stopAll = (e: Event) => {
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

    addBtn.appendChild(gear);
  }

  // ── Canonical order + reconcile ─────────────────────────────────────────────

  computeCanonicalOrder(keys: string[]): string[] {
    const groups = this.runtimeGroups;
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
        if (g.matcher(k)) {
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

  async reconcileFrontmatter(
    file: TFile
  ): Promise<"rewrote" | "noop" | "no-frontmatter" | "error" | "skipped"> {
    if (!file || file.extension !== "md") return "skipped";

    try {
      let outcome: "rewrote" | "noop" | "no-frontmatter" = "no-frontmatter";

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

        const snapshot: Record<string, unknown> = {};
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

// ── Settings Tab ──────────────────────────────────────────────────────────────

class FfgSettingTab extends PluginSettingTab {
  plugin: FoldableFrontmatterGroupsPlugin;

  constructor(app: App, plugin: FoldableFrontmatterGroupsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
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
    const bodyEl = containerEl.createDiv("ffg-settings-body");

    const applyPausedState = (enabled: boolean) => {
      banner.style.display = enabled ? "none" : "";
      bodyEl.toggleClass("ffg-settings-disabled", !enabled);
    };
    applyPausedState(this.plugin.settings.groupFoldingEnabled);

    new Setting(bodyEl)
      .setName("Reconcile frontmatter on file leave")
      .setDesc(
        "When you switch away from a file, rewrite its YAML key order to match the Properties panel display. Off by default."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.reconcileOnLeave)
          .onChange(async (value) => {
            this.plugin.settings.reconcileOnLeave = value;
            await this.plugin.saveSettings();
          })
      );

    bodyEl.createEl("h3", { text: "Properties Order" });
    bodyEl.createEl("p", {
      text: "Properties listed here appear at the top of the Properties panel, in this order. Overrides group matching.",
      cls: "setting-item-description",
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
        return (key: string) => !matchers.some((m) => m(key));
      }
    );

    bodyEl.createEl("h3", { text: "Groups" });

    const groupsContainer = bodyEl.createDiv("ffg-settings-groups");
    this.renderGroups(groupsContainer);

    new Setting(bodyEl).addButton((btn) =>
      btn
        .setButtonText("+ Add Group")
        .onClick(async () => {
          this.plugin.settings.groups.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            name: "New Group",
            matcherType: "prefix",
            matcherValues: [],
            defaultFolded: true,
            fieldOrder: [],
          });
          await this.plugin.saveSettings();
          this.renderGroups(groupsContainer);
        })
    );
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

  private renderGroupCard(
    container: HTMLElement,
    group: StoredGroupConfig,
    index: number,
    total: number
  ) {
    const card = container.createDiv("ffg-settings-card");

    new Setting(card)
      .setName("Name")
      .addExtraButton((btn) =>
        btn
          .setIcon("arrow-up")
          .setTooltip("Move up")
          .setDisabled(index === 0)
          .onClick(async () => {
            const groups = this.plugin.settings.groups;
            const i = groups.findIndex((g) => g.id === group.id);
            if (i <= 0) return;
            [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]];
            await this.plugin.saveSettings();
            this.renderGroups(container);
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("arrow-down")
          .setTooltip("Move down")
          .setDisabled(index === total - 1)
          .onClick(async () => {
            const groups = this.plugin.settings.groups;
            const i = groups.findIndex((g) => g.id === group.id);
            if (i < 0 || i >= groups.length - 1) return;
            [groups[i], groups[i + 1]] = [groups[i + 1], groups[i]];
            await this.plugin.saveSettings();
            this.renderGroups(container);
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Delete group")
          .onClick(async () => {
            this.plugin.settings.groups = this.plugin.settings.groups.filter(
              (g) => g.id !== group.id
            );
            await this.plugin.saveSettings();
            this.renderGroups(container);
          })
      )
      .addText((text) =>
        text
          .setValue(group.name)
          .onChange(async (value) => {
            group.name = value;
            await this.plugin.saveSettings();
          })
      )
      .addDropdown((dd) =>
        dd
          .addOption("true", "Collapsed")
          .addOption("false", "Expanded")
          .setValue(group.defaultFolded ? "true" : "false")
          .onChange(async (value) => {
            group.defaultFolded = value === "true";
            await this.plugin.saveSettings();
          })
      );

    const placeholderByType: Record<StoredGroupConfig["matcherType"], string> = {
      prefix: "Add prefix (e.g. ai_) and press Enter",
      regex: "Add regex pattern and press Enter",
      list: "Add exact field name and press Enter",
    };

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
      .setName("Match by")
      .addDropdown((dd) =>
        dd
          .addOption("prefix", "Prefix")
          .addOption("regex", "Regex")
          .addOption("list", "Exact list")
          .setValue(group.matcherType)
          .onChange(async (value) => {
            group.matcherType = value as StoredGroupConfig["matcherType"];
            await this.plugin.saveSettings();
            this.renderGroups(container);
          })
      )
      .addText((text) => {
        text.setPlaceholder(placeholderByType[group.matcherType]);
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
          .setTooltip("Add criterion")
          .onClick(() => void commit())
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
          filter: () => (key: string) => !group.matcherValues.includes(key),
        }
      );
    }

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
      () => toRuntimeGroup(group).matcher
    );

  }
}
