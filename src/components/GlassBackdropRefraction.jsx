import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Matches the CSS background-image: cover; background-position: center.
// The file is optional: if public/background.jpg doesn't exist, the shader
// doesn't render and the original glass/emission remain unaffected.
export default function GlassBackdropRefraction({ geometry, glass, ior, thickness }) {
  const { gl } = useThree();
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    let mounted = true;
    const loader = new THREE.TextureLoader();
    loader.load(
      '/background.jpg',
      (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.wrapS = THREE.ClampToEdgeWrapping;
        loaded.wrapT = THREE.ClampToEdgeWrapping;
        if (mounted) setTexture(loaded);
        else loaded.dispose();
      },
      undefined,
      () => { if (mounted) setTexture(null); }
    );
    return () => { mounted = false; };
  }, []);

  useEffect(() => () => { texture?.dispose(); }, [texture]);

  const shader = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uImage: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uImageAspect: { value: 1 },
      uGlass: { value: 0 },
      uIor: { value: 1.5 },
      uThickness: { value: 1 },
    },
    vertexShader: `
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uImage;
      uniform vec2 uResolution;
      uniform float uImageAspect;
      uniform float uGlass;
      uniform float uIor;
      uniform float uThickness;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      // Match CSS background-size: cover and centered positioning.
      vec2 coverUv(vec2 screenUv) {
        float screenAspect = uResolution.x / uResolution.y;
        vec2 scale = vec2(1.0);
        if (screenAspect > uImageAspect) {
          scale.y = uImageAspect / screenAspect;
        } else {
          scale.x = screenAspect / uImageAspect;
        }
        return (screenUv - 0.5) * scale + 0.5;
      }

      void main() {
        vec3 normal = normalize(vViewNormal);
        vec3 viewDir = normalize(vViewDir);
        float ndv = abs(dot(normal, viewDir));
        float edge = pow(1.0 - ndv, 2.0);
        vec2 uv = gl_FragCoord.xy / uResolution;
        float refractionStrength = (uIor - 1.0) * (0.024 + 0.020 * min(uThickness, 5.0));
        refractionStrength *= uGlass;
        // Distortion follows the mesh normals, including sculpted details.
        vec2 offset = normal.xy * refractionStrength * (0.5 + edge * 2.0);
        vec2 distortedUv = coverUv(clamp(uv + offset, 0.0, 1.0));
        vec3 backdrop = texture2D(uImage, distortedUv).rgb;
        // Keep the original interior emission visible through the refracted image.
        float opacity = uGlass * (0.74 + 0.16 * edge);
        gl_FragColor = vec4(backdrop, opacity);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  }), []);

  useFrame(() => {
    gl.getDrawingBufferSize(shader.uniforms.uResolution.value);
  });

  shader.uniforms.uImage.value = texture;
  shader.uniforms.uGlass.value = THREE.MathUtils.smoothstep(glass, 0.02, 1);
  shader.uniforms.uIor.value = ior;
  shader.uniforms.uThickness.value = thickness;
  if (texture?.image?.width && texture?.image?.height) {
    shader.uniforms.uImageAspect.value = texture.image.width / texture.image.height;
  }
  useEffect(() => () => shader.dispose(), [shader]);

  if (!texture || glass <= 0.02) return null;
  return (
    <mesh
      geometry={geometry}
      material={shader}
      dispose={null}
      raycast={() => null}
      renderOrder={1}
    />
  );
}
