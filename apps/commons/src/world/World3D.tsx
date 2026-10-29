import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import type { WorldScene } from './scene';

/*
 * A GL surface that runs three.js: expo-gl's context on iOS and Android,
 * a real <canvas> on the web. `onFrame` runs before each draw with the
 * seconds since the last one.
 */
export function World3D({ scene, onFrame }: { scene: WorldScene; onFrame: (dt: number) => void }) {
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => stopRef.current(), []);

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const renderer = createRenderer(gl, width, height);
    scene.resize(width, height);

    let raf = 0;
    let last = 0;
    let running = true;
    const loop = (now: number) => {
      if (!running) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      frameRef.current(dt);
      renderer.render(scene.scene, scene.camera);
      gl.endFrameEXP();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    stopRef.current = () => {
      running = false;
      cancelAnimationFrame(raf);
      renderer.dispose();
    };
  };

  return <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />;
}

function createRenderer(gl: ExpoWebGLRenderingContext, width: number, height: number) {
  /* three wants a canvas to size and listen on. Native has none, so it gets
     a stand-in with the drawing buffer's size; on the web this is ignored
     because the context already belongs to a real canvas. */
  const canvas = (gl as unknown as { canvas?: HTMLCanvasElement }).canvas ?? {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => gl,
  };
  /* three r163+ refuses anything that is `instanceof WebGLRenderingContext`
     (WebGL 1). expo-gl's native context is WebGL 2 in practice but its class
     inherits from that global, so hide it while the renderer checks. */
  const g = globalThis as { WebGLRenderingContext?: unknown };
  const hidden = g.WebGLRenderingContext;
  const native = !(gl as unknown as { canvas?: unknown }).canvas;
  if (native) g.WebGLRenderingContext = undefined;
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas as HTMLCanvasElement,
      context: gl as unknown as WebGL2RenderingContext,
      antialias: false,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    return renderer;
  } finally {
    if (native) g.WebGLRenderingContext = hidden;
  }
}
