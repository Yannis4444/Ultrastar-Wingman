import "./Loading.css";

/** The app's pending indicator: a sliding bar, no dependency, no layout jump. */
export default function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <span className="loading-bar" />
    </div>
  );
}
