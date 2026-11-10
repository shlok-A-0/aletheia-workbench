import type { TruthTable } from '../../engine/types';

interface MsiBlockDiagramProps {
  mode: 'implement' | 'gallery';
  implTarget?: 'mux' | 'decoder';
  activeTT?: TruthTable;
  selectVars?: string[];
  galleryKey?: string;
  inputs: Record<string, 0 | 1>;
  onToggleInput: (name: string) => void;
  outputValues: Record<string, 0 | 1>;
  steps?: { title: string; detail: string }[];
}

export function MsiBlockDiagram({
  mode,
  implTarget = 'mux',
  activeTT,
  selectVars = [],
  galleryKey = 'mux2',
  inputs,
  onToggleInput,
  outputValues,
  steps = [],
}: MsiBlockDiagramProps) {
  // 1. Function realization: MUX implementation
  if (mode === 'implement' && implTarget === 'mux') {
    const k = Math.max(1, selectVars.length);
    const numDataLines = 1 << k;
    const allVars = activeTT?.vars ?? [];
    const residualVars = allVars.filter((v) => !selectVars.includes(v));

    // Extract Shannon residues from derivation steps
    const residues: { index: number; label: string; currentVal: 0 | 1 }[] = [];
    for (let d = 0; d < numDataLines; d++) {
      const step = steps.find((s) => s.title === `Data Input D${d}`);
      let label = '0';
      if (step) {
        const m = step.detail.match(/I_\d+\s*=\s*(.+)$/);
        if (m) label = m[1].trim();
      }

      // Compute current live value for this data line based on residual vars
      let currentVal: 0 | 1 = 0;
      if (label === '1') {
        currentVal = 1;
      } else if (label === '0') {
        currentVal = 0;
      } else if (residualVars.length === 1) {
        const rName = residualVars[0];
        const rVal = inputs[rName] ?? 0;
        if (label === rName) currentVal = rVal;
        else if (label === `${rName}'`) currentVal = (1 - rVal) as 0 | 1;
      } else if (activeTT && residualVars.length > 1) {
        // Multi-residual evaluation against current input vector
        const targetRow = activeTT.rows.find((row) => {
          for (let sIdx = 0; sIdx < k; sIdx++) {
            const bitVal = (d >> (k - 1 - sIdx)) & 1;
            const vCol = allVars.indexOf(selectVars[sIdx]);
            if (row.inputs[vCol] !== bitVal) return false;
          }
          for (const rVar of residualVars) {
            const vCol = allVars.indexOf(rVar);
            if (row.inputs[vCol] !== (inputs[rVar] ?? 0)) return false;
          }
          return true;
        });
        currentVal = targetRow?.out === 1 ? 1 : 0;
      }

      residues.push({ index: d, label, currentVal });
    }

    // Determine current select index from live inputs
    let currentSelectIdx = 0;
    for (let i = 0; i < k; i++) {
      const sVar = selectVars[i];
      const bit = inputs[sVar] ?? 0;
      currentSelectIdx = (currentSelectIdx << 1) | bit;
    }

    const outVal = outputValues['Y'] ?? residues[currentSelectIdx]?.currentVal ?? 0;

    // Geometry layout
    const boxX = 220;
    const boxY = 40;
    const boxW = 200;
    const lineSpacing = numDataLines <= 4 ? 44 : 36;
    const boxH = Math.max(220, numDataLines * lineSpacing + 40);
    const svgW = 680;
    const svgH = boxH + 110;

    return (
      <div className="msi-block-container" style={{ textAlign: 'center' }}>
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          style={{ maxWidth: svgW, height: 'auto', display: 'block', margin: '0 auto' }}
          className="msi-svg"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--signal-ink)" />
            </marker>
            <marker id="arrow-dim" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--text-3)" />
            </marker>
            <marker id="arrow-up" viewBox="0 0 10 10" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 1 8 L 5 0 L 9 8 z" fill="var(--signal-ink)" />
            </marker>
            <marker id="arrow-up-dim" viewBox="0 0 10 10" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 1 8 L 5 0 L 9 8 z" fill="var(--text-3)" />
            </marker>
          </defs>

          {/* Central MSI MUX Block */}
          <rect
            x={boxX}
            y={boxY}
            width={boxW}
            height={boxH}
            rx={6}
            fill="var(--inset)"
            stroke="var(--signal-ink)"
            strokeWidth={2.5}
          />
          <text
            x={boxX + boxW / 2}
            y={boxY + boxH / 2 - 8}
            textAnchor="middle"
            fill="var(--text-1)"
            fontSize="22"
            fontWeight="800"
            fontFamily="var(--font-mono, monospace)"
          >
            {numDataLines} : 1
          </text>
          <text
            x={boxX + boxW / 2}
            y={boxY + boxH / 2 + 18}
            textAnchor="middle"
            fill="var(--signal-ink)"
            fontSize="14"
            fontWeight="700"
            letterSpacing="2"
          >
            MUX
          </text>

          {/* Data Inputs on Left */}
          {residues.map((r, d) => {
            const y = boxY + 30 + d * lineSpacing;
            const isSelected = d === currentSelectIdx;
            const strokeColor = isSelected ? 'var(--signal-ink)' : 'var(--line-strong)';
            const wireWidth = isSelected ? 2.5 : 1.5;

            return (
              <g key={d} className="msi-pin-group">
                {/* Connecting wire */}
                <line
                  x1={80}
                  y1={y}
                  x2={boxX}
                  y2={y}
                  stroke={strokeColor}
                  strokeWidth={wireWidth}
                  markerEnd={isSelected ? 'url(#arrow)' : 'url(#arrow-dim)'}
                />
                {/* Pin label inside block */}
                <text
                  x={boxX + 10}
                  y={y + 4}
                  fill={isSelected ? 'var(--text-1)' : 'var(--text-2)'}
                  fontSize="12"
                  fontWeight={isSelected ? '700' : '500'}
                  fontFamily="monospace"
                >
                  I{d}
                </text>
                {/* Shannon Residue assignment label on left (clickable if residual variable) */}
                <text
                  x={70}
                  y={y + 4}
                  textAnchor="end"
                  fill={isSelected ? 'var(--signal-ink)' : 'var(--text-1)'}
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="monospace"
                  style={{ cursor: residualVars.length > 0 ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (residualVars.length === 1) onToggleInput(residualVars[0]);
                  }}
                >
                  {residualVars.length === 1 && <title>{`Click to toggle ${residualVars[0]}`}</title>}
                  {r.label}
                </text>
                {/* Value chip */}
                <rect
                  x={140}
                  y={y - 8}
                  width={22}
                  height={16}
                  rx={3}
                  fill={isSelected ? 'var(--signal-dim)' : 'var(--raised)'}
                  stroke={isSelected ? 'var(--signal-ink)' : 'var(--line)'}
                />
                <text
                  x={151}
                  y={y + 4}
                  textAnchor="middle"
                  fill={isSelected ? 'var(--signal-ink)' : 'var(--text-2)'}
                  fontSize="10"
                  fontWeight="700"
                >
                  {r.currentVal}
                </text>
                {isSelected && (
                  <circle cx={boxX - 8} cy={y} r={3} fill="var(--signal-ink)" />
                )}
              </g>
            );
          })}

          {/* Select Lines at Bottom */}
          {selectVars.map((sVar, i) => {
            const x = boxX + (i + 1) * (boxW / (k + 1));
            const bit = inputs[sVar] ?? 0;
            const strokeColor = bit === 1 ? 'var(--signal-ink)' : 'var(--line-strong)';
            const sPinIndex = k - 1 - i;

            return (
              <g
                key={sVar}
                className="msi-select-group"
                style={{ cursor: 'pointer' }}
                onClick={() => onToggleInput(sVar)}
              >
                <line
                  x1={x}
                  y1={boxY + boxH + 50}
                  x2={x}
                  y2={boxY + boxH}
                  stroke={strokeColor}
                  strokeWidth={2}
                  markerEnd={bit === 1 ? 'url(#arrow-up)' : 'url(#arrow-up-dim)'}
                />
                {/* Select pin name inside bottom */}
                <text
                  x={x}
                  y={boxY + boxH - 8}
                  textAnchor="middle"
                  fill="var(--text-2)"
                  fontSize="11"
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  S{sPinIndex}
                </text>
                {/* External variable label */}
                <text
                  x={x}
                  y={boxY + boxH + 68}
                  textAnchor="middle"
                  fill="var(--text-1)"
                  fontSize="13"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {sVar} = {bit}
                </text>
              </g>
            );
          })}

          {/* Output Y on Right */}
          <line
            x1={boxX + boxW}
            y1={boxY + boxH / 2}
            x2={boxX + boxW + 80}
            y2={boxY + boxH / 2}
            stroke={outVal === 1 ? 'var(--signal-ink)' : 'var(--line-strong)'}
            strokeWidth={3}
            markerEnd={outVal === 1 ? 'url(#arrow)' : 'url(#arrow-dim)'}
          />
          <text
            x={boxX + boxW + 90}
            y={boxY + boxH / 2 - 4}
            fill="var(--text-1)"
            fontSize="14"
            fontWeight="700"
          >
            Output Y
          </text>
          <text
            x={boxX + boxW + 90}
            y={boxY + boxH / 2 + 16}
            fill={outVal === 1 ? 'var(--signal-ink)' : 'var(--text-2)'}
            fontSize="18"
            fontWeight="800"
            fontFamily="monospace"
          >
            {outVal}
          </text>
        </svg>

        <p className="dp-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
          Figure: <strong>{numDataLines}:1 Multiplexer Realization</strong> with inputs{' '}
          {selectVars.join(', ')} on Select lines S<sub>{k - 1}</sub>..S<sub>0</sub> and Shannon
          residues on Data pins I<sub>0</sub>..I<sub>{numDataLines - 1}</sub>.
        </p>
      </div>
    );
  }

  // 2. Function realization: Decoder + OR Gate
  if (mode === 'implement' && implTarget === 'decoder') {
    const allVars = activeTT?.vars ?? [];
    const n = allVars.length;
    const numOutputs = 1 << n;
    const minterms = activeTT?.rows.filter((r) => r.out === 1).map((r) => r.index) ?? [];

    // Current address value
    let currentAddr = 0;
    for (let i = 0; i < n; i++) {
      const v = allVars[i];
      currentAddr = (currentAddr << 1) | (inputs[v] ?? 0);
    }

    const boxX = 140;
    const boxY = 30;
    const boxW = 180;
    const lineSpacing = numOutputs <= 8 ? 32 : 22;
    const boxH = Math.max(220, numOutputs * lineSpacing + 30);

    // OR gate position on right
    const orGateX = boxX + boxW + 140;
    const orGateY = boxY + boxH / 2;
    const orGateW = 70;
    const orGateH = Math.min(boxH - 20, Math.max(60, minterms.length * 20));
    const finalY = outputValues['Y'] ?? (minterms.includes(currentAddr) ? 1 : 0);

    const svgW = 740;
    const svgH = boxH + 60;

    return (
      <div className="msi-block-container" style={{ textAlign: 'center' }}>
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          style={{ maxWidth: svgW, height: 'auto', display: 'block', margin: '0 auto' }}
          className="msi-svg"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--signal-ink)" />
            </marker>
            <marker id="arrow-dim" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--text-3)" />
            </marker>
          </defs>

          {/* Central Decoder Block */}
          <rect
            x={boxX}
            y={boxY}
            width={boxW}
            height={boxH}
            rx={6}
            fill="var(--inset)"
            stroke="var(--signal-ink)"
            strokeWidth={2.5}
          />
          <text
            x={boxX + boxW / 2}
            y={boxY + boxH / 2 - 8}
            textAnchor="middle"
            fill="var(--text-1)"
            fontSize="18"
            fontWeight="800"
            fontFamily="monospace"
          >
            {n} to {numOutputs}
          </text>
          <text
            x={boxX + boxW / 2}
            y={boxY + boxH / 2 + 16}
            textAnchor="middle"
            fill="var(--signal-ink)"
            fontSize="14"
            fontWeight="700"
            letterSpacing="2"
          >
            Decoder
          </text>

          {/* Address Inputs on Left */}
          {allVars.map((vName, idx) => {
            const y = boxY + 40 + idx * ((boxH - 80) / Math.max(1, n - 1));
            const bit = inputs[vName] ?? 0;
            return (
              <g
                key={vName}
                style={{ cursor: 'pointer' }}
                onClick={() => onToggleInput(vName)}
                className="msi-addr-group"
              >
                <line
                  x1={40}
                  y1={y}
                  x2={boxX}
                  y2={y}
                  stroke={bit === 1 ? 'var(--signal-ink)' : 'var(--line-strong)'}
                  strokeWidth={2}
                  markerEnd={bit === 1 ? 'url(#arrow)' : 'url(#arrow-dim)'}
                />
                <text
                  x={30}
                  y={y + 5}
                  textAnchor="end"
                  fill="var(--text-1)"
                  fontSize="13"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {vName} = {bit}
                </text>
              </g>
            );
          })}

          {/* Decoder Outputs on Right */}
          {Array.from({ length: numOutputs }).map((_, m) => {
            const y = boxY + 20 + m * lineSpacing;
            const isMinterm = minterms.includes(m);
            const isActive = m === currentAddr;

            // Route wire to OR gate if active minterm
            const wireEnd = isMinterm ? orGateX : boxX + boxW + 40;
            const strokeColor = isActive ? 'var(--signal-ink)' : isMinterm ? 'var(--logic-x)' : 'var(--line)';

            return (
              <g key={m}>
                <line
                  x1={boxX + boxW}
                  y1={y}
                  x2={wireEnd}
                  y2={y}
                  stroke={strokeColor}
                  strokeWidth={isActive ? 2.5 : isMinterm ? 1.5 : 1}
                  markerEnd={isMinterm ? undefined : 'url(#arrow-dim)'}
                />
                <text
                  x={boxX + boxW + 12}
                  y={y + 4}
                  fill={isActive ? 'var(--signal-ink)' : isMinterm ? 'var(--logic-x)' : 'var(--text-3)'}
                  fontSize="11"
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  Y{m}
                </text>
              </g>
            );
          })}

          {/* External OR Gate collecting minterms */}
          {minterms.length > 0 && (
            <g transform={`translate(${orGateX}, ${orGateY - orGateH / 2})`}>
              {/* OR gate body */}
              <path
                d={`M0,0 Q${orGateW * 0.55},0 ${orGateW},${orGateH / 2} Q${orGateW * 0.55},${orGateH} 0,${orGateH} Q${orGateW * 0.28},${orGateH / 2} 0,0 Z`}
                fill="var(--surface)"
                stroke={finalY === 1 ? 'var(--signal-ink)' : 'var(--text-2)'}
                strokeWidth={2}
              />
              <text
                x={orGateW * 0.45}
                y={orGateH / 2 + 5}
                textAnchor="middle"
                fill="var(--text-1)"
                fontSize="12"
                fontWeight="700"
              >
                OR
              </text>
              {/* Output F */}
              <line
                x1={orGateW}
                y1={orGateH / 2}
                x2={orGateW + 60}
                y2={orGateH / 2}
                stroke={finalY === 1 ? 'var(--signal-ink)' : 'var(--line-strong)'}
                strokeWidth={3}
                markerEnd={finalY === 1 ? 'url(#arrow)' : 'url(#arrow-dim)'}
              />
              <text
                x={orGateW + 70}
                y={orGateH / 2 - 4}
                fill="var(--text-1)"
                fontSize="13"
                fontWeight="700"
              >
                F = Σm({minterms.join(',')})
              </text>
              <text
                x={orGateW + 70}
                y={orGateH / 2 + 18}
                fill={finalY === 1 ? 'var(--signal-ink)' : 'var(--text-2)'}
                fontSize="18"
                fontWeight="800"
                fontFamily="monospace"
              >
                {finalY}
              </text>
            </g>
          )}
        </svg>

        <p className="dp-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
          Figure: <strong>{n}-to-{numOutputs} Decoder + OR Realization</strong>. Active minterms{' '}
          {minterms.length > 0 ? `Σm(${minterms.join(', ')})` : 'none'} are tied into the external
          summing OR gate.
        </p>
      </div>
    );
  }

  // 3. Standard MSI Catalog Parts: MUX, DEMUX, Decoders, Encoders, BCD-to-7seg
  const isMux = galleryKey.startsWith('mux');
  const isDemux = galleryKey.startsWith('demux');
  const isDec = galleryKey.startsWith('dec');
  const isBcd = galleryKey === 'bcd7';

  // Number of select lines
  const k = isMux
    ? galleryKey === 'mux1' ? 1 : galleryKey === 'mux3' ? 3 : 2
    : isDemux
    ? galleryKey === 'demux1' ? 1 : galleryKey === 'demux3' ? 3 : 2
    : 2;

  const numLines = 1 << k;

  // Compute select value from inputs
  let selVal = 0;
  for (let i = 0; i < k; i++) {
    const sName = `S${k - 1 - i}`;
    selVal = (selVal << 1) | (inputs[sName] ?? 0);
  }

  // BCD 7-segment segment values
  const bcdDigit =
    ((inputs['A3'] ?? 0) << 3) |
    ((inputs['A2'] ?? 0) << 2) |
    ((inputs['A1'] ?? 0) << 1) |
    (inputs['A0'] ?? 0);

  const bcdPatterns: Record<number, string> = {
    0: '1111110',
    1: '0110000',
    2: '1101101',
    3: '1111001',
    4: '0110011',
    5: '1011011',
    6: '1011111',
    7: '1110000',
    8: '1111111',
    9: '1111011',
  };
  const activeSegments = bcdPatterns[bcdDigit] ?? '0000000';

  return (
    <div className="msi-block-container" style={{ textAlign: 'center' }}>
      <svg
        viewBox="0 0 640 360"
        width="100%"
        style={{ maxWidth: 640, height: 'auto', display: 'block', margin: '0 auto' }}
        className="msi-svg"
      >
        <rect
          x={200}
          y={40}
          width={220}
          height={240}
          rx={6}
          fill="var(--inset)"
          stroke="var(--signal-ink)"
          strokeWidth={2.5}
        />
        <text
          x={310}
          y={150}
          textAnchor="middle"
          fill="var(--text-1)"
          fontSize="20"
          fontWeight="800"
          fontFamily="monospace"
        >
          {isMux
            ? `${numLines} : 1 MUX`
            : isDemux
            ? `1 : ${numLines} DEMUX`
            : isDec
            ? `${k} to ${numLines} Decoder`
            : isBcd
            ? 'BCD → 7-Segment'
            : 'MSI Block'}
        </text>

        {isBcd && (
          /* Render live 7-segment display on the right */
          <g transform="translate(480, 100)">
            <rect width="80" height="120" rx="6" fill="var(--canvas)" stroke="var(--line-strong)" strokeWidth="2" />
            {/* Segment a */}
            <rect x="18" y="14" width="44" height="8" rx="2" fill={activeSegments[0] === '1' ? 'var(--accent-rose)' : 'var(--line)'} />
            {/* Segment b */}
            <rect x="60" y="24" width="8" height="34" rx="2" fill={activeSegments[1] === '1' ? 'var(--accent-rose)' : 'var(--line)'} />
            {/* Segment c */}
            <rect x="60" y="62" width="8" height="34" rx="2" fill={activeSegments[2] === '1' ? 'var(--accent-rose)' : 'var(--line)'} />
            {/* Segment d */}
            <rect x="18" y="98" width="44" height="8" rx="2" fill={activeSegments[3] === '1' ? 'var(--accent-rose)' : 'var(--line)'} />
            {/* Segment e */}
            <rect x="12" y="62" width="8" height="34" rx="2" fill={activeSegments[4] === '1' ? 'var(--accent-rose)' : 'var(--line)'} />
            {/* Segment f */}
            <rect x="12" y="24" width="8" height="34" rx="2" fill={activeSegments[5] === '1' ? 'var(--accent-rose)' : 'var(--line)'} />
            {/* Segment g */}
            <rect x="18" y="56" width="44" height="8" rx="2" fill={activeSegments[6] === '1' ? 'var(--accent-rose)' : 'var(--line)'} />
            <text x="40" y="136" textAnchor="middle" fill="var(--text-2)" fontSize="11" fontWeight="700">Digit: {bcdDigit < 10 ? bcdDigit : 'Invalid'}</text>
          </g>
        )}

        {/* Inputs on left */}
        <text x="180" y="80" textAnchor="end" fill="var(--text-1)" fontSize="12" fontWeight="700" fontFamily="monospace">
          Inputs: {Object.entries(inputs).map(([k, v]) => `${k}=${v}`).join(', ') || 'Default 0'}
        </text>

        {/* Outputs on right */}
        <text x="440" y="80" textAnchor="start" fill="var(--signal-ink)" fontSize="12" fontWeight="700" fontFamily="monospace">
          Outputs: {Object.entries(outputValues).map(([k, v]) => `${k}=${v}`).join(', ')}
        </text>
      </svg>
      <p className="dp-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
        Standard Textbook <strong>MSI Block Symbol</strong>. Toggle input bits below to observe the logic routing.
      </p>
    </div>
  );
}
