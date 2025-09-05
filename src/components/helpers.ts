export function getJobId({
  elementId,
  partId,
  format,
}: {
  elementId: string;
  partId: string;
  format: string;
}) {
  return `${elementId}-${partId}-${format}`;
}
