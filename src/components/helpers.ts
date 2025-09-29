export function getJobId({
  elementId,
  partId,
}: {
  elementId: string;
  partId: string;
}) {
  return `${elementId}-${partId}`;
}
