(() => {
  function groupsFor(states, types) {
    const ids = [[], [], []];
    const typeNames = new Map(types.map(type => [String(type.id), type.name]));
    for (const state of states) {
      const id = Number(state.id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const type = typeNames.get(String(state.state_type_id));
      const rank = type === "new" ? 0 : type === "open" ? 1 : type?.startsWith("pending ") ? 2 : -1;
      if (rank >= 0) ids[rank].push(id);
    }
    const groups = ids.filter(group => group.length).map(group => `state_id:(${[...new Set(group)].sort((a, b) => a - b).join(" OR ")})`);
    const first = [...new Set(ids.flat())].sort((a, b) => a - b);
    groups.push(first.length ? `NOT state_id:(${first.join(" OR ")})` : "*");
    return groups;
  }

  function pageSlices(counts, offset, limit, direction) {
    const indices = counts.map((count, index) => index);
    if (direction === "DESC") indices.reverse();
    const slices = [];
    for (const index of indices) {
      if (offset >= counts[index]) {
        offset -= counts[index];
        continue;
      }
      const size = Math.min(limit, counts[index] - offset);
      if (size > 0) slices.push({ index, offset, limit: size });
      limit -= size;
      offset = 0;
      if (!limit) break;
    }
    return slices;
  }

  function create() {
    const messages = {
      en: { hint: "Sort by state: New, Open, Pending, Closed. Click again to reverse.", loading: "Sorting search results…", error: "Could not sort results. The previous results are still shown." },
      pl: { hint: "Sortuj według stanu: nowe, otwarte, oczekujące, zamknięte. Kliknij ponownie, aby odwrócić kolejność.", loading: "Sortowanie wyników…", error: "Nie udało się posortować wyników. Nadal wyświetlane są poprzednie wyniki." }
    };
    let app;
    let controller;
    let search;
    let originalSearch;
    let originalRender;
    let wrappedSearch;
    let wrappedRender;
    let generation = 0;
    let previousOrder;
    let lastOrder;
    let countCache;
    let accountId;
    let notice;
    let requestNumber = 0;
    const requestPrefix = "zms-state-sort-" + Math.random().toString(36).slice(2);
    const requests = new Set();

    function text() {
      return messages[String(app.Session.get("preferences")?.locale || "en").slice(0, 2)] || messages.en;
    }

    function root() {
      return controller?.el?.[0] || controller?.el;
    }

    function notify(message) {
      if (!notice?.isConnected) {
        notice = document.createElement("p");
        notice.className = "help-block zms-sort-message";
        notice.setAttribute("role", "status");
        notice.setAttribute("aria-live", "polite");
        root()?.querySelector(".js-content")?.prepend(notice);
      }
      notice.textContent = message;
      notice.hidden = !message;
    }

    function decorate() {
      if (controller?.model !== "Ticket") return;
      const header = root()?.querySelector('th[data-column-key="state_id"], th[data-column-key="state"]');
      const heading = header?.querySelector(".table-column-head");
      if (!heading) return;
      heading.classList.remove("table-column-head-unclickable");
      heading.classList.add("zms-state-sort");
      heading.setAttribute("role", "button");
      heading.tabIndex = 0;
      heading.title = text().hint;
      heading.setAttribute("aria-label", text().hint);
      const order = controller.savedOrderBy?.Ticket;
      header.setAttribute("aria-sort", order?.orderBy === "state_id" ? order.orderDirection === "DESC" ? "descending" : "ascending" : "none");
    }

    function cancel() {
      generation++;
      for (const request of [...requests]) request.cancel();
    }

    function requestGroup(query, offset, limit, valid, withItems = false) {
      return new Promise((resolve, reject) => {
        let finished = false;
        let timeout;
        let ajaxRequest;
        const request = { cancel: () => finish(new Error("Search canceled")) };
        function finish(error, value) {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          requests.delete(request);
          if (error && ajaxRequest) app.Ajax.abort(ajaxRequest);
          if (error) reject(error);
          else resolve(value);
        }
        requests.add(request);
        try {
          timeout = setTimeout(() => finish(new Error("Search timed out")), 20000);
          ajaxRequest = app.Ajax.request({
            id: `${requestPrefix}-${++requestNumber}`, type: "GET", url: `${app.Config.get("api_path")}/search`, processData: true,
            data: { query, objects: "Ticket", by_object: true, offset, limit, sort_by: ["updated_at", "id"], order_by: ["DESC", "ASC"] },
            success(data) {
              if (finished || !valid()) return finish(new Error("Search canceled"));
              try {
                const ticket = data?.result?.Ticket || (data?.result && !Object.keys(data.result).length ? { object_ids: [], total_count: 0 } : null);
                if (!ticket || !Array.isArray(ticket.object_ids) || !Number.isSafeInteger(ticket.total_count) || ticket.total_count < 0) throw new Error("Invalid ticket search result");
                let items = [];
                if (withItems) {
                  app.Collection.loadAssets(data.assets);
                  items = ticket.object_ids.map(id => app.Ticket.find(id).searchResultAttributes());
                }
                finish(null, { items, total_count: ticket.total_count });
              } catch (error) {
                finish(error);
              }
            },
            error: () => finish(new Error("Ticket search failed"))
          });
        } catch (error) {
          finish(error);
        }
      });
    }

    async function sortedSearch(params, version, account) {
      const currentSearch = search;
      const groups = groupsFor(app.TicketState.all(), app.TicketStateType.all());
      const queries = groups.map(group => `(${params.query}) AND (${group})`);
      const key = JSON.stringify([account, params.query, groups]);
      const valid = () => version === generation && account === String(app.Session.get("id")) && app.TaskManager.worker("Search") === controller && controller?.query === params.query;
      try {
        search.close?.();
        search.ajaxStart?.(params);
        notify(text().loading);
        const counts = countCache?.key === key && Date.now() - countCache.time < 20000
          ? countCache.counts
          : await Promise.all(queries.map(query => requestGroup(query, 0, 1, valid).then(result => result.total_count)));
        if (!valid()) return;
        countCache = { key, time: Date.now(), counts };
        const slices = pageSlices(counts, params.offset || 0, controller.globalSearch.limit || 50, params.orderDirection);
        const pages = await Promise.all(slices.map(slice => requestGroup(queries[slice.index], slice.offset, slice.limit, valid, true)));
        if (!valid()) return;
        lastOrder = { ...controller.savedOrderBy.Ticket };
        search.renderTry({ Ticket: { items: pages.flatMap(page => page.items), total_count: counts.reduce((sum, count) => sum + count, 0) } }, params.query, params);
        notify("");
      } catch {
        if (!valid()) return;
        for (const request of [...requests]) request.cancel();
        if (lastOrder || previousOrder) controller.savedOrderBy.Ticket = { ...(lastOrder || previousOrder) };
        else delete controller.savedOrderBy.Ticket;
        decorate();
        notify(text().error);
      } finally {
        currentSearch.ajaxStop?.(params);
      }
    }

    function chooseOrder(event) {
      const heading = event.target instanceof Element ? event.target.closest(".zms-state-sort") : null;
      if (!heading || !root()?.contains(heading) || controller.model !== "Ticket" || !app.Session.get("id") || !String(controller.query || "").trim()) return;
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const order = controller.savedOrderBy.Ticket;
      if (order?.orderBy !== "state_id") {
        previousOrder = order ? { ...order } : undefined;
        lastOrder = undefined;
      }
      controller.savedOrderBy.Ticket = { orderBy: "state_id", orderDirection: order?.orderBy === "state_id" && order.orderDirection === "ASC" ? "DESC" : "ASC", page: 0 };
      decorate();
      controller.goToPaginated("Ticket", 0);
    }

    function detach() {
      if (!controller) return;
      cancel();
      if (search.search === wrappedSearch) search.search = originalSearch;
      if (controller.renderTab === wrappedRender) controller.renderTab = originalRender;
      if (controller.savedOrderBy?.Ticket?.orderBy === "state_id") {
        if (previousOrder) controller.savedOrderBy.Ticket = previousOrder;
        else delete controller.savedOrderBy.Ticket;
      }
      notice?.remove();
      root()?.querySelectorAll(".zms-state-sort").forEach(heading => {
        heading.classList.remove("zms-state-sort");
        heading.classList.add("table-column-head-unclickable");
        for (const name of ["role", "tabindex", "title", "aria-label"]) heading.removeAttribute(name);
        heading.closest("th")?.removeAttribute("aria-sort");
      });
      controller = undefined;
      search = undefined;
      previousOrder = undefined;
      lastOrder = undefined;
      countCache = undefined;
    }

    function observe(currentApp) {
      const account = String(currentApp?.Session?.get("id") || "");
      const next = account && currentApp.TaskManager?.worker?.("Search");
      if (next === controller && account === accountId) return;
      const accountChanged = accountId !== undefined && accountId !== account;
      detach();
      accountId = account;
      if (!next?.renderTab || !next.globalSearch?.search || !next.goToPaginated || !currentApp.TicketState?.all || !currentApp.TicketStateType?.all || typeof currentApp.TicketList !== "function") return;
      if (!currentApp.Ajax?.request || !currentApp.Ajax?.abort || !currentApp.Config?.get || !currentApp.Collection?.loadAssets || !currentApp.Ticket?.find) return;
      const element = next.el?.[0] || next.el;
      if (!(element instanceof Element) || !currentApp.TicketState.all().length || !currentApp.TicketStateType.all().length) return;
      app = currentApp;
      controller = next;
      search = controller.globalSearch;
      originalSearch = search.search;
      originalRender = controller.renderTab;
      wrappedSearch = function (params) {
        cancel();
        notify("");
        if (params.object === "Ticket" && params.orderBy === "state_id") {
          return sortedSearch(params, generation, String(app.Session.get("id")));
        }
        countCache = undefined;
        return originalSearch.call(this, params);
      };
      wrappedRender = function (model, items) {
        const TicketList = app.TicketList;
        if (model === "Ticket") app.TicketList = class extends TicketList {
          constructor(params) {
            const columns = params.columns;
            super({ ...params, columns: columns.includes("state") || columns.includes("state_id") ? columns : [...columns, "state"] });
          }
        };
        try {
          const result = originalRender.call(this, model, items);
          decorate();
          return result;
        } finally {
          app.TicketList = TicketList;
        }
      };
      search.search = wrappedSearch;
      controller.renderTab = wrappedRender;
      if (!accountChanged && controller.model === "Ticket" && Array.isArray(controller.table?.ticket_ids)) {
        const selected = [...root().querySelectorAll('input[name="bulk"]:checked')].map(input => input.value);
        controller.renderTab("Ticket", controller.table.ticket_ids.map(id => ({ id })));
        root().querySelectorAll('input[name="bulk"]').forEach(input => { input.checked = selected.includes(input.value); });
        if (selected.length) root().querySelector('input[name="bulk"]')?.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    document.addEventListener("click", chooseOrder, true);
    document.addEventListener("keydown", chooseOrder, true);
    return {
      observe,
      reset: detach,
      destroy() {
        const previous = controller;
        detach();
        document.removeEventListener("click", chooseOrder, true);
        document.removeEventListener("keydown", chooseOrder, true);
        if (previous?.model === "Ticket") previous.reloadCurrentSearch?.();
      }
    };
  }

  globalThis.ZammadStateSorter = { create, groupsFor, pageSlices };
})();
