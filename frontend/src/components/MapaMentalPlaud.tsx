"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const transformer = new Transformer();

export function MapaMentalPlaud({ texto }: { texto: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const { root } = transformer.transform(texto);
    const mm = Markmap.create(svgRef.current, undefined, root);
    mm.fit();
    return () => {
      mm.destroy();
    };
  }, [texto]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <svg ref={svgRef} className="h-[420px] w-full" />
    </div>
  );
}
