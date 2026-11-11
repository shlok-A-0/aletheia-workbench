import React, { useMemo } from 'react';
import type { StateTable } from '../../../engine/types';
import { stateDiagramData } from '../../../engine/sequential/fsm';

export const StateDiagramSVG: React.FC<{ st: StateTable }> = ({ st }) => {
  const { nodes, edges } = useMemo(() => stateDiagramData(st), [st]);

  const count = nodes.length;
  const radius = Math.max(130, Math.min(220, count * 28));
  const width = Math.max(480, (radius + 60) * 2);
  const height = Math.max(380, (radius + 60) * 2);
  const centerX = width / 2;
  const centerY = height / 2;
  const nodeRadius = 26;

  // Circular layout coordinates
  const positions = useMemo(() => {
    return Object.fromEntries(
      nodes.map((n, idx) => {
        const angle = (idx / count) * 2 * Math.PI - Math.PI / 2;
        return [
          n.id,
          {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
          },
        ];
      })
    );
  }, [nodes, count, centerX, centerY, radius]);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width }} className="state-diagram-svg">
      <defs>
        <marker
          id="fsm-arrow"
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" className="sd-arrow" />
        </marker>
        <marker
          id="fsm-arrow-self"
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" className="sd-arrow sd-arrow--self" />
        </marker>
      </defs>

      {/* Edges */}
      {edges.map((e, idx) => {
        const from = positions[e.from];
        const to = positions[e.to];
        if (!from || !to) return null;

        if (e.from === e.to) {
          // Self-loop arc
          const lx1 = from.x - 14;
          const ly1 = from.y - nodeRadius;
          const lx2 = from.x + 14;
          const ly2 = from.y - nodeRadius;
          const path = `M ${lx1} ${ly1} C ${from.x - 30} ${from.y - nodeRadius - 40}, ${from.x + 30} ${from.y - nodeRadius - 40}, ${lx2} ${ly2}`;
          return (
            <g key={`edge-${idx}`}>
              <path d={path} className="sd-edge sd-edge--self" markerEnd="url(#fsm-arrow-self)" />
              <text x={from.x} y={from.y - nodeRadius - 26} textAnchor="middle" className="sd-label sd-label--self" fontSize={10}>
                {e.label}
              </text>
            </g>
          );
        }

        // Inter-node curved arc
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        const ux = dx / dist;
        const uy = dy / dist;

        // Offset from border of node
        const sx = from.x + ux * nodeRadius;
        const sy = from.y + uy * nodeRadius;
        const ex = to.x - ux * (nodeRadius + 4);
        const ey = to.y - uy * (nodeRadius + 4);

        // Control point curve
        const midX = (sx + ex) / 2;
        const midY = (sy + ey) / 2;
        const curveOffset = 24;
        const cx = midX - uy * curveOffset;
        const cy = midY + ux * curveOffset;

        return (
          <g key={`edge-${idx}`}>
            <path
              d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
              className="sd-edge"
              markerEnd="url(#fsm-arrow)"
            />
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              className="sd-label"
              fontSize={10.5}
            >
              {e.label}
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const p = positions[n.id];
        if (!p) return null;
        const isReset = n.id === st.reset;
        return (
          <g key={n.id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={nodeRadius}
              className={`sd-node${isReset ? ' is-reset' : ''}`}
            />
            <text
              x={p.x}
              y={n.output ? p.y - 4 : p.y + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              className="sd-node-text"
              fontSize={12}
            >
              {n.label}
            </text>
            {n.output && (
              <text
                x={p.x}
                y={p.y + 11}
                textAnchor="middle"
                className="sd-node-out"
                fontSize={9.5}
              >
                /{n.output}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};
