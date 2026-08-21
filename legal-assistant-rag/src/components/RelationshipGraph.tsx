"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { GraphData, GraphNode } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

const COLORS: Record<string, string> = {
  documento: "#c9a24b",
  relator: "#4a9de0",
  interessado: "#e07a5f",
  processo: "#7bc47f",
  unidade: "#b98fd6",
};

const LEGEND = [
  { type: "documento", label: "Documento" },
  { type: "relator", label: "Relator" },
  { type: "interessado", label: "Interessado" },
  { type: "processo", label: "Processo relacionado" },
];

interface Props {
  data: GraphData;
  onNodeSelect: (nodeId: string, label: string) => void;
}

export default function RelationshipGraph({ data, onNodeSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 600, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, scale: number) => {
      const color = COLORS[node.type] || "#888";
      const r = node.type === "documento" ? 7 : 5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 0.6;
      ctx.stroke();

      if (scale > 1.4) {
        const label: string = node.label || node.id;
        const short =
          label.length > 26 ? label.slice(0, 24) + "…" : label;
        ctx.font = `${4}px "Segoe UI", sans-serif`;
        ctx.fillStyle = "#dbe4f0";
        ctx.textAlign = "center";
        ctx.fillText(short, node.x, node.y + r + 5);
      }
    },
    []
  );

  if (!data || data.nodes.length === 0) {
    return (
      <div className="graph-empty">
        O grafo de relacionamentos aparecerá aqui após a busca.
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <div className="graph-legend">
        {LEGEND.map((l) => (
          <div className="legend-item" key={l.type}>
            <span
              className="legend-dot"
              style={{ background: COLORS[l.type] }}
            />
            {l.label}
          </div>
        ))}
      </div>

      <ForceGraph2D
        graphData={data as any}
        width={dims.width}
        height={dims.height}
        backgroundColor="#0e1c30"
        nodeRelSize={5}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: any, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={() => "rgba(255,255,255,0.18)"}
        linkWidth={1}
        onNodeClick={(node: any) =>
          onNodeSelect(node.id, node.label || node.id)
        }
        cooldownTicks={80}
      />

      <div className="graph-hint">
        Clique em um nó (entidade ou documento) para atualizar os resultados à
        esquerda.
      </div>
    </div>
  );
}
