(() => {
  const holder = document.createElement("div");
  holder.className = "js-content";
  document.querySelector("#results").closest("table").replaceWith(holder);
  const tickets = new Map();
  const states = [
    { id: 12, name: "new", state_type_id: 1 },
    { id: 2, name: "open", state_type_id: 2 },
    { id: 9, name: "waiting for supplier", state_type_id: 3 },
    { id: 4, name: "closed", state_type_id: 4 },
    { id: 15, name: "merged", state_type_id: 5 },
    { id: 100, name: "removed", state_type_id: 6 }
  ];
  App.TicketState = { all: () => states, findNative: id => states.find(state => state.id === id) };
  App.TicketStateType = { all: () => [
    { id: 1, name: "new" }, { id: 2, name: "open" }, { id: 3, name: "pending reminder" },
    { id: 4, name: "closed" }, { id: 5, name: "merged" }, { id: 6, name: "removed" }
  ] };
  App.Config = { get: key => key === "api_path" ? `${location.origin}/api/v1` : undefined };
  App.Collection = { loadAssets: assets => {
    window.loadedSortAssets ||= [];
    for (const ticket of Object.values(assets.Ticket)) {
      window.loadedSortAssets.push(ticket.id);
      tickets.set(ticket.id, ticket);
    }
  } };
  App.Ticket = { find: id => ({ searchResultAttributes: () => ({ id: Number(id) }) }) };
  App.Ajax = {
    request(options) {
      if (options.url !== `${location.origin}/api/v1/search`) throw new Error("Unexpected API endpoint");
      const request = new AbortController();
      const url = new URL("/sort-search", location.origin);
      const data = options.data;
      for (const [key, value] of Object.entries({ query: data.query, object: data.objects, offset: data.offset, orderBy: data.sort_by, orderDirection: data.order_by })) url.searchParams.set(key, JSON.stringify(value));
      url.searchParams.set("limit", data.limit);
      fetch(url, { signal: request.signal, headers: { "X-Fixture-Account": String(App.Session.get("id")) } })
        .then(response => { if (!response.ok) throw new Error("Search failed"); return response.json(); })
        .then(data => options.success({
          result: { Ticket: { object_ids: data.Ticket.items.map(item => item.id), total_count: data.Ticket.total_count } },
          assets: { Ticket: Object.fromEntries(data.Ticket.items.map(item => [item.id, item])) }
        }), options.error);
      return request;
    },
    abort(request) { if (!window.ignoreSortAbort) request.abort(); }
  };

  App.GlobalSearch = class {
    constructor(options) { Object.assign(this, options); }
    search(params) {
      this.request?.abort();
      this.request = new AbortController();
      const url = new URL("/sort-search", location.origin);
      for (const key of ["query", "object", "offset", "orderBy", "orderDirection"]) url.searchParams.set(key, JSON.stringify(params[key] ?? null));
      url.searchParams.set("limit", this.limit);
      fetch(url, { signal: this.request.signal, headers: { "X-Fixture-Account": String(App.Session.get("id")) } })
        .then(response => { if (!response.ok) throw new Error("Search failed"); return response.json(); })
        .then(data => {
          data.Ticket.items.forEach(ticket => tickets.set(ticket.id, ticket));
          params.callbackStop?.();
          this.renderTry(data, params.query, params);
        }, () => params.callbackStop?.());
    }
    renderTry(result, query, params) { this.render(result, params); }
    close() { this.request?.abort(); }
    releaseController() {}
    ajaxStart() {}
    ajaxStop() {}
  };

  App.TicketList = class {
    constructor(params) {
      const items = params.ticket_ids.map(id => ({ id }));
      const table = document.createElement("table");
      table.className = "table table-hover";
      const row = table.createTHead().insertRow();
      const selectAll = document.createElement("input");
      selectAll.type = "checkbox";
      selectAll.name = "bulk_all";
      row.insertCell().append(selectAll);
      for (const column of params.columns) {
        const key = column === "state" ? "state_id" : column;
        const cell = document.createElement("th");
        cell.dataset.columnKey = key;
        const heading = document.createElement("div");
        heading.className = "table-column-head " + (column === "state" ? "table-column-head-unclickable" : "js-sort");
        const label = document.createElement("div");
        label.className = "table-column-title";
        label.textContent = column;
        heading.append(label);
        cell.append(heading);
        row.append(cell);
      }
      const body = table.createTBody();
      body.id = "results";
      for (const item of items) {
        const ticket = tickets.get(item.id);
        const row = body.insertRow();
        row.dataset.ticketId = ticket.id;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "bulk";
        checkbox.value = ticket.id;
        row.insertCell().append(checkbox);
        for (const column of params.columns) {
          row.insertCell().textContent = column === "state" ? App.TicketState.findNative(ticket.state_id)?.name || "other" : ticket[column];
        }
      }
      this.ticket_ids = params.ticket_ids;
      const pager = document.createElement("div");
      pager.className = "js-pager";
      holder.replaceChildren(table, pager);
    }
  };

  App.Search = class {
    static ticketSearchColumns = ["number", "title"];
    constructor() {
      this.el = [document.querySelector(".detail-search")];
      this.query = searchState.query;
      this.model = "Ticket";
      this.savedOrderBy = {};
      this.globalSearch = new App.GlobalSearch({ limit: 4, render: (result, params) => {
        this.result = result;
        this.renderTab("Ticket", result.Ticket.items);
        const count = result.Ticket.total_count;
        const pager = holder.querySelector(".js-pager");
        for (let page = 0; page < Math.ceil(count / this.globalSearch.limit); page++) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn js-page";
          button.dataset.page = page;
          button.textContent = page + 1;
          button.addEventListener("click", () => {
            (this.savedOrderBy.Ticket ||= {}).page = page;
            this.goToPaginated("Ticket", page);
          });
          pager.append(button);
        }
      } });
      this.el[0].addEventListener("click", event => {
        if (event.target.closest(".zms-state-sort")) window.nativeStateClick = true;
        const heading = event.target.closest(".js-sort");
        if (!heading || !holder.contains(heading)) return;
        this.savedOrderBy.Ticket = { orderBy: heading.closest("th").dataset.columnKey, orderDirection: "ASC" };
        this.goToPaginated("Ticket", 0);
      });
    }
    renderTab(model, items) {
      this.table = new App.TicketList({
        columns: App.Search.ticketSearchColumns || ["number", "title"],
        ticket_ids: items.map(item => item.id)
      });
    }
    goToPaginated(model, page) {
      const order = this.savedOrderBy[model] ||= {};
      return this.globalSearch.search({ query: this.query, object: model, offset: page * this.globalSearch.limit, orderBy: order.orderBy, orderDirection: order.orderDirection, delay: -1 });
    }
    reloadCurrentSearch() { this.goToPaginated("Ticket", 0); }
  };
  const controller = new App.Search();
  App.TaskManager.worker = key => key === "Search" ? controller : undefined;
  window.addEventListener("hashchange", () => {
    controller.query = searchState.query;
    controller.savedOrderBy = {};
    controller.reloadCurrentSearch();
  });
  controller.reloadCurrentSearch();
})();
