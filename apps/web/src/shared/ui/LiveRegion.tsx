type LiveRegionProps = {
  message: string;
};

export function LiveRegion({ message }: LiveRegionProps) {
  return (
    <p className="sr-only" aria-live="polite">
      {message}
    </p>
  );
}
