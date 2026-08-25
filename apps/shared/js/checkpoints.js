(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.TrainingCheckpoints = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RESULT = Object.freeze({
    ACCEPTABLE: "acceptable",
    CLOSE: "close",
    INCORRECT: "materially-incorrect",
    INVALID: "invalid"
  });

  function finiteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function evaluateNumeric(actualValue, targetValue, options) {
    const actual = finiteNumber(actualValue);
    const target = finiteNumber(targetValue);
    const settings = options || {};
    if (actual === null || target === null) {
      return Object.freeze({ status: RESULT.INVALID, actual, target, difference: null, tolerance: null });
    }

    const absolute = Math.max(0, finiteNumber(settings.absolute) || 0);
    const percent = Math.max(0, finiteNumber(settings.percent) || 0);
    const tolerance = Math.max(absolute, Math.abs(target) * percent / 100);
    const closeMultiplier = Math.max(1, finiteNumber(settings.closeMultiplier) || 2);
    const difference = actual - target;
    const magnitude = Math.abs(difference);
    const status = magnitude <= tolerance
      ? RESULT.ACCEPTABLE
      : magnitude <= tolerance * closeMultiplier
        ? RESULT.CLOSE
        : RESULT.INCORRECT;

    return Object.freeze({ status, actual, target, difference, tolerance });
  }

  function memoryStorage() {
    const values = new Map();
    return {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    };
  }

  class SessionState {
    constructor(moduleId, checkpointIds, storage) {
      if (!moduleId || !Array.isArray(checkpointIds) || checkpointIds.length === 0) {
        throw new Error("SessionState requires a module id and at least one checkpoint id.");
      }
      this.key = `training-checkpoints:${moduleId}:v1`;
      this.ids = checkpointIds.slice();
      this.storage = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : memoryStorage());
      this.state = this.read();
    }

    defaults() {
      return { currentIndex: 0, completed: [], results: {} };
    }

    read() {
      try {
        const parsed = JSON.parse(this.storage.getItem(this.key) || "null");
        if (!parsed || !Array.isArray(parsed.completed)) return this.defaults();
        const completed = parsed.completed.filter(id => this.ids.includes(id));
        const currentIndex = Math.max(0, Math.min(this.ids.length - 1, Number(parsed.currentIndex) || 0));
        return { currentIndex, completed, results: parsed.results && typeof parsed.results === "object" ? parsed.results : {} };
      } catch (_error) {
        return this.defaults();
      }
    }

    write() {
      this.storage.setItem(this.key, JSON.stringify(this.state));
    }

    currentId() {
      return this.ids[this.state.currentIndex];
    }

    isComplete(id) {
      return this.state.completed.includes(id);
    }

    complete(id, result) {
      if (!this.ids.includes(id)) throw new Error(`Unknown checkpoint id: ${id}`);
      if (!this.isComplete(id)) this.state.completed.push(id);
      if (result !== undefined) this.state.results[id] = result;
      this.write();
    }

    next() {
      if (!this.isComplete(this.currentId())) return false;
      if (this.state.currentIndex < this.ids.length - 1) this.state.currentIndex += 1;
      this.write();
      return true;
    }

    allComplete() {
      return this.ids.every(id => this.isComplete(id));
    }

    snapshot() {
      return JSON.parse(JSON.stringify({ ...this.state, allComplete: this.allComplete(), currentId: this.currentId() }));
    }

    reset() {
      this.state = this.defaults();
      this.storage.removeItem(this.key);
    }
  }

  function requiredElement(elements, name) {
    const node = elements && elements[name];
    if (!node) throw new Error(`Checkpoint flow requires the '${name}' element.`);
    return node;
  }

  class CheckpointFlow {
    constructor(options) {
      const settings = options || {};
      this.checkpoints = settings.checkpoints || [];
      if (this.checkpoints.length === 0) throw new Error("CheckpointFlow requires checkpoints.");
      this.elements = settings.elements || {};
      this.onUnlock = settings.onUnlock || function () {};
      this.onReset = settings.onReset || function () {};
      this.session = new SessionState(settings.moduleId, this.checkpoints.map(item => item.id), settings.storage);
      this.feedback = requiredElement(this.elements, "feedback");
      this.checkButton = requiredElement(this.elements, "checkButton");
      this.nextButton = requiredElement(this.elements, "nextButton");
      this.resetButton = requiredElement(this.elements, "resetButton");
      this.bind();
      this.render();
    }

    current() {
      return this.checkpoints[this.session.state.currentIndex];
    }

    bind() {
      this.checkButton.addEventListener("click", () => this.check());
      this.nextButton.addEventListener("click", () => {
        this.session.next();
        this.render();
      });
      this.resetButton.addEventListener("click", () => {
        this.session.reset();
        this.onReset();
        this.render();
      });
    }

    showFeedback(kind, message) {
      this.feedback.className = `checkpoint-feedback is-${kind}`;
      this.feedback.textContent = message;
      this.feedback.hidden = false;
    }

    render() {
      const checkpoint = this.current();
      const snapshot = this.session.snapshot();
      requiredElement(this.elements, "number").textContent = `Checkpoint ${snapshot.currentIndex + 1} of ${this.checkpoints.length}`;
      requiredElement(this.elements, "title").textContent = checkpoint.title;
      requiredElement(this.elements, "task").textContent = checkpoint.task;
      requiredElement(this.elements, "progress").style.width = `${100 * snapshot.completed.length / this.checkpoints.length}%`;
      this.feedback.hidden = true;
      this.checkButton.hidden = snapshot.allComplete || this.session.isComplete(checkpoint.id);
      this.nextButton.hidden = !this.session.isComplete(checkpoint.id) || snapshot.allComplete;
      requiredElement(this.elements, "completeMessage").hidden = !snapshot.allComplete;
      if (typeof checkpoint.render === "function") checkpoint.render(requiredElement(this.elements, "body"), snapshot);
      if (this.session.isComplete(checkpoint.id) && !snapshot.allComplete) {
        this.showFeedback("success", checkpoint.takeaway || "Checkpoint complete.");
      }
      this.onUnlock(snapshot.allComplete, snapshot);
    }

    check() {
      const checkpoint = this.current();
      const result = checkpoint.evaluate();
      if (!result || !result.status) throw new Error(`Checkpoint '${checkpoint.id}' did not return an evaluation status.`);
      if (result.status === RESULT.ACCEPTABLE) {
        this.session.complete(checkpoint.id, result.storedResult);
        requiredElement(this.elements, "progress").style.width = `${100 * this.session.state.completed.length / this.checkpoints.length}%`;
        this.checkButton.hidden = true;
        this.nextButton.hidden = this.session.allComplete();
        this.showFeedback("success", result.message || checkpoint.takeaway || "Checkpoint complete.");
        this.onUnlock(this.session.allComplete(), this.session.snapshot());
        requiredElement(this.elements, "completeMessage").hidden = !this.session.allComplete();
      } else {
        const kind = result.status === RESULT.CLOSE ? "close" : "error";
        this.showFeedback(kind, result.message || (kind === "close" ? "You are close. Recheck the requested quantity and units." : "Recheck the data, units, and engineering assumption."));
      }
      return result;
    }
  }

  return Object.freeze({ RESULT, finiteNumber, evaluateNumeric, SessionState, CheckpointFlow });
});
