const React = window.React;

if (!React) {
  throw new Error('CircularGallery: React precisa ser carregado antes do componente.');
}

const { useEffect, useRef, useState } = React;

let Camera;
let Mesh;
let Plane;
let Program;
let Renderer;
let Texture;
let Transform;
let oglPromise = null;

function loadOgl() {
  if (oglPromise) return oglPromise;

  const sources = [
    'https://cdn.jsdelivr.net/npm/ogl@1.0.11/src/index.js',
    'https://unpkg.com/ogl@1.0.11/src/index.js?module',
    'https://cdn.skypack.dev/ogl@1.0.11'
  ];

  oglPromise = (async () => {
    let lastError;

    for (const source of sources) {
      try {
        const ogl = await import(source);
        if (ogl?.Renderer && ogl?.Camera && ogl?.Mesh && ogl?.Plane && ogl?.Program && ogl?.Texture && ogl?.Transform) {
          Camera = ogl.Camera;
          Mesh = ogl.Mesh;
          Plane = ogl.Plane;
          Program = ogl.Program;
          Renderer = ogl.Renderer;
          Texture = ogl.Texture;
          Transform = ogl.Transform;
          return ogl;
        }
        throw new Error(`Módulo OGL incompleto em ${source}`);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Não foi possível carregar OGL.');
  })();

  return oglPromise;
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function lerp(p1, p2, t) {
  return p1 + (p2 - p1) * t;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function autoBind(instance) {
  const proto = Object.getPrototypeOf(instance);
  Object.getOwnPropertyNames(proto).forEach(key => {
    if (key !== 'constructor' && typeof instance[key] === 'function') {
      instance[key] = instance[key].bind(instance);
    }
  });
}

async function resolveFont(font) {
  if (document.fonts && document.fonts.load) {
    try {
      await document.fonts.load(font);
      await document.fonts.ready;
    } catch {
      // A fonte de fallback mantém a galeria funcional.
    }
  }
  return font;
}

function getFontSize(font) {
  const match = font.match(/(\d+)px/);
  return match ? parseInt(match[1], 10) : 30;
}

function createTextTexture(gl, text, font = '500 30px sans-serif', color = '#0d2340') {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  const metrics = context.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(getFontSize(font) * 1.2);
  canvas.width = textWidth + 36;
  canvas.height = textHeight + 24;
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new Texture(gl, { generateMipmaps: false });
  texture.image = canvas;
  return { texture, width: canvas.width, height: canvas.height };
}

class Title {
  constructor({ gl, plane, text, textColor = '#0d2340', font = '500 30px sans-serif' }) {
    autoBind(this);
    this.gl = gl;
    this.plane = plane;
    this.text = text;
    this.textColor = textColor;
    this.font = font;
    this.createMesh();
  }

  createMesh() {
    const { texture, width, height } = createTextTexture(this.gl, this.text, this.font, this.textColor);
    const geometry = new Plane(this.gl);
    const program = new Program(this.gl, {
      vertex: `
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tMap, vUv);
          if (color.a < 0.1) discard;
          gl_FragColor = color;
        }
      `,
      uniforms: { tMap: { value: texture } },
      transparent: true
    });

    this.mesh = new Mesh(this.gl, { geometry, program });
    const aspect = width / height;
    const textHeight = this.plane.scale.y * 0.13;
    const textWidth = textHeight * aspect;
    this.mesh.scale.set(textWidth, textHeight, 1);
    this.mesh.position.y = -this.plane.scale.y * 0.5 - textHeight * 0.5 - 0.08;
    this.mesh.position.z = 0.04;
    this.mesh.setParent(this.plane);
  }
}

class Media {
  constructor({ geometry, gl, image, index, length, scene, screen, text, viewport, bend, textColor, borderRadius = 0, font, mobile = false }) {
    this.extra = 0;
    this.geometry = geometry;
    this.gl = gl;
    this.image = image;
    this.index = index;
    this.length = length;
    this.scene = scene;
    this.screen = screen;
    this.text = text;
    this.viewport = viewport;
    this.bend = bend;
    this.textColor = textColor;
    this.borderRadius = borderRadius;
    this.font = font;
    this.mobile = mobile;
    this.focus = 0;
    this.createShader();
    this.createMesh();
    this.onResize();
    this.createTitle();
  }

  createShader() {
    const texture = new Texture(this.gl, { generateMipmaps: true });
    this.texture = texture;

    this.program = new Program(this.gl, {
      depthTest: true,
      depthWrite: false,
      vertex: `
        precision highp float;
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform float uTime;
        uniform float uSpeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z = (sin(p.x * 4.0 + uTime) * 1.5 + cos(p.y * 2.0 + uTime) * 1.5) * (0.1 + uSpeed * 0.5);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform vec2 uImageSizes;
        uniform vec2 uPlaneSizes;
        uniform sampler2D tMap;
        uniform float uBorderRadius;
        uniform float uFocus;
        varying vec2 vUv;

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 d = abs(p) - b;
          return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
        }

        void main() {
          vec2 ratio = vec2(
            min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
            min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
          );
          vec2 uv = vec2(
            vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
            vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
          );
          vec4 color = texture2D(tMap, uv);

          float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          float saturation = mix(0.48, 1.0, uFocus);
          vec3 focusedColor = mix(vec3(luminance), color.rgb, saturation);
          focusedColor *= mix(0.72, 1.07, uFocus);
          focusedColor = mix(focusedColor, focusedColor + vec3(0.035, 0.018, 0.0), uFocus * 0.45);

          float d = roundedBoxSDF(vUv - 0.5, vec2(0.5 - uBorderRadius), uBorderRadius);
          float edgeSmooth = 0.002;
          float alpha = 1.0 - smoothstep(-edgeSmooth, edgeSmooth, d);
          gl_FragColor = vec4(focusedColor, alpha);
        }
      `,
      uniforms: {
        tMap: { value: texture },
        uPlaneSizes: { value: [1, 1] },
        uImageSizes: { value: [1, 1] },
        uSpeed: { value: 0 },
        uTime: { value: 100 * Math.random() },
        uBorderRadius: { value: this.borderRadius },
        uFocus: { value: 0 }
      },
      transparent: true
    });

    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.src = this.image;
    img.onload = () => {
      texture.image = img;
      this.program.uniforms.uImageSizes.value = [img.naturalWidth, img.naturalHeight];
    };
  }

  createMesh() {
    this.plane = new Mesh(this.gl, { geometry: this.geometry, program: this.program });
    this.plane.setParent(this.scene);
  }

  createTitle() {
    this.title = new Title({
      gl: this.gl,
      plane: this.plane,
      text: this.text,
      textColor: this.textColor,
      font: this.font
    });
  }

  update(scroll, direction) {
    this.plane.position.x = this.x - scroll.current - this.extra;

    const x = this.plane.position.x;
    const H = this.viewport.width / 2;

    if (this.bend === 0) {
      this.plane.position.y = 0;
      this.plane.rotation.z = 0;
    } else {
      const bendAbs = Math.abs(this.bend);
      const R = (H * H + bendAbs * bendAbs) / (2 * bendAbs);
      const effectiveX = Math.min(Math.abs(x), H);
      const arc = R - Math.sqrt(Math.max(R * R - effectiveX * effectiveX, 0));

      if (this.bend > 0) {
        this.plane.position.y = -arc;
        this.plane.rotation.z = -Math.sign(x) * Math.asin(Math.min(effectiveX / R, 1));
      } else {
        this.plane.position.y = arc;
        this.plane.rotation.z = Math.sign(x) * Math.asin(Math.min(effectiveX / R, 1));
      }
    }

    const focusRadius = Math.max(this.width * (this.mobile ? 1.15 : 1.42), this.viewport.width * (this.mobile ? 0.38 : 0.27));
    const proximity = 1 - clamp(Math.abs(x) / focusRadius, 0, 1);
    const focus = smoothstep01(proximity);
    this.focus = lerp(this.focus, focus, this.mobile ? 0.18 : 0.14);

    const scaleBoost = 1 + this.focus * (this.mobile ? 0.075 : 0.12);
    this.plane.scale.x = this.baseScaleX * scaleBoost;
    this.plane.scale.y = this.baseScaleY * scaleBoost;
    this.plane.position.z = this.focus * (this.mobile ? 0.48 : 1.05);

    this.speed = scroll.current - scroll.last;
    this.program.uniforms.uTime.value += 0.04;
    this.program.uniforms.uSpeed.value = this.speed;
    this.program.uniforms.uFocus.value = this.focus;
    this.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];

    if (this.title?.mesh) {
      this.title.mesh.position.z = 0.04 + this.focus * 0.09;
    }

    const planeOffset = this.baseScaleX / 2;
    const viewportOffset = this.viewport.width / 2;
    this.isBefore = this.plane.position.x + planeOffset < -viewportOffset;
    this.isAfter = this.plane.position.x - planeOffset > viewportOffset;

    if (direction === 'right' && this.isBefore) {
      this.extra -= this.widthTotal;
      this.isBefore = this.isAfter = false;
    }
    if (direction === 'left' && this.isAfter) {
      this.extra += this.widthTotal;
      this.isBefore = this.isAfter = false;
    }
  }

  onResize({ screen, viewport } = {}) {
    if (screen) this.screen = screen;
    if (viewport) this.viewport = viewport;
    if (!this.screen || !this.viewport) return;

    this.scale = this.screen.height / 1500;
    if (this.mobile) {
      this.baseScaleY = this.viewport.height * 0.72;
      this.baseScaleX = this.viewport.height * 0.55;
    } else {
      this.baseScaleY = (this.viewport.height * (1040 * this.scale)) / this.screen.height;
      this.baseScaleX = (this.viewport.width * (810 * this.scale)) / this.screen.width;
    }

    this.plane.scale.y = this.baseScaleY;
    this.plane.scale.x = this.baseScaleX;
    this.plane.program.uniforms.uPlaneSizes.value = [this.baseScaleX, this.baseScaleY];
    this.padding = this.mobile ? 1.45 : 2;
    this.width = this.baseScaleX + this.padding;
    this.widthTotal = this.width * this.length;
    this.x = this.width * this.index;
  }

  destroy() {
    if (this.plane) this.plane.setParent(null);
  }
}

class App {
  constructor(container, { items, bend, textColor = '#0d2340', borderRadius = 0, font = '500 28px Jost', scrollSpeed = 2, scrollEase = 0.05, mobile = false, onSelect, autoPlay = false, autoPlaySpeed = 0.0045, autoPlayResumeDelay = 2600 } = {}) {
    autoBind(this);
    this.container = container;
    this.bend = bend;
    this.textColor = textColor;
    this.borderRadius = borderRadius;
    this.font = font;
    this.scrollSpeed = scrollSpeed;
    this.mobile = mobile;
    this.onSelect = typeof onSelect === 'function' ? onSelect : null;
    this.pointerId = null;
    this.gestureAxis = null;
    this.dragThreshold = mobile ? 9 : 5;
    this.dragSensitivity = mobile ? 0.042 : 0.025;
    this.scroll = { ease: mobile ? Math.min(scrollEase + 0.018, 0.09) : scrollEase, current: 0, target: 0, last: 0, position: 0 };
    this.onCheckDebounce = debounce(this.onCheck, mobile ? 110 : 160);
    this.reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.autoPlay = Boolean(autoPlay) && !this.reducedMotion;
    this.autoPlaySpeed = autoPlaySpeed;
    this.autoPlayResumeDelay = autoPlayResumeDelay;
    this.lastInteractionAt = 0;
    this.createRenderer();
    this.createCamera();
    this.createScene();
    this.onResize();
    this.createGeometry();
    this.createMedias(items);
    this.onResize();
    this.update();
    this.addEventListeners();
  }

  createRenderer() {
    this.renderer = new Renderer({ alpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0, 0, 0, 0);
    this.container.appendChild(this.gl.canvas);
  }

  createCamera() {
    this.camera = new Camera(this.gl);
    this.camera.fov = 45;
    this.camera.position.z = 20;
  }

  createScene() {
    this.scene = new Transform();
  }

  createGeometry() {
    this.planeGeometry = new Plane(this.gl, { heightSegments: 50, widthSegments: 100 });
  }

  createMedias(items) {
    const galleryItems = items && items.length ? items : [];
    if (!galleryItems.length) {
      this.mediasImages = [];
      this.medias = [];
      return;
    }

    const repetitions = Math.max(2, Math.ceil(8 / galleryItems.length));
    this.mediasImages = Array.from({ length: repetitions }, () => galleryItems).flat();
    this.medias = this.mediasImages.map((data, index) => new Media({
      geometry: this.planeGeometry,
      gl: this.gl,
      image: data.image,
      index,
      length: this.mediasImages.length,
      scene: this.scene,
      screen: this.screen,
      text: data.text,
      viewport: this.viewport,
      bend: this.bend,
      textColor: this.textColor,
      borderRadius: this.borderRadius,
      font: this.font,
      mobile: this.mobile
    }));
  }

  updateGallery({ items, bend, textColor, borderRadius, font, onSelect }) {
    this.bend = bend;
    this.textColor = textColor;
    this.borderRadius = borderRadius;
    this.font = font;
    this.onSelect = typeof onSelect === 'function' ? onSelect : null;

    if (this.medias) this.medias.forEach(media => media.destroy());
    this.medias = [];
    this.mediasImages = [];
    this.scroll.current = 0;
    this.scroll.target = 0;
    this.scroll.last = 0;
    this.scroll.position = 0;
    this.createMedias(items);
    this.onResize();
  }

  markInteraction() {
    this.lastInteractionAt = performance.now();
  }

  onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    this.markInteraction();
    this.isDown = true;
    this.pointerId = e.pointerId ?? null;
    this.gestureAxis = null;
    this.scroll.position = this.scroll.current;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.lastMoveAt = performance.now();
    this.velocityX = 0;

    if (this.container.setPointerCapture && this.pointerId !== null) {
      try { this.container.setPointerCapture(this.pointerId); } catch { /* captura opcional */ }
    }
  }

  onPointerMove(e) {
    if (!this.isDown || (this.pointerId !== null && e.pointerId !== this.pointerId)) return;

    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;

    if (!this.gestureAxis) {
      if (Math.hypot(dx, dy) < this.dragThreshold) return;
      this.gestureAxis = Math.abs(dx) > Math.abs(dy) * 1.12 ? 'x' : 'y';

      if (this.gestureAxis === 'y') {
        this.releasePointer(e);
        return;
      }
    }

    if (this.gestureAxis !== 'x') return;
    if (e.cancelable) e.preventDefault();

    const distance = (this.startX - e.clientX) * (this.scrollSpeed * this.dragSensitivity);
    this.scroll.target = this.scroll.position + distance;

    const now = performance.now();
    const elapsed = Math.max(now - this.lastMoveAt, 1);
    this.velocityX = (this.lastX - e.clientX) / elapsed;
    this.lastX = e.clientX;
    this.lastMoveAt = now;
  }

  onPointerUp(e) {
    if (!this.isDown || (this.pointerId !== null && e.pointerId !== this.pointerId)) return;

    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const isTap = Math.hypot(dx, dy) < this.dragThreshold && !this.gestureAxis;

    if (this.gestureAxis === 'x' && Math.abs(this.velocityX) > 0.18 && this.medias?.[0]) {
      const width = this.medias[0].width;
      const direction = this.velocityX > 0 ? 1 : -1;
      const snapped = Math.round(this.scroll.target / width) * width;
      this.scroll.target = snapped + width * direction;
    }

    if (isTap) this.selectAt(e.clientX);

    this.releasePointer(e);
    this.onCheck();
  }

  getFrontMediaIndex() {
    if (!this.medias?.length) return -1;

    let frontIndex = -1;
    let frontDistance = Infinity;

    this.medias.forEach((media, index) => {
      const distance = Math.abs(media.plane.position.x);
      if (distance < frontDistance) {
        frontDistance = distance;
        frontIndex = index;
      }
    });

    return frontIndex;
  }

  centerMedia(index) {
    const media = this.medias?.[index];
    if (!media) return;

    // A posição horizontal é calculada como x - scroll.current - extra.
    // Logo, x - extra é exatamente o valor de scroll que coloca este card no centro.
    this.scroll.target = media.x - media.extra;
    this.onCheckDebounce();
  }

  selectAt(clientX) {
    if (!this.onSelect || !this.medias?.length || !this.viewport) return;
    const rect = this.container.getBoundingClientRect();
    if (!rect.width) return;

    const normalizedX = (clientX - rect.left) / rect.width - 0.5;
    const worldX = normalizedX * this.viewport.width;
    let closestIndex = -1;
    let closestDistance = Infinity;

    this.medias.forEach((media, index) => {
      const distance = Math.abs(media.plane.position.x - worldX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex < 0) return;
    const media = this.medias[closestIndex];
    const hitTolerance = Math.max(media.baseScaleX * 0.76, 1.2);
    if (closestDistance > hitTolerance) return;

    const frontIndex = this.getFrontMediaIndex();
    const centerTolerance = Math.max(media.baseScaleX * (this.mobile ? 0.11 : 0.09), 0.24);
    const settleTolerance = Math.max(media.width * 0.08, 0.12);
    const isCentered =
      closestIndex === frontIndex &&
      Math.abs(media.plane.position.x) <= centerTolerance &&
      Math.abs(this.scroll.target - this.scroll.current) <= settleTolerance;

    // Primeiro clique/toque em um item de segundo plano apenas o leva ao centro.
    // O modal só abre quando o mesmo card já é o item em primeiro plano e recebe outro clique.
    if (!isCentered) {
      this.centerMedia(closestIndex);
      return;
    }

    const item = this.mediasImages[closestIndex];
    if (item) this.onSelect(item);
  }

  releasePointer(e) {
    if (this.container.releasePointerCapture && this.pointerId !== null) {
      try { this.container.releasePointerCapture(this.pointerId); } catch { /* captura opcional */ }
    }
    this.isDown = false;
    this.pointerId = null;
    this.gestureAxis = null;
  }

  onWheel(e) {
    if (this.mobile) return;
    this.markInteraction();
    const delta = e.deltaY || e.wheelDelta || e.detail;
    this.scroll.target += (delta > 0 ? this.scrollSpeed : -this.scrollSpeed) * 0.2;
    this.onCheckDebounce();
  }

  step(direction) {
    if (!this.medias?.[0]) return;
    this.markInteraction();
    const width = this.medias[0].width;
    this.scroll.target = Math.round(this.scroll.target / width) * width + width * direction;
    this.onCheckDebounce();
  }

  onKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'Enter' || e.key === ' ') {
      this.markInteraction();
    }
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        this.step(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.step(-1);
        break;
      case 'Home':
        e.preventDefault();
        this.scroll.target = 0;
        this.onCheckDebounce();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        {
          const rect = this.container.getBoundingClientRect();
          this.selectAt(rect.left + rect.width / 2);
        }
        break;
      default:
        break;
    }
  }

  onCheck() {
    if (!this.medias || !this.medias[0]) return;
    const width = this.medias[0].width;
    const itemIndex = Math.round(Math.abs(this.scroll.target) / width);
    const item = width * itemIndex;
    this.scroll.target = this.scroll.target < 0 ? -item : item;
  }

  onResize() {
    this.screen = { width: this.container.clientWidth, height: this.container.clientHeight };
    if (!this.renderer || this.screen.width === 0 || this.screen.height === 0) return;
    this.renderer.setSize(this.screen.width, this.screen.height);
    this.camera.perspective({ aspect: this.screen.width / this.screen.height });
    const fov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(fov / 2) * this.camera.position.z;
    const width = height * this.camera.aspect;
    this.viewport = { width, height };
    if (this.medias) this.medias.forEach(media => media.onResize({ screen: this.screen, viewport: this.viewport }));
  }

  update() {
    if (this.autoPlay && !this.isDown && !document.hidden && performance.now() - this.lastInteractionAt > this.autoPlayResumeDelay) {
      this.scroll.target -= this.autoPlaySpeed;
    }
    this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.scroll.ease);
    const direction = this.scroll.current > this.scroll.last ? 'right' : 'left';
    if (this.medias) this.medias.forEach(media => media.update(this.scroll, direction));
    this.renderer.render({ scene: this.scene, camera: this.camera });
    this.scroll.last = this.scroll.current;
    this.raf = window.requestAnimationFrame(this.update);
  }

  addEventListeners() {
    window.addEventListener('resize', this.onResize);
    this.container.addEventListener('wheel', this.onWheel, { passive: true });
    this.container.addEventListener('pointerdown', this.onPointerDown);
    this.container.addEventListener('pointermove', this.onPointerMove, { passive: false });
    this.container.addEventListener('pointerup', this.onPointerUp);
    this.container.addEventListener('pointercancel', this.releasePointer);
    this.container.addEventListener('keydown', this.onKeyDown);
  }

  destroy() {
    window.cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerup', this.onPointerUp);
    this.container.removeEventListener('pointercancel', this.releasePointer);
    this.container.removeEventListener('keydown', this.onKeyDown);
    if (this.medias) this.medias.forEach(media => media.destroy());
    if (this.renderer?.gl?.canvas?.parentNode) this.renderer.gl.canvas.parentNode.removeChild(this.renderer.gl.canvas);

    try {
      this.renderer?.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Liberação explícita é opcional.
    }
  }
}

function FallbackGallery({ items, onSelect }) {
  return React.createElement(
    'div',
    {
      className: 'circular-gallery-fallback-list',
      role: 'list',
      'aria-label': 'Catálogo de luminárias'
    },
    items.map((item, index) =>
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'circular-gallery-fallback-card',
          role: 'listitem',
          key: `${item.image}-${index}`,
          onClick: () => onSelect?.(item),
          'aria-label': `Ver detalhes de ${item.text || 'luminária'}`
        },
        React.createElement('img', { src: item.image, alt: item.text || 'Luminária do Lojão Veras', loading: 'lazy' }),
        React.createElement('span', null, item.text)
      )
    )
  );
}

export default function CircularGallery({
  items,
  bend = 3,
  textColor = '#0d2340',
  borderRadius = 0.05,
  font = '500 28px Jost',
  scrollSpeed = 2,
  scrollEase = 0.05,
  onSelect,
  autoPlay = false,
  autoPlaySpeed = 0.0045,
  autoPlayResumeDelay = 2600
}) {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const latestConfigRef = useRef({ items, bend, textColor, borderRadius, font, scrollSpeed, scrollEase, onSelect, autoPlay, autoPlaySpeed, autoPlayResumeDelay });
  const [status, setStatus] = useState('loading');
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 720px), (pointer: coarse)').matches
      : false
  );

  latestConfigRef.current = { items, bend, textColor, borderRadius, font, scrollSpeed, scrollEase, onSelect, autoPlay, autoPlaySpeed, autoPlayResumeDelay };

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px), (pointer: coarse)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    let app;
    let isMounted = true;
    setStatus('loading');

    const current = latestConfigRef.current;

    Promise.all([loadOgl(), resolveFont(current.font)])
      .then(([, resolvedFont]) => {
        if (!isMounted || !containerRef.current) return;

        app = new App(containerRef.current, {
          items: current.items,
          bend: mobile ? Math.sign(current.bend || 1) * Math.min(Math.abs(current.bend), 1.15) : current.bend,
          textColor: current.textColor,
          borderRadius: mobile ? Math.max(current.borderRadius, 0.065) : current.borderRadius,
          font: resolvedFont,
          scrollSpeed: mobile ? Math.max(1.15, current.scrollSpeed * 0.72) : current.scrollSpeed,
          scrollEase: current.scrollEase,
          mobile,
          onSelect: current.onSelect,
          autoPlay: current.autoPlay,
          autoPlaySpeed: mobile ? current.autoPlaySpeed * 0.75 : current.autoPlaySpeed,
          autoPlayResumeDelay: current.autoPlayResumeDelay
        });
        appRef.current = app;
        setStatus('ready');
      })
      .catch(error => {
        console.error('CircularGallery: falha ao iniciar OGL. Usando catálogo alternativo.', error);
        if (isMounted) setStatus('fallback');
      });

    return () => {
      isMounted = false;
      if (app) app.destroy();
      if (appRef.current === app) appRef.current = null;
    };
  }, [mobile]);

  useEffect(() => {
    if (status !== 'ready' || !appRef.current || !items?.length) return undefined;

    let cancelled = false;
    resolveFont(font).then(resolvedFont => {
      if (cancelled || !appRef.current) return;
      appRef.current.updateGallery({
        items,
        bend: mobile ? Math.sign(bend || 1) * Math.min(Math.abs(bend), 1.15) : bend,
        textColor,
        borderRadius: mobile ? Math.max(borderRadius, 0.065) : borderRadius,
        font: resolvedFont,
        onSelect
      });
    });

    return () => {
      cancelled = true;
    };
  }, [items, bend, textColor, borderRadius, font, onSelect, status, mobile]);

  return React.createElement(
    'div',
    { className: `circular-gallery-shell circular-gallery-shell--${status}${mobile ? ' circular-gallery-shell--mobile' : ''}` },
    React.createElement('div', {
      className: 'circular-gallery',
      ref: containerRef,
      tabIndex: 0,
      role: 'region',
      'aria-label': mobile
        ? 'Galeria de luminárias. Deslize para os lados. O primeiro toque seleciona o produto e o leva ao centro; toque novamente para abrir os detalhes.'
        : 'Galeria circular de luminárias. Arraste ou use as setas para navegar. O primeiro clique seleciona e centraliza o produto; clique novamente para abrir os detalhes.'
    }),
    status === 'loading'
      ? React.createElement('div', { className: 'circular-gallery-state', role: 'status' }, 'Carregando catálogo…')
      : null,
    status === 'fallback' ? React.createElement(FallbackGallery, { items, onSelect }) : null,
    status === 'ready' && mobile
      ? React.createElement(
          'div',
          { className: 'circular-gallery-mobile-ui', 'aria-label': 'Controles do catálogo' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'circular-gallery-nav circular-gallery-nav--prev',
              onClick: () => appRef.current?.step(-1),
              'aria-label': 'Produto anterior'
            },
            '←'
          ),
          React.createElement('span', { className: 'circular-gallery-swipe-hint', 'aria-hidden': 'true' }, 'Deslize para explorar'),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'circular-gallery-nav circular-gallery-nav--next',
              onClick: () => appRef.current?.step(1),
              'aria-label': 'Próximo produto'
            },
            '→'
          )
        )
      : null
  );
}
