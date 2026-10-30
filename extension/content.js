(async () => {
  const extensionApi = globalThis.browser || globalThis.chrome;
  if (globalThis.zammadMultiSearch) return;
  globalThis.zammadMultiSearch = true;
  let privateMode = false;
  let temporaryMode = false;
  try {
    const result = await extensionApi.runtime.sendMessage({ type: "search-tabs:status" });
    privateMode = Boolean(result?.privateMode);
    temporaryMode = privateMode && !result?.sharedSearches;
    if (!result?.enabled) {
      globalThis.zammadMultiSearch = false;
      document.dispatchEvent(new Event("zammad-multi-search:stop"));
      return;
    }
  } catch {
    globalThis.zammadMultiSearch = false;
    return;
  }

  const labels = {
    en: { close: "Close search", rename: "Rename search", name: "Search tab name", error: "Changes are kept on this page. Could not save them yet; retrying." },
    pl: { close: "Zamknij wyszukiwanie", rename: "Zmień nazwę wyszukiwania", name: "Nazwa karty wyszukiwania", error: "Zmiany pozostają na tej stronie. Zapis jeszcze się nie udał; ponawiam próbę." }
  };

  let currentState = null;
  let storageKey = "";
  let loadedKey = "";
  let loadingKey = "";
  let scopeVersion = 0;
  let openSearches = [];
  let searchNames = new Map();
  let searchAnchors = new Map();
  let nameEditor = null;
  let drag = null;
  let suppressClick = false;
  let dirty = false;
  let writing = false;
  let pendingWrite;
  let storageError = false;
  let retryTimer;
  let typingTimer;
  let typing = false;
  let editingQuery = "";
  let lastQuery = "";
  let lastUserId = "";
  let tabTemplate = null;
  let renderPending = false;
  let stopped = false;
  let stopping;
  let receivedStates = 0;
  let reportedReady;
  const closedWhileLoading = new Set();

  const searchBuilder = globalThis.ZammadSearchBuilder.create({
    readState: () => { requestState(true); return currentState; },
    applyQuery: query => {
      finishTyping();
      replaceSearch(currentState?.query.trim() || editingQuery, query);
      location.hash = `#search/${encodeURIComponent(query)}`;
    }
  });

  function text() {
    return labels[currentState?.locale?.slice(0, 2)] || labels.en;
  }

  function searchIsOpen() {
    return /^#search(?:\/|$)/.test(location.hash);
  }

  function isSearchInput(element) {
    return element instanceof Element && element.matches('.detail-search .js-search, form.search-holder .js-search');
  }

  function requestState(includeOptions = false) {
    if (stopped) return;
    try {
      if (!extensionApi.runtime.id) return stop();
      document.dispatchEvent(new CustomEvent("zammad-multi-search:request", { detail: includeOptions === true ? "options" : "" }));
    } catch {
      stop();
    }
  }

  function scheduleRender() {
    if (renderPending || stopped) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      render();
    });
  }

  function readSearches(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(query => typeof query === "string" && query.trim()).map(query => query.trim()))];
  }

  function settingsKey(key = storageKey) {
    return key.replace(/^searches:/, "searchSettings:");
  }

  function readSettings(value) {
    const entries = field => Object.entries(value?.[field] || {}).filter(([query]) => openSearches.includes(query));
    searchNames = new Map(entries("names").filter(([, name]) => typeof name === "string" && name.trim()).map(([query, name]) => [query, name.trim().slice(0, 160)]));
    searchAnchors = new Map(entries("anchors").filter(([, anchor]) => anchor === null || typeof anchor === "string"));
  }

  async function readStored(keys) {
    if (!temporaryMode) return extensionApi.storage.local.get(keys);
    const result = await extensionApi.runtime.sendMessage({ type: "search-tabs:private-data", operation: "read", keys });
    if (!result?.ok) throw new Error(result?.error || "Private storage is unavailable.");
    return result.data;
  }

  async function writeStored(data) {
    if (!temporaryMode) return extensionApi.storage.local.set(data);
    const result = await extensionApi.runtime.sendMessage({ type: "search-tabs:private-data", operation: "write", data });
    if (!result?.ok) throw new Error(result?.error || "Private storage is unavailable.");
  }

  function saveChanges() {
    openSearches = [...openSearches];
    dirty = true;
    scheduleRender();
    persistSearches();
  }

  async function loadSearches() {
    if (!storageKey || loadedKey === storageKey || loadingKey === storageKey) return;
    const key = storageKey;
    const version = scopeVersion;
    loadingKey = key;

    try {
      const stored = await readStored([key, settingsKey(key)]);
      if (scopeVersion !== version || stopped) return;
      openSearches = [...new Set([...readSearches(stored[key]), ...openSearches])].filter(query => !closedWhileLoading.has(query));
      readSettings(stored[settingsKey(key)]);
      closedWhileLoading.clear();
      loadedKey = key;
      storageError = false;
      persistSearches();
    } catch {
      if (scopeVersion === version) storageError = true;
    } finally {
      if (scopeVersion === version) {
        loadingKey = "";
        scheduleRender();
      }
    }
  }

  async function persistSearches() {
    if (stopped || writing || !dirty || !storageKey || loadedKey !== storageKey) return;
    clearTimeout(retryTimer);
    const key = storageKey;
    const version = scopeVersion;
    const snapshot = openSearches;
    let failed = false;
    writing = true;

    try {
      pendingWrite = writeStored({ [key]: snapshot, [settingsKey(key)]: { names: Object.fromEntries(searchNames), anchors: Object.fromEntries(searchAnchors) } });
      await pendingWrite;
      if (scopeVersion === version) {
        if (openSearches === snapshot) dirty = false;
        storageError = false;
      }
    } catch {
      failed = true;
      if (scopeVersion === version) storageError = true;
    } finally {
      writing = false;
      pendingWrite = null;
      scheduleRender();
      if (dirty && !stopped) retryTimer = setTimeout(persistSearches, failed ? 1200 : 0);
    }
  }

  function rememberSearch(query) {
    query = query.trim();
    if (!query || !storageKey || openSearches.includes(query)) return;
    closedWhileLoading.delete(query);
    openSearches = [...openSearches, query];
    dirty = true;
    scheduleRender();
    persistSearches();
  }

  function replaceSearch(previousQuery, query) {
    query = query.trim();
    if (!query || !storageKey) return;
    editingQuery = query;
    if (!openSearches.includes(previousQuery)) return rememberSearch(query);
    if (previousQuery === query) return;

    if (searchNames.has(previousQuery)) searchNames.set(query, searchNames.get(previousQuery));
    searchNames.delete(previousQuery);
    if (searchAnchors.has(previousQuery)) searchAnchors.set(query, searchAnchors.get(previousQuery));
    else searchAnchors.delete(query);
    searchAnchors.delete(previousQuery);

    const tabs = Array.from(document.querySelectorAll(".zms-tab"));
    const tab = tabs.find(item => item.dataset.zmsQuery === previousQuery);
    tabs.find(item => item !== tab && item.dataset.zmsQuery === query)?.remove();
    if (tab) {
      tab.dataset.zmsQuery = query;
      tab.querySelector(".nav-tab-name").textContent = searchNames.get(query) || query;
    }

    openSearches = openSearches.filter(item => item !== query).map(item => item === previousQuery ? query : item);
    if (loadedKey !== storageKey) closedWhileLoading.add(previousQuery);
    closedWhileLoading.delete(query);
    dirty = true;
    scheduleRender();
    persistSearches();
  }

  function activeSearchQuery() {
    if (!searchIsOpen()) return "";
    const query = currentState?.query.trim() || "";
    if (typing && openSearches.includes(editingQuery)) return editingQuery;
    if (openSearches.includes(query)) return query;
    return openSearches.includes(editingQuery) ? editingQuery : query;
  }

  function receiveState(event) {
    let state;
    try {
      state = JSON.parse(event.detail);
    } catch {
      return;
    }

    receivedStates++;
    currentState = state && typeof state.userId === "string" && typeof state.query === "string" ? state : null;
    const nextKey = currentState ? `searches:${location.origin}${location.pathname}:${currentState.userId}` : "";

    if (nextKey !== storageKey) {
      finishRename(false);
      finishDrag(false);
      scopeVersion++;
      storageKey = nextKey;
      loadedKey = "";
      loadingKey = "";
      openSearches = [];
      searchNames = new Map();
      searchAnchors = new Map();
      dirty = false;
      storageError = false;
      lastQuery = lastUserId && currentState?.userId !== lastUserId ? currentState?.query.trim() || "" : "";
      tabTemplate = null;
      closedWhileLoading.clear();
      clearTimeout(typingTimer);
      typing = false;
      editingQuery = "";
    }

    const query = currentState?.query.trim() || "";
    if (currentState) lastUserId = currentState.userId;
    if (query !== lastQuery) {
      lastQuery = query;
      if (!typing) {
        rememberSearch(query);
        if (query) editingQuery = query;
      }
    }

    loadSearches();
    scheduleRender();
  }

  function finishTyping() {
    clearTimeout(typingTimer);
    if (!typing) return;
    const key = storageKey;
    requestState();
    typing = false;
    if (storageKey === key && currentState) replaceSearch(editingQuery, currentState.query);
  }

  function onInput(event) {
    if (!isSearchInput(event.target)) return;
    if (!typing) {
      requestState();
      editingQuery = currentState?.query.trim() || editingQuery;
    }
    typing = true;
    clearTimeout(typingTimer);
    if (!event.isComposing) typingTimer = setTimeout(finishTyping, 700);
  }

  function commitInput(input) {
    const key = storageKey;
    requestState();
    const previousQuery = typing ? editingQuery : currentState?.query.trim() || editingQuery;
    clearTimeout(typingTimer);
    typing = false;
    if (key === storageKey && currentState) replaceSearch(previousQuery, input.value);
  }

  function onSubmit(event) {
    const input = event.target.querySelector('.js-search');
    if (isSearchInput(input)) commitInput(input);
  }

  function onBlur(event) {
    if (event.target === nameEditor?.input) finishRename(true);
    if (isSearchInput(event.target)) finishTyping();
  }

  function onHashChange() {
    if (!searchIsOpen()) finishTyping();
    requestState();
  }

  function icon(name, sprite) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", `icon icon-${name}`);
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `${sprite}#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function iconReference(use) {
    return use?.getAttribute("href") || use?.getAttributeNS("http://www.w3.org/1999/xlink", "href") || use?.getAttribute("xlink:href") || "";
  }

  function searchTemplate(nativeSearch) {
    const template = document.createElement("div");
    const nativeIcon = nativeSearch?.querySelector(".nav-tab-icon");
    const nativeClose = nativeSearch?.querySelector(".nav-tab-close") || document.querySelector('.tasks-navigation > a .nav-tab-close');
    if (nativeClose) {
      template.style.setProperty("--zms-actions-inset", getComputedStyle(nativeClose).paddingInlineEnd);
      const size = nativeClose.querySelector(".nav-tab-close-inner")?.getBoundingClientRect().width;
      if (size) template.style.setProperty("--zms-action-size", `${size}px`);
    }
    const nativeSearchSvg = nativeIcon?.querySelector("svg.icon-searchdetail");
    const nativeUse = nativeSearchSvg?.querySelector("use");
    const nativeReference = iconReference(nativeUse);
    const hasSearchIcon = Boolean(nativeSearchSvg && (nativeUse
      ? nativeReference.endsWith("#icon-searchdetail") && (!nativeReference.startsWith("#") || document.getElementById("icon-searchdetail"))
      : nativeSearchSvg.querySelector("path, circle, rect, polygon")));
    const references = [nativeUse, nativeClose?.querySelector("use"), ...document.querySelectorAll('.tasks-navigation > a use')].map(iconReference).filter(Boolean);
    const sprite = (references.find(reference => !reference.startsWith("#")) || references[0] || "").split("#")[0];
    const tabIcon = hasSearchIcon ? nativeIcon.cloneNode(true) : document.createElement("div");
    tabIcon.className = "nav-tab-icon";
    if (!hasSearchIcon) {
      const searchIcon = icon("searchdetail", sprite);
      if (!sprite && !document.getElementById("icon-searchdetail")) {
        searchIcon.setAttribute("viewBox", "0 0 24 24");
        searchIcon.innerHTML = '<circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 14.5L21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
      }
      tabIcon.append(searchIcon);
    }
    tabIcon.setAttribute("aria-hidden", "true");

    const name = document.createElement("div");
    name.className = "nav-tab-name u-textTruncate flex";

    const close = nativeClose ? nativeClose.cloneNode(true) : document.createElement("div");
    close.className = "nav-tab-close zms-close";
    close.setAttribute("role", "button");
    close.tabIndex = 0;
    if (!nativeClose) {
      const inner = document.createElement("div");
      inner.className = "nav-tab-close-inner";
      inner.append(icon("diagonal-cross", sprite));
      close.append(inner);
    }

    const rename = close.cloneNode(true);
    rename.className = "nav-tab-close zms-rename";
    const pencil = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pencil.setAttribute("viewBox", "0 0 16 16");
    pencil.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(pencil.namespaceURI, "path");
    path.setAttribute("d", "M10.5 1.5a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-8.8 8.8L1 15l.7-4.7zm-7.4 9.4-.4 2.4 2.4-.4 6.6-6.6-2-2zm7.6-7.6 2 2 1-1-2-2z");
    pencil.append(path);
    const renameInner = rename.firstElementChild || rename.appendChild(document.createElement("div"));
    renameInner.className = "nav-tab-close-inner";
    renameInner.replaceChildren(pencil);
    const actions = document.createElement("div");
    actions.className = "zms-actions";
    actions.append(rename, close);
    template.append(tabIcon, name, actions);
    return template;
  }

  function startRename(tab) {
    if (loadedKey !== storageKey) return;
    finishRename(true);
    const query = tab.dataset.zmsQuery;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control zms-name-editor";
    input.value = searchNames.get(query) || "";
    input.placeholder = query;
    input.maxLength = 160;
    input.setAttribute("aria-label", text().name);
    nameEditor = { input, query, key: storageKey };
    tab.classList.add("zms-renaming");
    tab.querySelector(".nav-tab-name").replaceChildren(input);
    input.focus();
    input.select();
  }

  function finishRename(save, restoreFocus = false) {
    if (!nameEditor) return;
    const { input, query, key } = nameEditor;
    const tab = input.closest(".zms-tab");
    nameEditor = null;
    if (save && key === storageKey && openSearches.includes(query)) {
      const name = input.value.trim().slice(0, 160);
      if (name) searchNames.set(query, name);
      else searchNames.delete(query);
      saveChanges();
    }
    if (tab) {
      tab.classList.remove("zms-renaming");
      tab.querySelector(".nav-tab-name").textContent = searchNames.get(query) || query;
      if (restoreFocus) tab.focus({ preventScroll: true });
    }
  }

  function saveTabOrder(navigation) {
    const tabs = Array.from(navigation.querySelectorAll(":scope > .zms-tab"));
    const order = tabs.map(tab => tab.dataset.zmsQuery).filter(query => openSearches.includes(query));
    openSearches = [...order, ...openSearches.filter(query => !order.includes(query))];
    for (const tab of tabs) {
      let next = tab.nextElementSibling;
      while (next && !next.matches("a[data-key]")) next = next.nextElementSibling;
      searchAnchors.set(tab.dataset.zmsQuery, next?.dataset.key ?? null);
    }
    saveChanges();
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !event.isPrimary || loadedKey !== storageKey) return;
    if (event.target.closest?.(".zms-close, .zms-rename, .zms-name-editor")) return;
    const tab = event.target.closest?.(".zms-tab");
    if (!tab) return;
    finishRename(true);
    event.preventDefault();
    event.stopPropagation();
    tab.focus({ preventScroll: true });
    drag = { tab, navigation: tab.parentElement, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false, placeholder: null, bounds: tab.getBoundingClientRect() };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { tab, navigation } = drag;
    if (!tab.isConnected) return finishDrag(false);
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 15) return;
      drag.started = true;
      const placeholder = document.createElement("div");
      placeholder.className = "nav-tab zms-placeholder";
      placeholder.style.blockSize = `${drag.bounds.height}px`;
      drag.placeholder = placeholder;
      navigation.insertBefore(placeholder, tab);
      tab.style.inlineSize = `${drag.bounds.width}px`;
      tab.classList.add("zms-dragging");
      tab.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    tab.style.left = `${drag.bounds.left + event.clientX - drag.x}px`;
    tab.style.top = `${drag.bounds.top + event.clientY - drag.y}px`;
    const area = navigation.getBoundingClientRect();
    if (event.clientY < area.top + 24) navigation.scrollTop -= 12;
    else if (event.clientY > area.bottom - 24) navigation.scrollTop += 12;
    const target = Array.from(navigation.children).find(element => {
      if (element === tab || element === drag.placeholder || !element.matches(".nav-tab") || !element.getClientRects().length) return false;
      const bounds = element.getBoundingClientRect();
      return event.clientY < bounds.top + bounds.height / 2;
    });
    if (drag.placeholder.nextElementSibling !== (target || null)) navigation.insertBefore(drag.placeholder, target || null);
  }

  function finishDrag(save) {
    if (!drag) return;
    const { tab, navigation, pointerId, started, placeholder } = drag;
    drag = null;
    if (tab.hasPointerCapture(pointerId)) tab.releasePointerCapture(pointerId);
    if (save && tab.isConnected && placeholder?.isConnected) placeholder.replaceWith(tab);
    else placeholder?.remove();
    tab.classList.remove("zms-dragging");
    for (const property of ["inline-size", "left", "top"]) tab.style.removeProperty(property);
    if (!started) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (save && tab.isConnected) saveTabOrder(navigation);
    scheduleRender();
  }

  function onPointerUp(event) {
    if (drag && event.pointerId === drag.pointerId) finishDrag(event.type === "pointerup");
  }

  function createSearchTab(query) {
    const tab = tabTemplate.cloneNode(true);
    tab.className = "nav-tab task zms-tab";
    tab.dataset.zmsQuery = query;
    tab.setAttribute("role", "link");
    tab.tabIndex = 0;
    tab.querySelector(".nav-tab-name").textContent = query;
    return tab;
  }

  function reportReady(active) {
    if (reportedReady === active) return;
    reportedReady = active;
    try { extensionApi.runtime.sendMessage({ type: "search-tabs:ready", active }).catch(() => {}); } catch {}
  }

  function render() {
    if (stopped) return;
    searchBuilder.render(currentState);
    const navigation = document.querySelector(".tasks.tasks-navigation");
    if (!navigation || !currentState) {
      reportReady(false);
      return removeControls();
    }
    if (drag?.started || navigation.querySelector(".ui-sortable-helper")) return;
    if (nameEditor && !nameEditor.input.isConnected) finishRename(false);

    const nativeSearch = navigation.querySelector('[data-key="Search"]');
    tabTemplate = searchTemplate(nativeSearch);
    const currentQuery = activeSearchQuery();

    for (const tab of navigation.querySelectorAll(".zms-tab")) {
      if (!openSearches.includes(tab.dataset.zmsQuery)) tab.remove();
    }

    const orderedTabs = [];
    for (const query of openSearches) {
      let tab = Array.from(navigation.querySelectorAll(".zms-tab")).find(item => item.dataset.zmsQuery === query);
      if (!tab) {
        tab = createSearchTab(query);
        navigation.insertBefore(tab, nativeSearch);
      }

      for (const selector of [".nav-tab-icon", ".zms-close .nav-tab-close-inner"]) {
        const current = tab.querySelector(selector);
        const expected = tabTemplate.querySelector(selector);
        if (current && expected && current.outerHTML !== expected.outerHTML) current.replaceWith(expected.cloneNode(true));
      }

      const label = searchNames.get(query) || query;
      const title = label === query ? query : `${label}\n${query}`;
      tab.title = storageError ? `${title}\n${text().error}` : title;
      if (nameEditor?.query !== query) tab.querySelector(".nav-tab-name").textContent = label;
      const active = query === currentQuery;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
      const close = tab.querySelector(".zms-close");
      close.title = text().close;
      close.setAttribute("aria-label", `${text().close}: ${label}`);
      const rename = tab.querySelector(".zms-rename");
      rename.title = text().rename;
      rename.setAttribute("aria-label", `${text().rename}: ${label}`);
      rename.setAttribute("aria-disabled", String(loadedKey !== storageKey));
      tab.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      orderedTabs.push(tab);
    }

    const anchors = Array.from(navigation.querySelectorAll(":scope > a[data-key]"));
    const nextTabs = new Map();
    for (let index = orderedTabs.length - 1; index >= 0; index--) {
      const tab = orderedTabs[index];
      const key = searchAnchors.get(tab.dataset.zmsQuery);
      const anchor = key === null ? null : anchors.find(item => item.dataset.key === key) || nativeSearch;
      const nextTab = nextTabs.get(anchor) || anchor;
      if (tab.nextSibling !== nextTab) navigation.insertBefore(tab, nextTab);
      nextTabs.set(anchor, tab);
    }

    nativeSearch?.classList.toggle("zms-native-hidden", openSearches.includes(currentQuery || currentState.query.trim()));
    const order = Array.from(navigation.querySelectorAll(":scope > .zms-tab"), tab => tab.dataset.zmsQuery);
    if (loadedKey === storageKey && order.some((query, index) => query !== openSearches[index])) {
      openSearches = order;
      saveChanges();
    }
    reportReady(true);
  }

  function closeSearch(query) {
    const index = openSearches.indexOf(query);
    const active = activeSearchQuery() === query;
    openSearches = openSearches.filter(item => item !== query);
    searchNames.delete(query);
    searchAnchors.delete(query);
    if (loadedKey !== storageKey) closedWhileLoading.add(query);
    dirty = true;
    scheduleRender();
    persistSearches();

    if (!active) return;
    const nextQuery = openSearches[Math.max(0, index - 1)];
    editingQuery = nextQuery || "";
    if (nextQuery) location.hash = `#search/${encodeURIComponent(nextQuery)}`;
    else document.querySelector('.tasks-navigation [data-key="Search"] .js-close')?.click();
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest(".zms-tab");
    if (!tab) {
      const shortcut = target?.closest(".detail-search .js-shortcut");
      if (shortcut || target?.closest(".js-emptySearch")) {
        finishTyping();
        const key = storageKey;
        requestState();
        if (key === storageKey && currentState && shortcut?.dataset.query) {
          replaceSearch(currentState.query.trim() || editingQuery, shortcut.dataset.query);
        }
      }
      return;
    }

    if (target.closest(".zms-name-editor")) {
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "auxclick" || suppressClick) return;
    const key = storageKey;
    requestState();
    if (!currentState || key !== storageKey) return;
    finishTyping();

    if (target.closest(".zms-rename")) startRename(tab);
    else if (target.closest(".zms-close")) closeSearch(tab.dataset.zmsQuery);
    else {
      editingQuery = tab.dataset.zmsQuery;
      location.hash = `#search/${encodeURIComponent(tab.dataset.zmsQuery)}`;
    }
  }

  function onKeyDown(event) {
    if (event.isComposing) return;
    if (event.target === nameEditor?.input) {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finishRename(event.key === "Enter", true);
      }
      event.stopImmediatePropagation();
      return;
    }
    const tab = event.target.closest?.(".zms-tab");
    if (tab && event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key) && loadedKey === storageKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const previous = event.key === "ArrowUp";
      let sibling = previous ? tab.previousElementSibling : tab.nextElementSibling;
      while (sibling && !sibling.getClientRects().length) sibling = previous ? sibling.previousElementSibling : sibling.nextElementSibling;
      if (sibling) {
        tab.parentElement.insertBefore(tab, previous ? sibling : sibling.nextElementSibling);
        saveTabOrder(tab.parentElement);
        tab.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === "Enter" && isSearchInput(event.target)) commitInput(event.target);
    if ((event.key === "Enter" || event.key === " ") && event.target.closest?.(".zms-tab")) onClick(event);
  }

  function removeControls() {
    document.querySelectorAll(".zms-tab").forEach(element => element.remove());
    document.querySelectorAll(".zms-native-hidden").forEach(element => element.classList.remove("zms-native-hidden"));
  }

  function onStorageChanged(changes, area) {
    if (area !== (temporaryMode ? "private" : "local")) return;
    if (!privateMode && changes.enabledSites && !changes.enabledSites.newValue?.includes(location.origin)) {
      stop();
      return;
    }
    if (stopped || (!changes[storageKey] && !changes[settingsKey()]) || dirty || writing || loadedKey !== storageKey) return;
    if (changes[storageKey]) openSearches = readSearches(changes[storageKey].newValue);
    if (changes[settingsKey()]) readSettings(changes[settingsKey()].newValue);
    scheduleRender();
  }

  async function stop() {
    if (stopped) {
      try { await stopping; } catch {}
      return;
    }
    stopped = true;
    finishRename(false);
    finishDrag(false);
    stopping = pendingWrite;
    globalThis.zammadMultiSearch = false;
    clearInterval(stateTimer);
    clearTimeout(typingTimer);
    clearTimeout(retryTimer);
    observer.disconnect();
    document.removeEventListener("zammad-multi-search:state", receiveState);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("blur", onBlur, true);
    document.removeEventListener("compositionend", onInput, true);
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("lostpointercapture", onPointerUp, true);
    window.removeEventListener("hashchange", onHashChange);
    searchBuilder.destroy();
    removeControls();
    document.dispatchEvent(new Event("zammad-multi-search:stop"));
    try { extensionApi.runtime.sendMessage({ type: "search-tabs:stopped" }).catch(() => {}); } catch {}
    try { extensionApi.storage.onChanged.removeListener(onStorageChanged); } catch {}
    try { await stopping; } catch {}
    try { extensionApi.runtime.onMessage.removeListener(onMessage); } catch {}
  }

  function onMessage(message, sender, respond) {
    if (sender.id !== extensionApi.runtime.id) return;
    if (message?.type === "search-tabs:ping") {
      const before = receivedStates;
      try {
        requestState();
        render();
        const active = !stopped && receivedStates !== before && reportedReady === true;
        if (!active) reportReady(false);
        respond({ active });
      } catch {
        reportReady(false);
        respond({ active: false });
      }
      return;
    }
    if (message?.type === "search-tabs:private-changed" && temporaryMode) {
      onStorageChanged(message.changes, "private");
      respond({ ok: true });
      return;
    }
    if (message?.type !== "search-tabs:stop") return;
    if (message.origins && !message.origins.includes(location.origin)) return;
    stop().then(() => respond({ ok: true }));
    return true;
  }

  document.addEventListener("zammad-multi-search:state", receiveState);
  document.addEventListener("input", onInput, true);
  document.addEventListener("blur", onBlur, true);
  document.addEventListener("compositionend", onInput, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("lostpointercapture", onPointerUp, true);
  window.addEventListener("hashchange", onHashChange);
  extensionApi.storage.onChanged.addListener(onStorageChanged);
  extensionApi.runtime.onMessage.addListener(onMessage);

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => {
      const element = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      return !element?.closest(".zms-tab, .zms-builder, .zms-builder-toolbar");
    })) scheduleRender();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const stateTimer = setInterval(requestState, 800);
  requestState();
})();
