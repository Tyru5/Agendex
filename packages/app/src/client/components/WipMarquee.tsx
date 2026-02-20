const WIP_TEXT =
  'Work in progress \u2014 contributions welcome! \u00A0\u00A0\u2022\u00A0\u00A0 ' +
  'github.com/Tyru5/Agendex \u00A0\u00A0\u2022\u00A0\u00A0 ';

export function WipMarquee({ style }: { style?: React.CSSProperties }) {
  const repeated = WIP_TEXT.repeat(8);
  return (
    <div className="wip-marquee" style={style}>
      <div className="wip-marquee-track">
        {repeated}
        {repeated}
      </div>
    </div>
  );
}
