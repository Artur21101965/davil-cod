// lib/economics.js — оценка экономии Freegate против платных API.
// Freegate бесплатен (маршрутизация по free-моделям), но пользователь получил
// бы объём работы. Оцениваем, сколько стоил бы этот же трафик у платных
// провайдеров, показываем экономию в $. Цены — репрезентативные (USD / 1M
// токенов), усреднённые по индустрии; расчёт консервативный (в пользу «дорого»,
// чтобы не преувеличивать экономию).

// Репрезентативные цены за 1M токенов (input / output), USD. Усреднено по
// популярным моделям (GPT-4o, Claude, Gemini Pro): input ~$3-5, output ~$15.
const PRICE_PER_M_INPUT = 3;
const PRICE_PER_M_OUTPUT = 15;

// Расчёт стоимости заданного объёма токенов.
function costOfTokens(promptTokens = 0, completionTokens = 0) {
  const inputCost = (promptTokens / 1000000) * PRICE_PER_M_INPUT;
  const outputCost = (completionTokens / 1000000) * PRICE_PER_M_OUTPUT;
  return { usd: inputCost + outputCost, inputUsd: inputCost, outputUsd: outputCost };
}

// Агрегация по всем провайдерам из tokenUsage. Возвращает итоговую экономию.
function aggregateSavings(tokenUsage = {}) {
  let prompt = 0, completion = 0;
  for (const [_, tu] of Object.entries(tokenUsage)) {
    prompt += tu.promptTokens || 0;
    completion += tu.completionTokens || 0;
  }
  const total = prompt + completion;
  const cost = costOfTokens(prompt, completion);
  // Экономия = стоимость платного аналога (Freegate этого не стоит — 0).
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    savedUsd: cost.usd,
    savedInputUsd: cost.inputUsd,
    savedOutputUsd: cost.outputUsd,
    costPerMInput: PRICE_PER_M_INPUT,
    costPerMOutput: PRICE_PER_M_OUTPUT,
    basis: `input $${PRICE_PER_M_INPUT}/M, output $${PRICE_PER_M_OUTPUT}/M (репрезентативно)`,
  };
}

module.exports = { PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT, costOfTokens, aggregateSavings };
