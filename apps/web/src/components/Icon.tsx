/** Small inline stroke icons (no icon font, no emoji). */
const P: Record<string, string> = {
  overview: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 9h8V3h-8z",
  approvals: "M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V7z",
  agents: "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 22v-2a7 7 0 0 1 14 0v2",
  audit: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  plus: "M12 5v14M5 12h14",
  collapse: "M15 18l-6-6 6-6",
  expand: "M9 18l6-6-6-6",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
};
export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ""} />
    </svg>
  );
}
