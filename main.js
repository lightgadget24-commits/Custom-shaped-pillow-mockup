import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

const $ = (id) => document.getElementById(id);
const state = { original: null, cutout: null, imageName: '', segmenter: null, scene: null, camera: null, renderer: null, controls: null, mesh: null, texture: null, sideMaterial: null, activeView: '3d', toastTimer: null };
const fileInput = $('fileInput');
const stage = $('stage');
const toastEl = $('toast');
const textureCanvas = document.createElement('canvas');
textureCanvas.width = textureCanvas.height = 1024;
const textureCtx = textureCanvas.getContext('2d');

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3600);
}
function setStatus(message) { $('stageStatus').textContent = message.toUpperCase(); }
function setBusy(busy, message = 'Working…') {
  $('removeBg').disabled = busy || !state.original;
  $('removeBg').innerHTML = busy ? `<span>◌</span> ${message}` : '<span>✦</span> Remove background with AI';
}
function setArtworkReady() {
  $('emptyState').hidden = true;
  $('resetView').disabled = false;
  $('downloadPng').disabled = false;
  $('download3d').disabled = false;
  $('removeBg').disabled = false;
  $('rotateTip').textContent = state.activeView === '3d' ? '↻ Drag to rotate · Scroll to zoom' : 'Transparent cutout · Ready to export';
}
function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open this image.')); };
    image.src = url;
  });
}
async function handleFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Please choose a PNG, JPG, or WebP image.');
  if (file.size > 15 * 1024 * 1024) return toast('Please use an image smaller than 15 MB.');
  try {
    const image = await imageFromFile(file);
    state.original = image;
    state.cutout = null;
    state.imageName = file.name.replace(/\.[^.]+$/, '') || 'pillow-artwork';
    $('fileRow').hidden = false;
    $('fileName').textContent = file.name;
    $('fileMeta').textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    $('fileThumb').style.backgroundImage = `url(${image.src})`;
    $('removeBg').disabled = false;
    setStatus('Image loaded · remove background to shape pillow');
    toast('Image loaded. Remove the background to form the pillow silhouette.');
    // If the uploaded image already has transparency, allow it to be used immediately.
    if (file.type === 'image/png' && await hasTransparency(image)) {
      state.cutout = image;
      buildPreview(image);
      toast('Transparent PNG detected — shaped pillow preview is ready.');
    } else {
      drawFlatPreview(image, false);
    }
  } catch (err) { toast(err.message || 'Could not load image.'); }
}
async function hasTransparency(image) {
  const c = document.createElement('canvas');
  c.width = Math.min(64, image.naturalWidth); c.height = Math.min(64, image.naturalHeight);
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 245) return true;
  return false;
}
async function removeBackground() {
  if (!state.original) return;
  setBusy(true, 'Loading AI model…');
  setStatus('Loading background removal model');
  $('aiHint').textContent = 'First use downloads an AI model (roughly 180 MB); keep this tab open.';
  try {
    if (!state.segmenter) {
      state.segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4', {
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            const pct = Math.round(p.loaded / p.total * 100);
            $('removeBg').innerHTML = `<span>◌</span> Loading model ${pct}%`;
          }
        }
      });
    }
    setBusy(true, 'Cutting out subject…');
    setStatus('AI is finding the subject edge');
    const result = await state.segmenter(state.original);
    const first = Array.isArray(result) ? result[0] : result;
    let cutoutCanvas;
    // Some Transformers.js segmentation pipelines return a mask; combine it with the original RGB pixels.
    const mask = first?.mask || first?.segmentation || (first?.data ? first : null);
    if (mask?.data && mask.width && mask.height && mask.data.length === mask.width * mask.height) {
      const w = mask.width, h = mask.height;
      const maskCanvas = document.createElement('canvas'); maskCanvas.width = w; maskCanvas.height = h;
      const mctx = maskCanvas.getContext('2d');
      const maskImage = mctx.createImageData(w, h);
      let maxMask = 0;
      for (let i=0;i<mask.data.length;i++) maxMask=Math.max(maxMask, Number(mask.data[i]) || 0);
      for (let i=0;i<mask.data.length;i++) {
        const a = Math.max(0, Math.min(255, Math.round((Number(mask.data[i]) || 0) * (maxMask <= 1 ? 255 : 1))));
        maskImage.data[i*4]=255; maskImage.data[i*4+1]=255; maskImage.data[i*4+2]=255; maskImage.data[i*4+3]=a;
      }
      mctx.putImageData(maskImage,0,0);
      cutoutCanvas=document.createElement('canvas'); cutoutCanvas.width=state.original.naturalWidth; cutoutCanvas.height=state.original.naturalHeight;
      const cctx=cutoutCanvas.getContext('2d'); cctx.drawImage(state.original,0,0);
      const originalPixels=cctx.getImageData(0,0,cutoutCanvas.width,cutoutCanvas.height);
      const scaledMask=document.createElement('canvas');scaledMask.width=cutoutCanvas.width;scaledMask.height=cutoutCanvas.height;
      const sctx=scaledMask.getContext('2d');sctx.drawImage(maskCanvas,0,0,scaledMask.width,scaledMask.height);
      const maskPixels=sctx.getImageData(0,0,scaledMask.width,scaledMask.height).data;
      for(let i=0;i<originalPixels.data.length/4;i++) originalPixels.data[i*4+3]=Math.round(originalPixels.data[i*4+3]*maskPixels[i*4+3]/255);
      cctx.putImageData(originalPixels,0,0);
    } else if (first?.toCanvas) {
      cutoutCanvas = first.toCanvas();
    } else {
      throw new Error('AI model did not return a usable foreground mask. Try a transparent PNG instead.');
    }
    // Normalize to a real RGBA canvas and preserve model alpha.
    const normalized = document.createElement('canvas');
    normalized.width = cutoutCanvas.width; normalized.height = cutoutCanvas.height;
    normalized.getContext('2d').drawImage(cutoutCanvas, 0, 0);
    const img = new Image();
    img.src = normalized.toDataURL('image/png');
    await img.decode();
    state.cutout = img;
    buildPreview(img);
    $('aiHint').textContent = 'Cutout created in your browser. Complex images may need a better source photo.';
    toast('Background removed. Your image now defines the pillow shape.');
  } catch (err) {
    console.error(err);
    toast(`Background removal failed: ${err.message || 'model could not run'}. Try a transparent PNG or another browser.`);
    $('aiHint').textContent = 'If AI fails, upload a transparent PNG cutout from any background-removal tool.';
    setStatus('AI removal failed · transparent PNG supported');
  } finally { setBusy(false); }
}
function buildTexture(image) {
  textureCtx.clearRect(0, 0, 1024, 1024);
  const scale = Math.min(940 / image.naturalWidth, 940 / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  textureCtx.drawImage(image, (1024-w)/2, (1024-h)/2, w, h);
}
function getContour(image, maxDim = 160) {
  const scale = Math.min(maxDim / image.naturalWidth, maxDim / image.naturalHeight, 1);
  const w = Math.max(2, Math.round(image.naturalWidth * scale));
  const h = Math.max(2, Math.round(image.naturalHeight * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0,0,w,h).data;
  const solid = (x,y) => x>=0 && y>=0 && x<w && y<h && data[(y*w+x)*4+3] > 90;
  const edges = [];
  const add = (x1,y1,x2,y2) => edges.push({a:`${x1},${y1}`, b:`${x2},${y2}`, p1:[x1,y1],p2:[x2,y2]});
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) if (solid(x,y)) {
    if (!solid(x,y-1)) add(x,y,x+1,y);
    if (!solid(x+1,y)) add(x+1,y,x+1,y+1);
    if (!solid(x,y+1)) add(x+1,y+1,x,y+1);
    if (!solid(x-1,y)) add(x,y+1,x,y);
  }
  const byStart = new Map();
  edges.forEach((e,i) => { if(!byStart.has(e.a)) byStart.set(e.a,[]); byStart.get(e.a).push(i); });
  const used = new Uint8Array(edges.length); let best=[];
  for(let i=0;i<edges.length;i++) {
    if(used[i]) continue;
    const loop=[]; let current=i; const start=edges[i].a; let guard=0;
    while(current!==undefined && !used[current] && guard++<edges.length+2) {
      const e=edges[current]; used[current]=1; loop.push(e.p1);
      if(e.b===start) break;
      const candidates=(byStart.get(e.b)||[]).filter(idx=>!used[idx]);
      if(!candidates.length){current=undefined;break;}
      // At ambiguous diagonal contacts, follow the edge that keeps the contour tight.
      current=candidates[0];
    }
    if(loop.length>best.length && loop.length>8) best=loop;
  }
  if(best.length<3) return null;
  // Downsample contour for lighter geometry while preserving the silhouette.
  const stride = Math.max(1, Math.floor(best.length/240));
  let pts = best.filter((_,i)=>i%stride===0);
  if(pts.length<3) pts=best;
  return { points: pts.map(([x,y])=>({x:x/w, y:y/h})), aspect:w/h };
}
function makeShape(contour) {
  const pts=contour.points;
  const shape=new THREE.Shape();
  pts.forEach((p,i)=>{const x=(p.x-.5)*contour.aspect; const y=(.5-p.y); if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);});
  shape.closePath();
  return shape;
}
function makeGeometry(contour) {
  const shape=makeShape(contour);
  const aspect=contour.aspect;
  const uvGenerator={
    generateTopUV(_g, vertices, a,b,c){
      const uv=(i)=>{const x=vertices[i*3], y=vertices[i*3+1];return new THREE.Vector2(x/aspect+0.5, y+0.5);};
      return [uv(a),uv(b),uv(c)];
    },
    generateSideWallUV(_g, vertices, a,b,c,d){
      const uv=(i)=>new THREE.Vector2(vertices[i*3], vertices[i*3+2]);
      return [uv(a),uv(b),uv(d),uv(b),uv(c),uv(d)];
    }
  };
  const thickness=Number($('thickness').value)/100;
  const round=Number($('rounding').value);
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSegments:round,steps:1,bevelThickness:Math.min(.045,thickness*.28),bevelSize:.025,curveSegments:8,UVGenerator:uvGenerator});
  geometry.computeVertexNormals();
  geometry.center();
  return geometry;
}
function init3d() {
  if(state.renderer) return;
  const host=$('threeHost');
  state.scene=new THREE.Scene();
  state.camera=new THREE.PerspectiveCamera(35,1,.1,100);
  state.camera.position.set(0,.1,3.4);
  state.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  state.renderer.outputColorSpace=THREE.SRGBColorSpace;
  state.renderer.toneMapping=THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure=1.15;
  host.appendChild(state.renderer.domElement);
  state.controls=new OrbitControls(state.camera,state.renderer.domElement);
  state.controls.enableDamping=true; state.controls.dampingFactor=.06; state.controls.minDistance=1.5; state.controls.maxDistance=6; state.controls.target.set(0,0,0);
  state.scene.add(new THREE.HemisphereLight(0xffffff,0x373044,2.1));
  const key=new THREE.DirectionalLight(0xffffff,3.2); key.position.set(-3,4,5); state.scene.add(key);
  const fill=new THREE.DirectionalLight(0xc5b5ff,1.4); fill.position.set(4,1,-3); state.scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffffff,1.7); rim.position.set(0,-2,-4); state.scene.add(rim);
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(1.2,64),new THREE.MeshBasicMaterial({color:0x070912,transparent:true,opacity:.24,depthWrite:false})); shadow.rotation.x=-Math.PI/2;shadow.position.y=-.62;shadow.scale.set(1.25,.65,1);state.scene.add(shadow);
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;state.camera.aspect=w/h;state.camera.updateProjectionMatrix();state.renderer.setSize(w,h,false);};
  new ResizeObserver(resize).observe(host); resize();
  const animate=()=>{requestAnimationFrame(animate);state.controls.update();state.renderer.render(state.scene,state.camera);}; animate();
}
function buildPreview(image) {
  buildTexture(image);
  const contour=getContour(image);
  if(!contour) { toast('Could not find the subject outline. Try a cleaner transparent PNG.'); return; }
  init3d();
  const geometry=makeGeometry(contour);
  const texture=new THREE.CanvasTexture(textureCanvas); texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=state.renderer.capabilities.getMaxAnisotropy(); texture.needsUpdate=true;
  const front=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.03,roughness:.82,metalness:0,side:THREE.DoubleSide});
  const sides=new THREE.MeshStandardMaterial({color:0xe4dce9,roughness:1,metalness:0});
  const mesh=new THREE.Mesh(geometry,[front,sides]); mesh.rotation.x=0; mesh.castShadow=false; mesh.receiveShadow=true;
  if(state.mesh){state.scene.remove(state.mesh);state.mesh.geometry.dispose();state.mesh.material.forEach(m=>m.dispose());}
  state.mesh=mesh; state.texture=texture; state.sideMaterial=sides; state.scene.add(mesh);
  const box=new THREE.Box3().setFromObject(mesh); const size=box.getSize(new THREE.Vector3());
  const max=Math.max(size.x,size.y,size.z); const s=1.55/max; mesh.scale.setScalar(s);
  state.controls.target.set(0,0,0); state.camera.position.set(0,.05,3.4); state.controls.update();
  drawFlatPreview(image,true);
  setArtworkReady(); setStatus('Custom silhouette generated');
  $('previewTitle').textContent='Your image, shaped into a pillow';
  $('stage').classList.toggle('no-studio',!$('studioBg').checked);
  $('sideStatus').textContent=$('sameBack').checked?'Front + back':'Front only';
}
function drawFlatPreview(image, isCutout) {
  const canvas=$('flatCanvas');const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  if($('studioBg').checked){const g=ctx.createRadialGradient(600,380,60,600,450,600);g.addColorStop(0,'#373346');g.addColorStop(1,'#171b27');ctx.fillStyle=g;ctx.fillRect(0,0,canvas.width,canvas.height);}
  const scale=Math.min(720/image.naturalWidth,660/image.naturalHeight);const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  if(isCutout){ctx.save();ctx.shadowColor='rgba(0,0,0,.38)';ctx.shadowBlur=25;ctx.shadowOffsetY=22;ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);ctx.restore();ctx.save();ctx.globalAlpha=.10;ctx.filter='blur(9px)';ctx.drawImage(image,(canvas.width-w)/2-2,(canvas.height-h)/2-2,w,h);ctx.restore();}
  else ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
}
function switchView(view) {
  state.activeView=view;
  $('threeHost').hidden=view!=='3d';$('twoDHost').hidden=view!=='2d';
  document.querySelectorAll('.view-button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('modeStatus').textContent=view==='3d'?'Interactive 3D':'2D cutout';
  $('rotateTip').textContent=view==='3d'?'↻ Drag to rotate · Scroll to zoom':'Transparent cutout · Ready to export';
  if(view==='3d'&&state.renderer){state.renderer.setSize($('threeHost').clientWidth,$('threeHost').clientHeight,false);}
}
function downloadCanvas(canvas,name){const a=document.createElement('a');a.download=name;a.href=canvas.toDataURL('image/png');a.click();}
function downloadCutout(){if(!state.cutout)return toast('Remove the background first.');const c=document.createElement('canvas');c.width=state.cutout.naturalWidth;c.height=state.cutout.naturalHeight;c.getContext('2d').drawImage(state.cutout,0,0);downloadCanvas(c,`${state.imageName}-cutout.png`);}
function downloadView(){if(!state.renderer||!state.mesh)return toast('Generate a pillow preview first.');state.renderer.render(state.scene,state.camera);const a=document.createElement('a');a.download=`${state.imageName}-3d-mockup.png`;a.href=state.renderer.domElement.toDataURL('image/png');a.click();}
fileInput.addEventListener('change',e=>handleFile(e.target.files?.[0]));
$('removeBg').addEventListener('click',removeBackground);
$('removeImage').addEventListener('click',()=>{state.original=null;state.cutout=null;fileInput.value='';$('fileRow').hidden=true;$('emptyState').hidden=false;$('removeBg').disabled=true;$('downloadPng').disabled=true;$('download3d').disabled=true;$('resetView').disabled=true;$('previewTitle').textContent='Your pillow, from every angle';setStatus('Ready for your image');if(state.mesh){state.scene.remove(state.mesh);state.mesh.geometry.dispose();state.mesh.material.forEach(m=>m.dispose());state.mesh=null;}switchView('3d');});
$('dropZone').addEventListener('dragover',e=>{e.preventDefault();$('dropZone').classList.add('dragging');});
$('dropZone').addEventListener('dragleave',()=> $('dropZone').classList.remove('dragging'));
$('dropZone').addEventListener('drop',e=>{e.preventDefault();$('dropZone').classList.remove('dragging');handleFile(e.dataTransfer.files?.[0]);});
document.querySelectorAll('.view-button').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
$('thickness').addEventListener('input',e=>{$('thicknessValue').textContent=`${e.target.value}%`;if(state.cutout)buildPreview(state.cutout);});
$('rounding').addEventListener('input',e=>{$('roundingValue').textContent=Number(e.target.value)<=2?'Subtle':Number(e.target.value)<=4?'Medium':'Soft';if(state.cutout)buildPreview(state.cutout);});
$('sameBack').addEventListener('change',()=>{$('sideStatus').textContent=$('sameBack').checked?'Front + back':'Front only';if(state.mesh){state.mesh.material[0].visible=true;}});
$('studioBg').addEventListener('change',()=>{stage.classList.toggle('no-studio',!$('studioBg').checked);if(state.cutout)drawFlatPreview(state.cutout,true);});
$('downloadPng').addEventListener('click',downloadCutout);$('download3d').addEventListener('click',downloadView);
$('resetView').addEventListener('click',()=>{if(state.controls){state.camera.position.set(0,.05,3.4);state.controls.target.set(0,0,0);state.controls.update();}});
window.addEventListener('resize',()=>{if(state.renderer){state.renderer.setSize($('threeHost').clientWidth,$('threeHost').clientHeight,false);}});
