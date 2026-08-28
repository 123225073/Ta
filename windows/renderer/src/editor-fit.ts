export function computeEditorFitScale(
  imageWidth: number,
  imageHeight: number,
  availableWidth: number,
  availableHeight: number,
) {
  if (![imageWidth, imageHeight, availableWidth, availableHeight].every((value) => Number.isFinite(value) && value > 0)) return 1
  return Math.max(0.001, Math.min(1, availableWidth / imageWidth, availableHeight / imageHeight))
}
