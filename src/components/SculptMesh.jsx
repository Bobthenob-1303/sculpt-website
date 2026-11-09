import { useRef, useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import GlassBackdropRefraction from "./GlassBackdropRefraction";

// Preserve the brush strength that is working in the current project.
const STRENGTH_SCALE = 1.0;

// Undo history: only added setting.
const MAX_UNDO_STEPS = 25;

// Physical thickness: 0.01 keeps the original sculpted surface unchanged.
// At the slider maximum (5), the outer shell extends 0.5 scene units outward.
const THICKNESS_MIN = 0.01;
const THICKNESS_MAX = 5;
const THICKNESS_MAX_OFFSET = 0.5;

export default function SculptMesh({
  drawEnabled,
  brushSize,
  brushStrength,
  brushPointiness = 0.5,
  material,
  onMeshEnter,
  onMeshLeave,
}) {
  const invalidate = useThree((state) => state.invalidate);
  const meshRef = useRef(null);
  const sculpting = useRef(false);
  const brush = useRef({ brushSize, brushStrength, brushPointiness });
  const vertex = useRef(new THREE.Vector3());
  const normal = useRef(new THREE.Vector3());

  // Undo/redo stores snapshots of the same geometry's vertex positions.
  const undoHistory = useRef([]);
  const redoHistory = useRef([]);

  // The outer glass and inward-facing emission share this same sculpted geometry.
  const geometry = useMemo(() => new THREE.SphereGeometry(1.7, 256, 256), []);
  // Outer shell is a separate surface, derived from the sculpted inner surface.
  // The original geometry remains untouched for undo/redo and inner emission.
  const outerGeometry = useMemo(() => geometry.clone(), [geometry]);
  const thicknessOffset = THREE.MathUtils.clamp(
    (material.thickness - THICKNESS_MIN) / (THICKNESS_MAX - THICKNESS_MIN), 0, 1
  ) * THICKNESS_MAX_OFFSET;

  function syncOuterGeometry(offset) {
    const innerPositions = geometry.attributes.position;
    const innerNormals = geometry.attributes.normal;
    const outerPositions = outerGeometry.attributes.position;
    for (let i = 0; i < innerPositions.count; i++) {
      outerPositions.setXYZ(
        i,
        innerPositions.getX(i) + innerNormals.getX(i) * offset,
        innerPositions.getY(i) + innerNormals.getY(i) * offset,
        innerPositions.getZ(i) + innerNormals.getZ(i) * offset
      );
    }
    outerPositions.needsUpdate = true;
    outerGeometry.computeVertexNormals();
    outerGeometry.computeBoundingSphere();
    outerGeometry.computeBoundingBox();
  }

  // Keep the shell in sync immediately when Thickness changes, regardless
  // of whether Glass is adjusted before or after it.
  useLayoutEffect(() => {
    syncOuterGeometry(thicknessOffset);
    invalidate();
  }, [geometry, outerGeometry, thicknessOffset, invalidate]);

  useEffect(() => {
    return () => { geometry.dispose(); outerGeometry.dispose(); };
  }, [geometry, outerGeometry]);

  useEffect(() => {
    brush.current = { brushSize, brushStrength, brushPointiness };
  }, [brushSize, brushStrength, brushPointiness]);

  // Added: restore positions, then refresh the existing geometry caches.
  function restorePositions(snapshot) {
    const positions = geometry.attributes.position;
    positions.array.set(snapshot);
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    syncOuterGeometry(thicknessOffset);
  }

  // Added: keyboard shortcuts; leave native undo in editable fields intact.
  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;

      const from = event.shiftKey ? redoHistory.current : undoHistory.current;
      const to = event.shiftKey ? undoHistory.current : redoHistory.current;
      if (from.length === 0) return;

      event.preventDefault();
      const positions = geometry.attributes.position;
      to.push(positions.array.slice());
      if (to.length > MAX_UNDO_STEPS) to.shift();
      restorePositions(from.pop());
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [geometry, outerGeometry, thicknessOffset]);

  const glass = THREE.MathUtils.clamp(material.transmission, 0, 1);
  // At full glass the surface itself becomes nearly invisible. A separate
  // Fresnel rim provides the glossy edge without filling the center.
  const glassMix = THREE.MathUtils.smoothstep(glass, 0.05, 1);
  const outerOpacity = THREE.MathUtils.lerp(1, 0.035, glassMix);
  const opticalThickness = Math.max(0.005, material.thickness * 0.025);
  const rimOpacity = THREE.MathUtils.smoothstep(glass, 0.2, 1) * 0.85;
  const glassTint = useMemo(() => new THREE.Color(), []);
  glassTint.set(material.color);

  // Rim shader uses the sculpted sphere's SAME geometry and vertex normals.
  // It does not add an inner sphere or alter the sculpting geometry.
  const rimMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#4e88ff') },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vViewDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewDirection = normalize(cameraPosition - worldPosition.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vWorldNormal;
      varying vec3 vViewDirection;
      void main() {
        float ndv = clamp(abs(dot(normalize(vWorldNormal), normalize(vViewDirection))), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, 3.0);
        // Blue-dominant iridescence, split into slightly different bands.
        vec3 blue = vec3(0.03, 0.26, 1.0);
        vec3 cyan = vec3(0.06, 0.85, 1.0);
        vec3 warm = vec3(0.80, 0.74, 0.60);
        float band = clamp((1.0 - ndv - 0.80) / 0.20, 0.0, 1.0);
        vec3 rainbow = mix(warm, cyan, smoothstep(0.0, 0.5, band));
        rainbow = mix(rainbow, blue, smoothstep(0.48, 1.0, band));
        vec3 tinted = mix(rainbow, rainbow * uColor * 1.4, 0.35);
        gl_FragColor = vec4(tinted, fresnel * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  }), []);
  rimMaterial.uniforms.uColor.value.copy(glassTint);
  rimMaterial.uniforms.uOpacity.value = rimOpacity;
  useEffect(() => () => rimMaterial.dispose(), [rimMaterial]);
  const emission = Math.max(0, material.emissiveIntensity);
  // Brighten only inward-facing polygons. No extra sphere or inner geometry.
  // HDR emission is necessary for the Bloom brightness threshold (> 1).
  // Keep the energy controlled by the existing Emission slider.
  const innerFaceColor = new THREE.Color(material.emissive).multiplyScalar(
    emission * 1.0
  );

  function sculpt(event) {
    const mesh = meshRef.current;
    if (!mesh) return;

    const {
      brushSize: size,
      brushStrength: strength,
      brushPointiness: pointiness,
    } = brush.current;

    const center = mesh.worldToLocal(event.point.clone());
    // Pointer hits the expanded outer shell; map the brush to the sculpted base.
    if (thicknessOffset > 0) {
      center.addScaledVector(center.clone().normalize(), -thicknessOffset);
    }
    const positions = geometry.attributes.position;
    const falloffPower = 0.7 + pointiness * 3.0;
    const inverse = Boolean(event.sourceEvent?.shiftKey ?? event.shiftKey);
    const direction = inverse ? -1 : 1;
    const radiusSquared = size * size;
    let changed = false;

    for (let i = 0; i < positions.count; i++) {
      vertex.current.fromBufferAttribute(positions, i);
      const distanceSquared = vertex.current.distanceToSquared(center);
      if (distanceSquared > radiusSquared) continue;

      const distance = Math.sqrt(distanceSquared);
      const falloff = Math.pow(1 - distance / size, falloffPower);
      const amount = strength * STRENGTH_SCALE * falloff * direction;
      normal.current.copy(vertex.current).normalize();
      vertex.current.addScaledVector(normal.current, amount);

      positions.setXYZ(i, vertex.current.x, vertex.current.y, vertex.current.z);
      changed = true;
    }

    if (changed) {
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      syncOuterGeometry(thicknessOffset);
    }
  }

  function down(event) {
    if (!drawEnabled || event.button !== 0) return;
    event.stopPropagation();
    // Added: save one undo state at the beginning of each brush stroke.
    undoHistory.current.push(geometry.attributes.position.array.slice());
    if (undoHistory.current.length > MAX_UNDO_STEPS) undoHistory.current.shift();
    redoHistory.current = [];
    sculpting.current = true;
    event.target.setPointerCapture(event.pointerId);
    sculpt(event);
  }

  function move(event) {
    if (!drawEnabled || !sculpting.current) return;
    event.stopPropagation();
    sculpt(event);
  }

  function end(event) {
    if (!sculpting.current) return;
    event.stopPropagation();
    sculpting.current = false;
    if (event.target.hasPointerCapture(event.pointerId)) {
      event.target.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={outerGeometry}
        dispose={null}
        onPointerOver={() => onMeshEnter?.()}
        onPointerOut={() => onMeshLeave?.()}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <meshPhysicalMaterial
          color={material.color}
          roughness={THREE.MathUtils.lerp(material.roughness, 0.06, glass)}
          metalness={material.metalness * (1 - glass)}
          clearcoat={material.clearcoat}
          clearcoatRoughness={material.clearcoatRoughness}
          // Explicit transparency is essential: transmission alone leaves the
          // full surface visually dense, especially over a black background.
          transparent={glass > 0}
          opacity={outerOpacity}
          depthWrite={glass < 0.01}
          transmission={glass * 0.30}
          ior={material.ior}
          iridescence={glass * 0.35}
          iridescenceIOR={1.3}
          iridescenceThicknessRange={[100, 430]}
          thickness={opticalThickness}
          attenuationColor={material.color}
          attenuationDistance={3.0}
          emissive="#000000"
          emissiveIntensity={0}
          flatShading={false}
        />
      </mesh>

      {/* Image-space refraction of the CSS background. Uses the same geometry
          so sculpting, dents, and distortions track the mesh in real time. */}
      <GlassBackdropRefraction
        geometry={outerGeometry}
        glass={glass}
        ior={material.ior}
        thickness={material.thickness}
      />

      {rimOpacity > 0 && (
        <mesh
          geometry={outerGeometry}
          material={rimMaterial}
          dispose={null}
          raycast={() => null}
          renderOrder={2}
        />
      )}

      {/* The original sculpted surface becomes the inward-facing wall when
          thickness is increased. At 0.01 this wall is not rendered. */}
      {thicknessOffset > 0 && emission <= 0 && (
        <mesh geometry={geometry} dispose={null} raycast={() => null}>
          <meshPhysicalMaterial
            side={THREE.BackSide}
            color={material.color}
            roughness={material.roughness}
            metalness={material.metalness * (1 - glass)}
            transparent={glass > 0}
            opacity={outerOpacity}
            depthWrite={glass < 0.01}
          />
        </mesh>
      )}

      {/* Render only the INSIDE of the exact same deformed surface.
          BackSide keeps the glow off the exterior. The glass front lets
          these inward-facing polygons show through when transmission is on. */}
      {emission > 0 && (
        <mesh
          scale={0.999}
          geometry={geometry}
          dispose={null}
          raycast={() => null}
        >
          <meshBasicMaterial
            side={THREE.BackSide}
            color={innerFaceColor}
            toneMapped={false}
            depthWrite={true}
          />
        </mesh>
      )}
    </group>
  );
}
