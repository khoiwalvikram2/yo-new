import { useId, type ReactNode } from 'react'

type Paint = (name: string) => string
type SuitName = 'spade' | 'heart' | 'club' | 'diamond'

/* Shared materials, never shared SVG ids: several lounge previews can safely coexist. */
function Scene({ kind, children }: { kind: string; children: (paint: Paint, id: string) => ReactNode }) {
  const id = `lounge-${useId().replace(/:/g, '')}`
  const paint: Paint = name => `url(#${id}-${name})`
  return <svg className={`lg-art-svg is-${kind}`} viewBox="0 0 320 260" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#5B442A" /><stop offset=".2" stopColor="#C8AA71" /><stop offset=".39" stopColor="#FFF0C5" /><stop offset=".56" stopColor="#9B7946" /><stop offset=".8" stopColor="#DCC18B" /><stop offset="1" stopColor="#5F472E" />
      </linearGradient>
      <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2=".9" y2="1">
        <stop stopColor="#313940" /><stop offset=".28" stopColor="#BBC3C6" /><stop offset=".46" stopColor="#F0F2EF" /><stop offset=".64" stopColor="#6F797F" /><stop offset="1" stopColor="#242B31" />
      </linearGradient>
      <linearGradient id={`${id}-paper`} x1="0" y1="0" x2=".8" y2="1">
        <stop stopColor="#FFFFF4" /><stop offset=".65" stopColor="#E8E2CF" /><stop offset="1" stopColor="#BCB5A5" />
      </linearGradient>
      <linearGradient id={`${id}-ink`} x1="0" y1="0" x2=".9" y2="1">
        <stop stopColor="#35404A" /><stop offset=".45" stopColor="#111B22" /><stop offset="1" stopColor="#080E13" />
      </linearGradient>
      <linearGradient id={`${id}-red`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#E06453" /><stop offset=".38" stopColor="#A62E30" /><stop offset="1" stopColor="#531C26" />
      </linearGradient>
      <radialGradient id={`${id}-well`} cx=".42" cy=".33" r=".7">
        <stop stopColor="#52605D" /><stop offset=".4" stopColor="#253330" /><stop offset="1" stopColor="#0A1517" />
      </radialGradient>
      <radialGradient id={`${id}-shadow`}>
        <stop stopColor="#000" stopOpacity=".6" /><stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="160" cy="232" rx="143" ry="20" fill={paint('shadow')} />
    {children(paint, id)}
  </svg>
}

function Pip({ suit, fill }: { suit: SuitName; fill: string }) {
  if (suit === 'club') return <g fill={fill}><circle cx="12" cy="6" r="5" /><circle cx="6" cy="13" r="5" /><circle cx="18" cy="13" r="5" /><path d="M10 13H14L16 23H8Z" /></g>
  const shapes = {
    spade: 'M12 1C9 6 2 10 2 15C2 21 8 22 11 17L9 23H15L13 17C16 22 22 21 22 15C22 10 15 6 12 1Z',
    heart: 'M12 22C9 18 1 13 1 7C1 0 9-1 12 5C15-1 23 0 23 7C23 13 15 18 12 22Z',
    diamond: 'M12 1L22 12L12 23L2 12Z',
  }
  return <path d={shapes[suit]} fill={fill} />
}

function PlayingCard({ x, y, angle = 0, rank, suit, paint, side = '' }: { x: number; y: number; angle?: number; rank: string; suit: SuitName; paint: Paint; side?: string }) {
  const fill = suit === 'heart' || suit === 'diamond' ? '#A52E34' : '#15242C'
  return <g transform={`translate(${x} ${y}) rotate(${angle} 34 86)`}>
    <g className={`lg-art-fan ${side}`}>
      <rect x="1" y="4" width="68" height="102" rx="6" fill="#000" opacity=".35" />
      <rect width="68" height="100" rx="6" fill={paint('paper')} stroke="#FFF7DF" strokeWidth=".7" />
      <rect x="4" y="4" width="60" height="92" rx="3" fill="none" stroke="#A19C8B" strokeOpacity=".35" />
      <text x="10" y="23" fill={fill} fontSize="20" fontFamily="Georgia, serif" fontWeight="700">{rank}</text>
      <g transform="translate(9 26) scale(.44)"><Pip suit={suit} fill={fill} /></g>
      <g transform="translate(21 42) scale(1.1)"><Pip suit={suit} fill={fill} /></g>
      <g transform="translate(59 89) rotate(180) scale(.44)"><Pip suit={suit} fill={fill} /></g>
    </g>
  </g>
}

function ChipStack({ x, y, paint, dark = false, label }: { x: number; y: number; paint: Paint; dark?: boolean; label?: string }) {
  return <g transform={`translate(${x} ${y})`}>
    {[3, 2, 1, 0].map(level => <g key={level} transform={`translate(0 ${level * 6})`}>
      <ellipse cy="4" rx="25" ry="9" fill={dark ? '#0A1218' : '#581D25'} />
      <ellipse rx="25" ry="9" fill={paint(dark ? 'ink' : 'red')} stroke="#C7AA76" strokeWidth="1" />
      <ellipse rx="21" ry="7" fill="none" stroke="#F3DFB7" strokeWidth="3" strokeDasharray="5 11" />
      <ellipse rx="14" ry="5" fill="none" stroke="#E2C38D" strokeWidth=".6" />
    </g>)}
    {label && <text x="0" y="3" textAnchor="middle" fill="#FFF1D0" fontSize="9" fontWeight="800">{label}</text>}
  </g>
}

const point = (radius: number, turn: number) => {
  const angle = turn * Math.PI * 2 - Math.PI / 2
  return `${(160 + radius * Math.cos(angle)).toFixed(2)} ${(130 + radius * Math.sin(angle)).toFixed(2)}`
}
function segment(index: number, count: number, inner: number, outer: number) {
  const a = index / count, b = (index + 1) / count
  return `M${point(outer, a)}A${outer} ${outer} 0 0 1 ${point(outer, b)}L${point(inner, b)}A${inner} ${inner} 0 0 0 ${point(inner, a)}Z`
}
const rouletteOrder = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]

export function RouletteArt() {
  return <Scene kind="roulette">{paint => <>
    <circle cx="160" cy="135" r="108" fill="#090F13" />
    <circle cx="160" cy="130" r="108" fill={paint('brass')} />
    <circle cx="160" cy="130" r="102" fill={paint('ink')} stroke="#E0CDA5" strokeWidth=".8" />
    <circle cx="160" cy="130" r="96" fill="#4D3A2C" stroke="#BEA371" strokeWidth="1" />
    <g className="lg-art-wheel is-roulette">
      {rouletteOrder.map((number, i) => <g key={number}>
        <path d={segment(i, 37, 63, 93)} fill={i === 0 ? '#2D735B' : i % 2 ? '#9D3037' : '#111D25'} stroke="#CDB788" strokeWidth=".55" />
        <text x="160" y="48" textAnchor="middle" fill="#F9EED7" fontSize="7" fontFamily="Arial, sans-serif" transform={`rotate(${(i + .5) * 360 / 37} 160 130)`}>{number}</text>
      </g>)}
      <circle cx="160" cy="130" r="62" fill={paint('well')} stroke="#DAC18F" strokeWidth="2" />
      <circle cx="160" cy="130" r="53" fill="none" stroke="#799185" strokeOpacity=".3" />
      {[0, 90].map(angle => <g key={angle} transform={`rotate(${angle} 160 130)`}><rect x="156" y="89" width="8" height="82" rx="3" fill={paint('chrome')} /><circle cx="160" cy="90" r="5" fill={paint('brass')} /><circle cx="160" cy="170" r="5" fill={paint('brass')} /></g>)}
      <circle cx="160" cy="130" r="15" fill={paint('brass')} stroke="#F2D9A4" /><circle cx="160" cy="130" r="7" fill={paint('chrome')} />
    </g>
    <g className="lg-art-ball"><circle cx="160" cy="34" r="4.5" fill="#FFF9EB" /><circle cx="159" cy="33" r="1.2" fill="#FFF" /></g>
    <path d="M145 22Q160 16 175 22" fill="none" stroke="#FFF6D5" strokeWidth="2" strokeLinecap="round" opacity=".7" />
    <ChipStack x={252} y={205} paint={paint} /><ChipStack x={67} y={215} paint={paint} dark />
  </>}</Scene>
}

export function ReelsArt() {
  return <Scene kind="slots">{(paint, id) => <>
    <defs>{[0, 1, 2].map(i => <clipPath id={`${id}-reel-${i}`} key={i}><rect x={80 + i * 55} y="89" width="48" height="72" rx="3" /></clipPath>)}</defs>
    <path d="M64 56L80 37H242L258 56V206H64Z" fill="#070F15" />
    <rect x="59" y="48" width="202" height="166" rx="13" fill={paint('brass')} stroke="#E0CDA5" />
    <rect x="65" y="54" width="190" height="151" rx="9" fill={paint('ink')} />
    <rect x="93" y="61" width="134" height="17" rx="3" fill="#0C151B" stroke="#8D774F" strokeWidth=".7" />
    {[0, 1, 2, 3, 4].map(i => <path key={i} d="M0-4L1.2-1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2-1.2Z" transform={`translate(${132 + i * 14} 69)`} fill="#D2B47C" />)}
    <rect x="73" y="83" width="174" height="85" rx="5" fill="#040A0E" stroke="#C9B082" strokeWidth="2" />
    {[0, 1, 2].map(i => <g key={i}>
      <rect x={80 + i * 55} y="89" width="48" height="72" rx="3" fill={paint('paper')} />
      <g clipPath={`url(#${id}-reel-${i})`}><g className={`lg-art-reel is-${i + 1}`}>
        {[0, 1, 2].map(row => <text key={row} x={104 + i * 55} y={141 + row * 72} textAnchor="middle" fontSize="44" fontFamily="Georgia, serif" fontWeight="700" fill={row === 1 ? '#18272F' : '#A63136'}>{row === 1 ? '♣' : '7'}</text>)}
      </g></g>
      <path d={`M${81 + i * 55} 91H${126 + i * 55}`} stroke="#FFF" strokeWidth="2" opacity=".7" />
    </g>)}
    <path d="M74 125H246" stroke="#B5443D" strokeWidth="1" opacity=".55" />
    <rect x="96" y="178" width="128" height="17" rx="4" fill="#0B1319" stroke="#8E794F" />
    <circle cx="160" cy="186" r="5" fill={paint('red')} stroke="#D2B47C" />
    <path d="M268 96V159" stroke={paint('chrome')} strokeWidth="8" strokeLinecap="round" /><circle cx="268" cy="91" r="11" fill={paint('red')} stroke="#D2B47C" strokeWidth="2" />
    <path d="M69 214H251L262 224H58Z" fill={paint('brass')} /><ChipStack x={68} y={212} paint={paint} dark />
  </>}</Scene>
}

export function BlackjackArt() {
  return <Scene kind="blackjack">{paint => <>
    <path d="M49 213Q160 160 273 213" fill="none" stroke="#B59A66" strokeWidth=".8" strokeDasharray="4 7" opacity=".5" />
    <g transform="translate(48 25) scale(1.4)"><PlayingCard x={9} y={19} angle={-17} rank="A" suit="spade" paint={paint} side="is-left" /><PlayingCard x={62} y={12} angle={14} rank="K" suit="heart" paint={paint} side="is-right" /></g>
    <ChipStack x={241} y={197} paint={paint} /><ChipStack x={202} y={217} paint={paint} dark />
    <circle cx="75" cy="201" r="22" fill={paint('brass')} /><circle cx="75" cy="201" r="18" fill={paint('ink')} stroke="#F7DFAD" strokeWidth=".6" /><text x="75" y="207" textAnchor="middle" fill="#F8E7C1" fontSize="19" fontFamily="Georgia, serif">21</text>
  </>}</Scene>
}

export function BaccaratArt() {
  return <Scene kind="baccarat">{paint => <>
    <path d="M160 48V219" stroke="#CBB17B" strokeWidth=".6" strokeDasharray="3 6" opacity=".45" />
    <g transform="translate(-9 8) scale(1.12)"><PlayingCard x={70} y={51} angle={-10} rank="A" suit="spade" paint={paint} side="is-left" /><PlayingCard x={163} y={51} angle={10} rank="9" suit="heart" paint={paint} side="is-right" /></g>
    {[{ x: 103, label: 'P', dark: true }, { x: 217, label: 'B', dark: false }].map(chip => <g key={chip.label}>
      <circle cx={chip.x} cy="203" r="26" fill="#071015" opacity=".5" transform="translate(0 4)" /><circle cx={chip.x} cy="203" r="26" fill={paint(chip.dark ? 'ink' : 'red')} stroke="#C9AE78" strokeWidth="2" /><circle cx={chip.x} cy="203" r="20" fill="none" stroke="#F0D6A5" strokeDasharray="3 6" /><text x={chip.x} y="211" textAnchor="middle" fill="#F9EACB" fontSize="23" fontFamily="Georgia, serif">{chip.label}</text>
    </g>)}
    <ChipStack x={263} y={220} paint={paint} dark />
  </>}</Scene>
}

export function TeenPattiArt() {
  return <Scene kind="teenpatti">{paint => <>
    <g transform="translate(-18 -1) scale(1.18)"><PlayingCard x={67} y={68} angle={-21} rank="A" suit="club" paint={paint} side="is-left" /><PlayingCard x={113} y={53} rank="A" suit="diamond" paint={paint} side="is-center" /><PlayingCard x={160} y={68} angle={21} rank="A" suit="heart" paint={paint} side="is-right" /></g>
    <ChipStack x={88} y={213} paint={paint} dark /><ChipStack x={234} y={202} paint={paint} /><ChipStack x={199} y={222} paint={paint} dark />
    <path d="M141 222L160 232L179 222" fill="none" stroke="#D7B77C" strokeWidth="1" />
  </>}</Scene>
}

const showColors = ['#9A3941', '#B69B67', '#254B4D', '#D6CCB0', '#394A67', '#9A3941', '#B69B67', '#254B4D', '#D6CCB0', '#394A67', '#9A3941', '#B69B67']
export function GameShowsArt() {
  return <Scene kind="shows">{paint => <>
    <path d="M142 195L132 227H188L178 195" fill={paint('brass')} /><rect x="118" y="225" width="84" height="8" rx="3" fill={paint('ink')} stroke="#BBA16F" />
    <circle cx="160" cy="130" r="104" fill={paint('brass')} /><circle cx="160" cy="130" r="98" fill={paint('ink')} />
    <g className="lg-art-wheel is-shows">
      {showColors.map((fill, i) => <g key={i}><path d={segment(i, 12, 25, 92)} fill={fill} stroke="#0F1C21" strokeWidth="1.6" /><text x="160" y="59" transform={`rotate(${(i + .5) * 30} 160 130)`} textAnchor="middle" fill={i % 5 === 1 || i % 5 === 3 ? '#1B282D' : '#F6E9CB'} fontSize="15" fontFamily="Georgia, serif" fontWeight="700">{['1', '2', '5', '10'][i % 4]}</text></g>)}
      <circle cx="160" cy="130" r="26" fill={paint('brass')} /><circle cx="160" cy="130" r="20" fill={paint('ink')} /><path d="M160 115L164 125L175 130L164 134L160 145L156 134L145 130L156 125Z" fill={paint('brass')} />
    </g>
    {Array.from({ length: 24 }, (_, i) => <circle key={i} cx="160" cy="29" r="2.1" fill={i % 2 ? '#EBD5A8' : '#B89D6A'} transform={`rotate(${i * 15} 160 130)`} />)}
    <path d="M151 20H169L160 40Z" fill={paint('red')} stroke="#E6C88D" strokeWidth="1.4" /><ChipStack x={258} y={211} paint={paint} dark />
  </>}</Scene>
}

function Jewel({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g className="lg-art-jewel"><g transform={`translate(${x} ${y}) scale(${scale})`}><path d="M0-13L12 0L0 17L-12 0Z" fill="#DEC997" stroke="#FFF0CA" strokeWidth=".8" /><path d="M0-13V17M-12 0H12M0-13L5 0L0 17L-5 0Z" fill="none" stroke="#927747" strokeWidth=".7" /></g></g>
}
export function TopCasinoArt() {
  return <Scene kind="top">{paint => <>
    <path className="lg-art-ray is-left" d="M130 231L53 36L100 28L161 231Z" fill="#D6BC85" opacity=".07" /><path className="lg-art-ray is-right" d="M170 231L237 28L284 39L201 231Z" fill="#E2C792" opacity=".07" />
    <ellipse cx="160" cy="220" rx="96" ry="13" fill="#060C10" /><path d="M77 212H243V223H77Z" fill={paint('ink')} stroke="#AD925F" strokeWidth=".8" />
    <g className="lg-art-crown">
      <path d="M65 105L113 134L160 63L207 134L255 105L235 201H85Z" fill="#655034" />
      <path d="M65 99L113 128L160 57L207 128L255 99L235 195H85Z" fill={paint('brass')} stroke="#EAD6A9" strokeWidth="1" />
      <path d="M83 121L116 143L160 80L204 143L237 121L224 178H96Z" fill={paint('ink')} stroke="#BFA06A" strokeWidth="1" />
      <path d="M111 151L160 93L209 151L221 179H99Z" fill={paint('red')} />
      <path d="M99 179L160 101L221 179" fill="none" stroke="#D2B47A" strokeOpacity=".5" />
      <rect x="84" y="184" width="152" height="16" rx="4" fill={paint('brass')} stroke="#EAD6A9" strokeWidth=".8" />
      {[108, 134, 160, 186, 212].map((x, i) => <path key={x} d={`M${x} 187L${x + 4} 192L${x} 197L${x - 4} 192Z`} fill={i === 2 ? '#A3373C' : '#5E4B32'} />)}
      <circle cx="65" cy="98" r="7" fill={paint('brass')} /><circle cx="160" cy="56" r="8" fill={paint('brass')} /><circle cx="255" cy="98" r="7" fill={paint('brass')} />
    </g>
    <Jewel x={48} y={162} scale={.65} /><Jewel x={261} y={51} scale={.75} /><Jewel x={99} y={51} scale={.4} />
  </>}</Scene>
}
