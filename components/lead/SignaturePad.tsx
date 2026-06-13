"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onChange: (hasSignature: boolean) => void;
}

/**
 * Touch-friendly signature pad. Calls onChange(true) on first stroke,
 * onChange(false) when cleared. The dataURL is exposed via getDataURL()
 * — the parent can call it via ref if it needs the rendered image, but
 * for the MVP we treat "has any ink" as enough proof of consent.
 */
export function SignaturePad({ onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [, force] = useState(0);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0B2B29";
  }, []);

  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  return (
    <div className="relative h-[90px] w-full overflow-hidden rounded-xl border-[1.5px] border-dashed border-[#C9DEDB] bg-white">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          drawingRef.current = true;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          if (!hasInkRef.current) {
            hasInkRef.current = true;
            onChange(true);
            force((n) => n + 1);
          }
        }}
        onPointerMove={(e) => {
          if (!drawingRef.current) return;
          e.preventDefault();
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawingRef.current = false;
        }}
        onPointerLeave={() => {
          drawingRef.current = false;
        }}
      />
      <div className="pointer-events-none absolute bottom-6 left-4 right-4 border-b-[1.5px] border-[var(--line)]" />
      {!hasInkRef.current && (
        <span className="pointer-events-none absolute bottom-[27px] left-0 right-0 text-center text-xs text-[#AFC6C2]">
          ✗ Sign here with your finger
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          hasInkRef.current = false;
          onChange(false);
          force((n) => n + 1);
        }}
        className="absolute right-2 top-1.5 text-[11.5px] font-bold text-[var(--teal-deep)]"
      >
        Clear
      </button>
    </div>
  );
}
