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
    this.unwrapAll();
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
    if (!this.settings.groupFoldingEnabled) {
      this.unwrapAll();
      return;
    }
    this.isProcessing = true;
    try {
      this.unwrapAll();
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

  private processContainer(container: HTMLElement) {
    try {
      this.ensureSettingsGear(container);

      if (!this.settings.groupFoldingEnabled) return;

      const groups = this.runtimeGroups;
      if (!this.needsRegrouping(container, groups)) return;

      const allProps = Array.from(
        container.querySelectorAll<HTMLElement>(".metadata-property")
      );
      if (allProps.length === 0) return;

      const topLevelProp = allProps.find((p) => !p.closest(".ffg-group-body"));
      const existingWrapper = container.querySelector<HTMLElement>(".ffg-group");
      const mainParent =
        topLevelProp?.parentElement ?? existingWrapper?.parentElement ?? null;
      if (!mainParent) return;

      let state = this.foldState.get(container);
      if (!state) {
        state = new Map();
        for (const g of groups) state.set(g.id, g.defaultFolded);
        this.foldState.set(container, state);
      }

      const topSet = new Set(this.settings.topZone.fieldOrder);

      const expectedGroup = (p: HTMLElement): string | null => {
        const key = p.dataset.propertyKey ?? "";
        if (topSet.has(key)) return null;
        for (const g of groups) {
          if (g.matcher(key)) return g.id;
        }
        return null;
      };

      const propsByGroup = new Map<string, HTMLElement[]>();
      for (const p of allProps) {
        const gid = expectedGroup(p);
        if (gid !== null) {
          const arr = propsByGroup.get(gid) ?? [];
          arr.push(p);
          propsByGroup.set(gid, arr);
        }
      }

      for (const g of groups) {
        const props = propsByGroup.get(g.id) ?? [];
        let wrapper = container.querySelector<HTMLElement>(
          `.ffg-group[data-group-id="${g.id}"]`
        );

        if (props.length === 0) {
          if (wrapper) this.unwrapOne(wrapper);
          continue;
        }

        if (!wrapper) {
          const folded = state.get(g.id) ?? g.defaultFolded;
          wrapper = this.createWrapper(g, folded, container);
          mainParent.appendChild(wrapper);
        }

        const body = wrapper.querySelector<HTMLElement>(".ffg-group-body");
        if (!body) continue;

        const ordered = orderByFieldOrder(props, g.fieldOrder);
        for (const p of ordered) body.appendChild(p);

        const count = wrapper.querySelector<HTMLElement>(".ffg-count");
        if (count) count.textContent = `(${props.length})`;
      }

      for (const p of allProps) {
        if (expectedGroup(p) === null && p.closest(".ffg-group-body")) {
          mainParent.appendChild(p);
        }
      }

      // Top zone: position listed top-zone props at the start of mainParent in configured order.
      if (topSet.size > 0) {
        const topProps = allProps.filter((p) =>
          topSet.has(p.dataset.propertyKey ?? "")
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

  private createWrapper(
    g: RuntimeGroup,
    folded: boolean,
    container: HTMLElement
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "ffg-group";
    if (folded) wrapper.classList.add("ffg-folded");
    wrapper.dataset.groupId = g.id;

    const header = document.createElement("div");
    header.className = "ffg-group-header";

    const chevron = document.createElement("span");
    chevron.className = "ffg-chevron";
    setIcon(chevron, folded ? "chevron-right" : "chevron-down");

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
        const groupState = this.foldState.get(container);
        if (!groupState) return;
        const newFolded = !groupState.get(g.id);
        groupState.set(g.id, newFolded);
        body.style.display = newFolded ? "none" : "";
        setIcon(chevron, newFolded ? "chevron-right" : "chevron-down");
        wrapper.classList.toggle("ffg-folded", newFolded);
      },
      true
    );

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  private needsRegrouping(container: HTMLElement, groups: RuntimeGroup[]): boolean {
    const allProps = Array.from(
      container.querySelectorAll<HTMLElement>(".metadata-property")
    );
    const topSet = new Set(this.settings.topZone.fieldOrder);

    for (const p of allProps) {
      const key = p.dataset.propertyKey ?? "";
      let shouldBeIn: string | null = null;
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
        const wrapper = inBody.closest(".ffg-group") as HTMLElement | null;
        if (wrapper?.dataset.groupId !== shouldBeIn) return true;
      }
    }

    if (topSet.size > 0) {
      const topProps = allProps.filter((p) => topSet.has(p.dataset.propertyKey ?? ""));
      if (topProps.length > 0) {
        const ordered = orderByFieldOrder(topProps, this.settings.topZone.fieldOrder);
        const parent = ordered[0].parentElement;
        if (!parent) return true;
        const topLevelProps: HTMLElement[] = [];
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
      const wrapper = container.querySelector<HTMLElement>(
        `.ffg-group[data-group-id="${g.id}"]`
      );
      if (!wrapper) continue;
      const body = wrapper.querySelector<HTMLElement>(".ffg-group-body");
      if (!body) continue;
      const groupProps = Array.from(body.querySelectorAll<HTMLElement>(".metadata-property"));
      const ordered = orderByFieldOrder(groupProps, g.fieldOrder);
      for (let i = 0; i < groupProps.length; i++) {
        if (groupProps[i] !== ordered[i]) return true;
      }
    }

    return false;
  }

  private unwrapAll() {
    document
      .querySelectorAll<HTMLElement>(".ffg-group")
      .forEach((wrapper) => this.unwrapOne(wrapper));
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

  private unwrapOne(wrapper: HTMLElement) {
    const body = wrapper.querySelector<HTMLElement>(".ffg-group-body");
    const parent = wrapper.parentElement;
    if (parent && body) {
      Array.from(body.children).forEach((child) => {
        parent.insertBefore(child, wrapper);
      });
    }
    wrapper.remove();
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
            matcherValue: "",
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
