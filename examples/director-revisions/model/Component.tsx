import { usePromptFrameModel } from '@promptframe/component-kit/model-react';
import type { PromptFrameRuntimeResourceProps } from '@promptframe/component-kit';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { AmbientLight, DirectionalLight, Group, Mesh, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ComponentProps } from './schema';

// The two included fixtures have geometry and solid materials.
async function prepare(bytes: ArrayBuffer, signal: AbortSignal) {
  signal.throwIfAborted();
  return (await new GLTFLoader().parseAsync(bytes, '')).scene;
}

function dispose(group: Group) {
  group.traverse(object => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      for (const material of [object.material].flat()) material.dispose();
    }
  });
}

export default function Component(props: ComponentProps & PromptFrameRuntimeResourceProps) {
  const group = usePromptFrameModel(props, props.model, { prepare, dispose });
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<WebGLRenderer | null>(null);
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const scene = useMemo(() => {
    const root = new Scene();
    const light = new DirectionalLight(0xffffff, 2);
    light.position.set(-2, 4, 6);
    root.add(new AmbientLight(0xffffff, 1.6), light);
    return root;
  }, []);
  const camera = useMemo(() => {
    const x = (width / height) * 1.4;
    const view = new OrthographicCamera(-x, x, 1.4, -1.4, 0.1, 20);
    view.position.z = 4;
    return view;
  }, [width, height]);

  useLayoutEffect(() => {
    if (!canvas.current) return;
    const gl = new WebGLRenderer({ canvas: canvas.current, antialias: true, preserveDrawingBuffer: true });
    gl.setSize(width, height, false);
    gl.setClearColor(0x142827);
    renderer.current = gl;
    return () => { renderer.current = null; gl.dispose(); };
  }, [width, height]);

  useLayoutEffect(() => {
    if (!group) return;
    scene.add(group);
    return () => { scene.remove(group); };
  }, [group, scene]);

  useLayoutEffect(() => {
    const angle = frame * Math.PI / 90;
    camera.position.set(4 * Math.sin(angle), 0, 4 * Math.cos(angle));
    camera.lookAt(0, 0, 0);
    renderer.current?.render(scene, camera);
  }, [group, frame, scene, camera]);

  return <canvas ref={canvas} aria-label={props.title} style={{width: '100%', height: '100%'}} />;
}
