# Potree API Documentation

Comprehensive API reference for building Vue 3/Quasar/Pinia applications with Potree point cloud visualization and object manipulation.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Scene Management & Custom Scenes](#scene-management--custom-scenes)
3. [Object Manipulation APIs](#object-manipulation-apis)
4. [Clipping Volumes (Deep Dive)](#clipping-volumes-deep-dive)
5. [Profiles (Deep Dive)](#profiles-deep-dive)
6. [Measurements & Annotations](#measurements--annotations)
7. [Render Loop & Event System](#render-loop--event-system)
8. [Vue 3/Quasar/Pinia Integration](#vue-3quasarpinia-integration)
9. [API Reference](#api-reference)
10. [Code Examples](#code-examples)
11. [File Reference Map](#file-reference-map)

---

## Architecture Overview

### Core Components

Potree is built on THREE.js and provides a specialized rendering pipeline optimized for massive point cloud datasets. The architecture consists of:

- **Viewer** ([src/viewer/viewer.js](src/viewer/viewer.js)): Main application controller
- **Scene** ([src/viewer/Scene.js](src/viewer/Scene.js)): Scene graph manager
- **Renderers**: Specialized renderers for point clouds (PotreeRenderer, EDLRenderer)
- **Tools**: Measurement, clipping, transformation, annotation tools

### The Three-Scene Architecture

Potree uses **three separate THREE.Scene instances** for rendering optimization:

```javascript
// From src/viewer/Scene.js
this.scene = new THREE.Scene();           // Main scene for general 3D objects
this.scenePointCloud = new THREE.Scene(); // Point cloud scene (separate shader pipeline)
this.sceneBG = new THREE.Scene();         // Background scene (gradient/skybox)
```

**Why Three Scenes?**

1. **scenePointCloud**: Point clouds use custom shaders requiring a separate render pass
2. **sceneBG**: Background is rendered first without depth testing
3. **scene**: Standard THREE.js objects (meshes, lines, etc.) rendered last

**Important**: This is a **hard-coded limit**. The render pipeline explicitly renders these three scenes in order. You cannot add a fourth scene to the Scene object and expect it to render automatically.

### Viewer Initialization

```javascript
import * as Potree from './potree/build/potree.js';

// Create viewer
const viewer = new Potree.Viewer(domElement, {
  onPointCloudLoaded: (e) => { /* callback */ },
  noDragAndDrop: false,
  useDefaultRenderLoop: true  // Set false for custom integration (Cesium, etc.)
});

// Configure viewer
viewer.setEDLEnabled(true);           // Eye-Dome Lighting for better depth perception
viewer.setFOV(60);                    // Field of view
viewer.setPointBudget(1_000_000);     // Max points to render per frame
viewer.setBackground('gradient');     // 'gradient' | 'skybox' | 'black' | 'white'
viewer.setMoveSpeed(10);              // Camera movement speed
```

### Key Viewer Properties

| Property | Type | Description |
|----------|------|-------------|
| `viewer.scene` | Scene | The Scene instance managing all THREE.Scene objects |
| `viewer.renderer` | THREE.WebGLRenderer | The WebGL renderer |
| `viewer.controls` | Controls | Active camera controls (Orbit, FPS, Earth) |
| `viewer.inputHandler` | InputHandler | Handles mouse/keyboard input |
| `viewer.clippingTool` | ClippingTool | Tool for creating clipping volumes |
| `viewer.transformationTool` | TransformationTool | Tool for transforming objects |
| `viewer.measuringTool` | MeasuringTool | Tool for creating measurements |
| `viewer.profileTool` | ProfileTool | Tool for creating profiles |
| `viewer.volumeTool` | VolumeTool | Tool for creating volume measurements |
| `viewer.annotationTool` | AnnotationTool | Tool for creating annotations |

---

## Scene Management & Custom Scenes

### Understanding the Fixed Render Pipeline

The render sequence is **explicitly hard-coded** in the renderer files:

**[src/viewer/PotreeRenderer.js](src/viewer/PotreeRenderer.js:59-91)** (simplified rendering):

```javascript
// 1. Background
if(viewer.background === "skybox"){
    renderer.render(viewer.skybox.scene, viewer.skybox.camera);
} else if(viewer.background === "gradient"){
    renderer.render(viewer.scene.sceneBG, viewer.scene.cameraBG);
}

// 2. Point clouds (custom shader pipeline)
viewer.pRenderer.render(viewer.scene.scenePointCloud, camera, null, {...});

// 3. Main scene (standard THREE.js objects)
renderer.render(viewer.scene.scene, camera);

// 4. Overlays (clipping tool UI, controls)
renderer.clearDepth();  // Clear depth buffer for always-on-top overlays
renderer.render(viewer.clippingTool.sceneMarker, viewer.scene.cameraScreenSpace);
renderer.render(viewer.clippingTool.sceneVolume, camera);
renderer.render(viewer.controls.sceneControls, camera);
```

### Adding Custom THREE.Scene Instances

While you cannot add scenes to the Scene object directly, you can hook into the render pipeline using events.

#### Recommended Approach: Event-Based Rendering

```javascript
// 1. Create your custom scene
const customScene = new THREE.Scene();

// Add objects to your custom scene
const mesh = new THREE.Mesh(geometry, material);
customScene.add(mesh);

// 2. Hook into the render pipeline
viewer.addEventListener("render.pass.scene", (event) => {
    // Render your scene after the main scene but before overlays
    event.viewer.renderer.render(
        customScene,
        event.viewer.scene.getActiveCamera()
    );
});
```

#### Available Render Events

From [src/viewer/PotreeRenderer.js](src/viewer/PotreeRenderer.js:52-109):

| Event | When Fired | Use Case |
|-------|------------|----------|
| `render.pass.begin` | Before any rendering | Setup render state |
| `render.pass.scene` | After main scene rendered | Add custom depth-tested scenes |
| `render.pass.perspective_overlay` | After clearDepth() | Add overlay UI elements |
| `render.pass.end` | After all rendering | Cleanup, post-processing |

#### Depth Buffer Considerations

```javascript
// Objects rendered BEFORE clearDepth() are depth-tested with point clouds/scene
viewer.addEventListener("render.pass.scene", (e) => {
    // Your objects will respect depth
    e.viewer.renderer.render(customScene, camera);
});

// Objects rendered AFTER clearDepth() always appear on top
viewer.addEventListener("render.pass.perspective_overlay", (e) => {
    // Your objects will always be visible (overlays)
    e.viewer.renderer.render(overlayScene, camera);
});
```

### Direct Renderer Modification (Advanced)

If you need tighter control, you can fork and modify the renderers:

**[src/viewer/PotreeRenderer.js](src/viewer/PotreeRenderer.js:82-91)** - Add after line 83:

```javascript
renderer.render(viewer.scene.scene, camera);

// ADD YOUR CUSTOM SCENE HERE
if (viewer.scene.sceneCustom) {
    renderer.render(viewer.scene.sceneCustom, camera);
}

renderer.clearDepth();
// ... rest of rendering
```

**Note**: You must modify both `PotreeRenderer.js` and `EDLRenderer.js` if using EDL.

---

## Object Manipulation APIs

### Adding THREE.js Objects to the Main Scene

You have **direct access** to the main THREE.Scene instance. Any standard THREE.js object can be added:

```javascript
// Access the main scene
const mainScene = viewer.scene.scene;

// Add any THREE.Object3D
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const cube = new THREE.Mesh(geometry, material);
cube.position.set(10, 20, 5);
mainScene.add(cube);

// Add lights
const light = new THREE.DirectionalLight(0xffffff, 1.0);
light.position.set(100, 100, 100);
mainScene.add(light);

// Add lines
const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(10, 10, 10)
];
const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
const lineMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
const line = new THREE.Line(lineGeometry, lineMaterial);
mainScene.add(line);
```

### Removing Objects

```javascript
// Remove from scene
viewer.scene.scene.remove(object);

// Dispose geometry and materials to free memory
object.geometry.dispose();
object.material.dispose();

// If object has textures
if (object.material.map) {
    object.material.map.dispose();
}
```

### Managing Object Collections

For Vue 3/Pinia applications, maintain a collection of your custom objects:

```javascript
// In Pinia store
const customObjects = ref([]);

// Add object
function addCustomObject(object) {
    viewer.scene.scene.add(object);
    customObjects.value.push(object);
}

// Remove object
function removeCustomObject(object) {
    viewer.scene.scene.remove(object);
    object.geometry.dispose();
    object.material.dispose();

    const index = customObjects.value.indexOf(object);
    if (index > -1) {
        customObjects.value.splice(index, 1);
    }
}

// Remove all objects
function removeAllCustomObjects() {
    customObjects.value.forEach(obj => {
        viewer.scene.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
    });
    customObjects.value = [];
}
```

### Point Cloud Management

#### Loading Point Clouds (COPC)

```javascript
// COPC (Cloud Optimized Point Cloud) format
Potree.loadPointCloud(urlOrFile, name, (e) => {
    const pointcloud = e.pointcloud;

    // Configure material
    pointcloud.material.size = 1;
    pointcloud.material.pointSizeType = Potree.PointSizeType.ADAPTIVE;
    pointcloud.material.activeAttributeName = 'rgba';

    // Add to scene
    viewer.scene.addPointCloud(pointcloud);

    // Fit camera to view
    viewer.fitToScreen();
}, true);  // true = isCopc flag
```

#### Point Cloud Properties

Point clouds inherit from `THREE.Object3D`, so standard transformations work:

```javascript
// Transform point cloud
pointcloud.position.set(x, y, z);
pointcloud.rotation.set(rx, ry, rz);
pointcloud.scale.set(sx, sy, sz);
pointcloud.visible = true;

// Update matrices
pointcloud.updateMatrix();
pointcloud.updateMatrixWorld();

// Access properties
const boundingBox = pointcloud.boundingBox;  // THREE.Box3
const name = pointcloud.name;
const material = pointcloud.material;
```

#### Removing Point Clouds

```javascript
// Remove from scene
const index = viewer.scene.pointclouds.indexOf(pointcloud);
if (index > -1) {
    viewer.scene.pointclouds.splice(index, 1);
}

// Point clouds handle their own memory management internally
```

---

## Clipping Volumes (Deep Dive)

Clipping volumes use **shader-based clipping**, not THREE.js native clipping planes. This allows efficient clipping of millions of points.

### How Clipping Works

From [src/viewer/viewer.js](src/viewer/viewer.js:1835-1868):

1. Each frame, the viewer collects all clip volumes
2. Volume transformation matrices are computed
3. Matrices are passed to point cloud material shaders as uniforms
4. Shaders test each point against volume bounds and discard if outside

### BoxVolume

**File**: [src/utils/Volume.js](src/utils/Volume.js:106-204)

#### Creating a BoxVolume

```javascript
// Create box volume
const volume = new Potree.BoxVolume();

// Position and size
volume.position.set(10, 20, 5);
volume.scale.set(10, 10, 5);  // Box dimensions
volume.rotation.set(0, Math.PI / 4, 0);  // Rotate 45 degrees around Y

// Enable clipping
volume.clip = true;  // When true, clips point clouds

// Make user-modifiable
volume.modifiable = true;  // Enables transformation handles

// Add to scene
viewer.scene.addVolume(volume);
```

#### BoxVolume API

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `volume.clip` | boolean | Enable/disable clipping mode |
| `volume.modifiable` | boolean | Show/hide transformation handles |
| `volume.visible` | boolean | Show/hide volume visualization |
| `volume.position` | THREE.Vector3 | Volume center position |
| `volume.scale` | THREE.Vector3 | Volume dimensions (half-extents) |
| `volume.rotation` | THREE.Euler | Volume rotation |
| `volume.box` | THREE.Mesh | Visual mesh representation |
| `volume.frame` | THREE.LineSegments | Wireframe visualization |

**Methods:**

```javascript
// Get volume in cubic world units
const cubicUnits = volume.getVolume();

// Update transformation matrix
volume.updateMatrixWorld();

// Access bounding box
const bbox = volume.boundingBox;  // THREE.Box3
```

#### BoxVolume Events

Volumes dispatch events when modified:

```javascript
volume.addEventListener('clip_property_changed', (e) => {
    console.log('Clip mode changed:', e.volume.clip);
});
```

### PolygonClipVolume

**File**: [src/utils/PolygonClipVolume.js](src/utils/PolygonClipVolume.js)

Polygon clip volumes define a 2D polygon in screen space that clips points when projected.

#### Creating a PolygonClipVolume

```javascript
// Create polygon volume with current camera
const polygonVolume = new Potree.PolygonClipVolume(viewer.scene.getActiveCamera());

// Add markers (screen-space coordinates)
polygonVolume.addMarker(new THREE.Vector3(x1, y1, 0));
polygonVolume.addMarker(new THREE.Vector3(x2, y2, 0));
polygonVolume.addMarker(new THREE.Vector3(x3, y3, 0));
// ... more points to define polygon

// Add to scene
viewer.scene.polygonClipVolumes.push(polygonVolume);
```

#### PolygonClipVolume API

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `polygonVolume.camera` | THREE.Camera | Camera snapshot at creation |
| `polygonVolume.viewMatrix` | THREE.Matrix4 | View matrix at creation |
| `polygonVolume.projMatrix` | THREE.Matrix4 | Projection matrix at creation |
| `polygonVolume.markers` | Array | Screen-space marker positions |
| `polygonVolume.initialized` | boolean | Whether polygon is complete |

**Methods:**

```javascript
// Add marker point
polygonVolume.addMarker(position);  // THREE.Vector3

// Remove last marker
polygonVolume.removeLastMarker();
```

### Clipping Integration

#### Shader Uniform System

From [src/PotreeRenderer.js](src/PotreeRenderer.js:771-810), clip data is passed to shaders:

```javascript
// Box clipping
if (material.clipBoxes && material.clipBoxes.length > 0) {
    // Matrices passed as shader uniforms
    gl.uniformMatrix4fv(lClipBoxes, false, clipBoxMatrices);
}

// Polygon clipping
if (material.clipPolygons && material.clipPolygons.length > 0) {
    gl.uniform1iv(lClipPolygonVCount, vertexCounts);
    gl.uniformMatrix4fv(lClipPolygonVP, false, viewProjMatrices);
    gl.uniform3fv(lClipPolygons, polygonVertices);
}
```

#### Clip Modes

```javascript
// Set on viewer
viewer.clipTask = Potree.ClipTask.SHOW_INSIDE;  // or SHOW_OUTSIDE, HIGHLIGHT
viewer.clipMethod = Potree.ClipMethod.INSIDE_ANY;  // or INSIDE_ALL
```

**ClipTask Options:**
- `SHOW_INSIDE`: Show only points inside volumes
- `SHOW_OUTSIDE`: Show only points outside volumes
- `HIGHLIGHT`: Highlight points inside volumes

**ClipMethod Options:**
- `INSIDE_ANY`: Point is inside if in ANY volume
- `INSIDE_ALL`: Point is inside if in ALL volumes

### Scene Volume Collections

```javascript
// Access all volumes
viewer.scene.volumes;  // Array of BoxVolume instances
viewer.scene.polygonClipVolumes;  // Array of PolygonClipVolume instances

// Add volume
viewer.scene.addVolume(volume);
// Fires 'volume_added' event

// Remove volume
viewer.scene.removeVolume(volume);
// Fires 'volume_removed' event

// Remove all clip volumes
viewer.scene.removeAllClipVolumes();
```

---

## Profiles (Deep Dive)

Profiles extract cross-sections of point cloud data along a path. Each profile segment creates a BoxVolume for clipping.

**File**: [src/utils/Profile.js](src/utils/Profile.js)

### Profile Structure

```javascript
class Profile extends THREE.Object3D {
    this.points = [];      // 3D world positions (Array<THREE.Vector3>)
    this.spheres = [];     // Visual markers at each point (Array<THREE.Mesh>)
    this.edges = [];       // Lines connecting markers (Array<THREE.Line>)
    this.boxes = [];       // BoxVolume for each segment (Array<BoxVolume>)
    this.width = 1;        // Profile width in world units
    this.height = 20;      // Profile height in world units
}
```

### Creating Profiles

```javascript
// Create profile
const profile = new Potree.Profile();
profile.name = "Cross Section 1";
profile.width = 2;   // 2 units wide
profile.height = 50; // 50 units tall

// Add points to define path
profile.addMarker(new THREE.Vector3(10, 20, 5));
profile.addMarker(new THREE.Vector3(50, 20, 5));
profile.addMarker(new THREE.Vector3(50, 60, 10));

// Add to scene
viewer.scene.addProfile(profile);
// Fires 'profile_added' event
```

### Profile API

#### Adding/Removing Markers

From [src/utils/Profile.js](src/utils/Profile.js:77-182):

```javascript
// Add marker (creates sphere, edge, and box automatically)
profile.addMarker(position);  // THREE.Vector3
// Fires 'marker_added' event

// Remove marker by index
profile.removeMarker(index);
// Fires 'marker_removed' event

// Update marker position
profile.setPosition(index, newPosition);
// Fires 'marker_moved' event
```

#### Configuration

```javascript
// Set profile width
profile.setWidth(5);  // 5 world units
// Fires 'width_changed' event
// Updates all box volumes automatically

// Set profile height
profile.height = 100;
profile.update();  // Manually trigger update

// Make user-modifiable
profile.modifiable = true;  // Shows sphere handles
```

#### Getting Profile Data

```javascript
// Get segments
const segments = profile.getSegments();
// Returns: [{start: Vector3, end: Vector3}, ...]

// Get segment transformation matrices
const matrices = profile.getSegmentMatrices();
// Returns: Array<THREE.Matrix4>
```

### Extracting Point Data from Profiles

**File**: [src/PointCloudOctree.js](src/PointCloudOctree.js:547)

```javascript
// Request points within profile
const request = pointcloud.getPointsInProfile(profile, maxDepth, (data) => {
    // Callback receives extracted point data
    // data.numPoints - number of points extracted
    // data contains all point attributes (position, color, intensity, etc.)

    console.log(`Extracted ${data.numPoints} points from profile`);
});

// Cancel request if needed
request.cancel();
```

### Profile Rendering

Profiles have a separate rendering system ([src/viewer/profile.js](src/viewer/profile.js)) that creates a 2D orthographic view:

```javascript
// ProfileWindow class manages the profile view
// ProfileFakeOctree stores extracted points
// Points are rendered in a side-view projection
```

### Profile Properties

| Property | Type | Description |
|----------|------|-------------|
| `profile.name` | string | Profile name |
| `profile.width` | number | Width in world units |
| `profile.height` | number | Height in world units |
| `profile.points` | Array<Vector3> | Path point positions |
| `profile.spheres` | Array<Mesh> | Marker spheres at each point |
| `profile.edges` | Array<Line> | Lines connecting markers |
| `profile.boxes` | Array<BoxVolume> | Clipping boxes for each segment |
| `profile.modifiable` | boolean | Show/hide marker handles |

### Profile Events

```javascript
profile.addEventListener('marker_added', (e) => {
    console.log('Marker added at:', e.position);
});

profile.addEventListener('marker_removed', (e) => {
    console.log('Marker removed at index:', e.index);
});

profile.addEventListener('marker_moved', (e) => {
    console.log('Marker moved:', e.index, e.position);
});

profile.addEventListener('width_changed', (e) => {
    console.log('Width changed to:', e.profile.width);
});
```

### Scene Profile Management

```javascript
// Access profiles
viewer.scene.profiles;  // Array<Profile>

// Add profile
viewer.scene.addProfile(profile);
// Fires 'profile_added' event

// Remove profile
viewer.scene.removeProfile(profile);
// Fires 'profile_removed' event
```

### Profile Clipping Boxes

Each profile segment automatically creates a BoxVolume:

```javascript
// After adding markers, boxes are created
profile.addMarker(point1);
profile.addMarker(point2);

// Access the box for the first segment
const box = profile.boxes[0];
box.clip = true;  // Enable clipping
box.visible = true;  // Show box visualization

// These boxes are included in the clipping system automatically
// From viewer.js:1835-1868, profile boxes are collected each frame:
for (let profile of viewer.scene.profiles) {
    clipBoxes.push(...profile.boxes);
}
```

---

## Measurements & Annotations

### Measurements

**File**: [src/utils/Measure.js](src/utils/Measure.js)

#### Creating Measurements

```javascript
// Create measurement
const measurement = new Potree.Measure();
measurement.name = "Distance 1";

// Configure display
measurement.showDistances = true;
measurement.showArea = true;
measurement.showAngles = true;
measurement.closed = false;  // true for closed polygons

// Add points
measurement.addMarker(new THREE.Vector3(10, 20, 5));
measurement.addMarker(new THREE.Vector3(50, 20, 5));
measurement.addMarker(new THREE.Vector3(50, 60, 10));

// Add to scene
viewer.scene.addMeasurement(measurement);
// Fires 'measurement_added' event
```

#### Measurement API

**Methods:**

```javascript
// Add marker point
measurement.addMarker(position);  // THREE.Vector3

// Remove marker
measurement.removeMarker(index);

// Get total distance
const distance = measurement.getTotalDistance();

// Get area (for closed measurements)
const area = measurement.getArea();

// Update
measurement.update();
```

#### Scene Measurement Management

```javascript
// Access measurements
viewer.scene.measurements;  // Array<Measure>

// Remove measurement
viewer.scene.removeMeasurement(measurement);
// Fires 'measurement_removed' event

// Remove all measurements
viewer.scene.removeAllMeasurements();
```

### Annotations

**File**: [src/Annotation.js](src/Annotation.js)

#### Creating Annotations

```javascript
// Method 1: Via scene helper
const annotation = viewer.scene.addAnnotation(
    [x, y, z],  // position array
    {
        title: "Point of Interest",
        description: "This is an important location"
    }
);

// Method 2: Direct creation
const annotation = new Potree.Annotation({
    position: new THREE.Vector3(x, y, z),
    title: "POI",
    description: "Description text",
    cameraPosition: viewer.scene.getActiveCamera().position.clone(),
    cameraTarget: new THREE.Vector3(x, y, z)
});

viewer.scene.annotations.add(annotation);
```

#### Annotation API

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `annotation.position` | Vector3 | 3D world position |
| `annotation.title` | string | Annotation title |
| `annotation.description` | string | Description text |
| `annotation.cameraPosition` | Vector3 | Saved camera position |
| `annotation.cameraTarget` | Vector3 | Saved camera target |
| `annotation.visible` | boolean | Show/hide annotation |

**Methods:**

```javascript
// Animate camera to annotation viewpoint
annotation.moveTo(viewer);

// Remove annotation
viewer.scene.removeAnnotation(annotation);
```

---

## Render Loop & Event System

### The Render Loop

From [src/viewer/viewer.js](src/viewer/viewer.js:2124-2143):

```javascript
loop(timestamp) {
    this.update(this.clock.getDelta(), timestamp);
    this.render();
}

update(delta, timestamp) {
    // Update point cloud loading
    Potree.pointLoadLimit = this.pointBudget;

    // Update controls
    this.controls.update(delta);

    // Update scene
    this.scene.update();

    // Update tools
    this.measuringTool.update();
    this.profileTool.update();
    // ... etc

    // Dispatch update event
    this.dispatchEvent({
        type: 'update',
        delta: delta,
        timestamp: timestamp
    });
}

render() {
    // Delegate to active renderer (PotreeRenderer or EDLRenderer)
    this.renderer.render(this);
}
```

### Custom Render Loops

For integration with other engines (e.g., Cesium):

```javascript
// Disable default loop
const viewer = new Potree.Viewer(domElement, {
    useDefaultRenderLoop: false
});

// Implement custom loop
function customLoop(timestamp) {
    // Update Potree
    const delta = clock.getDelta();
    viewer.update(delta, timestamp);

    // Update other systems
    cesium.update();

    // Render
    viewer.render();

    requestAnimationFrame(customLoop);
}
customLoop();
```

### Event System

Potree uses THREE.js EventDispatcher pattern.

#### Viewer Events

```javascript
viewer.addEventListener('update', (e) => {
    // Fired every frame
    // e.delta - time since last frame
    // e.timestamp - total elapsed time
});

viewer.addEventListener('scene_changed', (e) => {
    // Fired when scene is swapped
    // e.oldScene, e.scene
});

viewer.addEventListener('camera_changed', (e) => {
    // Fired when camera type changes
    // e.previous, e.camera
});
```

#### Scene Events

```javascript
scene.addEventListener('pointcloud_added', (e) => {
    // e.pointcloud - the PointCloudOctree that was added
});

scene.addEventListener('volume_added', (e) => {
    // e.volume - the Volume that was added
});

scene.addEventListener('volume_removed', (e) => {
    // e.volume - the Volume that was removed
});

scene.addEventListener('measurement_added', (e) => {
    // e.measurement - the Measure that was added
});

scene.addEventListener('measurement_removed', (e) => {
    // e.measurement - the Measure that was removed
});

scene.addEventListener('profile_added', (e) => {
    // e.profile - the Profile that was added
});

scene.addEventListener('profile_removed', (e) => {
    // e.profile - the Profile that was removed
});
```

#### Render Pass Events

From [src/viewer/PotreeRenderer.js](src/viewer/PotreeRenderer.js):

```javascript
viewer.addEventListener('render.pass.begin', (e) => {
    // Before any rendering
    // Setup custom render state
});

viewer.addEventListener('render.pass.scene', (e) => {
    // After main scene, before overlays
    // Add depth-tested custom rendering
    e.viewer.renderer.render(customScene, camera);
});

viewer.addEventListener('render.pass.perspective_overlay', (e) => {
    // After clearDepth(), for always-on-top elements
    // Add overlay UI rendering
});

viewer.addEventListener('render.pass.end', (e) => {
    // After all rendering
    // Cleanup, post-processing
});
```

---

## Vue 3/Quasar/Pinia Integration

### Architecture Recommendation

**Important**: Do NOT store complex objects like the Potree viewer directly in Pinia stores.

**Why?**
- Vue's reactivity system wraps objects in Proxies, causing significant overhead
- The viewer has circular references that can cause reactivity issues
- Not serializable for devtools or persistence
- The viewer is a "service instance," not application state
- Memory impact from deep reactivity on large THREE.js object graphs

**Recommended Pattern**: Use `provide/inject` for the viewer instance + Pinia for lightweight metadata

### Provide/Inject Pattern for Viewer (Recommended)

```javascript
// composables/usePotree.js
import { shallowRef, readonly, provide, inject } from 'vue';
import * as Potree from '@/lib/potree/build/potree.js';

const POTREE_KEY = Symbol('potree');

// Factory function creates isolated viewer instance
function createPotreeInstance() {
  const viewer = shallowRef(null);
  const pointCloud = shallowRef(null);

  function initViewer(domElement, options = {}) {
    if (viewer.value) {
      console.warn('Viewer already initialized');
      return viewer.value;
    }

    viewer.value = new Potree.Viewer(domElement, {
      useDefaultRenderLoop: true,
      ...options
    });

    // Configure viewer
    viewer.value.setEDLEnabled(true);
    viewer.value.setFOV(60);
    viewer.value.setPointBudget(1_000_000);
    viewer.value.setBackground('gradient');

    return viewer.value;
  }

  function destroyViewer() {
    viewer.value = null;
    pointCloud.value = null;
  }

  function loadPointCloud(url, name, callback) {
    if (!viewer.value) {
      throw new Error('Viewer not initialized');
    }

    Potree.loadPointCloud(url, name, (e) => {
      pointCloud.value = e.pointcloud;
      pointCloud.value.material.size = 1;
      pointCloud.value.material.pointSizeType = Potree.PointSizeType.ADAPTIVE;

      viewer.value.scene.addPointCloud(pointCloud.value);
      viewer.value.fitToScreen();

      callback?.(e);
    }, true); // COPC
  }

  return {
    viewer: readonly(viewer),
    pointCloud: readonly(pointCloud),
    initViewer,
    destroyViewer,
    loadPointCloud
  };
}

// Provide pattern (called in App.vue or parent component)
export function providePotree() {
  const potree = createPotreeInstance();
  provide(POTREE_KEY, potree);
  return potree;
}

// Inject pattern (called in child components)
export function usePotree() {
  const potree = inject(POTREE_KEY);
  if (!potree) {
    throw new Error('usePotree must be used after providePotree in parent');
  }
  return potree;
}
```

### Pinia Store for Metadata Only

```javascript
// stores/potreeState.js
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const usePotreeState = defineStore('potreeState', () => {
  // Lightweight, serializable state ONLY
  const isViewerReady = ref(false);
  const pointCloudUrl = ref('');
  const pointCloudLoaded = ref(false);

  // Object metadata (not the actual THREE.js objects!)
  const customObjects = ref([]);
  const volumes = ref([]);
  const measurements = ref([]);
  const profiles = ref([]);

  // Settings
  const settings = ref({
    pointBudget: 1_000_000,
    edlEnabled: true,
    fov: 60,
    background: 'gradient'
  });

  // Statistics
  const frameCount = ref(0);

  // Actions for metadata
  function addObjectMetadata(metadata) {
    customObjects.value.push({
      id: metadata.id || crypto.randomUUID(),
      type: metadata.type,
      position: metadata.position, // Array, not Vector3
      properties: metadata.properties,
      createdAt: new Date().toISOString()
    });
  }

  function removeObjectMetadata(id) {
    const index = customObjects.value.findIndex(obj => obj.id === id);
    if (index > -1) {
      customObjects.value.splice(index, 1);
    }
  }

  function addVolumeMetadata(volumeData) {
    volumes.value.push({
      id: crypto.randomUUID(),
      position: volumeData.position,
      scale: volumeData.scale,
      rotation: volumeData.rotation,
      clip: volumeData.clip,
      createdAt: new Date().toISOString()
    });
  }

  function removeVolumeMetadata(id) {
    const index = volumes.value.findIndex(v => v.id === id);
    if (index > -1) {
      volumes.value.splice(index, 1);
    }
  }

  return {
    // State
    isViewerReady,
    pointCloudUrl,
    pointCloudLoaded,
    customObjects,
    volumes,
    measurements,
    profiles,
    settings,
    frameCount,

    // Actions
    addObjectMetadata,
    removeObjectMetadata,
    addVolumeMetadata,
    removeVolumeMetadata
  };
});
```

### Component Setup Pattern

```vue
<template>
  <div ref="viewerContainer" class="potree-viewer"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { providePotree } from '@/composables/usePotree';
import { usePotreeState } from '@/stores/potreeState';

const viewerContainer = ref(null);
const { initViewer, destroyViewer, loadPointCloud } = providePotree();
const state = usePotreeState();

onMounted(() => {
  // Initialize viewer (stored in provide/inject, NOT Pinia)
  initViewer(viewerContainer.value);
  state.isViewerReady = true;

  // Load point cloud
  loadPointCloud(state.pointCloudUrl, 'MainCloud', () => {
    state.pointCloudLoaded = true;
  });
});

onBeforeUnmount(() => {
  destroyViewer();
  state.isViewerReady = false;
});
</script>

<style scoped>
.potree-viewer {
  width: 100%;
  height: 100%;
}
</style>
```

### Composables vs. Utility Functions

**Important Distinction:**

**Composables** - Can call `usePotree()` internally:
- Must be called FROM components during `<script setup>` or `setup()`
- The `inject()` call works because they execute in component context
- Examples: `usePotreeManager()`, `usePotreeTools()`, `usePotreeAPI()`

**Utility Functions** - Must receive viewer as parameter:
- Can be called FROM anywhere (components, classes, callbacks, other utilities)
- Cannot use `inject()` because they're not in component setup context
- Examples: `extractPointsFromProfile(viewer, ...)`, `addMarker(viewer, ...)`

### Object Manager Composable (Links Viewer + Metadata)

**Note: This is a composable, so it must be called from within a component.**

This composable bridges the viewer (from provide/inject) with metadata (from Pinia):

```javascript
// composables/usePotreeManager.js
import { usePotree } from './usePotree';
import { usePotreeState } from '@/stores/potreeState';
import * as THREE from 'three';

export function usePotreeManager() {
  const { viewer } = usePotree();
  const state = usePotreeState();

  // Map to link metadata IDs to actual THREE.js objects
  const objectMap = new Map();

  function addCustomObject(type, geometry, material, position, properties = {}) {
    if (!viewer.value) {
      throw new Error('Viewer not initialized');
    }

    // Create THREE.js object (NOT stored in Pinia)
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);

    const id = crypto.randomUUID();
    mesh.userData.id = id;
    mesh.userData.type = type;

    // Add to scene
    viewer.value.scene.scene.add(mesh);

    // Store lightweight metadata in Pinia
    state.addObjectMetadata({
      id,
      type,
      position: position.toArray(),
      properties
    });

    // Link metadata ID to THREE.js object
    objectMap.set(id, mesh);

    return { id, mesh };
  }

  function removeCustomObject(id) {
    if (!viewer.value) return;

    const mesh = objectMap.get(id);
    if (!mesh) return;

    // Remove from scene
    viewer.value.scene.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();

    // Remove from map and Pinia
    objectMap.delete(id);
    state.removeObjectMetadata(id);
  }

  function getObject(id) {
    return objectMap.get(id);
  }

  function addVolume(position, scale, rotation = { x: 0, y: 0, z: 0 }) {
    if (!viewer.value) return null;

    const volume = new Potree.BoxVolume();
    volume.position.set(position.x, position.y, position.z);
    volume.scale.set(scale.x, scale.y, scale.z);
    volume.rotation.set(rotation.x, rotation.y, rotation.z);
    volume.clip = true;
    volume.modifiable = true;

    viewer.value.scene.addVolume(volume);

    // Store metadata
    state.addVolumeMetadata({
      position: position.toArray ? position.toArray() : [position.x, position.y, position.z],
      scale: scale.toArray ? scale.toArray() : [scale.x, scale.y, scale.z],
      rotation: [rotation.x, rotation.y, rotation.z],
      clip: true
    });

    return volume;
  }

  return {
    addCustomObject,
    removeCustomObject,
    getObject,
    addVolume
  };
}
```

### Utility Functions with Explicit Parameters

**When to use utility functions instead of composables:**
- When you need to call the function from outside a component (classes, callbacks, workers, etc.)
- When the function is purely algorithmic and doesn't need component context
- When you want maximum testability and reusability

For utility functions that need the viewer, pass it explicitly:

```javascript
// utils/pointCloudUtils.js
import * as THREE from 'three';

/**
 * Extract points from a profile
 * @param {Potree.Viewer} viewer - The Potree viewer instance
 * @param {Potree.Profile} profile - The profile to extract from
 * @param {number} maxDepth - Maximum octree depth
 * @returns {Promise} Promise resolving to extracted point data
 */
export function extractPointsFromProfile(viewer, profile, maxDepth = 5) {
  if (!viewer) {
    throw new Error('Viewer is required');
  }

  const pointcloud = viewer.scene.pointclouds[0];
  if (!pointcloud) {
    throw new Error('No point cloud loaded');
  }

  return new Promise((resolve, reject) => {
    pointcloud.getPointsInProfile(profile, maxDepth, (data) => {
      resolve(data);
    });
  });
}

/**
 * Add a custom marker to the scene
 * @param {Potree.Viewer} viewer - The Potree viewer instance
 * @param {THREE.Vector3} position - Marker position
 * @param {number} color - Marker color (hex)
 * @param {number} size - Marker size
 * @returns {THREE.Mesh} The created marker mesh
 */
export function addMarker(viewer, position, color = 0xff0000, size = 2) {
  if (!viewer) {
    throw new Error('Viewer is required');
  }

  const geometry = new THREE.SphereGeometry(size, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.copy(position);

  viewer.scene.scene.add(marker);

  return marker;
}

/**
 * Calculate distance between two points
 * @param {THREE.Vector3} point1 - First point
 * @param {THREE.Vector3} point2 - Second point
 * @returns {number} Distance in world units
 */
export function calculateDistance(point1, point2) {
  return point1.distanceTo(point2);
}
```

**Usage from a component:**

```vue
<script setup>
import { usePotree } from '@/composables/usePotree';
import { extractPointsFromProfile, addMarker } from '@/utils/pointCloudUtils';

const { viewer } = usePotree();

async function handleExtractProfile(profile) {
  // Pass viewer explicitly to utility
  const data = await extractPointsFromProfile(viewer.value, profile, 5);
  console.log(`Extracted ${data.numPoints} points`);
}

function handleAddMarker(position) {
  // Pass viewer explicitly to utility
  const marker = addMarker(viewer.value, position, 0xff0000, 2);
  console.log('Marker added:', marker);
}
</script>
```

**Usage from a non-component context (class, callback, etc.):**

```javascript
// services/PointCloudAnalyzer.js
import { extractPointsFromProfile } from '@/utils/pointCloudUtils';

export class PointCloudAnalyzer {
  constructor(viewer) {
    this.viewer = viewer;
  }

  async analyzeProfile(profile) {
    // Utility function works here because we pass viewer explicitly
    // Cannot use composables here - we're not in a component!
    const data = await extractPointsFromProfile(this.viewer, profile, 5);
    return this.processData(data);
  }

  processData(data) {
    // Analysis logic...
  }
}

// Usage:
// In component:
const { viewer } = usePotree();
const analyzer = new PointCloudAnalyzer(viewer.value);

// Later, even in callbacks:
setTimeout(() => {
  analyzer.analyzeProfile(someProfile); // Works because viewer was passed to constructor
}, 5000);
```

### Reactive UI Updates

The UI displays lightweight metadata from Pinia (serializable and reactive):

```vue
<template>
  <div class="tools-panel">
    <!-- Display metadata from Pinia -->
    <h3>Custom Objects ({{ state.customObjects.length }})</h3>
    <ul>
      <li v-for="obj in state.customObjects" :key="obj.id">
        {{ obj.type }} at [{{ obj.position.join(', ') }}]
        <button @click="removeObject(obj.id)">Remove</button>
      </li>
    </ul>

    <h3>Volumes ({{ state.volumes.length }})</h3>
    <ul>
      <li v-for="volume in state.volumes" :key="volume.id">
        Volume at [{{ volume.position.join(', ') }}]
        <span v-if="volume.clip">(Clipping Enabled)</span>
        <button @click="removeVolume(volume.id)">Remove</button>
      </li>
    </ul>

    <h3>Viewer Status</h3>
    <p>Ready: {{ state.isViewerReady }}</p>
    <p>Point Cloud Loaded: {{ state.pointCloudLoaded }}</p>
    <p>Frame Count: {{ state.frameCount }}</p>
  </div>
</template>

<script setup>
import { usePotreeState } from '@/stores/potreeState';
import { usePotreeManager } from '@/composables/usePotreeManager';

const state = usePotreeState();
const manager = usePotreeManager();

function removeObject(id) {
  // This removes both the THREE.js object and Pinia metadata
  manager.removeCustomObject(id);
}

function removeVolume(id) {
  // Implementation depends on how you track volume instances
  // You may need to maintain a similar Map for volumes
  state.removeVolumeMetadata(id);
}
</script>
```

### Benefits of This Architecture

**Provide/Inject for Viewer:**
- ✅ No reactivity overhead on complex objects
- ✅ Proper lifecycle management tied to component tree
- ✅ Isolated instances for testing
- ✅ Works with SSR if needed

**Pinia for Metadata:**
- ✅ Reactive UI updates
- ✅ Serializable state (can save/restore)
- ✅ Debuggable in Vue devtools
- ✅ Can sync with external APIs easily

**Explicit Parameters for Utilities:**
- ✅ Clear dependencies
- ✅ Easy to test (just pass mock viewer)
- ✅ No hidden global state
- ✅ Works in non-component contexts

### Decision Guide: Composable or Utility?

| Scenario | Use | Why |
|----------|-----|-----|
| Called from `<script setup>` or component `setup()` | Composable | Can use `inject()` |
| Called from a class | Utility | No component context |
| Called from a setTimeout/setInterval callback | Utility | No component context |
| Called from a Web Worker | Utility | No component context |
| Pure algorithm (no Vue features needed) | Utility | More testable |
| Needs reactive refs or computed | Composable | Requires Vue runtime |
| Called from another composable | Composable | Still in component context |

---

## API Reference

### Viewer Class

**File**: [src/viewer/viewer.js](src/viewer/viewer.js)

#### Constructor

```javascript
new Viewer(domElement, args = {})
```

**Parameters:**
- `domElement`: HTMLElement - Container for the viewer
- `args.onPointCloudLoaded`: Function - Callback when point cloud loads
- `args.noDragAndDrop`: boolean - Disable drag and drop
- `args.useDefaultRenderLoop`: boolean - Use built-in render loop (default: true)

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `scene` | Scene | The Scene instance |
| `renderer` | WebGLRenderer | THREE.js WebGL renderer |
| `controls` | Controls | Active camera controls |
| `inputHandler` | InputHandler | Input event handler |
| `clippingTool` | ClippingTool | Clipping volume tool |
| `transformationTool` | TransformationTool | Object transformation tool |
| `measuringTool` | MeasuringTool | Measurement tool |
| `profileTool` | ProfileTool | Profile tool |
| `volumeTool` | VolumeTool | Volume tool |
| `annotationTool` | AnnotationTool | Annotation tool |

#### Methods

##### Configuration

```javascript
setFOV(value: number): void
setPointBudget(value: number): void  // Max points per frame
setEDLEnabled(enabled: boolean): void  // Eye-Dome Lighting
setBackground(type: string): void  // 'skybox' | 'gradient' | 'black' | 'white'
setMoveSpeed(value: number): void
setControls(controls: Controls): void
```

##### Camera

```javascript
fitToScreen(factor?: number): void  // Fit camera to point cloud
setTopView(): void
setFrontView(): void
setLeftView(): void
setRightView(): void
```

##### Rendering

```javascript
update(delta: number, timestamp: number): void
render(): void
loop(timestamp: number): void
```

### Scene Class

**File**: [src/viewer/Scene.js](src/viewer/Scene.js)

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `scene` | THREE.Scene | Main scene for objects |
| `scenePointCloud` | THREE.Scene | Point cloud scene |
| `sceneBG` | THREE.Scene | Background scene |
| `view` | View | Camera view controller |
| `cameraP` | PerspectiveCamera | Perspective camera |
| `cameraO` | OrthographicCamera | Orthographic camera |
| `pointclouds` | Array<PointCloudOctree> | Point clouds in scene |
| `measurements` | Array<Measure> | Measurements in scene |
| `profiles` | Array<Profile> | Profiles in scene |
| `volumes` | Array<Volume> | Volumes in scene |
| `polygonClipVolumes` | Array<PolygonClipVolume> | Polygon clip volumes |
| `annotations` | AnnotationGroup | Annotations |

#### Methods

```javascript
addPointCloud(pointcloud: PointCloudOctree): void
addMeasurement(measurement: Measure): void
removeMeasurement(measurement: Measure): void
removeAllMeasurements(): void
addProfile(profile: Profile): void
removeProfile(profile: Profile): void
addVolume(volume: Volume): void
removeVolume(volume: Volume): void
removeAllClipVolumes(): void
addAnnotation(position: Array, options: Object): Annotation
removeAnnotation(annotation: Annotation): void
getActiveCamera(): Camera
```

### BoxVolume Class

**File**: [src/utils/Volume.js](src/utils/Volume.js)

#### Constructor

```javascript
new BoxVolume()
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `clip` | boolean | Enable/disable clipping |
| `modifiable` | boolean | Show transformation handles |
| `position` | Vector3 | Center position |
| `scale` | Vector3 | Dimensions (half-extents) |
| `rotation` | Euler | Rotation |
| `box` | Mesh | Visual representation |
| `frame` | LineSegments | Wireframe |

#### Methods

```javascript
getVolume(): number  // Returns volume in cubic units
```

### Profile Class

**File**: [src/utils/Profile.js](src/utils/Profile.js)

#### Constructor

```javascript
new Profile()
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Profile name |
| `width` | number | Width in world units |
| `height` | number | Height in world units |
| `points` | Array<Vector3> | Path points |
| `spheres` | Array<Mesh> | Marker spheres |
| `edges` | Array<Line> | Connection lines |
| `boxes` | Array<BoxVolume> | Segment clipping boxes |
| `modifiable` | boolean | Show marker handles |

#### Methods

```javascript
addMarker(position: Vector3): void
removeMarker(index: number): void
setPosition(index: number, position: Vector3): void
setWidth(width: number): void
getSegments(): Array<{start: Vector3, end: Vector3}>
getSegmentMatrices(): Array<Matrix4>
update(): void
```

### Measure Class

**File**: [src/utils/Measure.js](src/utils/Measure.js)

#### Constructor

```javascript
new Measure()
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Measurement name |
| `showDistances` | boolean | Show distance labels |
| `showArea` | boolean | Show area label |
| `showAngles` | boolean | Show angle labels |
| `closed` | boolean | Closed polygon |
| `points` | Array<Vector3> | Measurement points |

#### Methods

```javascript
addMarker(position: Vector3): void
removeMarker(index: number): void
getTotalDistance(): number
getArea(): number
update(): void
```

### Point Cloud Material

**File**: [src/materials/PointCloudMaterial.js](src/materials/PointCloudMaterial.js)

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `size` | number | Point size |
| `minSize` | number | Minimum point size |
| `pointSizeType` | PointSizeType | ADAPTIVE or FIXED |
| `activeAttributeName` | string | Active attribute ('rgba', 'intensity', etc.) |
| `shape` | PointShape | SQUARE, CIRCLE, PARABOLOID |
| `intensityRange` | [number, number] | Intensity min/max |
| `elevationRange` | [number, number] | Elevation min/max |

---

## Code Examples

### Example 1: Basic Setup with COPC

```javascript
import * as Potree from '@/lib/potree/build/potree.js';

// Initialize viewer
const viewer = new Potree.Viewer(document.getElementById('viewer'), {
  useDefaultRenderLoop: true
});

viewer.setEDLEnabled(true);
viewer.setFOV(60);
viewer.setPointBudget(1_000_000);
viewer.setBackground('gradient');

// Load COPC point cloud
Potree.loadPointCloud('/data/pointcloud.copc.laz', 'MainCloud', (e) => {
  const pointcloud = e.pointcloud;

  // Configure material
  pointcloud.material.size = 1;
  pointcloud.material.pointSizeType = Potree.PointSizeType.ADAPTIVE;
  pointcloud.material.activeAttributeName = 'rgba';

  // Add to scene
  viewer.scene.addPointCloud(pointcloud);

  // Fit camera
  viewer.fitToScreen();
}, true);  // COPC flag
```

### Example 2: Adding Custom THREE.js Objects

```javascript
import * as THREE from 'three';

// Create sphere marker
const geometry = new THREE.SphereGeometry(2, 32, 32);
const material = new THREE.MeshStandardMaterial({
  color: 0xff0000,
  emissive: 0x330000
});
const marker = new THREE.Mesh(geometry, material);
marker.position.set(100, 200, 50);

// Add to main scene
viewer.scene.scene.add(marker);

// Add light for the material
const light = new THREE.DirectionalLight(0xffffff, 1.0);
light.position.set(100, 100, 100);
viewer.scene.scene.add(light);

// Remove later
viewer.scene.scene.remove(marker);
marker.geometry.dispose();
marker.material.dispose();
```

### Example 3: Creating Custom Scene with Render Hook

```javascript
import * as THREE from 'three';

// Create custom scene
const customScene = new THREE.Scene();

// Add objects to custom scene
const box = new THREE.Mesh(
  new THREE.BoxGeometry(5, 5, 5),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
box.position.set(50, 50, 25);
customScene.add(box);

// Hook into render pipeline
viewer.addEventListener("render.pass.scene", (event) => {
  // Render after main scene, respects depth buffer
  event.viewer.renderer.render(
    customScene,
    event.viewer.scene.getActiveCamera()
  );
});

// Update objects in update loop
viewer.addEventListener("update", (event) => {
  // Animate box
  box.rotation.y += event.delta;
});
```

### Example 4: Creating BoxVolume for Clipping

```javascript
// Create box volume
const volume = new Potree.BoxVolume();

// Position and size
volume.position.set(100, 200, 50);
volume.scale.set(20, 20, 10);  // 40x40x20 box
volume.rotation.set(0, Math.PI / 4, 0);  // Rotate 45 degrees

// Enable clipping
volume.clip = true;
volume.modifiable = true;  // Allow user to move/resize

// Add to scene
viewer.scene.addVolume(volume);

// Listen for changes
viewer.scene.addEventListener('volume_added', (e) => {
  console.log('Volume added:', e.volume);
});

// Set clip mode
viewer.clipTask = Potree.ClipTask.SHOW_INSIDE;

// Remove volume
viewer.scene.removeVolume(volume);
```

### Example 5: Creating Profile

```javascript
// Create profile
const profile = new Potree.Profile();
profile.name = "Section A-A";
profile.width = 5;
profile.height = 100;

// Add path points
profile.addMarker(new THREE.Vector3(50, 100, 20));
profile.addMarker(new THREE.Vector3(150, 100, 20));
profile.addMarker(new THREE.Vector3(150, 200, 30));

// Add to scene
viewer.scene.addProfile(profile);

// Extract point data
pointcloud.getPointsInProfile(profile, 5, (data) => {
  console.log(`Extracted ${data.numPoints} points from profile`);

  // Access point attributes
  // data contains position, color, intensity, classification, etc.
});

// Listen for marker changes
profile.addEventListener('marker_moved', (e) => {
  console.log('Marker moved:', e.index, e.position);

  // Re-extract points if needed
  pointcloud.getPointsInProfile(profile, 5, updateCallback);
});
```

### Example 6: Vue 3 Composable for Object Management

**Note: This is a COMPOSABLE (not a utility function)**. It must be called from a component.

```javascript
// composables/usePotreeTools.js
import { usePotree } from './usePotree';
import { usePotreeState } from '@/stores/potreeState';
import * as THREE from 'three';
import * as Potree from '@/lib/potree/build/potree.js';

export function usePotreeTools() {
  // inject() works because usePotreeTools() is called FROM a component
  const { viewer } = usePotree();
  const state = usePotreeState();

  function addMarker(position, color = 0xff0000) {
    if (!viewer.value) {
      throw new Error('Viewer not initialized');
    }

    const geometry = new THREE.SphereGeometry(2, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(position);

    // Add to scene (viewer from provide/inject)
    viewer.value.scene.scene.add(marker);

    // Store metadata in Pinia
    state.addObjectMetadata({
      type: 'marker',
      position: position.toArray(),
      properties: { color, size: 2 }
    });

    return marker;
  }

  function createClippingBox(center, size) {
    if (!viewer.value) return null;

    const volume = new Potree.BoxVolume();
    volume.position.copy(center);
    volume.scale.copy(size);
    volume.clip = true;
    volume.modifiable = true;

    viewer.value.scene.addVolume(volume);

    // Store metadata
    state.addVolumeMetadata({
      position: center.toArray(),
      scale: size.toArray(),
      rotation: [0, 0, 0],
      clip: true
    });

    return volume;
  }

  function createMeasurement(points) {
    if (!viewer.value) return null;

    const measurement = new Potree.Measure();
    measurement.name = `Measurement ${state.measurements.length + 1}`;
    measurement.showDistances = true;

    points.forEach(point => {
      measurement.addMarker(point);
    });

    viewer.value.scene.addMeasurement(measurement);

    return measurement;
  }

  function createProfile(pathPoints, width = 5) {
    if (!viewer.value) return null;

    const profile = new Potree.Profile();
    profile.name = `Profile ${state.profiles.length + 1}`;
    profile.width = width;
    profile.height = 100;

    pathPoints.forEach(point => {
      profile.addMarker(point);
    });

    viewer.value.scene.addProfile(profile);

    return profile;
  }

  return {
    addMarker,
    createClippingBox,
    createMeasurement,
    createProfile
  };
}
```

### Example 7: API Integration Pattern

**Note: This is a COMPOSABLE (not a utility function)**. It must be called from a component.

Sync lightweight metadata (stored in Pinia) with external API:

```javascript
// composables/usePotreeAPI.js
import { usePotree } from './usePotree';
import { usePotreeState } from '@/stores/potreeState';
import * as THREE from 'three';
import axios from 'axios';

export function usePotreeAPI() {
  // inject() works because usePotreeAPI() is called FROM a component
  const { viewer } = usePotree();
  const state = usePotreeState();

  // Map to track THREE.js objects by metadata ID
  const objectMap = new Map();

  /**
   * Add object to scene and sync to API
   */
  async function addObjectAndSync(type, geometry, material, position, properties = {}) {
    if (!viewer.value) {
      throw new Error('Viewer not initialized');
    }

    // Create THREE.js object
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);

    const id = crypto.randomUUID();
    mesh.userData.id = id;

    // Add to scene
    viewer.value.scene.scene.add(mesh);
    objectMap.set(id, mesh);

    // Create metadata
    const metadata = {
      id,
      type,
      position: position.toArray(),
      properties,
      createdAt: new Date().toISOString()
    };

    // Sync to external API first
    try {
      const response = await axios.post('/api/scene/objects', metadata);

      // Store API ID in metadata
      metadata.apiId = response.data.id;

      // Store in Pinia (with API ID)
      state.addObjectMetadata(metadata);

      return { id, mesh, apiId: response.data.id };
    } catch (error) {
      // Rollback on API error
      viewer.value.scene.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      objectMap.delete(id);

      console.error('Failed to sync object to API:', error);
      throw error;
    }
  }

  /**
   * Remove object from scene and sync to API
   */
  async function removeObjectAndSync(id) {
    if (!viewer.value) return;

    const mesh = objectMap.get(id);
    const metadata = state.customObjects.find(obj => obj.id === id);

    if (!mesh || !metadata) {
      console.warn('Object not found:', id);
      return;
    }

    // Remove from scene
    viewer.value.scene.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    objectMap.delete(id);

    // Sync deletion to API
    if (metadata.apiId) {
      try {
        await axios.delete(`/api/scene/objects/${metadata.apiId}`);
      } catch (error) {
        console.error('Failed to delete object from API:', error);
        // Continue with local removal even if API fails
      }
    }

    // Remove from Pinia
    state.removeObjectMetadata(id);
  }

  /**
   * Update object properties and sync to API
   */
  async function updateObjectProperties(id, properties) {
    const metadata = state.customObjects.find(obj => obj.id === id);

    if (!metadata) {
      console.warn('Object metadata not found:', id);
      return;
    }

    // Update metadata locally
    Object.assign(metadata.properties, properties);

    // Sync to API
    if (metadata.apiId) {
      try {
        await axios.patch(`/api/scene/objects/${metadata.apiId}`, {
          properties
        });
      } catch (error) {
        console.error('Failed to update object in API:', error);
        throw error;
      }
    }
  }

  /**
   * Load entire scene from API
   */
  async function loadSceneFromAPI(sceneId) {
    if (!viewer.value) {
      throw new Error('Viewer not initialized');
    }

    try {
      const response = await axios.get(`/api/scenes/${sceneId}`);
      const sceneData = response.data;

      // Load objects
      for (const objData of sceneData.objects) {
        // Recreate geometry based on type
        const geometry = createGeometry(objData.type, objData.properties);
        const material = createMaterial(objData.properties);
        const position = new THREE.Vector3(...objData.position);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.userData.id = objData.id;

        viewer.value.scene.scene.add(mesh);
        objectMap.set(objData.id, mesh);

        // Store metadata in Pinia
        state.addObjectMetadata({
          id: objData.id,
          type: objData.type,
          position: objData.position,
          properties: objData.properties,
          apiId: objData.apiId
        });
      }

      // Load volumes
      for (const volData of sceneData.volumes) {
        state.addVolumeMetadata(volData);
      }

      return sceneData;
    } catch (error) {
      console.error('Failed to load scene from API:', error);
      throw error;
    }
  }

  /**
   * Save entire scene to API
   */
  async function saveSceneToAPI(sceneName) {
    try {
      const sceneData = {
        name: sceneName,
        objects: state.customObjects,
        volumes: state.volumes,
        measurements: state.measurements,
        timestamp: new Date().toISOString()
      };

      const response = await axios.post('/api/scenes', sceneData);

      return response.data;
    } catch (error) {
      console.error('Failed to save scene to API:', error);
      throw error;
    }
  }

  // Helper functions
  function createGeometry(type, properties) {
    switch (type) {
      case 'marker':
        return new THREE.SphereGeometry(properties.size || 2, 16, 16);
      case 'box':
        return new THREE.BoxGeometry(
          properties.width || 1,
          properties.height || 1,
          properties.depth || 1
        );
      default:
        return new THREE.SphereGeometry(1, 16, 16);
    }
  }

  function createMaterial(properties) {
    return new THREE.MeshBasicMaterial({
      color: properties.color || 0xff0000,
      transparent: properties.transparent || false,
      opacity: properties.opacity || 1
    });
  }

  return {
    addObjectAndSync,
    removeObjectAndSync,
    updateObjectProperties,
    loadSceneFromAPI,
    saveSceneToAPI
  };
}
```

**Usage in a component:**

```vue
<script setup>
import { usePotreeAPI } from '@/composables/usePotreeAPI';
import { usePotreeState } from '@/stores/potreeState';
import * as THREE from 'three';

// Called from component setup - inject() will work
const api = usePotreeAPI();
const state = usePotreeState();

// Add object with API sync
async function addMarkerWithSync() {
  const geometry = new THREE.SphereGeometry(2, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const position = new THREE.Vector3(100, 200, 50);

  try {
    const result = await api.addObjectAndSync(
      'marker',
      geometry,
      material,
      position,
      { color: 0xff0000, size: 2 }
    );

    console.log('Object synced with API:', result.apiId);
  } catch (error) {
    console.error('Failed to add object:', error);
  }
}

// Load scene from API
async function loadScene(sceneId) {
  try {
    await api.loadSceneFromAPI(sceneId);
    console.log('Scene loaded successfully');
  } catch (error) {
    console.error('Failed to load scene:', error);
  }
}

// Save current scene to API
async function saveScene() {
  try {
    const result = await api.saveSceneToAPI('My Scene');
    console.log('Scene saved with ID:', result.id);
  } catch (error) {
    console.error('Failed to save scene:', error);
  }
}
</script>
```

---

## File Reference Map

### Core Architecture

| File | Lines | Description |
|------|-------|-------------|
| [src/viewer/viewer.js](src/viewer/viewer.js) | 2327 | Main Viewer class, render loop, tools |
| [src/viewer/Scene.js](src/viewer/Scene.js) | 437 | Scene management, three THREE.Scene instances |
| [src/viewer/View.js](src/viewer/View.js) | 192 | Camera view controller |
| [src/Potree.js](src/Potree.js) | 345 | Main exports, loadPointCloud() |

### Rendering

| File | Lines | Description |
|------|-------|-------------|
| [src/PotreeRenderer.js](src/PotreeRenderer.js) | ~1500 | Point cloud renderer with shader system |
| [src/viewer/PotreeRenderer.js](src/viewer/PotreeRenderer.js) | 127 | Simple renderer (no EDL) |
| [src/viewer/EDLRenderer.js](src/viewer/EDLRenderer.js) | 341 | Eye-Dome Lighting renderer |

### Point Clouds

| File | Lines | Description |
|------|-------|-------------|
| [src/PointCloudOctree.js](src/PointCloudOctree.js) | ~700 | PointCloudOctree class |
| [src/PointCloudTree.js](src/PointCloudTree.js) | 51 | Base class for point clouds |
| [src/materials/PointCloudMaterial.js](src/materials/PointCloudMaterial.js) | ~2000 | Point cloud material and shaders |
| [src/loader/EptLoader.js](src/loader/EptLoader.js) | ~250 | EPT/COPC loader |

### Tools & Utilities

| File | Lines | Description |
|------|-------|-------------|
| [src/utils/Volume.js](src/utils/Volume.js:106-204) | 204 | BoxVolume class |
| [src/utils/PolygonClipVolume.js](src/utils/PolygonClipVolume.js) | ~100 | PolygonClipVolume class |
| [src/utils/Profile.js](src/utils/Profile.js) | ~350 | Profile class for cross-sections |
| [src/utils/Measure.js](src/utils/Measure.js) | ~600 | Measurement class |
| [src/Annotation.js](src/Annotation.js) | ~200 | Annotation system |
| [src/utils/MeasuringTool.js](src/utils/MeasuringTool.js) | ~250 | Interactive measurement tool |
| [src/utils/VolumeTool.js](src/utils/VolumeTool.js) | ~200 | Interactive volume tool |
| [src/utils/ProfileTool.js](src/utils/ProfileTool.js) | ~150 | Interactive profile tool |
| [src/utils/ClippingTool.js](src/utils/ClippingTool.js) | ~300 | Interactive clipping tool |

### Navigation

| File | Lines | Description |
|------|-------|-------------|
| [src/navigation/OrbitControls.js](src/navigation/OrbitControls.js) | ~400 | Orbit camera controls |
| [src/navigation/FirstPersonControls.js](src/navigation/FirstPersonControls.js) | ~350 | First-person controls |
| [src/navigation/EarthControls.js](src/navigation/EarthControls.js) | ~450 | Earth/globe controls |
| [src/navigation/InputHandler.js](src/navigation/InputHandler.js) | ~300 | Input event handling |

### Profile Rendering

| File | Lines | Description |
|------|-------|-------------|
| [src/viewer/profile.js](src/viewer/profile.js) | ~400 | Profile view window and rendering |

---

## Key Concepts Summary

### Scene Architecture
- **Three hard-coded scenes**: main scene, point cloud scene, background scene
- **Not dynamically extensible**: Must use event hooks for custom scenes
- **Depth buffer management**: Controls render order and overlay behavior

### Clipping System
- **Shader-based**: More efficient than THREE.js native clipping
- **Box volumes**: 3D rectangular clipping regions
- **Polygon volumes**: 2D screen-space polygon clipping
- **Clip modes**: SHOW_INSIDE, SHOW_OUTSIDE, HIGHLIGHT

### Profiles
- **Multi-segment paths**: Define cross-section extraction paths
- **Automatic clipping boxes**: Each segment creates a BoxVolume
- **Point extraction**: Extract full point attributes within profile
- **Separate rendering**: 2D orthographic view of profile data

### Object Management
- **Direct THREE.js access**: Add any Object3D to viewer.scene.scene
- **Memory management**: Always dispose geometry/materials
- **Event-driven**: Use events for reactive UI updates

### Vue 3 Integration
- **Provide/inject for viewer**: No reactivity overhead, proper lifecycle management
- **Pinia for metadata**: Serializable, reactive state (not complex objects)
- **Composables**: Bridge viewer and metadata, encapsulate operations
- **Explicit parameters**: Pass viewer to utility functions for clarity
- **API synchronization**: Store metadata in Pinia, sync with external APIs

---

## Additional Resources

- **THREE.js Documentation**: https://threejs.org/docs/
- **Potree GitHub**: https://github.com/potree/potree
- **COPC Specification**: https://copc.io/

---

**Document Version**: 1.2
**Last Updated**: 2025-11-12
**Repository**: katapult-potree (develop branch)

**Changelog**:
- v1.2: Clarified distinction between composables (can use `inject()` from component context) and utility functions (require explicit parameters)
- v1.1: Updated Vue 3 integration pattern - use provide/inject for viewer instance, Pinia for metadata only
- v1.0: Initial documentation
