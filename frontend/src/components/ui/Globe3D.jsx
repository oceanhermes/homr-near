import React, { Component, Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { BackSide, SRGBColorSpace } from 'three';

export function GlobeFallback() {
  return <div className="globe-static" aria-hidden="true" />;
}

class GlobeBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onUnavailable?.();
  }

  render() {
    return this.state.failed ? <GlobeFallback /> : this.props.children;
  }
}

function Earth({ rotating, onReady }) {
  const globe = useRef(null);
  const [texture, bump] = useTexture(['/textures/earth-blue-marble.jpg', '/textures/earth-topology.png']);

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    onReady?.();
  }, [texture, onReady]);

  useFrame((_, delta) => {
    if (rotating && globe.current) globe.current.rotation.y += Math.min(delta, 0.1) * 0.045;
  });

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[-3, 5, 6]} intensity={2.2} />
      <directionalLight position={[4, -1, -3]} intensity={0.5} color="#cbb7fb" />
      <mesh ref={globe} rotation={[0.12, 3.8, -0.2]}>
        <sphereGeometry args={[2, 64, 64]} />
        <meshStandardMaterial map={texture} bumpMap={bump} bumpScale={0.055} roughness={0.85} />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[2, 48, 32]} />
        <shaderMaterial
          side={BackSide}
          transparent
          depthWrite={false}
          vertexShader={`
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
              gl_Position = projectionMatrix * vec4(vPosition, 1.0);
            }
          `}
          fragmentShader={`
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
              float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vPosition))), 3.0);
              gl_FragColor = vec4(0.65, 0.62, 0.95, rim * 0.65);
            }
          `}
        />
      </mesh>
    </>
  );
}

export default function Globe3D({ rotating = true, onReady, onUnavailable }) {
  const [supported, setSupported] = useState(null);

  useEffect(() => {
    const probe = document.createElement('canvas');
    let context = null;
    try {
      context = probe.getContext('webgl2');
    } catch {
      onUnavailable?.();
    }
    setSupported(Boolean(context));
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    if (!context) onUnavailable?.();
  }, [onUnavailable]);

  if (!supported) return <GlobeFallback />;

  return (
    <GlobeBoundary onUnavailable={onUnavailable}>
      <Canvas
        aria-hidden="true"
        dpr={[1, 1.5]}
        frameloop={rotating ? 'always' : 'demand'}
        camera={{ fov: 45, near: 0.1, far: 100, position: [0, 0, 7] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        fallback={<GlobeFallback />}
        onCreated={({ gl }) => {
          if (onUnavailable) gl.domElement.addEventListener('webglcontextlost', onUnavailable, { once: true });
        }}
      >
        <Suspense fallback={null}>
          <Earth rotating={rotating} onReady={onReady} />
        </Suspense>
      </Canvas>
    </GlobeBoundary>
  );
}
