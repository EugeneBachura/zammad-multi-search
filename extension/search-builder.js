(() => {
  if (globalThis.ZammadSearchBuilder) return;

  const translations = {
    en: {
      launch: "Search filters", title: "Build a search",
      catalog: "Add a condition", find: "Find a condition…", noFields: "No matching conditions", ticket: "Ticket", people: "People and teams", dates: "Dates and content",
      conditions: "Conditions", match: "Combine the search text and conditions", all: "All conditions (AND)", any: "At least one (OR)",
      allHint: "For example: open tickets AND created in the last 7 days.", anyHint: "For example: open tickets OR created in the last 7 days.",
      addGroup: "Add group", subgroup: "Add subgroup", groupLabel: "Group", mainGroup: "Main conditions", addTo: "Add conditions to", addHere: "Add here", ungroup: "Ungroup", exclude: "Exclude (NOT)", excludeGroup: "Exclude this group (NOT)", moveTo: "Move condition to", emptyGroup: "Add a condition to this group or remove it.", queryField: "Search text / query", range: "Between (TO)", numberOrder: "The maximum must not be less than the minimum.",
      base: "Search text or current query", basePlaceholder: "Optional: a word, phrase or existing query",
      empty: "Choose a condition on the left", emptyHint: "Combine a status, a date, a customer or other filters.",
      preview: "Search query", incomplete: "Fill in the selected conditions to continue.", remove: "Remove condition", cancel: "Cancel", apply: "Search", close: "Close search builder",
      is: "Is one of", isNot: "Is none of", contains: "Contains", notContains: "Does not contain", value: "Value", required: "Enter a value.", selectValue: "Choose at least one value.", noValues: "No matching values",
      day: "Last 24 hours", week: "Last 7 days", fortnight: "Last 14 days", month: "Last 30 days", on: "On a date", before: "Before a date", since: "Starting from a date", between: "Between dates",
      from: "From", to: "To", invalidDate: "Enter a valid date.", dateOrder: "The end date must not be before the start date.", equal: "Equals", atLeast: "At least", atMost: "At most", invalidNumber: "Enter a whole number of zero or more.",
      state: "Status", priority: "Priority", titleField: "Title", number: "Ticket number", group: "Group", owner: "Owner email", customer: "Customer email", organization: "Organization", tags: "Tag", created: "Created", updated: "Updated", body: "Message text", attachment: "Attachment name", articles: "Number of messages",
      new: "New", open: "Open", closed: "Closed", pendingReminder: "Pending reminder", pendingClose: "Pending close", low: "Low", normal: "Normal", high: "High"
    },
    pl: {
      launch: "Filtry wyszukiwania", title: "Zbuduj wyszukiwanie",
      catalog: "Dodaj warunek", find: "Znajdź warunek…", noFields: "Brak pasujących warunków", ticket: "Zgłoszenie", people: "Osoby i zespoły", dates: "Daty i treść",
      conditions: "Warunki", match: "Połącz szukany tekst i warunki", all: "Wszystkie warunki (AND)", any: "Co najmniej jeden (OR)",
      allHint: "Na przykład: otwarte zgłoszenia ORAZ utworzone w ostatnich 7 dniach.", anyHint: "Na przykład: otwarte zgłoszenia LUB utworzone w ostatnich 7 dniach.",
      addGroup: "Dodaj grupę", subgroup: "Dodaj podgrupę", groupLabel: "Grupa", mainGroup: "Warunki główne", addTo: "Dodawaj warunki do", addHere: "Dodaj tutaj", ungroup: "Rozgrupuj", exclude: "Wyklucz (NOT)", excludeGroup: "Wyklucz tę grupę (NOT)", moveTo: "Przenieś warunek do", emptyGroup: "Dodaj warunek do tej grupy lub usuń ją.", queryField: "Szukany tekst / zapytanie", range: "Między (TO)", numberOrder: "Maksimum nie może być mniejsze od minimum.",
      base: "Szukany tekst lub bieżące zapytanie", basePlaceholder: "Opcjonalnie: słowo, fraza lub istniejące zapytanie",
      empty: "Wybierz warunek po lewej", emptyHint: "Połącz status, datę, klienta lub inne filtry.",
      preview: "Zapytanie", incomplete: "Uzupełnij wybrane warunki, aby kontynuować.", remove: "Usuń warunek", cancel: "Anuluj", apply: "Szukaj", close: "Zamknij kreator wyszukiwania",
      is: "Jest jednym z", isNot: "Nie jest żadnym z", contains: "Zawiera", notContains: "Nie zawiera", value: "Wartość", required: "Wpisz wartość.", selectValue: "Wybierz co najmniej jedną wartość.", noValues: "Brak pasujących wartości",
      day: "Ostatnie 24 godziny", week: "Ostatnie 7 dni", fortnight: "Ostatnie 14 dni", month: "Ostatnie 30 dni", on: "W dniu", before: "Przed dniem", since: "Od dnia", between: "Między datami",
      from: "Od", to: "Do", invalidDate: "Wpisz poprawną datę.", dateOrder: "Data końcowa nie może poprzedzać początkowej.", equal: "Równa się", atLeast: "Co najmniej", atMost: "Co najwyżej", invalidNumber: "Wpisz liczbę całkowitą nie mniejszą od zera.",
      state: "Status", priority: "Priorytet", titleField: "Tytuł", number: "Numer zgłoszenia", group: "Grupa", owner: "E-mail opiekuna", customer: "E-mail klienta", organization: "Organizacja", tags: "Tag", created: "Utworzono", updated: "Zaktualizowano", body: "Treść wiadomości", attachment: "Nazwa załącznika", articles: "Liczba wiadomości",
      new: "Nowe", open: "Otwarte", closed: "Zamknięte", pendingReminder: "Oczekujące przypomnienie", pendingClose: "Oczekujące zamknięcie", low: "Niski", normal: "Normalny", high: "Wysoki"
    }
  };

  const fields = [
    { id: "queryField", type: "query", category: "ticket" },
    { id: "state", attribute: "state.name", type: "choices", category: "ticket", options: "states" },
    { id: "priority", attribute: "priority.name", type: "choices", category: "ticket", options: "priorities" },
    { id: "titleField", attribute: "title", type: "text", category: "ticket" },
    { id: "number", attribute: "number", type: "text", category: "ticket" },
    { id: "tags", attribute: "tags", type: "text", category: "ticket" },
    { id: "group", attribute: "group.name", type: "text", category: "people", options: "groups" },
    { id: "owner", attribute: "owner.email", type: "text", category: "people" },
    { id: "customer", attribute: "customer.email", type: "text", category: "people" },
    { id: "organization", attribute: "organization.name", type: "text", category: "people" },
    { id: "created", attribute: "created_at", type: "date", category: "dates" },
    { id: "updated", attribute: "updated_at", type: "date", category: "dates" },
    { id: "body", attribute: "article.body", type: "text", category: "dates" },
    { id: "attachment", attribute: "article.attachment.title", type: "text", category: "dates" },
    { id: "articles", attribute: "article_count", type: "number", category: "dates" }
  ];

  const periods = { day: "24h", week: "7d", fortnight: "14d", month: "30d" };

  function quote(value) {
    return `"${String(value).trim().replace(/[\\"]/g, "\\$&")}"`;
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function compile(draft) {
    const errors = [];
    const errorsById = {};
    function compileCondition(condition) {
      const field = fields.find(item => item.id === condition.field);
      const value = condition.value.trim();
      let clause = "";
      let error = "";

      if (!field) {
        error = "required";
      } else if (field.type === "query") {
        if (!value) error = "required";
        else clause = value;
      } else if (field.type === "choices") {
        const values = [...new Set(condition.values.filter(item => typeof item === "string" && item.trim()))];
        if (!values.length) error = "selectValue";
        else clause = `${field.attribute}:${values.length === 1 ? quote(values[0]) : `(${values.map(quote).join(" OR ")})`}`;
      } else if (field.type === "date") {
        if (periods[condition.operator]) clause = `${field.attribute}:>now-${periods[condition.operator]}`;
        else if (!validDate(value)) error = "invalidDate";
        else if (condition.operator === "between") {
          if (!validDate(condition.endValue)) error = "invalidDate";
          else if (value > condition.endValue) error = "dateOrder";
          else clause = `${field.attribute}:[${value} TO ${condition.endValue}]`;
        } else if (condition.operator === "before") clause = `${field.attribute}:{* TO ${value}}`;
        else if (condition.operator === "since") clause = `${field.attribute}:[${value} TO *]`;
        else clause = `${field.attribute}:${value}`;
      } else if (field.type === "number") {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) error = "invalidNumber";
        else if (condition.operator === "between") {
          if (!/^\d+$/.test(condition.endValue) || !Number.isSafeInteger(Number(condition.endValue))) error = "invalidNumber";
          else if (Number(value) > Number(condition.endValue)) error = "numberOrder";
          else clause = `${field.attribute}:[${Number(value)} TO ${Number(condition.endValue)}]`;
        } else if (condition.operator === "atLeast") clause = `${field.attribute}:[${Number(value)} TO *]`;
        else if (condition.operator === "atMost") clause = `${field.attribute}:[* TO ${Number(value)}]`;
        else clause = `${field.attribute}:${Number(value)}`;
      } else if (!value) error = "required";
      else clause = `${field.attribute}:${quote(value)}`;

      if (clause && (condition.operator === "isNot" || condition.negated)) clause = `NOT (${clause})`;
      errors.push(error);
      errorsById[condition.id] = error;
      return clause;
    }

    function compileGroup(group, base = "") {
      const clauses = base.trim() ? [base.trim()] : [];
      for (const condition of group.conditions) {
        const clause = condition.conditions ? compileGroup(condition) : compileCondition(condition);
        if (clause) clauses.push(clause);
      }
      if (!clauses.length && group !== draft) {
        errors.push("emptyGroup");
        errorsById[group.id] = "emptyGroup";
      }
      const query = clauses.length > 1 ? clauses.map(clause => `(${clause})`).join(group.join === "any" ? " OR " : " AND ") : clauses[0] || "";
      return query && group.negated ? `NOT (${query})` : query;
    }

    const query = compileGroup(draft, draft.base || "");
    return { query, errors, errorsById };
  }

  function create({ readState, applyQuery }) {
    let state = null;
    let dialog = null;
    let draft = null;
    let openedUserId = "";
    let nextConditionId = 0;
    let targetGroupId = "root";
    let messages = translations.en;
    let options = {};
    let selectMarkup = "";
    let dismissSuggestions = null;
    const drafts = new Map();

    function element(tag, className, content) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    }

    function button(className, label) {
      const control = element("button", `btn ${className}`, label);
      control.type = "button";
      return control;
    }

    function nativeTemplate(markup) {
      const template = element("template");
      template.innerHTML = typeof markup === "string" ? markup : "";
      template.content.querySelectorAll("script,style,link,meta,base,iframe,object,embed,img,foreignObject,animate,set").forEach(node => node.remove());
      template.content.querySelectorAll("*").forEach(node => {
        for (const attribute of [...node.attributes]) {
          const name = attribute.name.toLowerCase();
          if (name.startsWith("on") || ["style", "srcdoc"].includes(name)) node.removeAttribute(attribute.name);
          else if (["href", "xlink:href", "src", "action", "formaction"].includes(name)) {
            try {
              const url = new URL(attribute.value, location.href);
              if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) node.removeAttribute(attribute.name);
            } catch {
              node.removeAttribute(attribute.name);
            }
          }
        }
      });
      return template;
    }

    function closeIcon() {
      const nativeIcon = dialog?.querySelector(".modal-close .icon") || document.querySelector('.tasks-navigation .nav-tab-close .icon');
      if (!nativeIcon) return document.createTextNode("×");
      const icon = nativeIcon.cloneNode(true);
      icon.setAttribute("aria-hidden", "true");
      return icon;
    }

    function selectArrow() {
      const template = nativeTemplate(selectMarkup);
      const nativeIcon = template.content.querySelector(".icon-arrow-down") || document.querySelector(".controls--select .icon-arrow-down");
      if (nativeIcon) {
        const icon = nativeIcon.cloneNode(true);
        icon.setAttribute("aria-hidden", "true");
        return icon;
      }

      const source = document.querySelector(".tasks-navigation use");
      const sprite = (source?.getAttribute("xlink:href") || source?.getAttribute("href") || "").split("#")[0];
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "icon icon-arrow-down");
      icon.setAttribute("aria-hidden", "true");
      const use = document.createElementNS(icon.namespaceURI, "use");
      use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `${sprite}#icon-arrow-down`);
      icon.append(use);
      return icon;
    }

    function modalContent() {
      const template = nativeTemplate(state.modalTemplate);
      let modal = template.content.querySelector(".modal-dialog");
      const required = [".modal-content", ".modal-header", ".modal-title", ".modal-close", ".modal-body", ".modal-footer", ".js-cancel", ".js-submit"];

      if (!modal || required.some(selector => !modal.querySelector(selector))) {
        template.innerHTML = `
          <div class="modal-dialog"><div class="modal-content">
            <div class="modal-header"><div class="modal-close js-close"></div><h1 class="modal-title"></h1></div>
            <div class="modal-body"></div>
            <div class="modal-footer">
              <div class="modal-leftFooter"><a class="btn btn--text btn--subtle js-cancel" href="#"></a></div>
              <div class="modal-rightFooter"><button type="button" class="btn btn--primary js-submit align-right"></button></div>
            </div>
          </div></div>`;
        modal = template.content.querySelector(".modal-dialog");
        modal.querySelector(".modal-close").append(closeIcon());
      }

      modal.querySelector(".modal-content").classList.add("zms-builder-shell");
      const title = modal.querySelector(".modal-title");
      title.id = "zms-builder-title";
      title.textContent = messages.title;
      const header = modal.querySelector(".modal-header");
      header.classList.add("zms-builder-header");

      const dismiss = modal.querySelector(".modal-close");
      dismiss.classList.add("zms-builder-dismiss");
      dismiss.setAttribute("role", "button");
      dismiss.tabIndex = 0;

      const cancel = modal.querySelector(".js-cancel");
      cancel.classList.add("zms-builder-cancel");
      cancel.textContent = messages.cancel;
      const apply = modal.querySelector(".js-submit");
      apply.classList.add("zms-builder-apply");
      apply.type = "button";
      apply.textContent = messages.apply;
      modal.querySelector(".modal-footer").classList.add("zms-builder-footer");
      return modal;
    }

    function searchInput() {
      return Array.from(document.querySelectorAll('.detail-search .js-search, form.search-holder .js-search')).find(input => input.getClientRects().length);
    }

    function close() {
      if (!dialog) return;
      dismissSuggestions?.();
      dialog.close();
      dialog.remove();
      dialog = null;
    }

    function choiceOptions(field) {
      if (options[field.options]?.length) return options[field.options];
      const defaults = field.id === "state"
        ? [["new", "new"], ["open", "open"], ["closed", "closed"], ["pending reminder", "pendingReminder"], ["pending close", "pendingClose"]]
        : [["1 low", "low"], ["2 normal", "normal"], ["3 high", "high"]];
      return defaults.map(([value, label]) => ({ value, label: messages[label] }));
    }

    function groups(group = draft, depth = 0) {
      return [{ group, depth }].concat(group.conditions.filter(item => item.conditions).flatMap(item => groups(item, depth + 1)));
    }

    function groupId(group) {
      return group === draft ? "root" : String(group.id);
    }

    function groupName(group) {
      return group === draft ? messages.mainGroup : `${messages.groupLabel} ${group.number}`;
    }

    function parentGroup(node) {
      return groups().find(({ group }) => group.conditions.includes(node))?.group;
    }

    function selectedGroup() {
      return groups().find(({ group }) => groupId(group) === targetGroupId)?.group || draft;
    }

    function updateTargets() {
      const entries = groups();
      if (!entries.some(({ group }) => groupId(group) === targetGroupId)) targetGroupId = "root";
      const target = dialog.querySelector(".zms-builder-target");
      target.hidden = entries.length < 2;
      const select = target.querySelector("select");
      select.replaceChildren();
      entries.forEach(({ group, depth }) => {
        const option = element("option", "", `${"· ".repeat(depth)}${groupName(group)}`);
        option.value = groupId(group);
        select.append(option);
      });
      select.value = targetGroupId;
      dialog.querySelectorAll(".zms-builder-group").forEach(row => row.classList.toggle("is-target", row.dataset.groupId === targetGroupId));
    }

    function renderRows() {
      dismissSuggestions?.();
      const rows = dialog.querySelector(".zms-builder-rows");
      rows.replaceChildren(...draft.conditions.map(node => node.conditions ? renderGroup(node) : renderCondition(node)));
      dialog.querySelector(".zms-builder-empty").hidden = Boolean(draft.conditions.length);
      updateTargets();
      updatePreview();
    }

    function negateControl(node, label) {
      const control = button("btn--small btn--slim zms-builder-negate", label);
      control.setAttribute("aria-pressed", Boolean(node.negated));
      control.classList.toggle("btn--active", Boolean(node.negated));
      control.addEventListener("click", () => {
        node.negated = !node.negated;
        control.setAttribute("aria-pressed", node.negated);
        control.classList.toggle("btn--active", node.negated);
        updatePreview();
      });
      return control;
    }

    function joinControls(group) {
      const controls = element("div", "btn-group zms-builder-join");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", `${messages.match}: ${groupName(group)}`);
      for (const join of ["all", "any"]) {
        const control = button("btn--small", messages[join]);
        control.dataset.join = join;
        control.setAttribute("aria-pressed", group.join === join);
        control.classList.toggle("btn--active", group.join === join);
        control.addEventListener("click", () => {
          group.join = join;
          controls.querySelectorAll("button").forEach(item => {
            item.setAttribute("aria-pressed", item.dataset.join === join);
            item.classList.toggle("btn--active", item.dataset.join === join);
          });
          updatePreview();
        });
        controls.append(control);
      }
      return controls;
    }

    function addGroup(parent) {
      const number = Math.max(0, ...groups().map(({ group }) => group.number || 0)) + 1;
      const group = { id: ++nextConditionId, number, join: "all", conditions: [], negated: false };
      parent.conditions.push(group);
      targetGroupId = groupId(group);
      renderRows();
      dialog.querySelector(`[data-group-id="${group.id}"]`).scrollIntoView({ block: "nearest" });
      dialog.querySelector(".zms-builder-find").focus();
    }

    function renderGroup(group) {
      const row = element("section", "zms-builder-group");
      row.dataset.groupId = group.id;
      row.dataset.conditionId = group.id;
      const heading = element("div", "zms-builder-condition-heading");
      heading.append(element("strong", "", groupName(group)));
      const actions = element("div", "zms-builder-row-actions");
      const ungroup = button("btn--text btn--subtle no-padding zms-builder-ungroup", messages.ungroup);
      ungroup.disabled = Boolean(group.negated);
      ungroup.addEventListener("click", () => {
        const parent = parentGroup(group);
        parent.conditions.splice(parent.conditions.indexOf(group), 1, ...group.conditions);
        targetGroupId = groupId(parent);
        renderRows();
      });
      const remove = button("btn--text btn--subtle no-padding zms-builder-remove-group");
      remove.append(closeIcon());
      remove.setAttribute("aria-label", `${messages.remove}: ${groupName(group)}`);
      remove.addEventListener("click", () => {
        const parent = parentGroup(group);
        parent.conditions = parent.conditions.filter(item => item !== group);
        renderRows();
      });
      actions.append(ungroup, remove);
      heading.append(actions);
      const logic = element("div", "zms-builder-group-logic");
      const negate = negateControl(group, messages.excludeGroup);
      negate.addEventListener("click", () => { ungroup.disabled = Boolean(group.negated); });
      logic.append(joinControls(group), negate);
      const children = element("div", "zms-builder-group-rows");
      children.append(...group.conditions.map(node => node.conditions ? renderGroup(node) : renderCondition(node)));
      const error = element("p", "help-block text-danger zms-builder-error");
      error.setAttribute("aria-live", "polite");
      const tools = element("div", "zms-builder-group-tools");
      const add = button("btn--text no-padding zms-builder-add-here", messages.addHere);
      add.addEventListener("click", () => {
        targetGroupId = groupId(group);
        updateTargets();
        dialog.querySelector(".zms-builder-find").focus();
      });
      const subgroup = button("btn--text no-padding zms-builder-add-subgroup", messages.subgroup);
      subgroup.addEventListener("click", () => addGroup(group));
      tools.append(add, subgroup);
      row.append(heading, logic, children, error, tools);
      return row;
    }

    function moveControl(condition) {
      const select = element("select", "form-control zms-builder-move");
      select.setAttribute("aria-label", messages.moveTo);
      groups().forEach(({ group, depth }) => {
        const option = element("option", "", `${"· ".repeat(depth)}${groupName(group)}`);
        option.value = groupId(group);
        select.append(option);
      });
      select.value = groupId(parentGroup(condition));
      select.addEventListener("change", () => {
        const destination = groups().find(({ group }) => groupId(group) === select.value).group;
        const parent = parentGroup(condition);
        parent.conditions = parent.conditions.filter(item => item !== condition);
        destination.conditions.push(condition);
        renderRows();
      });
      const wrapper = element("div", "controls controls--select zms-builder-move-wrap");
      wrapper.append(select, selectArrow());
      return wrapper;
    }

    function updatePreview() {
      const result = compile(draft);
      const invalid = result.errors.some(Boolean);
      const preview = dialog.querySelector(".zms-builder-query");
      preview.value = invalid ? messages.incomplete : result.query || messages.empty;
      preview.classList.toggle("is-incomplete", invalid || !result.query);
      dialog.querySelector(".zms-builder-apply").disabled = invalid || !result.query;
      dialog.querySelector(".zms-builder-count").textContent = groups().reduce((total, { group }) => total + group.conditions.filter(node => !node.conditions).length, 0);
      dialog.querySelector(".zms-builder-join-help").textContent = messages[draft.join === "any" ? "anyHint" : "allHint"];

      dialog.querySelectorAll("[data-condition-id]").forEach(row => {
        const error = row.querySelector(":scope > .zms-builder-error");
        const key = result.errorsById[row.dataset.conditionId];
        error.textContent = key ? messages[key] : "";
        const node = groups().flatMap(({ group }) => group.conditions).find(item => String(item.id) === row.dataset.conditionId);
        error.hidden = !key || (!node?.touched && !node?.conditions);
      });
    }

    function selectControl(condition, choices, change) {
      const select = element("select", "form-control zms-builder-operator");
      select.setAttribute("aria-label", messages[condition.field]);
      choices.forEach(([value, label]) => {
        const option = element("option", "", messages[label]);
        option.value = value;
        select.append(option);
      });
      select.value = condition.operator;
      select.addEventListener("change", () => {
        condition.operator = select.value;
        condition.touched = true;
        if (change) change();
        updatePreview();
      });
      const wrapper = element("div", "controls controls--select zms-builder-operator-wrap");
      wrapper.append(select, selectArrow());
      return wrapper;
    }

    function inputControl(condition, property, type, label) {
      const input = element("input", "form-control zms-builder-value");
      input.type = type;
      input.value = condition[property];
      input.setAttribute("aria-label", label);
      input.placeholder = label;
      if (type === "number") { input.min = "0"; input.step = "1"; }
      input.addEventListener("input", () => {
        condition[property] = input.value;
        condition.touched = true;
        updatePreview();
      });
      return input;
    }

    function suggestionInput(input, values, condition) {
      const wrapper = element("div", "controls controls--select dropdown zms-builder-suggestions");
      const list = element("ul", "dropdown-menu zms-builder-suggestion-list");
      list.id = `zms-builder-values-${condition.id}`;
      list.setAttribute("role", "listbox");
      list.hidden = true;
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-controls", list.id);
      input.setAttribute("aria-expanded", "false");
      input.autocomplete = "off";
      let matches = [];
      let activeIndex = -1;

      function hide() {
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        if (dismissSuggestions === hide) dismissSuggestions = null;
      }

      function highlight(index) {
        activeIndex = index;
        list.querySelectorAll('[role="option"]').forEach((item, itemIndex) => {
          item.classList.toggle("is-active", itemIndex === index);
          item.setAttribute("aria-selected", itemIndex === index);
        });
        const active = list.querySelector(".is-active");
        if (active) {
          input.setAttribute("aria-activedescendant", active.id);
          if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop;
          else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight;
        } else input.removeAttribute("aria-activedescendant");
      }

      function choose(index) {
        input.value = matches[index].value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        hide();
      }

      function show() {
        if (dismissSuggestions !== hide) dismissSuggestions?.();
        dismissSuggestions = hide;
        const term = input.value.trim().toLocaleLowerCase();
        matches = values.filter(option => option.value.toLocaleLowerCase().includes(term));
        list.replaceChildren();
        matches.forEach((option, index) => {
          const item = element("li", "", option.label);
          item.id = `${list.id}-${index}`;
          item.setAttribute("role", "option");
          item.addEventListener("mouseenter", () => highlight(index));
          item.addEventListener("click", () => choose(index));
          list.append(item);
        });
        if (!matches.length) {
          const empty = element("li", "dropdown-header", messages.noValues);
          empty.setAttribute("disabled", "");
          list.append(empty);
        }
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        highlight(-1);

        const field = input.getBoundingClientRect();
        const editor = dialog.querySelector(".zms-builder-editor").getBoundingClientRect();
        const above = field.top - editor.top - 4;
        const below = editor.bottom - field.bottom - 4;
        const upward = below < Math.min(240, list.scrollHeight) && above > below;
        wrapper.classList.toggle("dropup", upward);
        list.style.maxHeight = `${Math.max(39, Math.min(240, upward ? above : below))}px`;
      }

      input.addEventListener("focus", show);
      input.addEventListener("click", show);
      input.addEventListener("input", show);
      input.addEventListener("blur", hide);
      list.addEventListener("mousedown", event => event.preventDefault());
      input.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (list.hidden) show();
          if (matches.length) {
            const direction = event.key === "ArrowDown" ? 1 : -1;
            highlight(activeIndex < 0 ? (direction > 0 ? 0 : matches.length - 1) : (activeIndex + direction + matches.length) % matches.length);
          }
        } else if (event.key === "Enter" && !list.hidden && activeIndex >= 0) {
          event.preventDefault();
          event.stopPropagation();
          choose(activeIndex);
        } else if (event.key === "Escape" && !list.hidden) {
          event.preventDefault();
          event.stopPropagation();
          hide();
        }
      });

      wrapper.append(input, selectArrow(), list);
      return wrapper;
    }

    function renderCondition(condition) {
      const field = fields.find(item => item.id === condition.field);
      const row = element("section", "zms-builder-condition");
      row.dataset.conditionId = condition.id;
      row.dataset.field = field.id;

      const heading = element("div", "zms-builder-condition-heading");
      heading.append(element("strong", "", messages[field.id]));
      const actions = element("div", "zms-builder-row-actions");
      if (groups().length > 1) actions.append(moveControl(condition));
      if (["date", "number", "query"].includes(field.type)) actions.append(negateControl(condition, messages.exclude));
      const remove = button("btn--text btn--subtle no-padding zms-builder-remove");
      remove.append(closeIcon());
      remove.setAttribute("aria-label", `${messages.remove}: ${messages[field.id]}`);
      remove.addEventListener("click", () => {
        const parent = parentGroup(condition);
        parent.conditions = parent.conditions.filter(item => item !== condition);
        renderRows();
      });
      actions.append(remove);
      heading.append(actions);
      row.append(heading);

      const controls = element("div", "zms-builder-condition-controls");

      if (field.type === "choices") {
        controls.append(selectControl(condition, [["is", "is"], ["isNot", "isNot"]]));
        const choices = element("div", "zms-builder-choices");
        choiceOptions(field).forEach(option => {
          const choice = button("btn--small btn--slim zms-builder-choice");
          choice.append(element("span", "", option.label));
          choice.dataset.value = option.value;
          choice.setAttribute("aria-pressed", condition.values.includes(option.value));
          choice.classList.toggle("btn--active", condition.values.includes(option.value));
          choice.addEventListener("click", () => {
            condition.values = condition.values.includes(option.value) ? condition.values.filter(value => value !== option.value) : [...condition.values, option.value];
            condition.touched = true;
            choice.setAttribute("aria-pressed", condition.values.includes(option.value));
            choice.classList.toggle("btn--active", condition.values.includes(option.value));
            updatePreview();
          });
          choices.append(choice);
        });
        controls.append(choices);
      } else if (field.type === "date") {
        const dates = element("div", "zms-builder-date-values");
        const renderDates = () => {
          dates.replaceChildren();
          if (periods[condition.operator]) return;
          dates.append(inputControl(condition, "value", "date", messages.from));
          if (condition.operator === "between") dates.append(inputControl(condition, "endValue", "date", messages.to));
        };
        controls.append(selectControl(condition, Object.keys(periods).concat(["on", "before", "since", "between"]).map(key => [key, key]), renderDates));
        renderDates();
        controls.append(dates);
      } else if (field.type === "number") {
        const values = element("div", "zms-builder-date-values");
        const renderNumbers = () => {
          values.replaceChildren(inputControl(condition, "value", "number", condition.operator === "between" ? messages.from : messages.value));
          if (condition.operator === "between") values.append(inputControl(condition, "endValue", "number", messages.to));
        };
        controls.append(selectControl(condition, [["equal", "equal"], ["atLeast", "atLeast"], ["atMost", "atMost"], ["between", "range"]], renderNumbers));
        renderNumbers();
        controls.append(values);
      } else {
        if (field.type !== "query") controls.append(selectControl(condition, [["is", "contains"], ["isNot", "notContains"]]));
        const input = inputControl(condition, "value", "text", messages.value);
        controls.append(field.options && options[field.options]?.length ? suggestionInput(input, options[field.options], condition) : input);
      }

      const error = element("p", "help-block text-danger zms-builder-error");
      error.setAttribute("aria-live", "polite");
      error.hidden = true;
      row.append(controls, error);
      return row;
    }

    function addCondition(field) {
      const condition = {
        id: ++nextConditionId, field: field.id,
        operator: field.type === "date" ? "week" : field.type === "number" ? "equal" : "is",
        value: "", endValue: "", values: [], touched: false
      };
      selectedGroup().conditions.push(condition);
      renderRows();
      const row = dialog.querySelector(`[data-condition-id="${condition.id}"]`);
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      updatePreview();
      (row.querySelector("input") || row.querySelector(".zms-builder-choice") || row.querySelector("select"))?.focus();
    }

    function renderCatalog(term = "") {
      const catalog = dialog.querySelector(".zms-builder-fields");
      catalog.replaceChildren();
      const matches = fields.filter(field => messages[field.id].toLocaleLowerCase().includes(term.trim().toLocaleLowerCase()));

      for (const category of ["ticket", "people", "dates"]) {
        const items = matches.filter(field => field.category === category);
        if (!items.length) continue;
        catalog.append(element("h3", "zms-builder-category", messages[category]));
        items.forEach(field => {
          const control = button("btn--text no-padding zms-builder-field");
          control.dataset.field = field.id;
          const plus = element("span", "zms-builder-field-plus", "+");
          plus.setAttribute("aria-hidden", "true");
          control.append(element("span", "", messages[field.id]), plus);
          control.addEventListener("click", () => addCondition(field));
          catalog.append(control);
        });
      }

      if (!matches.length) catalog.append(element("p", "zms-builder-catalog-empty", messages.noFields));
    }

    function open() {
      if (dialog?.open) return;
      const currentState = readState();
      if (state?.userId !== currentState?.userId) drafts.clear();
      state = currentState;
      if (!state || !searchInput()) return;
      openedUserId = state.userId;
      messages = translations[String(state.locale).slice(0, 2)] || translations.en;
      options = state.searchOptions || {};
      selectMarkup = state.selectTemplate || "";
      const query = searchInput().value.trim();
      draft = structuredClone(drafts.get(query) || { base: query, join: "all", conditions: [] });
      targetGroupId = "root";

      dialog = element("dialog", "zms-builder");
      dialog.setAttribute("aria-labelledby", "zms-builder-title");
      const modal = modalContent();
      const body = modal.querySelector(".modal-body");
      body.classList.add("zms-builder-body");
      body.innerHTML = `
            <aside class="zms-builder-catalog">
              <h2 data-label="catalog"></h2>
              <input type="search" class="form-control zms-builder-find" autocomplete="off">
              <label class="zms-builder-target" hidden><span data-label="addTo"></span><div class="controls controls--select"><select class="form-control"></select></div></label>
              <div class="zms-builder-fields"></div>
            </aside>
            <div class="zms-builder-editor">
              <label class="zms-builder-base-label"><span data-label="base"></span><textarea class="form-control zms-builder-base" rows="2"></textarea></label>
              <div class="zms-builder-conditions-header"><h2><span data-label="conditions"></span><span class="label label-info zms-builder-count"></span></h2><button type="button" class="btn btn--small btn--slim zms-builder-add-group" data-label="addGroup"></button></div>
              <div class="zms-builder-match">
                <div id="zms-builder-match-label" data-label="match"></div>
                <div class="btn-group zms-builder-join" role="group" aria-labelledby="zms-builder-match-label" aria-describedby="zms-builder-join-help">
                  <button type="button" class="btn btn--small" data-join="all" data-label="all"></button><button type="button" class="btn btn--small" data-join="any" data-label="any"></button>
                </div>
                <p id="zms-builder-join-help" class="help-block zms-builder-join-help"></p>
              </div>
              <div class="zms-builder-rows"></div>
              <div class="zms-builder-empty"><strong data-label="empty"></strong><p data-label="emptyHint"></p></div>
            </div>`;
      const preview = element("section", "modal-body zms-builder-preview");
      preview.innerHTML = '<label class="text-muted" data-label="preview" for="zms-builder-query"></label><input id="zms-builder-query" class="form-control zms-builder-query" type="text" readonly aria-live="polite">';
      modal.querySelector(".modal-content").insertBefore(preview, modal.querySelector(".modal-footer"));
      dialog.append(modal);

      dialog.querySelectorAll("[data-label]").forEach(node => { node.textContent = messages[node.dataset.label]; });
      dialog.querySelector(".zms-builder-dismiss").setAttribute("aria-label", messages.close);
      for (const selector of [".zms-builder-dismiss", ".zms-builder-cancel"]) {
        dialog.querySelector(selector).addEventListener("click", event => { event.preventDefault(); close(); });
      }
      dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
      dialog.addEventListener("click", event => {
        event.stopPropagation();
        if (event.target === dialog) close();
      });
      dialog.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
        else if ((event.key === "Enter" || event.key === " ") && event.target.closest(".zms-builder-dismiss")) { event.preventDefault(); close(); }
      });
      for (const eventName of ["keyup", "input", "change"]) dialog.addEventListener(eventName, event => event.stopPropagation());

      const find = dialog.querySelector(".zms-builder-find");
      find.placeholder = messages.find;
      find.setAttribute("aria-label", messages.find);
      find.addEventListener("input", () => renderCatalog(find.value));
      const target = dialog.querySelector(".zms-builder-target select");
      target.setAttribute("aria-label", messages.addTo);
      target.after(selectArrow());
      target.addEventListener("change", () => { targetGroupId = target.value; updateTargets(); });
      dialog.querySelector(".zms-builder-add-group").addEventListener("click", () => addGroup(draft));

      const base = dialog.querySelector(".zms-builder-base");
      base.value = draft.base;
      base.placeholder = messages.basePlaceholder;
      base.addEventListener("input", () => { draft.base = base.value; updatePreview(); });

      dialog.querySelectorAll(".zms-builder-match [data-join]").forEach(button => {
        button.setAttribute("aria-pressed", button.dataset.join === draft.join);
        button.classList.toggle("btn--active", button.dataset.join === draft.join);
        button.addEventListener("click", () => {
          draft.join = button.dataset.join;
          dialog.querySelectorAll(".zms-builder-match [data-join]").forEach(item => {
            item.setAttribute("aria-pressed", item.dataset.join === draft.join);
            item.classList.toggle("btn--active", item.dataset.join === draft.join);
          });
          updatePreview();
        });
      });

      dialog.querySelector(".zms-builder-apply").addEventListener("click", () => {
        const currentState = readState();
        if (currentState?.userId !== openedUserId || !/^#search(?:\/|$)/.test(location.hash)) return close();
        const result = compile(draft);
        if (!result.query || result.errors.some(Boolean)) return;
        drafts.set(result.query, structuredClone(draft));
        if (drafts.size > 30) drafts.delete(drafts.keys().next().value);
        close();
        applyQuery(result.query);
      });

      document.body.append(dialog);
      renderCatalog();
      renderRows();
      dialog.showModal();
      find.focus();
    }

    function render(nextState) {
      if (state?.userId !== nextState?.userId) { close(); drafts.clear(); }
      state = nextState;
      const input = state && /^#search(?:\/|$)/.test(location.hash) ? searchInput() : null;
      const toolbar = document.querySelector(".zms-builder-toolbar");

      if (!input) {
        toolbar?.remove();
        close();
        return;
      }

      const launchLabel = (translations[String(state.locale).slice(0, 2)] || translations.en).launch;
      if (toolbar?.isConnected) {
        const label = toolbar.querySelector(".zms-builder-launch-label");
        if (label.textContent !== launchLabel) label.textContent = launchLabel;
        return;
      }
      const container = element("div", "zms-builder-toolbar");
      const nativeAction = input.closest(".detail-search-header")?.querySelector("button.btn--action");
      const launch = nativeAction ? nativeAction.cloneNode(false) : button("btn--action");
      for (const attribute of [...launch.attributes]) if (attribute.name !== "class") launch.removeAttribute(attribute.name);
      for (const className of [...launch.classList]) {
        if (className.startsWith("js-") || ["btn--only-icon", "btn--icon-only", "is-disabled", "hide"].includes(className)) launch.classList.remove(className);
      }
      launch.classList.add("btn", "btn--action", "zms-builder-launch");
      launch.type = "button";
      const searchIcon = document.querySelector('.tasks-navigation .icon-searchdetail');
      if (searchIcon) {
        const icon = searchIcon.cloneNode(true);
        icon.setAttribute("aria-hidden", "true");
        launch.append(icon);
      }
      launch.append(element("span", "btn-label zms-builder-launch-label", launchLabel));
      launch.setAttribute("aria-haspopup", "dialog");
      launch.addEventListener("click", event => { event.stopPropagation(); open(); });
      container.append(launch);
      const anchor = input.closest(".searchfield") || input.closest("form.search-holder") || input;
      anchor.insertAdjacentElement("afterend", container);
    }

    function destroy() {
      close();
      drafts.clear();
      document.querySelectorAll(".zms-builder-toolbar").forEach(toolbar => toolbar.remove());
    }

    return { render, destroy };
  }

  globalThis.ZammadSearchBuilder = { create, compile };
})();
