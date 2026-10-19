import * as THREE from 'three';

export function installOpaqueReuse(renderer, scene) {
  if (!renderer.extensions.has('EXT_color_buffer_float') || renderer.capabilities.maxSamples < 4 || (scene.fog && !scene.fog.isFogExp2)) return null;
  const gl = renderer.getContext();
  if (!Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES) ?? []).includes(4)) return null;
  const render = renderer.render.bind(renderer);
  const size = new THREE.Vector2();
  const frustum = new THREE.Frustum();
  const clip = new THREE.Matrix4();
  const opaque = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: Math.min(4, renderer.capabilities.maxSamples),
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(1,1,THREE.UnsignedIntType),
  });
  const copy = new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({
    uniforms: {
      sceneColor:{value:opaque.texture}, sceneDepth:{value:opaque.depthTexture},
      cameraNear:{value:0.1}, cameraFar:{value:400}, fogDensity:{value:0},
      fogLinear:{value:new THREE.Color()}, fogDisplay:{value:new THREE.Color()},
    },
    vertexShader: 'varying vec2 screenUV; void main() { screenUV = uv; gl_Position = vec4(position.xy,1.0,1.0); }',
    fragmentShader: `uniform sampler2D sceneColor;
      uniform sampler2D sceneDepth;
      uniform float cameraNear;
      uniform float cameraFar;
      uniform float fogDensity;
      uniform vec3 fogLinear;
      uniform vec3 fogDisplay;
      varying vec2 screenUV;
      void main() {
        gl_FragColor = texture2D(sceneColor,screenUV);
        float depth = texture2D(sceneDepth,screenUV).x;
        gl_FragDepth = depth;
        float viewDepth = cameraNear * cameraFar / (cameraFar - depth * (cameraFar - cameraNear));
        float fogAmount = 1.0 - exp(-fogDensity * fogDensity * viewDepth * viewDepth);
        #ifdef TONE_MAPPING
          gl_FragColor.rgb = max(vec3(0.0),(gl_FragColor.rgb - fogLinear * fogAmount) / max(0.00001,1.0 - fogAmount));
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #ifdef TONE_MAPPING
          gl_FragColor.rgb = mix(gl_FragColor.rgb,fogDisplay,fogAmount);
        #endif
      }`,
    depthFunc: THREE.AlwaysDepth,
    depthWrite: true,
  }));
  copy.name = 'opaque-color-depth-reuse';
  copy.frustumCulled = false;
  copy.renderOrder = -10000;
  copy.visible = false;
  scene.add(copy);
  const surfaces = new Set();
  const opaqueMaterials = [];
  const otherMaterials = [];
  const transmissionObjects = [];
  const visibility = [];
  const refresh = () => {
    surfaces.clear(); opaqueMaterials.length = 0; otherMaterials.length = 0; transmissionObjects.length = 0; visibility.length = 0;
    scene.traverse((object) => {
      if (object === copy) return;
      const materials = [].concat(object.material ?? []);
      for (const material of materials) surfaces.add(material);
      if (materials.some((material) => material.transmission > 0)) transmissionObjects.push(object);
    });
    for (const material of surfaces) {
      (material.transparent || material.transmission > 0 ? otherMaterials : opaqueMaterials).push(material);
      visibility.push({material,visible:material.visible});
    }
  };
  refresh();
  const optimizedRender = (renderScene, camera) => {
    if (!pipeline.enabled || renderScene !== scene || renderer.getRenderTarget() || scene.overrideMaterial || renderer.shadowMap.needsUpdate) return render(renderScene, camera);
    frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),camera.coordinateSystem);
    const hasGlass = transmissionObjects.some((object) => {
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false;
      return object.layers.test(camera.layers) && frustum.intersectsObject(object);
    });
    if (!hasGlass) return render(renderScene,camera);
    renderer.getDrawingBufferSize(size);
    if (opaque.width !== size.x || opaque.height !== size.y) {
      opaque.setSize(size.x,size.y);
    }
    const state = {
      background: scene.background,
      backgroundIntensity: scene.backgroundIntensity,
      backgroundBlurriness: scene.backgroundBlurriness,
      toneMapping: renderer.toneMapping,
      autoClear: renderer.autoClear,
      autoReset: renderer.info.autoReset,
    };
    visibility.forEach((entry) => { entry.visible = entry.material.visible; });
    try {
      copy.material.uniforms.cameraNear.value = camera.near;
      copy.material.uniforms.cameraFar.value = camera.far;
      copy.material.uniforms.fogDensity.value = scene.fog?.density ?? 0;
      if (scene.fog) {
        copy.material.uniforms.fogLinear.value.copy(scene.fog.color);
        scene.fog.color.getRGB(copy.material.uniforms.fogDisplay.value,renderer.outputColorSpace);
      }
      renderer.info.autoReset = false;
      if (state.autoReset) renderer.info.reset();
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = true;
      copy.visible = false;
      otherMaterials.forEach((material) => { material.visible = false; });
      renderer.setRenderTarget(opaque);
      render(scene,camera);
      visibility.forEach(({material,visible}) => { material.visible = visible; });
      opaqueMaterials.forEach((material) => { material.visible = false; });
      scene.background = null;
      copy.visible = true;
      renderer.setRenderTarget(null);
      renderer.toneMapping = state.toneMapping;
      render(scene,camera);
    } finally {
      copy.visible = false;
      visibility.forEach(({material,visible}) => { material.visible = visible; });
      scene.background = state.background;
      scene.backgroundIntensity = state.backgroundIntensity;
      scene.backgroundBlurriness = state.backgroundBlurriness;
      renderer.toneMapping = state.toneMapping;
      renderer.autoClear = state.autoClear;
      renderer.info.autoReset = state.autoReset;
      renderer.setRenderTarget(null);
    }
  };
  renderer.render = optimizedRender;
  const pipeline = {
    enabled: true,
    refresh,
    dispose() {
      if (renderer.render === optimizedRender) renderer.render = render;
      scene.remove(copy); opaque.depthTexture.dispose(); opaque.dispose(); copy.material.dispose(); copy.geometry.dispose();
    },
  };
  return pipeline;
}