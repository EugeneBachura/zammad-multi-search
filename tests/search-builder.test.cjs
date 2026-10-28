const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/search-builder.js"), "utf8"), context);
const { compile } = context.ZammadSearchBuilder;

function condition(field, values = {}) {
  return { field, operator: "is", value: "", endValue: "", values: [], ...values };
}

test("combines an existing OR query with a grouped status condition", () => {
  const result = compile({
    base: "printer OR scanner", join: "all",
    conditions: [condition("state", { values: ["open", "new", "open"] }), condition("created", { operator: "week" })]
  });
  assert.equal(result.query, '(printer OR scanner) AND (state.name:("open" OR "new")) AND (created_at:>now-7d)');
  assert.ok(result.errors.every(error => !error));
});

test("escapes quotation marks and backslashes inside literal values", () => {
  const result = compile({ base: "", join: "all", conditions: [condition("titleField", { value: 'WiFi "A" \\ OR state.name:closed' })] });
  assert.equal(result.query, String.raw`title:"WiFi \"A\" \\ OR state.name:closed"`);
});

test("combines exclusions with OR without changing their scope", () => {
  const result = compile({
    base: "", join: "any", conditions: [
      condition("customer", { operator: "isNot", value: "a+b@example.org" }),
      condition("priority", { values: ["4 urgent"] })
    ]
  });
  assert.equal(result.query, '(NOT (customer.email:"a+b@example.org")) OR (priority.name:"4 urgent")');
});

test("generates inclusive numeric ranges and rejects invalid counts", () => {
  for (const [operator, expected] of [["equal", "0"], ["atLeast", "[0 TO *]"], ["atMost", "[* TO 0]"]]) {
    const result = compile({ base: "", join: "all", conditions: [condition("articles", { operator, value: "0" })] });
    assert.equal(result.query, `article_count:${expected}`);
  }
  for (const value of ["-1", "1.5", "Infinity", "", "9007199254740992"]) {
    const result = compile({ base: "", join: "all", conditions: [condition("articles", { value })] });
    assert.equal(result.errors[0], "invalidNumber");
  }
});

test("validates actual calendar dates and the order of a date range", () => {
  const compileDate = (value, endValue) => compile({ base: "", join: "all", conditions: [condition("created", { operator: "between", value, endValue })] });
  assert.equal(compileDate("2024-02-29", "2024-03-01").query, "created_at:[2024-02-29 TO 2024-03-01]");
  assert.equal(compileDate("2026-02-29", "2026-03-01").errors[0], "invalidDate");
  assert.equal(compileDate("2026-10-27", "2026-10-01").errors[0], "dateOrder");
  assert.equal(compileDate("2026-10-01", "").errors[0], "invalidDate");
});

test("keeps relative time periods relative to the time of each search", () => {
  for (const [operator, period] of [["day", "24h"], ["week", "7d"], ["fortnight", "14d"], ["month", "30d"]]) {
    const result = compile({ base: "", join: "all", conditions: [condition("updated", { operator })] });
    assert.equal(result.query, `updated_at:>now-${period}`);
  }
});

test("requires a value instead of silently applying an empty filter", () => {
  assert.equal(compile({ base: "Knovel", join: "all", conditions: [condition("state")] }).errors[0], "selectValue");
  assert.equal(compile({ base: "Knovel", join: "all", conditions: [condition("group")] }).errors[0], "required");
});

test("keeps independent AND and OR groups explicitly parenthesized", () => {
  const result = compile({ base: "", join: "all", conditions: [
    { id: 1, join: "any", conditions: [condition("group", { value: "Support" }), condition("group", { value: "IT" })] },
    { id: 2, join: "any", conditions: [condition("state", { values: ["open"] }), condition("priority", { values: ["3 high"] })] }
  ] });
  assert.equal(result.query, '((group.name:"Support") OR (group.name:"IT")) AND ((state.name:"open") OR (priority.name:"3 high"))');
  assert.ok(result.errors.every(error => !error));
});

test("negates whole nested groups without changing the inner operator", () => {
  const result = compile({ base: "printer", join: "all", conditions: [
    { id: 1, join: "any", negated: true, conditions: [condition("tags", { value: "spam" }), condition("state", { values: ["closed"] })] },
    condition("created", { operator: "week", negated: true })
  ] });
  assert.equal(result.query, '(printer) AND (NOT ((tags:"spam") OR (state.name:"closed"))) AND (NOT (created_at:>now-7d))');
});

test("reports invalid nested values and empty groups", () => {
  const empty = compile({ base: "printer", join: "all", conditions: [{ id: 5, join: "any", conditions: [] }] });
  assert.equal(empty.errorsById[5], "emptyGroup");
  const invalid = compile({ base: "", join: "all", conditions: [{ id: 5, join: "all", conditions: [condition("articles", { id: 6, value: "1.2" })] }] });
  assert.equal(invalid.errorsById[6], "invalidNumber");
});

test("supports numeric TO ranges, including zero, and validates both bounds", () => {
  const range = (value, endValue) => compile({ base: "", join: "all", conditions: [condition("articles", { operator: "between", value, endValue })] });
  assert.equal(range("0", "10").query, "article_count:[0 TO 10]");
  assert.equal(range("10", "2").errors[0], "numberOrder");
  assert.equal(range("2", "").errors[0], "invalidNumber");
  assert.equal(range("2", "2.5").errors[0], "invalidNumber");
});

test("keeps a raw search expression inside an excluded group", () => {
  const result = compile({ base: "", join: "all", conditions: [{ id: 1, join: "all", negated: true, conditions: [condition("queryField", { value: "printer OR scanner" })] }] });
  assert.equal(result.query, "NOT (printer OR scanner)");
});
