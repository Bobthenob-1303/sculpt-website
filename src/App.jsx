
import { useState, useRef, useEffect, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { OrbitControls, Environment } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";

import SculptMesh from "./components/SculptMesh";

import Gallery from "./components/Gallery";
import {
  ScribbleRing,
  ValueNode,
  ColorNode,
  MaterialColorNode,
  ChoiceNode,
  BranchNetwork,
} from "./components/ScribbleUI";

import "./App.css";

// ============================================================================
// EDITABLE SETTINGS — CHANGE VALUES HERE
// All startup values, slider limits, rendering settings, and drag sensitivities.
// ============================================================================

// Sculpting defaults and brush adjustment behavior
const BRUSH = {
  enabled: false,
  size: 0.4,
  strength: 0.002,
  pointiness: 0.5,
  sizeMin: 0.1,
  sizeMax: 1.2,
  strengthMin: 0.00001,
  strengthMax: 0.01,
  pointinessMin: 0,
  pointinessMax: 1,
  iconScaleBase: 0.4,
  iconScaleRange: 0.65,
  dragThresholdPx: 4,
  pointinessDragPx: 180, // move this many pixels for full pointiness range
  sizeDragPx: 220,       // move this many pixels for +1 brush size
};

const MATERIAL_DEFAULTS = {
  color: "#bcbcbc",
  roughness: 0.8,
  metalness: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.2,
  transmission: 0,
  ior: 1.5,
  thickness: 0.01,
  emissive: "#ffffff",
  emissiveIntensity: 0,
};

// [property name, visible label, minimum slider value, maximum slider value]
const MATERIAL_SLIDERS = [
  ["roughness", "Roughness", 0, 1],
  ["metalness", "Metalness", 0, 1],
  ["clearcoat", "Clearcoat", 0, 1],
  ["clearcoatRoughness", "Coat Roughness", 0, 1],
  ["transmission", "Glass", 0, 1],
  ["ior", "Refraction", 1, 2.33],
  ["thickness", "Thickness", 0.01, 5],
  ["emissiveIntensity", "Emission", 0, 5],
];

const HDRI = {
  initialPreset: "room",
  initialStrength: 0.35,
  initialRotation: 0,
  roomBlur: 0.12,
  strengthDragPx: 150,
  strengthMin: 0,
  strengthMax: 1,
  rotationMax: Math.PI * 2,
};

// [preset id, menu name, abbreviated label]
const HDRI_PRESETS = [
  ["room", "Default Room", "ROOM"],
  ["black", "No HDRI", "NONE"],
  ["studio", "Studio", "STD"],
  ["warehouse", "Warehouse", "WH"],
  ["apartment", "Apartment", "APT"],
  ["city", "City", "CITY"],
  ["forest", "Forest", "FOR"],
  ["sunset", "Sunset", "SUN"],
  ["dawn", "Dawn", "DAWN"],
  ["night", "Night", "NGT"],
  ["lobby", "Lobby", "LOB"],
  ["park", "Park", "PARK"],
];

// pos = Three.js scene coordinates; x/y = on-screen icon positions in %
const LIGHT_DEFAULTS = [
  { id: "topLeft", name: "Left Highlight", pos: [-3, 3, 4], x: 22, y: 22, power: 100 },
  { id: "topRight", name: "Right Highlight", pos: [3, 3, 4], x: 78, y: 22, power: 100 },
  { id: "bottom", name: "Bottom Highlight", pos: [0, -3.5, 4], x: 50, y: 83, power: 80 },
  { id: "back", name: "Back Highlight", pos: [0, 2, -4], x: 50, y: 12, power: 120 },
];

const LIGHTING = {
  defaultLightColor: "#ffffff",
  ambientIntensity: 0.15,
  spotlightAngle: 0.4,
  spotlightPenumbra: 0.15,
  spotlightDecay: 2,
  spotlightDistance: 20,
  powerMin: 0,
  powerMax: 200,
  dragPowerPx: 240,
  dragPowerChange: 200,
  dragPositionMaxPx: 35,
  dragPositionSceneScale: 12,
  iconScaleBase: 0.65,
  iconScaleRange: 0.7,
};

// Be aware: extremely low threshold values make spotlights/speculars bloom too.
// These reproduce your UPLOADED JSX values (they are not changed by cleanup).
const BLOOM = {
  maxIntensity: 3.3,
  intensityPerEmission: 0.99,
  luminanceThreshold: 0.000000000000000001,
  luminanceSmoothing: 0.0000000000000001,
  multisampling: 0,
  autoClear: false,
  mipmapBlur: true,
};

const CAMERA = {
  position: [0, 0, 5],
  fov: 45,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
  enablePan: false,
};

const UI = {
  meshLeaveDelayMs: 220,
  drawPanelColumns: 3,
  materialPanelColumns: 4,
  hdriPanelColumns: 4,
  lightPanelColumns: 2,
  titleText: "SKOLPT",
  titleAriaLabel: "SKOLPT?",
};

// ============================================================================
// INTERNAL HELPERS — normally no reason to edit below this line
// ============================================================================

function createLights() {
  return LIGHT_DEFAULTS.map((light) => ({
    ...light,
    position: [...light.pos],
    intensity: light.power,
    color: LIGHTING.defaultLightColor,
    dx: 0,
    dy: 0,
  }));
}

// ======================================
// ENVIRONMENT
// ======================================

function RoomLighting({ intensity, rotation }) {
  const { gl, scene } = useThree();

  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, HDRI.roomBlur);

    const oldEnvironment = scene.environment;
    const oldIntensity = scene.environmentIntensity;
    const oldRotation = scene.environmentRotation.clone();

    scene.environment = target.texture;

    return () => {
      if (scene.environment === target.texture) {
        scene.environment = oldEnvironment;
      }

      scene.environmentIntensity = oldIntensity;
      scene.environmentRotation.copy(oldRotation);

      target.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene]);

  useEffect(() => {
    scene.environmentIntensity = intensity;
    scene.environmentRotation.set(0, rotation, 0);
  }, [scene, intensity, rotation]);

  return null;
}

function SceneEnvironment({ preset, intensity, rotation }) {
  if (preset === "black") return null;

  if (preset === "room") {
    return (
      <RoomLighting
        intensity={intensity}
        rotation={rotation}
      />
    );
  }

  return (
    <Environment
      preset={preset}
      background={false}
      environmentIntensity={intensity}
      environmentRotation={[0, rotation, 0]}
    />
  );
}

// ======================================
// ICONS
// ======================================

function Icon({ type }) {
  // Filled black brush dot. Its size still follows the pointiness slider.
  if (type === "draw") return <span className="draw-icon" />;

  // Solid cube with a few irregular, sketch-like facet strokes.
  if (type === "material") {
    return (
      <svg className="main-tool-icon material-icon" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M50 12 L86 32 L86 70 L50 91 L14 70 L14 32 Z" fill="currentColor" />
        <path d="M14 32 L50 52 L86 32 M50 52 L50 91" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round" />
        <path className="icon-sketch-stroke" d="M15 34 L49 54 L85 34 M48 55 L51 89" fill="none" stroke="#ffffff" strokeWidth="1.3" opacity="0.65" />
      </svg>
    );
  }

  // Unfilled black hexagon with a secondary hand-drawn outline.
  if (type === "environment") {
    return (
      <svg className="main-tool-icon hdri-icon" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M50 10 L85 30 L85 70 L50 90 L15 70 L15 30 Z" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" />
        <path className="icon-sketch-stroke" d="M51 13 L83 31 L87 69 L49 88 L13 69 L17 29 Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" opacity="0.8" />
      </svg>
    );
  }

  if (type === "light") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2V4 M12 20V22 M2 12H4 M20 12H22 M4.93 4.93L6.35 6.35 M17.65 17.65L19.07 19.07 M4.93 19.07L6.35 17.65 M17.65 6.35L19.07 4.93" />
      </svg>
    );
  }

  if (type === "reset") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 11A9 9 0 1 1 6 18 M3 4V11H10" />
      </svg>
    );
  }
  return null;
}

// ======================================
// MAIN APPLICATION
// ======================================

export default function App() {
  // Sculpting
  const [drawEnabled, setDrawEnabled] = useState(BRUSH.enabled);
  const [brushSize, setBrushSize] = useState(BRUSH.size);
  const [brushStrength, setBrushStrength] = useState(BRUSH.strength);
  const [brushPointiness, setBrushPointiness] = useState(BRUSH.pointiness);
  const [meshVersion, setMeshVersion] = useState(0);
  const canvasElementRef = useRef(null);

  // UI
  const [openPanel, setOpenPanel] = useState(null);

  // Material
  const [material, setMaterial] = useState({
    ...MATERIAL_DEFAULTS,
  });

  // HDRI
  const [preset, setPreset] = useState(HDRI.initialPreset);
  const [hdriStrength, setHdriStrength] = useState(HDRI.initialStrength);
  const [hdriRotation, setHdriRotation] = useState(HDRI.initialRotation);

  // Lights
  const [lights, setLights] = useState(createLights);
  const [showLights, setShowLights] = useState(false);
  const [meshHovered, setMeshHovered] = useState(false);
  const [hubHovered, setHubHovered] = useState(false);

  // Pointer refs
  const dragRef = useRef(null);
  const skipClick = useRef(null);
  const brushDrag = useRef(null);
  const brushPointinessRef = useRef(brushPointiness);
  const brushSizeRef = useRef(brushSize);
  const hoverTimer = useRef(null);
  const activeDragCleanup = useRef(null);

  // Save a snapshot of the WebGL scene (mesh + lighting, without HTML UI).
  async function captureSculpture() {
    const canvas = canvasElementRef.current;
    if (!canvas) throw new Error("3D canvas is not ready.");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not export the canvas."));
        }, "image/png");
      } catch (error) { reject(error); }
    });
  }

  // ====================================
  // HELPERS
  // ====================================

  function changeMaterial(key, value) {
    setMaterial((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function changeLight(id, key, value) {
    setLights((previous) =>
      previous.map((light) =>
        light.id === id
          ? { ...light, [key]: value }
          : light
      )
    );
  }

  function resetLight(id) {
    const original = createLights().find(
      (light) => light.id === id
    );

    setLights((previous) =>
      previous.map((light) =>
        light.id === id ? original : light
      )
    );
  }

  function togglePanel(id) {
    setOpenPanel((previous) =>
      previous === id ? null : id
    );
  }

  // ====================================
  // CLOSE SETTINGS ON OUTSIDE CLICK
  // ====================================

  useEffect(() => {
    function outsideClick(event) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest(".interactive-group, .light-hub")
      ) {
        return;
      }

      setOpenPanel(null);
    }

    document.addEventListener("pointerdown", outsideClick);

    return () => {
      document.removeEventListener(
        "pointerdown",
        outsideClick
      );
    };
  }, []);

  // ====================================
  // MESH HOVER / LIGHT HUB
  // ====================================

  function cancelHoverTimer() {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  function meshEnter() {
    cancelHoverTimer();
    setMeshHovered(true);
  }

  function meshLeave() {
    cancelHoverTimer();

    // Allow time to move from sphere to the hub.
    hoverTimer.current = setTimeout(() => {
      setMeshHovered(false);
      hoverTimer.current = null;
    }, UI.meshLeaveDelayMs);
  }

  useEffect(() => {
    return () => {
      if (hoverTimer.current !== null) {
        clearTimeout(hoverTimer.current);
      }
    };
  }, []);

  useEffect(() => () => activeDragCleanup.current?.(), []);

  const hubVisible =
    meshHovered || hubHovered || showLights;

  // ====================================
  // DRAW ICON TWO-AXIS DRAG
  // Horizontal: pointiness. Vertical: size (up = larger, down = smaller).
  // Clicking the icon only opens brush settings; ON/OFF text toggles drawing.
  // ====================================

  function startBrushDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activeDragCleanup.current?.();

    const pointerId = event.pointerId;
    const xStart = event.clientX;
    const yStart = event.clientY;
    const initialPointiness = brushPointinessRef.current;
    const initialSize = brushSizeRef.current;
    let moved = false;

    function move(e) {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - xStart;
      const dy = e.clientY - yStart;
      if (!moved && Math.hypot(dx, dy) < BRUSH.dragThresholdPx) return;
      moved = true;

      const nextPointiness = THREE.MathUtils.clamp(
        initialPointiness + dx / BRUSH.pointinessDragPx, BRUSH.pointinessMin, BRUSH.pointinessMax
      );
      const nextSize = THREE.MathUtils.clamp(
        initialSize - dy / BRUSH.sizeDragPx, BRUSH.sizeMin, BRUSH.sizeMax
      );

      brushPointinessRef.current = nextPointiness;
      brushSizeRef.current = nextSize;
      setBrushPointiness(nextPointiness);
      setBrushSize(nextSize);
    }

    function stop(e) {
      if (e.pointerId !== pointerId) return;
      if (moved) skipClick.current = "draw";
      cleanup();
    }

    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      activeDragCleanup.current = null;
    }

    activeDragCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function clickDraw() {
    // A drag must not also open/close settings on release.
    if (skipClick.current === "draw") {
      skipClick.current = null;
      return;
    }

    // The brush icon controls its settings panel, not drawing ON/OFF.
    setOpenPanel((previous) => previous === "draw" ? null : "draw");
  }

  function toggleDrawEnabled() {
    setDrawEnabled((previous) => !previous);
  }

  // ====================================
  // HDRI AND LIGHT DRAGGING
  // ====================================

  function startDrag(event, id) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activeDragCleanup.current?.();
    const light = lights.find((item) => item.id === id);
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const initialPower = light?.intensity ?? 0;
    const initialStrength = hdriStrength;
    const initialDx = light?.dx ?? 0;
    const initialDy = light?.dy ?? 0;
    let moved = false;
    let mode = null;
    skipClick.current = null;

    function move(e) {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < BRUSH.dragThresholdPx) return;
      moved = true;

      if (id === "hdri") {
        setHdriStrength(THREE.MathUtils.clamp(initialStrength - dy / HDRI.strengthDragPx, HDRI.strengthMin, HDRI.strengthMax));
        return;
      }

      if (!mode) mode = Math.abs(dy) >= Math.abs(dx) ? "power" : "position";
      if (mode === "power") {
        changeLight(id, "intensity", THREE.MathUtils.clamp(initialPower - dy / LIGHTING.dragPowerPx * LIGHTING.dragPowerChange, LIGHTING.powerMin, LIGHTING.powerMax));
        return;
      }
      const x = THREE.MathUtils.clamp(initialDx + dx, -LIGHTING.dragPositionMaxPx, LIGHTING.dragPositionMaxPx);
      const y = THREE.MathUtils.clamp(initialDy + dy, -LIGHTING.dragPositionMaxPx, LIGHTING.dragPositionMaxPx);
      const original = LIGHT_DEFAULTS.find((item) => item.id === id);
      setLights((previous) => previous.map((item) => item.id === id ? {
        ...item, dx: x, dy: y,
        position: [original.pos[0] + x / LIGHTING.dragPositionSceneScale, original.pos[1] - y / LIGHTING.dragPositionSceneScale, original.pos[2]],
      } : item));
    }
    function stop(e) {
      if (e.pointerId !== pointerId) return;
      if (moved) skipClick.current = id;
      cleanup();
    }
    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      activeDragCleanup.current = null;
    }
    activeDragCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function iconClick(id) {
    if (skipClick.current === id) {
      skipClick.current = null;
      return;
    }

    togglePanel(id);
  }

  function dragHandlers(id) {
    return {
      onPointerDown: (event) => startDrag(event, id),

    };
  }

  // ====================================
  // RENDER
  // ====================================

  return (
    <div className="website">

      {/* Background title; controls stay in front of it. */}
      <h1 className="site-title" aria-label={UI.titleAriaLabel}>{UI.titleText}</h1>

      {/* The transparent WebGL scene sits ABOVE the title, allowing the
          sculpted mesh to obscure the letters naturally. */}
      <div className="sculpt-scene-layer">
      <Canvas
        camera={{
          position: CAMERA.position,
          fov: CAMERA.fov,
        }}
        gl={{ antialias: CAMERA.antialias, alpha: CAMERA.alpha, preserveDrawingBuffer: CAMERA.preserveDrawingBuffer }}
        onCreated={({ gl }) => {
          canvasElementRef.current = gl.domElement;
          gl.domElement.oncontextmenu = (event) =>
            event.preventDefault();
        }}
      >
        <Suspense fallback={null}>
          <SceneEnvironment
            preset={preset}
            intensity={hdriStrength}
            rotation={hdriRotation}
          />
        </Suspense>

        <ambientLight intensity={LIGHTING.ambientIntensity} />

        {lights.map((light) => (
          <spotLight
            key={light.id}
            position={light.position}
            color={light.color}
            intensity={light.intensity}
            angle={LIGHTING.spotlightAngle}
            penumbra={LIGHTING.spotlightPenumbra}
            decay={LIGHTING.spotlightDecay}
            distance={LIGHTING.spotlightDistance}
          />
        ))}

        <SculptMesh
          key={meshVersion}
          drawEnabled={drawEnabled}
          brushSize={brushSize}
          brushStrength={brushStrength}
          brushPointiness={brushPointiness}
          material={material}
          onMeshEnter={meshEnter}
          onMeshLeave={meshLeave}
        />

        <OrbitControls
          enablePan={CAMERA.enablePan}
          mouseButtons={{
            LEFT: drawEnabled
              ? -1
              : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
        />

        {/* Restore the emission-controlled bloom. Keep it selective so
            bright glass reflections don't turn into white blobs. */}
        {material.emissiveIntensity > 0 && (
          <EffectComposer multisampling={BLOOM.multisampling} autoClear={BLOOM.autoClear}>
            <Bloom
              intensity={Math.min(BLOOM.maxIntensity, material.emissiveIntensity * BLOOM.intensityPerEmission)}
              luminanceThreshold={BLOOM.luminanceThreshold}
              luminanceSmoothing={BLOOM.luminanceSmoothing}
              mipmapBlur={BLOOM.mipmapBlur}
            />
          </EffectComposer>
        )}
      </Canvas>
      </div>

      {/* =================================
          CENTRAL LIGHT HUB
          Appears on mesh hover
      ================================= */}

      {hubVisible && (
        <button
          className={`light-hub ${
            showLights ? "hub-open" : ""
          }`}
          title={
            showLights
              ? "Hide light controls"
              : "Show light controls"
          }
          aria-label={
            showLights
              ? "Hide light controls"
              : "Show light controls"
          }
          aria-expanded={showLights}
          onPointerEnter={() => {
            cancelHoverTimer();
            setHubHovered(true);
          }}
          onPointerLeave={() => {
            setHubHovered(false);
            if (!showLights) {
              setMeshHovered(false);
            }
          }}
          onClick={() => {
            setShowLights((previous) => !previous);
            setOpenPanel(null);
          }}
        >
          <ScribbleRing />
          <span className="hub-center">
            <Icon type="light" />
          </span>
        </button>
      )}

      {/* =================================
          FOUR HIDDEN LIGHT CONTROLS
      ================================= */}

      {showLights &&
        lights.map((light) => (
          <div
            key={light.id}
            className={`light-control interactive-group ${
              openPanel === light.id
                ? "expanded"
                : ""
            }`}
            style={{
              left: `calc(${light.x}% + ${light.dx}px)`,
              top: `calc(${light.y}% + ${light.dy}px)`,
            }}
          >
            <button
              className="light-button fill-button"
              style={{
                "--light-scale": LIGHTING.iconScaleBase + (light.intensity / LIGHTING.powerMax) * LIGHTING.iconScaleRange,
                "--light-color": light.color,
              }}
              title={`${light.name}: ${light.intensity.toFixed(0)}`}
              aria-label={light.name}
              aria-expanded={openPanel === light.id}
              {...dragHandlers(light.id)}
              onClick={() => iconClick(light.id)}
            >
              <span className="power-fill-clip">
                <span
                  className="power-fill"
                  style={{
                    height: `${
                      (light.intensity / LIGHTING.powerMax) * 100
                    }%`,
                  }}
                />
              </span>

              <span className="fill-icon light-colored-icon">
                <Icon type="light" />
              </span>

              <ScribbleRing />
            </button>

            {openPanel === light.id && (
              <BranchNetwork
                columns={UI.lightPanelColumns}
                side={
                  light.id === "topRight"
                    ? "left"
                    : "right"
                }
                className="light-network"
                items={[
                  {
                    key: "power",
                    content: (
                      <ValueNode
                        label="Power"
                        value={light.intensity}
                        max={LIGHTING.powerMax}
                        onChange={(value) =>
                          changeLight(
                            light.id,
                            "intensity",
                            value
                          )
                        }
                      />
                    ),
                  },
                  {
                    key: "color",
                    content: (
                      <ColorNode
                        label="Color"
                        value={light.color}
                        onChange={(value) =>
                          changeLight(
                            light.id,
                            "color",
                            value
                          )
                        }
                      />
                    ),
                  },
                  {
                    key: "reset",
                    content: (
                      <div className="node-cell">
                        <button
                          className="circle-node choice-node"
                          onClick={() =>
                            resetLight(light.id)
                          }
                        >
                          <ScribbleRing />
                          <span className="node-content">
                            RESET
                          </span>
                        </button>

                        <span className="node-label">
                          Reset Light
                        </span>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </div>
        ))}

      {/* =================================
          LEFT TOOLBAR
      ================================= */}

      <div className="toolbar">

        {/* DRAW */}

        <div className="tool-wrapper interactive-group">
          <button
            className={`tool-button draw-button ${
              drawEnabled ? "active" : ""
            }`}
            aria-label="Brush settings"
            aria-expanded={openPanel === "draw"}
            title={`Size: ${brushSize.toFixed(2)} (drag up/down) | Pointiness: ${brushPointiness.toFixed(2)} (drag left/right)`}
            onPointerDown={startBrushDrag}
            onClick={clickDraw}
          >
            <span
              className="brush-icon-wrapper"
              style={{
                transform: `scale(${
                  BRUSH.iconScaleBase + brushPointiness * BRUSH.iconScaleRange
                })`,
              }}
            >
              <Icon type="draw" />
            </span>

            <ScribbleRing />
          </button>

          <button
            type="button"
            className={`draw-status ${drawEnabled ? "is-on" : "is-off"}`}
            onClick={toggleDrawEnabled}
            aria-label={`Turn sculpting ${drawEnabled ? "off" : "on"}`}
            aria-pressed={drawEnabled}
            title={`Click to turn sculpting ${drawEnabled ? "off" : "on"}`}
          >
            {drawEnabled ? "ON" : "OFF"}
          </button>

          {openPanel === "draw" && (
            <BranchNetwork
              columns={UI.drawPanelColumns}
              items={[
                {
                  key: "size",
                  content: (
                    <ValueNode
                      label="Brush Size"
                      value={brushSize}
                      min={BRUSH.sizeMin}
                      max={BRUSH.sizeMax}
                      onChange={(value) => { brushSizeRef.current = value; setBrushSize(value); }}
                    />
                  ),
                },
                {
                  key: "strength",
                  content: (
                    <ValueNode
                      label="Strength"
                      value={brushStrength}
                      min={BRUSH.strengthMin}
                      max={BRUSH.strengthMax}
                      onChange={setBrushStrength}
                    />
                  ),
                },
                {
                  key: "pointiness",
                  content: (
                    <ValueNode
                      label="Pointiness"
                      value={brushPointiness}
                      min={BRUSH.pointinessMin}
                      max={BRUSH.pointinessMax}
                      onChange={(value) => {
                        brushPointinessRef.current = value;
                        setBrushPointiness(value);
                      }}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>

        {/* MATERIAL */}

        <div className="tool-wrapper interactive-group">
          <button
            className={`tool-button square ${
              openPanel === "material"
                ? "active"
                : ""
            }`}
            aria-label="Material"
            onClick={() => {
              setDrawEnabled(false);
              togglePanel("material");
            }}
          >
            <Icon type="material" />
            <ScribbleRing />
          </button>

          {openPanel === "material" && (
            <BranchNetwork
              columns={UI.materialPanelColumns}
              items={[
                {
                  key: "baseColor",
                  content: (
                    <MaterialColorNode
                      baseColor={material.color}
                      emissionColor={material.emissive}
                      onBaseChange={(value) => changeMaterial("color", value)}
                      onEmissionChange={(value) => changeMaterial("emissive", value)}
                    />
                  ),
                },

                ...MATERIAL_SLIDERS.map(
                  ([key, label, min, max]) => ({
                    key,
                    content: (
                      <ValueNode
                        label={label}
                        value={material[key]}
                        min={min}
                        max={max}
                        onChange={(value) =>
                          changeMaterial(key, value)
                        }
                      />
                    ),
                  })
                ),


                {
                  key: "reset",
                  content: (
                    <div className="node-cell">
                      <button
                        className="circle-node choice-node"
                        onClick={() =>
                          setMaterial({
                            ...MATERIAL_DEFAULTS,
                          })
                        }
                      >
                        <ScribbleRing />
                        <span className="node-content">
                          RESET
                        </span>
                      </button>

                      <span className="node-label">
                        Reset Material
                      </span>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>

        {/* HDRI */}

        <div className="tool-wrapper interactive-group">
          <button
            className="tool-button square fill-button hdri-button"
            title={`HDRI Strength: ${hdriStrength.toFixed(2)}`}
            aria-label="HDRI"
            aria-expanded={openPanel === "hdri"}
            {...dragHandlers("hdri")}
            onClick={() => {
              if (skipClick.current === "hdri") {
                skipClick.current = null;
                return;
              }

              setDrawEnabled(false);
              togglePanel("hdri");
            }}
          >
            <span className="power-fill-clip">
              <span
                className="power-fill"
                style={{
                  height: `${
                    hdriStrength * 100
                  }%`,
                }}
              />
            </span>

            <span className="fill-icon">
              <Icon type="environment" />
            </span>

            <ScribbleRing />
          </button>

          {openPanel === "hdri" && (
            <BranchNetwork
              columns={UI.hdriPanelColumns}
              items={[
                ...HDRI_PRESETS.map(
                  ([id, name, short]) => ({
                    key: id,
                    content: (
                      <ChoiceNode
                        label={name}
                        short={short}
                        selected={preset === id}
                        onClick={() =>
                          setPreset(id)
                        }
                      />
                    ),
                  })
                ),

                {
                  key: "rotation",
                  content: (
                    <ValueNode
                      label="Rotation"
                      value={hdriRotation}
                      max={HDRI.rotationMax}
                      onChange={setHdriRotation}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* RESET MESH */}

      <button
        className="reset-mesh-button"
        type="button"
        aria-label="Reset sculpted mesh"
        onClick={() => {
          setMeshVersion(
            (previous) => previous + 1
          );
          setOpenPanel(null);
        }}
      >
        <Icon type="reset" />
        RESET MESH
      </button>
      {/* Slide-out gallery with persistent saved PNG snapshots */}
      <Gallery captureImage={captureSculpture} />
    </div>
  );
}
