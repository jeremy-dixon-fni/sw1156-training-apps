"use strict";

const assert = require("node:assert/strict");

require("../js/model.js");
let call = null;
global.Plotly = {
  react(container, data, layout, config) {
    call = { container, data, layout, config };
    return "rendered";
  }
};

const Charts = require("../js/charts.js");
const container = { id: "plot" };
const figure = { data: [{ x: [0], y: [1] }], layout: { title: "Test" }, config: { responsive: true } };

assert.equal(Charts.render(container, figure), "rendered");
assert.equal(call.container, container);
assert.deepEqual(call.data, figure.data);
assert.deepEqual(call.layout, figure.layout);
assert.deepEqual(call.config, figure.config);

console.log("charts.js render regression test passed");
