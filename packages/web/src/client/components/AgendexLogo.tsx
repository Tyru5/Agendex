import mark from '../assets/agendex-mark.png';

/** The Painter-designed index mark with a live, theme-aware wordmark. */
export function AgendexLogo() {
  return (
    <span className="agendex-logo">
      <span
        className="agendex-logo-symbol"
        style={{ maskImage: `url(${mark})` }}
        aria-hidden="true"
      />
      <span>Agendex</span>
    </span>
  );
}
