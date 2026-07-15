/**
 * Deterministic "blockies" identicon (the familiar web3 wallet avatar): a symmetric pixel grid whose
 * colors + pattern are seeded from the address, so it looks random/unique per wallet but is stable.
 * Pure SVG, no dependencies. Algorithm mirrors the classic ethereum-blockies.
 */
function makeRand(seed: string) {
  const s = new Int32Array(4);
  for (let i = 0; i < seed.length; i++) {
    s[i % 4] = ((s[i % 4]! << 5) - s[i % 4]! + seed.charCodeAt(i)) | 0;
  }
  return () => {
    const t = s[0]! ^ (s[0]! << 11);
    s[0] = s[1]!; s[1] = s[2]!; s[2] = s[3]!;
    s[3] = (s[3]! ^ (s[3]! >>> 19) ^ t ^ (t >>> 8)) | 0;
    return (s[3]! >>> 0) / 0x100000000;
  };
}

function hsl(rand: () => number) {
  return `hsl(${Math.floor(rand() * 360)} ${Math.floor(rand() * 55 + 45)}% ${Math.floor(rand() * 25 + 45)}%)`;
}

const SIZE = 8;

export function WalletAvatar({ address, className }: { address: string; className?: string }) {
  const rand = makeRand((address || "0x0").toLowerCase());
  const color = hsl(rand);
  const bg = hsl(rand);
  const spot = hsl(rand);

  const cells: number[] = [];
  const dataWidth = Math.ceil(SIZE / 2);
  const mirror = SIZE - dataWidth;
  for (let y = 0; y < SIZE; y++) {
    const row: number[] = [];
    for (let x = 0; x < dataWidth; x++) row[x] = Math.floor(rand() * 2.3);
    const r = row.slice(0, mirror).reverse();
    cells.push(...row.concat(r));
  }

  return (
    <svg className={className} viewBox={`0 0 ${SIZE} ${SIZE}`} shapeRendering="crispEdges" aria-hidden>
      <rect width={SIZE} height={SIZE} fill={bg} />
      {cells.map((v, i) =>
        v === 0 ? null : (
          <rect key={i} x={i % SIZE} y={Math.floor(i / SIZE)} width={1} height={1} fill={v === 1 ? color : spot} />
        ),
      )}
    </svg>
  );
}
