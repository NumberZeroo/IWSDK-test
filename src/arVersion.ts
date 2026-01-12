import {
  AssetManifest,
  AssetType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SessionMode,
  SRGBColorSpace,
  AssetManager,
  World,
  XRInputManager
} from "@iwsdk/core";

import { PanelSystem } from "./panel.js";

import { RobotSystem } from "./robot.js";

import { EnvironmentType, LocomotionEnvironment } from "@iwsdk/core";

const assets: AssetManifest = {
  chimeSound: {
    url: "/audio/chime.mp3",
    type: AssetType.Audio,
    priority: "background",
  },
  eggSound: {
    url: "/audio/egg.mp3",
    type: AssetType.Audio,
    priority: "background",
  },
    simpHouse: {
    url: "/gltf/park/scene.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
    environmentDesk: {
    url: "/gltf/conference_room1/scene.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
  loading: {
    url: "/gltf/loading/scene.gltf",
    type: AssetType.GLTF,
  },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveAR, //O ImmersiveVR
    offer: "always",
      features: {
        handTracking: true,
        anchors: true,
        hitTest: true,
        planeDetection: true,
        meshDetection: true,
        layers: true,
    },
  },
  features: {
    grabbing: true,
    sceneUnderstanding: false,
  },
  level: "/glxf/Composition.glxf",
}).then((world) => {
  const { camera } = world;

  camera.position.set(-4, 1.5, -6);
  camera.rotateY(-Math.PI * 0.75);

  world
    .createTransformEntity()

  const scene = world.scene;
      
  const xrInput = new XRInputManager({ scene, camera });
  
  const rightPad = xrInput.gamepads.right;
  if(rightPad){
    console.log("Right pad connected:", rightPad);
  }
  else{
    console.log("Right pad not connected");
  }
  if(rightPad?.getButtonPressed('xr-standard-trigger')){
    console.log("Right trigger is pressed");
  }

  world.registerSystem(PanelSystem).registerSystem(RobotSystem);
});
