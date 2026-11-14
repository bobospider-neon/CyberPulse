// ═══════════════════════════════════════════════════════════════════════
//  CHRONO-SAR · 4D NISAR Earth-motion engine
//  NASA Space Apps Challenge 2026 — "Dancing with the SARs"
//  Single-module build: src/js/*.js are concatenated in file order.
// ═══════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// Colours are authored as display values (neon look); no implicit sRGB conversion.
THREE.ColorManagement.enabled = false;
