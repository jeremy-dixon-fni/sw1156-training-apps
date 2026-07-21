(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LossesModel = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TOTAL_RAINFALL_IN = 10.0;
  const DT_HR = 0.25;
  const STORM_DURATION_HR = 24.0;
  const CHECKPOINT_TARGETS = Object.freeze([
    Object.freeze({ targetPct: 5.0, targetTimeHr: 10.0 }),
    Object.freeze({ targetPct: 15.0, targetTimeHr: 11.0 }),
    Object.freeze({ targetPct: 30.0, targetTimeHr: 12.0 }),
    Object.freeze({ targetPct: 45.0, targetTimeHr: 13.0 }),
    Object.freeze({ targetPct: 60.0, targetTimeHr: 15.0 }),
  ]);
  const FINAL_TARGET_PCT = 74.0;
  const FINAL_TARGET_TIME_HR = 24.0;

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function finiteNumber(value, fallback = 0.0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function cumulativeSum(values) {
    let total = 0.0;
    return values.map((value) => {
      total += value;
      return total;
    });
  }

  function addArrays(left, right) {
    if (left.length !== right.length) {
      throw new Error("Array lengths must match.");
    }
    return left.map((value, index) => value + right[index]);
  }

  function sum(values) {
    return values.reduce((total, value) => total + value, 0.0);
  }

  function makeTrainingHyetograph() {
    const stepCount = Math.round(STORM_DURATION_HR / DT_HR);
    const timeHr = Array.from({ length: stepCount }, (_, index) => (index + 1) * DT_HR);
    const shape = timeHr.map((time) => {
      const center = time - 0.5 * DT_HR;
      return (
        0.10 * Math.exp(-0.5 * Math.pow((center - 6.5) / 2.3, 2)) +
        1.00 * Math.exp(-0.5 * Math.pow((center - 12.0) / 1.65, 2)) +
        0.22 * Math.exp(-0.5 * Math.pow((center - 16.8) / 2.4, 2)) +
        0.015
      );
    });

    const shapeTotal = sum(shape);
    const rainfallIn = shape.map((value) => (value / shapeTotal) * TOTAL_RAINFALL_IN);
    return { timeHr, rainfallIn };
  }

  function computeInitialConstantLosses(initialLossIn, constantLossRateInPerHr, percentImpervious) {
    const storm = makeTrainingHyetograph();
    const initialLoss = Math.max(finiteNumber(initialLossIn), 0.0);
    const constantRate = Math.max(finiteNumber(constantLossRateInPerHr), 0.0);
    const imperviousFraction = clamp(finiteNumber(percentImpervious) / 100.0, 0.0, 1.0);
    const perviousFraction = 1.0 - imperviousFraction;

    const imperviousRunoffIn = storm.rainfallIn.map((rain) => rain * imperviousFraction);
    const perviousRainfallIn = storm.rainfallIn.map((rain) => rain * perviousFraction);
    const initialLossIncrements = new Array(storm.rainfallIn.length).fill(0.0);
    const constantLossIncrements = new Array(storm.rainfallIn.length).fill(0.0);
    const perviousRunoffIn = new Array(storm.rainfallIn.length).fill(0.0);
    const remainingInitialLossIn = new Array(storm.rainfallIn.length).fill(0.0);

    let remainingInitial = initialLoss;
    const constantCapacityPerStep = constantRate * DT_HR;

    perviousRainfallIn.forEach((rain, index) => {
      const initialTake = Math.min(rain, remainingInitial);
      initialLossIncrements[index] = initialTake;
      remainingInitial -= initialTake;

      const availableAfterInitial = rain - initialTake;
      const constantTake = Math.min(availableAfterInitial, constantCapacityPerStep);
      constantLossIncrements[index] = constantTake;
      perviousRunoffIn[index] = availableAfterInitial - constantTake;
      remainingInitialLossIn[index] = remainingInitial;
    });

    const totalRunoffIn = addArrays(imperviousRunoffIn, perviousRunoffIn);
    const totalLossIn = addArrays(initialLossIncrements, constantLossIncrements);
    const cumulativeRainfallIn = cumulativeSum(storm.rainfallIn);
    const cumulativeRunoffIn = cumulativeSum(totalRunoffIn);
    const cumulativeInitialLossIn = cumulativeSum(initialLossIncrements);
    const cumulativeConstantLossIn = cumulativeSum(constantLossIncrements);
    const cumulativeTotalLossIn = cumulativeSum(totalLossIn);

    const massBalanceErrorIn = storm.rainfallIn.map(
      (rain, index) => rain - totalRunoffIn[index] - totalLossIn[index]
    );

    return {
      timeHr: storm.timeHr,
      rainfallIn: storm.rainfallIn,
      perviousRainfallIn,
      imperviousRunoffIn,
      initialLossIn: initialLossIncrements,
      constantLossIn: constantLossIncrements,
      perviousRunoffIn,
      totalRunoffIn,
      remainingInitialLossIn,
      totalLossIn,
      cumulativeRainfallIn,
      cumulativeRunoffIn,
      cumulativeInitialLossIn,
      cumulativeConstantLossIn,
      cumulativeTotalLossIn,
      massBalanceErrorIn,
      inputs: {
        initialLossIn: initialLoss,
        constantLossRateInPerHr: constantRate,
        percentImpervious: imperviousFraction * 100.0,
      },
    };
  }

  function firstCrossingTime(timeHr, valuesPct, targetPct) {
    if (timeHr.length !== valuesPct.length) {
      throw new Error("Time and value arrays must have the same length.");
    }

    const times = [0.0, ...timeHr];
    const values = [0.0, ...valuesPct];
    const upper = values.findIndex((value) => value >= targetPct);
    if (upper < 0) {
      return null;
    }
    if (upper === 0) {
      return times[0];
    }

    const lower = upper - 1;
    const y0 = values[lower];
    const y1 = values[upper];
    if (Math.abs(y1 - y0) <= 1e-12) {
      return times[upper];
    }

    const fraction = (targetPct - y0) / (y1 - y0);
    return times[lower] + fraction * (times[upper] - times[lower]);
  }

  function cumulativeRunoffPercent(result) {
    return result.cumulativeRunoffIn.map((value) => (value / TOTAL_RAINFALL_IN) * 100.0);
  }

  function makeGoalRows(result) {
    const runoffPct = cumulativeRunoffPercent(result);
    const rows = CHECKPOINT_TARGETS.map((target) => {
      const currentTimeHr = firstCrossingTime(result.timeHr, runoffPct, target.targetPct);
      return {
        kind: "checkpoint",
        targetPct: target.targetPct,
        targetTimeHr: target.targetTimeHr,
        currentTimeHr,
        miss: currentTimeHr === null ? null : currentTimeHr - target.targetTimeHr,
        missUnit: "hr",
      };
    });

    const finalRunoffPct = runoffPct[runoffPct.length - 1];
    rows.push({
      kind: "final",
      targetPct: FINAL_TARGET_PCT,
      targetTimeHr: FINAL_TARGET_TIME_HR,
      currentTimeHr: FINAL_TARGET_TIME_HR,
      miss: finalRunoffPct - FINAL_TARGET_PCT,
      missUnit: "%-pt",
    });
    return rows;
  }

  function summarizeResult(result) {
    const finalRunoffIn = result.cumulativeRunoffIn[result.cumulativeRunoffIn.length - 1];
    const totalLossIn = result.cumulativeTotalLossIn[result.cumulativeTotalLossIn.length - 1];
    const imperviousRunoffIn = sum(result.imperviousRunoffIn);
    const maximumAbsoluteMassBalanceErrorIn = Math.max(
      ...result.massBalanceErrorIn.map((value) => Math.abs(value))
    );

    return {
      finalRunoffIn,
      finalRunoffPct: (finalRunoffIn / TOTAL_RAINFALL_IN) * 100.0,
      totalLossIn,
      totalLossPct: (totalLossIn / TOTAL_RAINFALL_IN) * 100.0,
      imperviousRunoffIn,
      imperviousRunoffPct: (imperviousRunoffIn / TOTAL_RAINFALL_IN) * 100.0,
      maximumAbsoluteMassBalanceErrorIn,
    };
  }

  return Object.freeze({
    TOTAL_RAINFALL_IN,
    DT_HR,
    STORM_DURATION_HR,
    CHECKPOINT_TARGETS,
    FINAL_TARGET_PCT,
    FINAL_TARGET_TIME_HR,
    cumulativeSum,
    makeTrainingHyetograph,
    computeInitialConstantLosses,
    firstCrossingTime,
    cumulativeRunoffPercent,
    makeGoalRows,
    summarizeResult,
  });
});
