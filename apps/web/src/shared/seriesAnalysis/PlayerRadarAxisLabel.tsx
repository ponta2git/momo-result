/** Keep the qualifier with its word when a narrow comparison column wraps. */
export function PlayerRadarAxisLabel({ label }: { label: string }) {
  return label.split(/(?=（)/u).map((part) => (
    <span className="inline-block" key={part}>
      {part}
    </span>
  ));
}
