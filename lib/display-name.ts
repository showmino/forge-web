// displayName turns a service name such as "billing-web" into "Billing Web".
export function displayName(service: string): string {
  return service
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
