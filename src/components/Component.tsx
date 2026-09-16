import React, { useEffect, useRef } from 'react';

// Game Constants
const CAR_SPEED = 5;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;

export const RaceGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const carPos = useRef({ x: 180, y: 500 });
  const keys = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const handleKeyDown = (e: KeyboardEvent) => (keys.current[e.key] = true);
    const handleKeyUp = (e: KeyboardEvent) => (keys.current[e.key] = false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const loop = () => {
      // Update logic
      if (keys.current['ArrowLeft'] && carPos.current.x > 0) carPos.current.x -= CAR_SPEED;
      if (keys.current['ArrowRight'] && carPos.current.x < CANVAS_WIDTH - 40) carPos.current.x += CAR_SPEED;

      // Draw
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(carPos.current.x, carPos.current.y, 40, 70); // The Car

      requestAnimationFrame(loop);
    };

    const animationId = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={{ background: '#333' }} />;
};