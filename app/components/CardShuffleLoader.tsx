type CardShuffleLoaderProps = {
  label?: string;
};

type ShuffleCardSpec = {
  imagePath: string;
  side: "left" | "right";
  stack: number;
  riffleSlot: number;
  delaySec: number;
};

type ShuffleCardComputed = ShuffleCardSpec & {
  startX: number;
  startY: number;
  startRotDeg: number;
  approachX: number;
  approachY: number;
  approachRotDeg: number;
  interleaveX: number;
  interleaveY: number;
  interleaveRotDeg: number;
  packX: number;
  packY: number;
  packRotDeg: number;
  endX: number;
  endY: number;
  endRotDeg: number;
};

const BASE_SHUFFLE_CARDS: ShuffleCardSpec[] = [
  { imagePath: "/card2.jpg", side: "left", stack: 0, riffleSlot: 0, delaySec: 0 },
  { imagePath: "/card7.jpg", side: "left", stack: 1, riffleSlot: 2, delaySec: -0.08 },
  { imagePath: "/card11.jpg", side: "left", stack: 2, riffleSlot: 4, delaySec: -0.16 },
  { imagePath: "/card1.jpg", side: "left", stack: 3, riffleSlot: 6, delaySec: -0.24 },
  { imagePath: "/card4.jpg", side: "right", stack: 0, riffleSlot: 1, delaySec: -0.04 },
  { imagePath: "/card9.jpg", side: "right", stack: 1, riffleSlot: 3, delaySec: -0.12 },
  { imagePath: "/card13.jpg", side: "right", stack: 2, riffleSlot: 5, delaySec: -0.2 },
  { imagePath: "/card6.jpg", side: "right", stack: 3, riffleSlot: 7, delaySec: -0.28 },
];

function toComputedCard(spec: ShuffleCardSpec): ShuffleCardComputed {
  const direction = spec.side === "left" ? -1 : 1;
  const startX = direction * (54 - spec.stack * 2.8);
  const startY = -6 + spec.stack * 2.2;
  const startRotDeg = direction * (13 - spec.stack * 1.8);

  const approachX = direction * (22 - spec.stack * 1.2);
  const approachY = -15 + spec.stack * 1.7;
  const approachRotDeg = direction * (7 - spec.stack * 1.1);

  const interleaveX = (spec.riffleSlot - 3.5) * 4.2;
  const interleaveY = -10 + Math.floor(spec.riffleSlot / 2) * 1.4;
  const interleaveRotDeg = direction * (spec.riffleSlot % 2 === 0 ? 1.8 : -1.8);

  const packX = (spec.riffleSlot - 3.5) * 0.8;
  const packY = -5 + spec.stack * 0.5;
  const packRotDeg = direction * 1.5;

  const endX = -startX * 0.92;
  const endY = startY;
  const endRotDeg = -startRotDeg * 0.9;

  return {
    ...spec,
    startX,
    startY,
    startRotDeg,
    approachX,
    approachY,
    approachRotDeg,
    interleaveX,
    interleaveY,
    interleaveRotDeg,
    packX,
    packY,
    packRotDeg,
    endX,
    endY,
    endRotDeg,
  };
}

const SHUFFLE_CARDS = BASE_SHUFFLE_CARDS.map(toComputedCard);

export default function CardShuffleLoader({
  label = "Loading...",
}: CardShuffleLoaderProps) {
  return (
    <div className="page-transition-loader-content" role="status" aria-live="polite">
      <div className="page-transition-loader-stack" aria-hidden="true">
        {SHUFFLE_CARDS.map((card, index) => (
          <span
            key={`${card.imagePath}-${index}`}
            className="page-transition-loader-card"
            style={{
              backgroundImage: `url(${card.imagePath})`,
              ["--shuffle-start-x" as string]: `${card.startX}px`,
              ["--shuffle-start-y" as string]: `${card.startY}px`,
              ["--shuffle-start-rot" as string]: `${card.startRotDeg}deg`,
              ["--shuffle-approach-x" as string]: `${card.approachX}px`,
              ["--shuffle-approach-y" as string]: `${card.approachY}px`,
              ["--shuffle-approach-rot" as string]: `${card.approachRotDeg}deg`,
              ["--shuffle-interleave-x" as string]: `${card.interleaveX}px`,
              ["--shuffle-interleave-y" as string]: `${card.interleaveY}px`,
              ["--shuffle-interleave-rot" as string]: `${card.interleaveRotDeg}deg`,
              ["--shuffle-pack-x" as string]: `${card.packX}px`,
              ["--shuffle-pack-y" as string]: `${card.packY}px`,
              ["--shuffle-pack-rot" as string]: `${card.packRotDeg}deg`,
              ["--shuffle-end-x" as string]: `${card.endX}px`,
              ["--shuffle-end-y" as string]: `${card.endY}px`,
              ["--shuffle-end-rot" as string]: `${card.endRotDeg}deg`,
              ["--shuffle-delay" as string]: `${card.delaySec}s`,
            }}
          />
        ))}
      </div>
      <span className="page-transition-loader-label">{label}</span>
    </div>
  );
}
