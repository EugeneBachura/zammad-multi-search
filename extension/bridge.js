(() => {
  if (window.zammadMultiSearchBridge) return;
  window.zammadMultiSearchBridge = true;
  let observedUpdate;
  let originalUpdate;
  let observedManager;
  let active = true;

  function collectionOptions(app, model) {
    try {
      return (app[model]?.all() || []).filter(record => typeof record.name === "string").map(record => ({
        value: record.name,
        label: app.i18n?.translateInline(record.name) || record.name
      }));
    } catch {
      return [];
    }
  }

  function observeSearch(app) {
    const manager = app?.TaskManager;
    if (!manager?.update || manager.update === observedUpdate) return;
    originalUpdate = manager.update;
    const update = originalUpdate;
    observedUpdate = function (...args) {
      const result = update.apply(this, args);
      if (args[0] === "Search") publishState();
      return result;
    };
    manager.update = observedUpdate;
    observedManager = manager;
  }

  function modalTemplate(app) {
    try {
      return app.view("modal")({
        head: "Search", headPrefix: "", headMarkup: false,
        buttonClose: true, buttonCancel: "Cancel", buttonCancelClass: "btn--text btn--subtle",
        buttonSubmit: "Search", buttonClass: "btn--primary", includeForm: false,
        centerButtons: [], leftButtons: [], stickyAlerts: []
      });
    } catch {
      return "";
    }
  }

  function selectTemplate(app) {
    try {
      return app.view("generic/select")({ attribute: { name: "zms", options: [] } });
    } catch {
      return "";
    }
  }

  function publishState(includeOptions = false) {
    if (!active) return;
    let state = null;

    try {
      const app = window.App;
      observeSearch(app);
      const userId = app?.Session?.get("id");

      if (userId && app.TaskManager) {
        state = {
          userId: String(userId),
          query: app.TaskManager.get("Search")?.state?.query || "",
          locale: String(app.Session.get("preferences")?.locale || document.documentElement.lang || "en")
        };

        if (includeOptions) {
          state.modalTemplate = modalTemplate(app);
          state.selectTemplate = selectTemplate(app);
          state.searchOptions = {
            states: collectionOptions(app, "TicketState"),
            priorities: collectionOptions(app, "TicketPriority"),
            groups: collectionOptions(app, "Group")
          };
        }
      }
    } catch {
      state = null;
    }

    document.dispatchEvent(new CustomEvent("zammad-multi-search:state", {
      detail: JSON.stringify(state)
    }));
  }

  function onRequest(event) {
    publishState(event.detail === "options");
  }

  function stop() {
    active = false;
    if (observedManager && observedManager.update === observedUpdate) observedManager.update = originalUpdate;
    window.zammadMultiSearchBridge = false;
    document.removeEventListener("zammad-multi-search:request", onRequest);
    document.removeEventListener("zammad-multi-search:stop", stop);
  }

  document.addEventListener("zammad-multi-search:request", onRequest);
  document.addEventListener("zammad-multi-search:stop", stop);
})();
