export function clampChartTooltipPercent(value: number, minimum = 14, maximum = 86) {
  return Math.min(maximum, Math.max(minimum, value));
}
